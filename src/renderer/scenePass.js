/**
 * ScenePass — orchestrates the full render pass.
 *
 * - Computes per-node world matrices (depth-first hierarchy pass)
 * - Sorts parts by draw_order
 * - Builds camera MVP from view (zoom/pan)
 * - Multiplies camera MVP × world matrix for each part
 * - Issues draw calls via PartRenderer
 * - Respects editor.overlays and node.visible
 */
import { createProgram } from './program.js';
import { MESH_VERT, MESH_FRAG, WIRE_VERT, WIRE_FRAG } from './shaders/mesh.js';
import { PartRenderer } from './partRenderer.js';
import { BackgroundRenderer } from './backgroundRenderer.js';
import { computeWorldMatrices, computeEffectiveProps, mat3Mul } from './transforms.js';
import { matchTag } from '../io/psdOrganizer.js';

/**
 * Returns stencil info for iris/eyewhite clipping.
 * Match irides to eyewhites by side suffixes (-l, -r, etc).
 */
function getIrisStencilInfo(name) {
  const tag = matchTag(name);
  if (tag !== 'irides' && tag !== 'eyewhite') return null;

  const lower = name.toLowerCase();
  let sideId = 1; // Default/Center
  if (lower.includes('-l') || lower.includes('_l') || lower.includes(' l') || lower.endsWith(' l')) sideId = 2;
  else if (lower.includes('-r') || lower.includes('_r') || lower.includes(' r') || lower.endsWith(' r')) sideId = 3;
  
  return { type: tag, id: sideId };
}

/**
 * Build the camera MVP: maps image-pixel world coords → NDC.
 *   scale by zoom, translate by pan, flip Y, normalise by canvas size.
 *
 * @returns {Float32Array} 9-element column-major mat3
 */
function buildCameraMatrix(canvasW, canvasH, zoom, panX, panY) {
  const sx = (2 * zoom) / canvasW;
  const sy = -(2 * zoom) / canvasH; // flip Y (WebGL Y is up)
  const tx = (panX / canvasW) * 2 - 1;
  const ty = 1 - (panY / canvasH) * 2;

  // Column-major mat3:
  // [ sx   0  0 ]
  // [  0  sy  0 ]
  // [ tx  ty  1 ]
  return new Float32Array([
    sx,  0,   0,
    0,   sy,  0,
    tx,  ty,  1,
  ]);
}

export class ScenePass {
  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;

    const meshProg = createProgram(gl, MESH_VERT, MESH_FRAG);
    const wireProg = createProgram(gl, WIRE_VERT, WIRE_FRAG);

    this.meshProgram  = meshProg.program;
    this.meshUniforms = meshProg.uniforms;
    this.wireProgram  = wireProg.program;
    this.wireUniforms = wireProg.uniforms;

    this.bgRenderer   = new BackgroundRenderer(gl);
    this.partRenderer = new PartRenderer(gl, this.meshProgram, this.wireProgram);

    this.gl.enable(gl.BLEND);
    this.gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Main draw call. Called once per rAF when the scene is dirty.
   *
   * @param {Object}  project       - projectStore.project
   * @param {Object}  editor        - editorStore state
   * @param {boolean} isDark        - whether current theme is dark
   * @param {Map}     poseOverrides - optional Map<nodeId, {x?,y?,rotation?,scaleX?,scaleY?,opacity?}>
   *                                  from animationStore; applied on top of stored transforms
   */
  draw(project, editor, isDark = true, poseOverrides = null, { skipResize = false, exportMode = false } = {}) {
    const { gl } = this;
    const { canvas } = gl;

    // Resize if needed (skipped during export to preserve export dimensions)
    if (!skipResize) {
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width  = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    // Clear stencil buffer (requires mask to be enabled)
    gl.stencilMask(0xFF);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);

    // In export mode, clear to transparent and skip background renderer
    if (exportMode) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    const { zoom, panX, panY } = editor.view;
    const canvasArea = project?.canvas ?? null;
    if (!exportMode) {
      this.bgRenderer.draw(zoom, panX, panY, canvas.width, canvas.height, isDark, canvasArea);
    }

    if (!project || project.nodes.length === 0) return;

    const camera = buildCameraMatrix(canvas.width, canvas.height, zoom, panX, panY);

    const overlays     = editor.overlays   ?? {};
    const selectionSet = new Set(editor.selection ?? []);
    const meshEditMode = editor.meshEditMode && selectionSet.size > 0;

    // ── Apply pose overrides (from animation playback) ────────────────────
    // Build an effective node list with interpolated transforms merged in.
    // This avoids mutating projectStore state during playback.
    const effectiveNodes = (poseOverrides && poseOverrides.size > 0)
      ? project.nodes.map(node => {
          const ov = poseOverrides.get(node.id);
          if (!ov) return node;
          const transformOv = { ...node.transform };
          for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) {
            if (ov[k] !== undefined) transformOv[k] = ov[k];
          }
          return {
            ...node,
            transform: transformOv,
            opacity: ov.opacity !== undefined ? ov.opacity : node.opacity,
            visible: ov.visible !== undefined ? ov.visible : node.visible,
          };
        })
      : project.nodes;

    // ── Hierarchy pass: compute world matrix and effective vis/opacity ────
    const worldMatrices = computeWorldMatrices(effectiveNodes);
    const { visMap, opMap } = computeEffectiveProps(effectiveNodes);

    // Sort parts by draw_order ascending (groups are never rendered directly)
    const parts = effectiveNodes
      .filter(n => n.type === 'part')
      .sort((a, b) => a.draw_order - b.draw_order);

    // ── Textured mesh pass ────────────────────────────────────────────────
    if (overlays.showImage !== false) {
      gl.useProgram(this.meshProgram);
      const uMvp     = this.meshUniforms('u_mvp');
      const uTexture = this.meshUniforms('u_texture');
      const uOpacity = this.meshUniforms('u_opacity');

      for (const part of parts) {
        if (!visMap.get(part.id)) continue;

        // ── Stencil Clipping (Iris → Eyewhite) ──
        const sInfo = overlays.irisClipping !== false ? getIrisStencilInfo(part.name) : null;
        if (sInfo) {
          gl.enable(gl.STENCIL_TEST);
          if (sInfo.type === 'eyewhite') {
            // Eyewhite acts as a mask: always pass, and replace stencil value with our side ID
            gl.stencilFunc(gl.ALWAYS, sInfo.id, 0xFF);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
            gl.stencilMask(0xFF);
          } else {
            // Iris is clipped: only draw where stencil matches our side ID
            gl.stencilFunc(gl.EQUAL, sInfo.id, 0xFF);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            gl.stencilMask(0x00);
          }
        } else {
          gl.disable(gl.STENCIL_TEST);
        }

        const worldMatrix = worldMatrices.get(part.id);
        const partMvp     = worldMatrix ? mat3Mul(camera, worldMatrix) : camera;

        const baseOpacity = opMap.get(part.id) ?? 1;
        const effectiveOpacity = meshEditMode && !selectionSet.has(part.id)
          ? baseOpacity * 0.5
          : baseOpacity;

        this.partRenderer.drawPart(
          part.id,
          partMvp,
          effectiveOpacity,
          uMvp, uTexture, uOpacity
        );
      }
      gl.disable(gl.STENCIL_TEST);
    }

    // ── Overlay pass (wireframe / vertices / edge outline) ────────────────
    const needWirePass = overlays.showWireframe || overlays.showVertices ||
                         overlays.showEdgeOutline || selectionSet.size > 0;

    if (needWirePass) {
      gl.useProgram(this.wireProgram);
      const uMvpW  = this.wireUniforms('u_mvp');
      const uColor = this.wireUniforms('u_color');

      for (const part of parts) {
        if (!visMap.get(part.id)) continue;
        const isSelected = selectionSet.has(part.id);

        const worldMatrix = worldMatrices.get(part.id);
        const partMvp     = worldMatrix ? mat3Mul(camera, worldMatrix) : camera;

        // Edge outline
        if (overlays.showEdgeOutline || isSelected) {
          gl.uniform4f(uColor, 0.2, 0.9, 0.1, isSelected ? 0.9 : 0.5);
          this.partRenderer.drawEdgeOutline(part.id, partMvp, uMvpW);
        }

        // Wireframe triangles
        if (overlays.showWireframe || isSelected) {
          gl.uniform4f(uColor, 0.5, 0.8, 1.0, isSelected ? 0.3 : 0.15);
          this.partRenderer.drawWireframe(part.id, partMvp, uMvpW, uColor);
        }

        // Vertices
        if (overlays.showVertices || isSelected) {
          this.partRenderer.drawVertices(part.id, partMvp, uMvpW, uColor);
        }
      }
    }
  }

  /** Pass-through to PartRenderer for external callers */
  get parts() { return this.partRenderer; }

  destroy() {
    this.partRenderer.destroyAll();
    const { gl } = this;
    this.bgRenderer.destroy();
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.wireProgram);
  }
}
