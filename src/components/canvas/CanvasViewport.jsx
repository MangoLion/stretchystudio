import React, { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { ScenePass } from '@/renderer/scenePass';
import { importPsd } from '@/io/psd';
import { computeWorldMatrices, mat3Inverse, mat3Identity } from '@/renderer/transforms';
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

/** Generate a short unique id */
function uid() { return Math.random().toString(36).slice(2, 9); }

/** Strip extension from a filename */
function basename(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/* ──────────────────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────────────────── */

export default function CanvasViewport({ remeshRef }) {
  const canvasRef   = useRef(null);
  const sceneRef    = useRef(null);
  const rafRef      = useRef(null);
  const workersRef  = useRef(new Map());  // Map<partId, Worker> for concurrent mesh generation
  const dragRef     = useRef(null);   // { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY }
  const panRef      = useRef(null);   // { startX, startY, panX0, panY0 }
  const isDirtyRef  = useRef(true);

  const project        = useProjectStore(s => s.project);
  const updateProject  = useProjectStore(s => s.updateProject);
  const editorState    = useEditorStore();
  const { setSelection, setView } = editorState;

  // Stable refs for imperative callbacks
  const editorRef  = useRef(editorState);
  const projectRef = useRef(project);
  useEffect(() => { editorRef.current = editorState; }, [editorState]);
  useEffect(() => { projectRef.current = project; isDirtyRef.current = true; }, [project]);

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

    const tick = () => {
      if (isDirtyRef.current && sceneRef.current) {
        sceneRef.current.draw(projectRef.current, editorRef.current);
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
    [editorState.view, editorState.selection, editorState.overlays]);

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
        if (node) node.mesh = { vertices, uvs: Array.from(uvs), triangles, edgeIndices };
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

      const { meshDefaults } = editorRef.current;

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
          transform:  DEFAULT_TRANSFORM(),
          meshOpts:   null,
          mesh:       null,
        });
        ver.textureVersion++;
      });

      const scene = sceneRef.current;
      if (scene) { scene.parts.uploadTexture(partId, img); isDirtyRef.current = true; }

      dispatchMeshWorker(partId, imageData, meshDefaults);
    };
    img.src = url;
  }, [updateProject, dispatchMeshWorker]);

  /* ── PSD import helper ───────────────────────────────────────────────── */
  const importPsdFile = useCallback((file) => {
    file.arrayBuffer().then((buffer) => {
      let parsed;
      try { parsed = importPsd(buffer); }
      catch (err) { console.error('[PSD Import]', err); return; }

      const { width: psdW, height: psdH, layers } = parsed;
      if (!layers.length) return;

      const { meshDefaults } = editorRef.current;
      const partIds = layers.map(() => uid());

      updateProject((proj, ver) => {
        proj.canvas.width  = psdW;
        proj.canvas.height = psdH;

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

          off.toBlob((blob) => {
            const url = URL.createObjectURL(blob);

            updateProject((p2) => {
              const t = p2.textures.find(t => t.id === partId);
              if (t) t.source = url;
            });

            const img2 = new Image();
            img2.onload = () => {
              const scene = sceneRef.current;
              if (scene) { scene.parts.uploadTexture(partId, img2); isDirtyRef.current = true; }
            };
            img2.src = url;

            dispatchMeshWorker(partId, fullImageData, {
              ...meshDefaults,
              gridSpacing: Math.max(20, meshDefaults.gridSpacing - 10),
            });
          }, 'image/png');

          proj.textures.push({ id: partId, source: '' });
          proj.nodes.push({
            id:         partId,
            type:       'part',
            name:       layer.name,
            parent:     null,
            draw_order: layers.length - 1 - i,
            opacity:    layer.opacity,
            visible:    layer.visible,
            clip_mask:  null,
            transform:  DEFAULT_TRANSFORM(),
            meshOpts:   null,
            mesh:       null,
          });
        });

        ver.textureVersion++;
      });
    });
  }, [updateProject, dispatchMeshWorker]);

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
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  /* ── Pointer events ──────────────────────────────────────────────────── */
  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    const editor = editorRef.current;
    const { view, toolMode } = editor;

    // Middle mouse or alt+left → pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panRef.current = { startX: e.clientX, startY: e.clientY, panX0: view.panX, panY0: view.panY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);
    const proj = projectRef.current;

    // Compute world matrices once for picking
    const worldMatrices = computeWorldMatrices(proj.nodes);

    // ── add_vertex tool ──────────────────────────────────────────────────
    if (toolMode === 'add_vertex') {
      const sel = editor.selection;
      if (sel.length === 0) return;
      const partId = sel[0];
      const node = proj.nodes.find(n => n.id === partId);
      if (!node?.mesh) return;

      // Convert world click to part's local space
      const wm  = worldMatrices.get(partId) ?? mat3Identity();
      const iwm = mat3Inverse(wm);
      const [lx, ly] = worldToLocal(worldX, worldY, iwm);

      updateProject((p) => {
        const n = p.nodes.find(x => x.id === partId);
        if (!n?.mesh) return;
        const newVert = { x: lx, y: ly, restX: lx, restY: ly };
        n.mesh.vertices.push(newVert);
        const w = p.canvas.width || 1;
        const h = p.canvas.height || 1;
        n.mesh.uvs.push(lx / w, ly / h);
      });
      isDirtyRef.current = true;
      return;
    }

    // ── remove_vertex tool ───────────────────────────────────────────────
    if (toolMode === 'remove_vertex') {
      for (const node of [...proj.nodes].reverse()) {
        if (node.type !== 'part' || !node.mesh) continue;
        const wm  = worldMatrices.get(node.id) ?? mat3Identity();
        const iwm = mat3Inverse(wm);
        const [lx, ly] = worldToLocal(worldX, worldY, iwm);
        const idx = findNearestVertex(node.mesh.vertices, lx, ly, 14 / view.zoom);
        if (idx >= 0) {
          updateProject((p) => {
            const n = p.nodes.find(x => x.id === node.id);
            if (!n?.mesh) return;
            n.mesh.vertices.splice(idx, 1);
            n.mesh.uvs.splice(idx * 2, 2);
            n.mesh.triangles = n.mesh.triangles
              .filter(t => !t.includes(idx))
              .map(t => t.map(v => v > idx ? v - 1 : v));
          });
          isDirtyRef.current = true;
          return;
        }
      }
      return;
    }

    // ── select tool: vertex drag ─────────────────────────────────────────
    for (const node of [...proj.nodes].reverse()) {
      if (node.type !== 'part' || !node.mesh) continue;
      const wm  = worldMatrices.get(node.id) ?? mat3Identity();
      const iwm = mat3Inverse(wm);
      const [lx, ly] = worldToLocal(worldX, worldY, iwm);
      const idx = findNearestVertex(node.mesh.vertices, lx, ly, 14 / view.zoom);
      if (idx >= 0) {
        dragRef.current = {
          partId:       node.id,
          vertexIndex:  idx,
          startWorldX:  worldX,
          startWorldY:  worldY,
          startLocalX:  node.mesh.vertices[idx].x,
          startLocalY:  node.mesh.vertices[idx].y,
          iwm,
        };
        setSelection([node.id]);
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        return;
      }
    }
    setSelection([]);
  }, [setSelection, updateProject]);

  const onPointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    const { view } = editorRef.current;

    // Pan
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setView({ panX: panRef.current.panX0 + dx, panY: panRef.current.panY0 + dy });
      isDirtyRef.current = true;
      return;
    }

    // Vertex drag
    if (!dragRef.current) return;
    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);
    const { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY, iwm } = dragRef.current;

    // Compute local-space delta from the world-space delta, applying only the linear
    // part of the inverse world matrix (rotation/scale), not the translation.
    const worldDx = worldX - startWorldX;
    const worldDy = worldY - startWorldY;
    const localDx = iwm[0] * worldDx + iwm[3] * worldDy;
    const localDy = iwm[1] * worldDx + iwm[4] * worldDy;

    const newLocalX = startLocalX + localDx;
    const newLocalY = startLocalY + localDy;

    updateProject((proj) => {
      const node = proj.nodes.find(n => n.id === partId);
      if (!node?.mesh) return;
      node.mesh.vertices[vertexIndex].x = newLocalX;
      node.mesh.vertices[vertexIndex].y = newLocalY;
    });

    const scene = sceneRef.current;
    if (scene) {
      const node = projectRef.current.nodes.find(n => n.id === partId);
      if (node?.mesh) {
        const uvs = new Float32Array(node.mesh.uvs);
        scene.parts.uploadPositions(partId, node.mesh.vertices, uvs);
        isDirtyRef.current = true;
      }
    }
  }, [updateProject, setView]);

  const onPointerUp = useCallback((e) => {
    const canvas = canvasRef.current;
    canvas.releasePointerCapture(e.pointerId);

    if (panRef.current) {
      panRef.current = null;
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      canvas.style.cursor = 'crosshair';
    }
  }, []);

  /* ── Cursor style based on tool mode ─────────────────────────────────── */
  const toolCursor = {
    select:        'crosshair',
    add_vertex:    'cell',
    remove_vertex: 'not-allowed',
  }[editorState.toolMode] ?? 'crosshair';

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-[#1a1a1a]"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ cursor: toolCursor, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {/* Transform gizmo SVG overlay */}
      <GizmoOverlay />

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

      {/* Tool mode badge */}
      {editorState.toolMode !== 'select' && (
        <div className="absolute top-2 left-2 pointer-events-none">
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
            editorState.toolMode === 'add_vertex'
              ? 'bg-green-900/80 text-green-300 border-green-600'
              : 'bg-red-900/80 text-red-300 border-red-600'
          }`}>
            {editorState.toolMode === 'add_vertex' ? '+ ADD VERTEX' : '− REMOVE VERTEX'}
          </span>
        </div>
      )}
    </div>
  );
}
