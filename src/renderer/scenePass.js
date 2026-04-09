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
import { computeWorldMatrices, mat3Mul } from './transforms.js';

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
   * @param {Object} project  - projectStore.project
   * @param {Object} editor   - editorStore state
   * @param {boolean} isDark  - whether current theme is dark
   */
  draw(project, editor, isDark = true) {
    const { gl } = this;
    const { canvas } = gl;

    // Resize if needed
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width  = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    
    const { zoom, panX, panY } = editor.view;
    this.bgRenderer.draw(zoom, panX, panY, canvas.width, canvas.height, isDark);

    if (!project || project.nodes.length === 0) return;

    const camera = buildCameraMatrix(canvas.width, canvas.height, zoom, panX, panY);

    const overlays     = editor.overlays   ?? {};
    const selectionSet = new Set(editor.selection ?? []);
    const meshEditMode = editor.meshEditMode && selectionSet.size > 0;

    // ── Hierarchy pass: compute world matrix for every node ───────────────
    const worldMatrices = computeWorldMatrices(project.nodes);

    // Sort parts by draw_order ascending (groups are never rendered directly)
    const parts = project.nodes
      .filter(n => n.type === 'part')
      .sort((a, b) => a.draw_order - b.draw_order);

    // ── Textured mesh pass ────────────────────────────────────────────────
    if (overlays.showImage !== false) {
      gl.useProgram(this.meshProgram);
      const uMvp     = this.meshUniforms('u_mvp');
      const uTexture = this.meshUniforms('u_texture');
      const uOpacity = this.meshUniforms('u_opacity');

      for (const part of parts) {
        if (part.visible === false) continue;

        const worldMatrix = worldMatrices.get(part.id);
        const partMvp     = worldMatrix ? mat3Mul(camera, worldMatrix) : camera;

        const baseOpacity = part.opacity ?? 1;
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
    }

    // ── Overlay pass (wireframe / vertices / edge outline) ────────────────
    const needWirePass = overlays.showWireframe || overlays.showVertices ||
                         overlays.showEdgeOutline || selectionSet.size > 0;

    if (needWirePass) {
      gl.useProgram(this.wireProgram);
      const uMvpW  = this.wireUniforms('u_mvp');
      const uColor = this.wireUniforms('u_color');

      for (const part of parts) {
        if (part.visible === false) continue;
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
