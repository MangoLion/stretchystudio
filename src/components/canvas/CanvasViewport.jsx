import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useTheme } from '@/contexts/ThemeProvider';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { computePoseOverrides, KEYFRAME_PROPS, getNodePropertyValue, upsertKeyframe } from '@/renderer/animationEngine';
import { ScenePass } from '@/renderer/scenePass';
import { importPsd } from '@/io/psd';
import { detectCharacterFormat, organizeCharacterLayers, matchTag } from '@/io/psdOrganizer';
import { computeWorldMatrices, mat3Inverse, mat3Identity } from '@/renderer/transforms';
import { retriangulate } from '@/mesh/generate';
import { GizmoOverlay } from '@/components/canvas/GizmoOverlay';

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────────────────── */

/** Convert client coords → canvas-element-relative world coords (image/mesh pixel space) */
function clientToCanvasSpace(canvas, clientX, clientY, view) {
  const rect = canvas.getBoundingClientRect();
  const cx = (clientX - rect.left) / view.zoom - view.panX / view.zoom;
  const cy = (clientY - rect.top)  / view.zoom - view.panY / view.zoom;
  return [cx, cy];
}

/**
 * Convert a world-space point to a part's local object space using its inverse world matrix.
 * This ensures vertex picking works correctly for rotated/scaled/translated parts.
 */
function worldToLocal(worldX, worldY, inverseWorldMatrix) {
  const m = inverseWorldMatrix;
  return [
    m[0] * worldX + m[3] * worldY + m[6],
    m[1] * worldX + m[4] * worldY + m[7],
  ];
}

/** Find the vertex index closest to (x, y) within `radius`. Returns -1 if none. */
function findNearestVertex(vertices, x, y, radius) {
  const r2 = radius * radius;
  let best = -1, bestD = r2;
  for (let i = 0; i < vertices.length; i++) {
    const dx = vertices[i].x - x;
    const dy = vertices[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/**
 * Brush falloff weight. t = dist/radius (0=center, 1=edge).
 * hardness=1 → uniform weight=1; hardness=0 → smooth cosine falloff.
 */
function brushWeight(dist, radius, hardness) {
  const t = dist / radius;
  if (t >= 1) return 0;
  const soft = 0.5 * (1 + Math.cos(Math.PI * t));
  return hardness + (1 - hardness) * soft;
}

/** Sample alpha (0-255) at integer pixel coords from an ImageData. Returns 0 if out-of-bounds. */
function sampleAlpha(imageData, lx, ly) {
  const ix = Math.floor(lx), iy = Math.floor(ly);
  if (ix < 0 || iy < 0 || ix >= imageData.width || iy >= imageData.height) return 0;
  return imageData.data[(iy * imageData.width + ix) * 4 + 3];
}

/** Compute the bounding box of opaque pixels in an ImageData. Returns {minX, minY, maxX, maxY} or null if fully transparent. */
function computeImageBounds(imageData, alphaThreshold = 10) {
  let minX = imageData.width, minY = imageData.height;
  let maxX = -1, maxY = -1;

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/** Generate a short unique id */
function uid() { return Math.random().toString(36).slice(2, 9); }

/** Strip extension from a filename */
function basename(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/* ──────────────────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────────────────── */

export default function CanvasViewport({ remeshRef, deleteMeshRef }) {
  const canvasRef        = useRef(null);
  const sceneRef         = useRef(null);
  const rafRef           = useRef(null);
  const workersRef       = useRef(new Map());  // Map<partId, Worker> for concurrent mesh generation
  const imageDataMapRef  = useRef(new Map()); // Map<partId, ImageData> for alpha-based picking
  const dragRef          = useRef(null);   // { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY }
  const panRef           = useRef(null);   // { startX, startY, panX0, panY0 }
  const isDirtyRef       = useRef(true);
  const pendingPsdRef    = useRef(null);   // { psdW, psdH, layers, partIds } while org modal is open
  const brushCircleRef   = useRef(null);   // SVG <circle> for brush cursor — mutated directly for perf

  const [psdOrgModal, setPsdOrgModal] = useState(false);

  const project        = useProjectStore(s => s.project);
  const updateProject  = useProjectStore(s => s.updateProject);
  const editorState    = useEditorStore();
  const setBrush       = useEditorStore(s => s.setBrush);
  const setEditorMode  = useEditorStore(s => s.setEditorMode);
  const { setSelection, setView } = editorState;
  const { themeMode, osTheme } = useTheme();

  const animStore = useAnimationStore();
  const animRef   = useRef(animStore);
  animRef.current = animStore;

  // Stable refs for imperative callbacks
  const editorRef  = useRef(editorState);
  const projectRef = useRef(project);
  const isDark = themeMode === 'system' ? osTheme === 'dark' : themeMode === 'dark';
  const isDarkRef = useRef(isDark);

  // Update refs synchronously in render to ensure event handlers see latest state
  editorRef.current = editorState;
  projectRef.current = project;
  isDarkRef.current = isDark;

  useEffect(() => { isDirtyRef.current = true; }, [project, isDark]);

  /* ── WebGL init ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: false });
    if (!gl) { console.error('[CanvasViewport] WebGL2 not supported'); return; }

    try {
      sceneRef.current = new ScenePass(gl);
    } catch (err) {
      console.error('[CanvasViewport] ScenePass init failed:', err);
      return;
    }

    const tick = (timestamp) => {
      // Advance animation playback and mark dirty if time moved
      const moved = animRef.current.tick(timestamp);
      if (moved) isDirtyRef.current = true;

      if (isDirtyRef.current && sceneRef.current) {
        // Compute pose overrides from current animation state
        const anim = animRef.current;
        const proj = projectRef.current;
        const activeAnim = proj.animations.find(a => a.id === anim.activeAnimationId) ?? null;
        // Always compute pose overrides in animation mode so frame 0 keyframes
        // are respected. In staging mode, skip so raw node.transform is used.
        const poseOverrides = editorRef.current.editorMode === 'animation'
          ? computePoseOverrides(activeAnim, anim.currentTime)
          : null;

        sceneRef.current.draw(projectRef.current, editorRef.current, isDarkRef.current, poseOverrides);
        isDirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Mark dirty when editor view / overlays / selection changes ──────── */
  useEffect(() => { isDirtyRef.current = true; },
    [editorState.view, editorState.selection, editorState.overlays, editorState.meshEditMode]);

  /* ── Mark dirty when animation time changes (scrubbing) ─────────────── */
  useEffect(() => { isDirtyRef.current = true; }, [animStore.currentTime]);

  /* ── [ / ] brush size shortcuts (only in deform edit mode) ────────────── */
  useEffect(() => {
    const handler = (e) => {
      const { meshEditMode, meshSubMode, brushSize } = editorRef.current;
      if (!meshEditMode || meshSubMode !== 'deform') return;
      if (e.key === '[') setBrush({ brushSize: Math.max(5, brushSize - 5) });
      else if (e.key === ']') setBrush({ brushSize: Math.min(300, brushSize + 5) });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setBrush]);

  /* ── K key — insert keyframes for selected nodes at current time ─────── */
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'k' && e.key !== 'K') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const ed   = editorRef.current;
      const anim = animRef.current;
      if (ed.editorMode !== 'animation') return;

      const proj = projectRef.current;
      if (proj.animations.length === 0) return;

      const animId = anim.activeAnimationId ?? proj.animations[0]?.id;
      if (!animId) return;

      const selectedIds = ed.selection;
      if (selectedIds.length === 0) return;

      const currentTimeMs = anim.currentTime;

      updateProject((p) => {
        const animation = p.animations.find(a => a.id === animId);
        if (!animation) return;

        for (const nodeId of selectedIds) {
          const node = p.nodes.find(n => n.id === nodeId);
          if (!node) continue;

          const startMs = (anim.startFrame / anim.fps) * 1000;
          const rest    = anim.restPose.get(nodeId);

          for (const prop of KEYFRAME_PROPS) {
            const value = getNodePropertyValue(node, prop);

            let track = animation.tracks.find(t => t.nodeId === nodeId && t.property === prop);
            const isNewTrack = !track;
            if (!track) {
              track = { nodeId, property: prop, keyframes: [] };
              animation.tracks.push(track);
            }

            // Auto-insert a rest-pose keyframe at startFrame when this is the
            // first keyframe for this track and we're past the start.
            // This ensures interpolation from frame 0 works correctly with
            // group hierarchy — children keep their base position until their
            // own keyframes kick in.
            if (isNewTrack && currentTimeMs > startMs && rest) {
              const baseVal = prop === 'opacity' ? (rest.opacity ?? 1)
                            : (rest[prop] ?? (prop === 'scaleX' || prop === 'scaleY' ? 1 : 0));
              upsertKeyframe(track.keyframes, startMs, baseVal, 'linear');
            }

            upsertKeyframe(track.keyframes, currentTimeMs, value, 'linear');
          }
        }
      });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateProject]);

  /* ── Mesh worker dispatch ────────────────────────────────────────────── */
  const dispatchMeshWorker = useCallback((partId, imageData, opts) => {
    // Terminate any previous worker for this part
    const existingWorker = workersRef.current.get(partId);
    if (existingWorker) existingWorker.terminate();

    const worker = new Worker(new URL('@/mesh/worker.js', import.meta.url), { type: 'module' });
    workersRef.current.set(partId, worker);

    worker.onmessage = (e) => {
      if (!e.data.ok) { console.error('[MeshWorker]', e.data.error); return; }
      const { vertices, uvs, triangles, edgeIndices } = e.data;

      const scene = sceneRef.current;
      if (scene) {
        scene.parts.uploadMesh(partId, { vertices, uvs, triangles, edgeIndices });
        isDirtyRef.current = true;
      }

      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (node) {
          node.mesh = { vertices, uvs: Array.from(uvs), triangles, edgeIndices };
          
          // If the pivot is at the default (0,0), auto-center it to the mesh bounds
          if (node.transform && node.transform.pivotX === 0 && node.transform.pivotY === 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const v of vertices) {
              if (v.x < minX) minX = v.x;
              if (v.x > maxX) maxX = v.x;
              if (v.y < minY) minY = v.y;
              if (v.y > maxY) maxY = v.y;
            }
            if (minX !== Infinity) {
              node.transform.pivotX = (minX + maxX) / 2;
              node.transform.pivotY = (minY + maxY) / 2;
            }
          }
        }
      });

      // Clean up the worker from the map when done
      workersRef.current.delete(partId);
    };

    worker.postMessage({ imageData, opts });
  }, [updateProject]);

  /* ── Remesh selected part with given opts ────────────────────────────── */
  const remeshPart = useCallback((partId, opts) => {
    const proj = projectRef.current;
    const node = proj.nodes.find(n => n.id === partId);
    if (!node) return;

    const tex = proj.textures.find(t => t.id === partId);
    if (!tex) return;

    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.width; off.height = img.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      dispatchMeshWorker(partId, imageData, opts);
    };
    img.src = tex.source;
  }, [dispatchMeshWorker]);

  useEffect(() => { if (remeshRef) remeshRef.current = remeshPart; }, [remeshRef, remeshPart]);

  /* ── Delete mesh for a part ──────────────────────────────────────────────── */
  const deleteMeshForPart = useCallback((partId) => {
    const node = projectRef.current.nodes.find(n => n.id === partId);
    if (!node) return;

    // Clear mesh from project store
    updateProject((p) => {
      const n = p.nodes.find(x => x.id === partId);
      if (n) n.mesh = null;
    });
  }, [updateProject]);

  useEffect(() => { if (deleteMeshRef) deleteMeshRef.current = deleteMeshForPart; }, [deleteMeshRef, deleteMeshForPart]);

  /* ── PNG import helper ───────────────────────────────────────────────── */
  const importPng = useCallback((file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const partId = uid();
      const off = document.createElement('canvas');
      off.width = img.width; off.height = img.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      // Store imageData for alpha-based picking
      imageDataMapRef.current.set(partId, imageData);

      // Compute bounding box from opaque pixels
      const imageBounds = computeImageBounds(imageData);

      updateProject((proj, ver) => {
        proj.canvas.width  = img.width;
        proj.canvas.height = img.height;
        proj.textures.push({ id: partId, source: url });
        proj.nodes.push({
          id:         partId,
          type:       'part',
          name:       basename(file.name),
          parent:     null,
          draw_order: proj.nodes.filter(n => n.type === 'part').length,
          opacity:    1,
          visible:    true,
          clip_mask:  null,
          transform:  { ...DEFAULT_TRANSFORM(), pivotX: img.width / 2, pivotY: img.height / 2 },
          meshOpts:   null,
          mesh:       null,
          imageWidth: img.width,
          imageHeight: img.height,
          imageBounds: imageBounds || { minX: 0, minY: 0, maxX: img.width, maxY: img.height },
        });
        ver.textureVersion++;
      });

      const scene = sceneRef.current;
      if (scene) {
        scene.parts.uploadTexture(partId, img);
        scene.parts.uploadQuadFallback(partId, img.width, img.height);
        isDirtyRef.current = true;
      }
    };
    img.src = url;
  }, [updateProject]);

  /* ── PSD import: finalize (shared by both organized and flat paths) ─────── */
  const finalizePsdImport = useCallback((psdW, psdH, layers, partIds, organize) => {
    // If organizing, compute group defs + per-layer draw_order / parent
    let groupDefs = [];
    let assignments = null;
    if (organize) {
      const result = organizeCharacterLayers(layers, uid);
      groupDefs = result.groupDefs;
      assignments = result.assignments;
    }

    updateProject((proj, ver) => {
      proj.canvas.width  = psdW;
      proj.canvas.height = psdH;

      // Create group nodes first (so parent IDs exist when parts reference them)
      for (const g of groupDefs) {
        proj.nodes.push({
          id:        g.id,
          type:      'group',
          name:      g.name,
          parent:    g.parentId,
          opacity:   1,
          visible:   true,
          transform: DEFAULT_TRANSFORM(),
        });
      }

      layers.forEach((layer, i) => {
        const partId = partIds[i];
        const off = document.createElement('canvas');
        off.width = psdW; off.height = psdH;
        const ctx = off.getContext('2d');
        const tmp = document.createElement('canvas');
        tmp.width = layer.width; tmp.height = layer.height;
        tmp.getContext('2d').putImageData(layer.imageData, 0, 0);
        ctx.drawImage(tmp, layer.x, layer.y);
        const fullImageData = ctx.getImageData(0, 0, psdW, psdH);

        // Store imageData synchronously for alpha-based picking
        imageDataMapRef.current.set(partId, fullImageData);

        // Compute bounding box from opaque pixels
        const imageBounds = computeImageBounds(fullImageData);

        off.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          updateProject((p2) => {
            const t = p2.textures.find(t => t.id === partId);
            if (t) t.source = url;
          });
          const img2 = new Image();
          img2.onload = () => {
            const scene = sceneRef.current;
            if (scene) {
              scene.parts.uploadTexture(partId, img2);
              scene.parts.uploadQuadFallback(partId, psdW, psdH);
              isDirtyRef.current = true;
            }
          };
          img2.src = url;
        }, 'image/png');

        const assignment = assignments?.get(i);
        proj.textures.push({ id: partId, source: '' });
        proj.nodes.push({
          id:         partId,
          type:       'part',
          name:       layer.name,
          parent:     assignment?.parentGroupId ?? null,
          draw_order: assignment?.drawOrder ?? (layers.length - 1 - i),
          opacity:    layer.opacity,
          visible:    layer.visible,
          clip_mask:  null,
          transform:  { ...DEFAULT_TRANSFORM(), pivotX: psdW / 2, pivotY: psdH / 2 },
          meshOpts:   null,
          mesh:       null,
          imageWidth: psdW,
          imageHeight: psdH,
          imageBounds: imageBounds || { minX: 0, minY: 0, maxX: psdW, maxY: psdH },
        });
      });

      ver.textureVersion++;
    });
  }, [updateProject]);

  /* ── PSD import helper ───────────────────────────────────────────────── */
  const importPsdFile = useCallback((file) => {
    file.arrayBuffer().then((buffer) => {
      let parsed;
      try { parsed = importPsd(buffer); }
      catch (err) { console.error('[PSD Import]', err); return; }

      const { width: psdW, height: psdH, layers } = parsed;
      if (!layers.length) return;

      const partIds = layers.map(() => uid());

      if (detectCharacterFormat(layers)) {
        pendingPsdRef.current = { psdW, psdH, layers, partIds };
        setPsdOrgModal(true);
      } else {
        finalizePsdImport(psdW, psdH, layers, partIds, false);
      }
    });
  }, [finalizePsdImport]);

  /* ── Drag-and-drop ───────────────────────────────────────────────────── */
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.psd')) {
      importPsdFile(file);
    } else if (file.type.startsWith('image/')) {
      importPng(file);
    }
  }, [importPng, importPsdFile]);

  const onDragOver = useCallback((e) => { e.preventDefault(); }, []);

  const onContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  /* ── Wheel: zoom ─────────────────────────────────────────────────────── */
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const { view } = editorRef.current;
    const rect = canvas.getBoundingClientRect();

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.05, Math.min(20, view.zoom * factor));

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newPanX = mx - (mx - view.panX) * (newZoom / view.zoom);
    const newPanY = my - (my - view.panY) * (newZoom / view.zoom);

    setView({ zoom: newZoom, panX: newPanX, panY: newPanY });
    isDirtyRef.current = true;
  }, [setView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [onWheel, onContextMenu]);

  /* ── Pointer events ──────────────────────────────────────────────────── */
  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    const { view } = editorRef.current;

    // Middle mouse (1) or right mouse (2) or alt+left → pan / zoom
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      if (e.ctrlKey) {
        // Ctrl + Middle/Right drag → Zoom
        panRef.current = { 
          mode: 'zoom',
          startX: e.clientX, 
          startY: e.clientY, 
          zoom0: view.zoom,
          panX0: view.panX,
          panY0: view.panY 
        };
      } else {
        // Regular Middle/Right drag → Pan
        panRef.current = { 
          mode: 'pan',
          startX: e.clientX, 
          startY: e.clientY, 
          panX0: view.panX, 
          panY0: view.panY 
        };
      }
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = e.ctrlKey ? 'zoom-in' : 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);
    const proj = projectRef.current;

    // Compute world matrices once for picking
    const worldMatrices = computeWorldMatrices(proj.nodes);

    // Get parts sorted by draw order descending (front to back) for correct hit testing
    const sortedParts = proj.nodes
      .filter(n => n.type === 'part')
      .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

    // ── select tool: vertex drag and part selection ──────────────────────
    // When mesh edit mode is active, restrict interaction to the selected part only.
    const { meshEditMode, toolMode } = editorRef.current;
    const currentSelection = editorRef.current.selection ?? [];
    if (meshEditMode && currentSelection.length > 0) {
      const selNode = proj.nodes.find(n => n.id === currentSelection[0] && n.type === 'part' && n.mesh);
      if (selNode) {
        const wm  = worldMatrices.get(selNode.id) ?? mat3Identity();
        const iwm = mat3Inverse(wm);
        const [lx, ly] = worldToLocal(worldX, worldY, iwm);

        if (toolMode === 'add_vertex') {
          // Compute new mesh data first, then upload and persist atomically
          const newVerts = [...selNode.mesh.vertices, { x: lx, y: ly, restX: lx, restY: ly }];
          const oldUvs   = selNode.mesh.uvs;
          const newUvs   = new Float32Array(oldUvs.length + 2);
          newUvs.set(oldUvs);
          newUvs[oldUvs.length]     = lx / (selNode.imageWidth  ?? 1);
          newUvs[oldUvs.length + 1] = ly / (selNode.imageHeight ?? 1);
          const result = retriangulate(newVerts, newUvs, selNode.mesh.edgeIndices);

          // Upload to GPU immediately (no stale ref)
          sceneRef.current?.parts.uploadMesh(selNode.id, {
            vertices: result.vertices,
            uvs: result.uvs,
            triangles: result.triangles,
            edgeIndices: result.edgeIndices,
          });
          isDirtyRef.current = true;

          // Persist to store
          updateProject((proj2) => {
            const node = proj2.nodes.find(n => n.id === selNode.id);
            if (!node?.mesh) return;
            node.mesh.vertices   = result.vertices;
            node.mesh.uvs        = Array.from(result.uvs);
            node.mesh.triangles  = result.triangles;
          });

        } else if (toolMode === 'remove_vertex') {
          const idx = findNearestVertex(selNode.mesh.vertices, lx, ly, 14 / view.zoom);
          if (idx >= 0 && selNode.mesh.vertices.length > 3) {
            // Compute new mesh data first
            const newVerts = selNode.mesh.vertices.filter((_, i) => i !== idx);
            const oldUvs   = selNode.mesh.uvs;
            const newUvs   = new Float32Array(oldUvs.length - 2);
            for (let i = 0; i < idx; i++) { newUvs[i * 2] = oldUvs[i * 2]; newUvs[i * 2 + 1] = oldUvs[i * 2 + 1]; }
            for (let i = idx; i < newVerts.length; i++) { newUvs[i * 2] = oldUvs[(i + 1) * 2]; newUvs[i * 2 + 1] = oldUvs[(i + 1) * 2 + 1]; }
            const oldEdge  = selNode.mesh.edgeIndices ?? new Set();
            const newEdge  = new Set();
            for (const ei of oldEdge) {
              if (ei < idx) newEdge.add(ei);
              else if (ei > idx) newEdge.add(ei - 1);
            }
            const result = retriangulate(newVerts, newUvs, newEdge);

            // Upload to GPU immediately
            sceneRef.current?.parts.uploadMesh(selNode.id, {
              vertices: result.vertices,
              uvs: result.uvs,
              triangles: result.triangles,
              edgeIndices: newEdge,
            });
            isDirtyRef.current = true;

            // Persist to store
            updateProject((proj2) => {
              const node = proj2.nodes.find(n => n.id === selNode.id);
              if (!node?.mesh) return;
              node.mesh.vertices   = result.vertices;
              node.mesh.uvs        = Array.from(result.uvs);
              node.mesh.triangles  = result.triangles;
              node.mesh.edgeIndices = newEdge;
            });
          }
        } else {
          // Default select tool in deform mode: brush-based multi-vertex drag
          const { brushSize, brushHardness, meshSubMode } = editorRef.current;
          const worldRadius = brushSize / view.zoom;
          const verts = selNode.mesh.vertices;
          const affected = [];
          for (let i = 0; i < verts.length; i++) {
            const dx = verts[i].x - lx, dy = verts[i].y - ly;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const w = meshSubMode === 'deform'
              ? brushWeight(dist, worldRadius, brushHardness)
              : (dist <= 14 / view.zoom ? 1 : 0); // adjust: exact vertex pick
            if (w > 0) affected.push({ index: i, startX: verts[i].x, startY: verts[i].y, weight: w });
          }
          if (affected.length > 0 || meshSubMode === 'deform') {
            dragRef.current = {
              mode:          'brush',
              partId:        selNode.id,
              startWorldX:   worldX,
              startWorldY:   worldY,
              // Snapshot of all vertex positions at drag start (used each frame)
              verticesSnap:  verts.map(v => ({ ...v })),
              allUvs:        new Float32Array(selNode.mesh.uvs),
              imageWidth:    selNode.imageWidth,
              imageHeight:   selNode.imageHeight,
              affected,
              iwm,
            };
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'crosshair';
          }
        }
      }
      // In edit mode, never change selection or interact with other layers
      return;
    }

    for (const node of sortedParts) {
      const wm  = worldMatrices.get(node.id) ?? mat3Identity();
      const iwm = mat3Inverse(wm);
      const [lx, ly] = worldToLocal(worldX, worldY, iwm);

      // Check vertex hit first if mesh exists (priority for dragging)
      if (node.mesh) {
        const idx = findNearestVertex(node.mesh.vertices, lx, ly, 14 / view.zoom);
        if (idx >= 0) {
          dragRef.current = {
            partId:       node.id,
            vertexIndex:  idx,
            startWorldX:  worldX,
            startWorldY:  worldY,
            startLocalX:  node.mesh.vertices[idx].x,
            startLocalY:  node.mesh.vertices[idx].y,
            imageWidth:   node.imageWidth,
            imageHeight:  node.imageHeight,
            iwm,
          };
          setSelection([node.id]);
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = 'grabbing';
          return;
        }
      }

      // Alpha-based selection (works with or without mesh)
      const imgData = imageDataMapRef.current.get(node.id);
      if (imgData && sampleAlpha(imgData, lx, ly) > 10) {
        setSelection([node.id]);
        return;
      }
    }
    setSelection([]);
  }, [setSelection, updateProject, setView]);

  const onPointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    const { view } = editorRef.current;

    // Pan or Zoom
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      
      if (panRef.current.mode === 'zoom') {
        const { zoom0, panX0, panY0, startX, startY } = panRef.current;
        // Dragging up = zoom in, dragging down = zoom out
        const factor = Math.exp(-dy * 0.01); 
        const newZoom = Math.max(0.05, Math.min(20, zoom0 * factor));
        
        // Zoom relative to the point where the drag started
        const mx = startX - canvas.getBoundingClientRect().left;
        const my = startY - canvas.getBoundingClientRect().top;
        const newPanX = mx - (mx - panX0) * (newZoom / zoom0);
        const newPanY = my - (my - panY0) * (newZoom / zoom0);
        
        setView({ zoom: newZoom, panX: newPanX, panY: newPanY });
      } else {
        setView({ panX: panRef.current.panX0 + dx, panY: panRef.current.panY0 + dy });
      }
      isDirtyRef.current = true;
      return;
    }

    // Update brush circle cursor position (direct DOM, no React re-render)
    if (brushCircleRef.current) {
      const inDeformMode = editorRef.current.meshEditMode && editorRef.current.meshSubMode === 'deform';
      if (inDeformMode) {
        const rect = canvas.getBoundingClientRect();
        brushCircleRef.current.setAttribute('cx', e.clientX - rect.left);
        brushCircleRef.current.setAttribute('cy', e.clientY - rect.top);
        brushCircleRef.current.setAttribute('visibility', 'visible');
      } else {
        brushCircleRef.current.setAttribute('visibility', 'hidden');
      }
    }

    // Vertex / brush drag
    if (!dragRef.current) return;
    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);

    const { meshSubMode } = editorRef.current;

    // ── Brush deform (edit mode, deform sub-mode) ──────────────────────────
    if (dragRef.current.mode === 'brush') {
      const { partId, startWorldX, startWorldY, verticesSnap, allUvs, affected,
              imageWidth, imageHeight, iwm } = dragRef.current;

      const worldDx = worldX - startWorldX;
      const worldDy = worldY - startWorldY;
      const localDx = iwm[0] * worldDx + iwm[3] * worldDy;
      const localDy = iwm[1] * worldDx + iwm[4] * worldDy;

      // Build full vertex array from snapshot with weighted deltas applied
      const newVerts = verticesSnap.map(v => ({ ...v }));
      for (const { index, startX, startY, weight } of affected) {
        if (meshSubMode === 'adjust') {
          newVerts[index].x = startX + localDx * weight;
          newVerts[index].y = startY + localDy * weight;
        } else {
          newVerts[index].x = startX + localDx * weight;
          newVerts[index].y = startY + localDy * weight;
        }
      }

      // GPU upload from freshly computed data (no stale ref)
      sceneRef.current?.parts.uploadPositions(partId, newVerts, allUvs);
      isDirtyRef.current = true;

      // Persist — adjust mode also updates UVs to track position
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        for (const { index, startX, startY, weight } of affected) {
          const nx = startX + localDx * weight;
          const ny = startY + localDy * weight;
          node.mesh.vertices[index].x = nx;
          node.mesh.vertices[index].y = ny;
          if (meshSubMode === 'adjust') {
            node.mesh.uvs[index * 2]     = nx / (imageWidth  ?? 1);
            node.mesh.uvs[index * 2 + 1] = ny / (imageHeight ?? 1);
          }
        }
      });
      return;
    }

    // ── Single-vertex drag (non-edit-mode path) ────────────────────────────
    const { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY,
            imageWidth, imageHeight, iwm } = dragRef.current;

    const worldDx = worldX - startWorldX;
    const worldDy = worldY - startWorldY;
    const localDx = iwm[0] * worldDx + iwm[3] * worldDy;
    const localDy = iwm[1] * worldDx + iwm[4] * worldDy;

    if (meshSubMode === 'adjust') {
      const newLocalX = startLocalX + localDx;
      const newLocalY = startLocalY + localDy;
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        node.mesh.vertices[vertexIndex].x      = newLocalX;
        node.mesh.vertices[vertexIndex].y      = newLocalY;
        node.mesh.uvs[vertexIndex * 2]         = newLocalX / (imageWidth  ?? 1);
        node.mesh.uvs[vertexIndex * 2 + 1]     = newLocalY / (imageHeight ?? 1);
      });
    } else {
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        node.mesh.vertices[vertexIndex].x = startLocalX + localDx;
        node.mesh.vertices[vertexIndex].y = startLocalY + localDy;
      });
    }

    const scene = sceneRef.current;
    if (scene) {
      const node = projectRef.current.nodes.find(n => n.id === partId);
      if (node?.mesh) {
        scene.parts.uploadPositions(partId, node.mesh.vertices, new Float32Array(node.mesh.uvs));
        isDirtyRef.current = true;
      }
    }
  }, [updateProject, setView]);

  const onPointerUp = useCallback((e) => {
    const canvas = canvasRef.current;
    canvas.releasePointerCapture(e.pointerId);

    if (panRef.current) {
      panRef.current = null;
      canvas.style.cursor = '';
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      canvas.style.cursor = '';
    }
  }, []);

  /* ── Cursor style ────────────────────────────────────────────────────── */
  const toolCursor = 'crosshair';

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-[#1a1a1a]"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{
          cursor: editorState.meshEditMode && editorState.meshSubMode === 'deform' ? 'none' : toolCursor,
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseLeave={() => brushCircleRef.current?.setAttribute('visibility', 'hidden')}
      />

      {/* Brush cursor circle — shown in deform edit mode, positioned via direct DOM updates */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <circle
          ref={brushCircleRef}
          cx={0} cy={0}
          r={editorState.brushSize}
          fill="none"
          stroke="white"
          strokeWidth="1"
          strokeDasharray="4 3"
          visibility="hidden"
        />
      </svg>

      {/* Transform gizmo SVG overlay */}
      <GizmoOverlay />

      {/* Editor mode toggle — top-left */}
      <div className="absolute top-2 left-2 z-10 flex rounded overflow-hidden border border-border shadow-sm text-[11px] font-medium">
        <button
          onClick={() => setEditorMode('staging')}
          className={[
            'px-2.5 py-1 transition-colors',
            editorState.editorMode !== 'animation'
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted',
          ].join(' ')}
        >
          Staging
        </button>
        <button
          onClick={() => {
            setEditorMode('animation');
            // Snapshot rest pose so auto-base keyframes work correctly
            animRef.current.captureRestPose(projectRef.current.nodes);
          }}
          className={[
            'px-2.5 py-1 transition-colors border-l border-border',
            editorState.editorMode === 'animation'
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted',
          ].join(' ')}
        >
          Animation
        </button>
      </div>

      {/* Drop hint overlay */}
      {project.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p className="text-muted-foreground/60 text-sm font-medium select-none">
            Drop a PNG or PSD here to begin
          </p>
        </div>
      )}


      {/* PSD auto-organize modal */}
      {psdOrgModal && (() => {
        const { psdW, psdH, layers, partIds } = pendingPsdRef.current;
        const matchCount = layers.filter(l => matchTag(l.name) !== null).length;
        const dismiss = (organize) => {
          setPsdOrgModal(false);
          pendingPsdRef.current = null;
          finalizePsdImport(psdW, psdH, layers, partIds, organize);
        };
        return (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Auto-organize layers?</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {matchCount} of {layers.length} layers match character part names
                  (face, back hair, topwear…). Organize into a hierarchical{' '}
                  <span className="text-foreground font-medium">Body / Upperbody / Head</span> structure
                  with correct render order?
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  onClick={() => dismiss(false)}
                >
                  Import as-is
                </button>
                <button
                  className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                  onClick={() => dismiss(true)}
                >
                  Organize
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
