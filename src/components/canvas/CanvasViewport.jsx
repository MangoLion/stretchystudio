import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useTheme } from '@/contexts/ThemeProvider';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { computePoseOverrides, KEYFRAME_PROPS, getNodePropertyValue, upsertKeyframe } from '@/renderer/animationEngine';
import { ScenePass } from '@/renderer/scenePass';
import { importPsd } from '@/io/psd';
import {
  detectCharacterFormat, matchTag,
} from '@/io/armatureOrganizer';
import SkeletonOverlay from '@/components/canvas/SkeletonOverlay';
import PsdImportWizard from '@/components/canvas/PsdImportWizard';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { computeWorldMatrices, mat3Inverse, mat3Identity } from '@/renderer/transforms';
import { retriangulate } from '@/mesh/generate';
import { applyPuppetWarp } from '@/mesh/puppetWarp';
import { GizmoOverlay } from '@/components/canvas/GizmoOverlay';
import { saveProject, loadProject } from '@/io/projectFile';

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────────────────── */

/** Convert client coords → canvas-element-relative world coords (image/mesh pixel space) */
function clientToCanvasSpace(canvas, clientX, clientY, view) {
  const rect = canvas.getBoundingClientRect();
  const cx = (clientX - rect.left) / view.zoom - view.panX / view.zoom;
  const cy = (clientY - rect.top) / view.zoom - view.panY / view.zoom;
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

/** Compute smart mesh options based on part surface area */
function computeSmartMeshOpts(imageBounds) {
  if (!imageBounds) {
    return { alphaThreshold: 5, smoothPasses: 0, gridSpacing: 30, edgePadding: 8, numEdgePoints: 80 };
  }
  const w = imageBounds.maxX - imageBounds.minX;
  const h = imageBounds.maxY - imageBounds.minY;
  const sqrtArea = Math.sqrt(w * h);
  return {
    alphaThreshold: 5,
    smoothPasses: 0,
    gridSpacing: Math.max(6, Math.min(80, Math.round(sqrtArea * 0.08))),
    edgePadding: 8,
    numEdgePoints: Math.max(12, Math.min(300, Math.round(sqrtArea * 0.4))),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────────────────── */

export default function CanvasViewport({
  remeshRef, deleteMeshRef,
  saveRef, loadRef, resetRef,
  exportCaptureRef, thumbCaptureRef
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rafRef = useRef(null);
  const workersRef = useRef(new Map());  // Map<partId, Worker> for concurrent mesh generation
  const lastUploadedSourcesRef = useRef(new Map()); // Map<partId, string> (source URI)
  const imageDataMapRef = useRef(new Map()); // Map<partId, ImageData> for alpha-based picking
  const dragRef = useRef(null);   // { partId, vertexIndex, startWorldX, startWorldY, startLocalX, startLocalY }
  const panRef = useRef(null);   // { startX, startY, panX0, panY0 }
  const isDirtyRef = useRef(true);
  const brushCircleRef = useRef(null);   // SVG <circle> for brush cursor — mutated directly for perf
  const meshOverriddenParts = useRef(new Set()); // parts whose GPU mesh was overridden last frame
  const fileInputRef = useRef(null);

  // PSD import wizard state
  const wizardStep = useEditorStore(s => s.wizardStep);
  const setWizardStep = useEditorStore(s => s.setWizardStep);
  const [wizardPsd, setWizardPsd] = useState(null);  // { psdW, psdH, layers, partIds }
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const preImportSnapshotRef = useRef(null);  // project snapshot before finalizePsdImport
  const onnxSessionRef = useRef(null);  // cached ONNX session across imports
  const meshAllPartsRef = useRef(false);  // whether to auto-mesh all parts on import completion

  const project = useProjectStore(s => s.project);
  const versionControl = useProjectStore(s => s.versionControl);
  const updateProject = useProjectStore(s => s.updateProject);
  const resetProject = useProjectStore(s => s.resetProject);
  const editorState = useEditorStore();
  const setBrush = useEditorStore(s => s.setBrush);
  const setEditorMode = useEditorStore(s => s.setEditorMode);
  const { setSelection, setView } = editorState;
  const { themeMode, osTheme } = useTheme();

  const animStore = useAnimationStore();
  const animRef = useRef(animStore);
  animRef.current = animStore;

  // Stable refs for imperative callbacks
  const editorRef = useRef(editorState);
  const projectRef = useRef(project);
  const isDark = themeMode === 'system' ? osTheme === 'dark' : themeMode === 'dark';
  const isDarkRef = useRef(isDark);

  // Update refs synchronously in render to ensure event handlers see latest state
  editorRef.current = editorState;
  projectRef.current = project;
  isDarkRef.current = isDark;

  useEffect(() => { isDirtyRef.current = true; }, [project, isDark]);
  
  /* ── GPU Sync: Ensure nodes in store have matching WebGL resources ── */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    for (const node of project.nodes) {
      if (node.type !== 'part') continue;

      // 1. Texture Sync
      const texEntry = project.textures.find(t => t.id === node.id);
      if (texEntry) {
        const isUploaded = scene.parts.hasTexture(node.id);
        const lastSource = lastUploadedSourcesRef.current.get(node.id);
        const sourceChanged = lastSource !== texEntry.source;

        if (!isUploaded || sourceChanged) {
          const sourceToUpload = texEntry.source;
          const img = new Image();
          img.onload = () => {
            // Check if node still exists and still lacks texture or source changed (concurrency)
            if (sceneRef.current?.parts) {
              const currentTex = projectRef.current.textures.find(t => t.id === node.id);
              if (currentTex?.source === sourceToUpload) {
                sceneRef.current.parts.uploadTexture(node.id, img);
                lastUploadedSourcesRef.current.set(node.id, sourceToUpload);
                
                // Maintain imageDataMapRef for alpha picking
                const off = document.createElement('canvas');
                off.width = img.width; off.height = img.height;
                const ctx = off.getContext('2d');
                ctx.drawImage(img, 0, 0);
                imageDataMapRef.current.set(node.id, ctx.getImageData(0, 0, img.width, img.height));
                
                isDirtyRef.current = true;
              }
            }
          };
          img.src = sourceToUpload;
        }
      }

      // 2. Mesh Sync
      if (!scene.parts.hasMesh(node.id)) {
        if (node.mesh) {
          scene.parts.uploadMesh(node.id, node.mesh);
          isDirtyRef.current = true;
        } else if (node.imageWidth && node.imageHeight) {
          scene.parts.uploadQuadFallback(node.id, node.imageWidth, node.imageHeight);
          isDirtyRef.current = true;
        }
      }
    }
  }, [project.nodes, project.textures, versionControl.textureVersion]);

  const centerView = useCallback((contentW, contentH) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    if (vw === 0 || vh === 0) return;

    const zoom = editorRef.current.view.zoom;
    setView({
      panX: vw / 2 - (contentW / 2) * zoom,
      panY: vh / 2 - (contentH / 2) * zoom,
    });
    isDirtyRef.current = true;
  }, [setView]);

  // Auto-center view when entering the reorder or adjust steps
  useEffect(() => {
    if (wizardStep === 'reorder' || wizardStep === 'adjust') {
      const { psdW, psdH } = wizardPsd || {};
      if (psdW && psdH) {
        // Wait a tick for sidebars to appear/animate before centering
        const timer = setTimeout(() => {
          centerView(psdW, psdH);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [wizardStep, wizardPsd, centerView]);

  // Center view on initial mount
  useEffect(() => {
    const cw = projectRef.current.canvas.width;
    const ch = projectRef.current.canvas.height;
    // Use a small timeout to ensure the layout has settled and clientWidth/Height are correct
    const timer = setTimeout(() => centerView(cw, ch), 50);
    return () => clearTimeout(timer);
  }, [centerView]);

  /* ── WebGL init ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, stencil: true, preserveDrawingBuffer: true });
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

        let poseOverrides = null;
        if (editorRef.current.editorMode === 'animation') {
          // Base: keyframe-interpolated values
          const endMs = (anim.endFrame / anim.fps) * 1000;
          poseOverrides = computePoseOverrides(activeAnim, anim.currentTime, anim.loopKeyframes, endMs);
          // Overlay: draftPose (uncommitted drag) takes priority
          if (anim.draftPose.size > 0) {
            poseOverrides = new Map(poseOverrides);
            for (const [nodeId, draft] of anim.draftPose) {
              const existing = poseOverrides.get(nodeId) ?? {};
              poseOverrides.set(nodeId, { ...existing, ...draft });
            }
          }
        }

        // Always apply draftPose mesh_verts for GPU upload — this handles elbow/knee skinning
        // in staging mode where poseOverrides would otherwise be null.
        if (anim.draftPose.size > 0) {
          for (const [nodeId, draft] of anim.draftPose) {
            if (!draft.mesh_verts) continue;
            if (!poseOverrides) poseOverrides = new Map();
            // Don't clobber transform overrides already set by animation mode above
            const existing = poseOverrides.get(nodeId) ?? {};
            if (!existing.mesh_verts) poseOverrides.set(nodeId, { ...existing, mesh_verts: draft.mesh_verts });
          }
        }

        // Apply blend shapes — compute blended vertex positions for nodes with active influences
        const ed = editorRef.current;
        for (const node of projectRef.current.nodes) {
          if (node.type !== 'part' || !node.mesh || !node.blendShapes?.length) continue;
          const draft = anim.draftPose.get(node.id);
          const kfOv = poseOverrides?.get(node.id);

          let hasInfluence = false;
          const influences = node.blendShapes.map(shape => {
            // During edit mode, always show the active shape at full influence
            if (ed.blendShapeEditMode && ed.activeBlendShapeId === shape.id) {
              hasInfluence = true;
              return 1.0;
            }
            const prop = `blendShape:${shape.id}`;
            const v = draft?.[prop] ?? kfOv?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;
            if (v !== 0) hasInfluence = true;
            return v;
          });
          if (!hasInfluence) continue;

          const blendedVerts = node.mesh.vertices.map((v, i) => {
            let bx = v.restX, by = v.restY;
            for (let j = 0; j < node.blendShapes.length; j++) {
              const d = node.blendShapes[j].deltas[i];
              if (d) { bx += d.dx * influences[j]; by += d.dy * influences[j]; }
            }
            return { x: bx, y: by };
          });

          if (!poseOverrides) poseOverrides = new Map();
          const existing = poseOverrides.get(node.id) ?? {};
          if (!existing.mesh_verts) poseOverrides.set(node.id, { ...existing, mesh_verts: blendedVerts });
        }

        // Apply puppet warp — deform mesh using MLS-rigid based on pin positions
        for (const node of projectRef.current.nodes) {
          if (node.type !== 'part' || !node.mesh || !node.puppetWarp?.enabled || !node.puppetWarp.pins.length) continue;

          const draft = anim.draftPose.get(node.id);
          const kfOv = poseOverrides?.get(node.id);

          // Effective pins: draft > keyframe > base
          // Keyframe values only store {id, x, y} — merge restX/restY from base pins
          const basePins = node.puppetWarp.pins;
          const rawPins = draft?.puppet_pins ?? kfOv?.puppet_pins ?? null;
          const effectivePins = rawPins
            ? rawPins.map(p => {
                const base = basePins.find(b => b.id === p.id);
                return { restX: base?.restX ?? p.x, restY: base?.restY ?? p.y, x: p.x, y: p.y };
              })
            : basePins;
          if (!effectivePins.length) continue;

          // Input vertices: already blended (from blend shapes above) or base mesh
          const inputVerts = (kfOv?.mesh_verts ?? node.mesh.vertices).map(v => ({ x: v.x ?? v.restX, y: v.y ?? v.restY }));
          const warpedVerts = applyPuppetWarp(inputVerts, effectivePins);

          if (!poseOverrides) poseOverrides = new Map();
          const existing = poseOverrides.get(node.id) ?? {};
          poseOverrides.set(node.id, { ...existing, mesh_verts: warpedVerts });
        }

        // Upload mesh vertex overrides BEFORE drawing so the GPU buffers are
        // current for this frame's draw call. Previously uploads happened after
        // draw, causing a one-frame lag that made undo show the pre-undo mesh
        // for one frame (visible as a flicker when selection changes triggered
        // additional redraws).
        const newMeshOverridden = new Set();
        if (poseOverrides) {
          for (const [nodeId, ov] of poseOverrides) {
            if (!ov.mesh_verts) continue;
            newMeshOverridden.add(nodeId);
            const node = projectRef.current.nodes.find(n => n.id === nodeId);
            if (node?.mesh) {
              sceneRef.current.parts.uploadPositions(nodeId, ov.mesh_verts, new Float32Array(node.mesh.uvs));
            }
          }
        }
        for (const nodeId of meshOverriddenParts.current) {
          if (!newMeshOverridden.has(nodeId)) {
            // Override removed — restore base mesh from projectStore
            const node = projectRef.current.nodes.find(n => n.id === nodeId);
            if (node?.mesh) {
              sceneRef.current.parts.uploadPositions(nodeId, node.mesh.vertices, new Float32Array(node.mesh.uvs));
            }
          }
        }
        meshOverriddenParts.current = newMeshOverridden;

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
    [editorState.view, editorState.selection, editorState.overlays, editorState.meshEditMode,
    editorState.blendShapeEditMode, editorState.activeBlendShapeId]);

  /* ── Mark dirty when animation time or draft pose changes ───────────── */
  useEffect(() => { isDirtyRef.current = true; }, [animStore.currentTime]);
  useEffect(() => { isDirtyRef.current = true; }, [animStore.draftPose]);

  /* ── [ / ] brush size shortcuts (only in deform edit mode or blend shape edit mode) ────────────── */
  useEffect(() => {
    const handler = (e) => {
      const { meshEditMode, meshSubMode, blendShapeEditMode, brushSize } = editorRef.current;
      if ((!meshEditMode || meshSubMode !== 'deform') && !blendShapeEditMode) return;
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

      const ed = editorRef.current;
      const anim = useAnimationStore.getState();
      if (ed.editorMode !== 'animation') return;

      const proj = projectRef.current;
      if (proj.animations.length === 0) return;

      const animId = anim.activeAnimationId ?? proj.animations[0]?.id;
      if (!animId) return;

      let selectedIds = ed.selection;
      if (selectedIds.length === 0) return;

      // Expand selection to include dependent parts for JS skinning joints
      const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
      const extraIds = new Set();
      for (const selectedId of selectedIds) {
        const node = proj.nodes.find(n => n.id === selectedId);
        if (node && JSKinningRoles.has(node.boneRole)) {
          for (const pt of proj.nodes) {
            if (pt.type === 'part' && pt.mesh?.jointBoneId === selectedId) {
              extraIds.add(pt.id);
            }
          }
        }
      }
      if (extraIds.size > 0) {
        selectedIds = Array.from(new Set([...selectedIds, ...extraIds]));
      }

      const currentTimeMs = anim.currentTime;

      // Pre-compute effective values for each selected node:
      // draftPose (drag) > current keyframe > node.transform
      const activeAnimObj = proj.animations.find(a => a.id === animId) ?? null;
      const endMs = (anim.endFrame / anim.fps) * 1000;
      const keyframeOverrides = computePoseOverrides(activeAnimObj, currentTimeMs, anim.loopKeyframes, endMs);

      updateProject((p) => {
        const animation = p.animations.find(a => a.id === animId);
        if (!animation) return;

        for (const nodeId of selectedIds) {
          const node = p.nodes.find(n => n.id === nodeId);
          if (!node) continue;

          const startMs = (anim.startFrame / anim.fps) * 1000;
          const rest = anim.restPose.get(nodeId);
          const draft = anim.draftPose.get(nodeId);
          const kfValues = keyframeOverrides.get(nodeId);

          for (const prop of KEYFRAME_PROPS) {
            // Read value from highest-priority source: draft > current keyframe > base transform
            let value;
            if (draft && draft[prop] !== undefined) {
              value = draft[prop];
            } else if (kfValues && kfValues[prop] !== undefined) {
              value = kfValues[prop];
            } else {
              value = getNodePropertyValue(node, prop);
            }

            let track = animation.tracks.find(t => t.nodeId === nodeId && t.property === prop);
            const isNewTrack = !track;
            if (!track) {
              track = { nodeId, property: prop, keyframes: [] };
              animation.tracks.push(track);
            }

            // Auto-insert a rest-pose keyframe at startFrame when this is the
            // first keyframe for this track and we're past the start.
            if (isNewTrack && currentTimeMs > startMs && rest) {
              const baseVal = prop === 'opacity' ? (rest.opacity ?? 1)
                : (rest[prop] ?? (prop === 'scaleX' || prop === 'scaleY' ? 1 : 0));
              upsertKeyframe(track.keyframes, startMs, baseVal, 'linear');
            }

            upsertKeyframe(track.keyframes, currentTimeMs, value, 'linear');
          }

          // ── mesh_verts keyframe (deform mode) ───────────────────────────
          // Only create/update if the node actually has a mesh deform in draft,
          // or if a mesh_verts track already exists. This prevents accidental
          // mesh_verts keyframes from blocking blend shape animation.
          if (node.type === 'part' && node.mesh) {
            const hasMeshDeform = draft?.mesh_verts !== undefined;
            let meshTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'mesh_verts');

            if (hasMeshDeform || meshTrack) {
              const meshVerts = draft?.mesh_verts
                ?? kfValues?.mesh_verts
                ?? node.mesh.vertices.map(v => ({ x: v.x, y: v.y }));

              const isNewMeshTrack = !meshTrack;
              if (!meshTrack) {
                meshTrack = { nodeId, property: 'mesh_verts', keyframes: [] };
                animation.tracks.push(meshTrack);
              }

              // Auto-insert base-mesh keyframe at startFrame if this is the first keyframe
              if (isNewMeshTrack && currentTimeMs > startMs) {
                const baseVerts = node.mesh.vertices.map(v => ({ x: v.x, y: v.y }));
                upsertKeyframe(meshTrack.keyframes, startMs, baseVerts, 'linear');
              }

              upsertKeyframe(meshTrack.keyframes, currentTimeMs, meshVerts, 'linear');
            }
          }

          // ── blend shape influence keyframes ───────────────────────────────
          if (node.type === 'part' && node.blendShapes?.length) {
            for (const shape of node.blendShapes) {
              const prop = `blendShape:${shape.id}`;
              const value = draft?.[prop] ?? kfValues?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;

              let track = animation.tracks.find(t => t.nodeId === nodeId && t.property === prop);
              const isNewTrack = !track;
              if (!track) {
                track = { nodeId, property: prop, keyframes: [] };
                animation.tracks.push(track);
              }

              // Auto-insert rest-pose keyframe at startFrame if this is the first keyframe
              if (isNewTrack && currentTimeMs > startMs && rest) {
                upsertKeyframe(track.keyframes, startMs, node.blendShapeValues?.[shape.id] ?? 0, 'linear');
              }

              upsertKeyframe(track.keyframes, currentTimeMs, value, 'linear');
            }
          }

          // ── puppet_pins keyframe (puppet warp deformation) ──────────────────
          if (node.type === 'part' && node.puppetWarp?.enabled) {
            const hasPinDraft = draft?.puppet_pins !== undefined;
            let pinTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'puppet_pins');

            if (hasPinDraft || pinTrack) {
              const pinValue = draft?.puppet_pins
                ?? kfValues?.puppet_pins
                ?? node.puppetWarp.pins.map(p => ({ id: p.id, x: p.x, y: p.y }));

              const isNewPinTrack = !pinTrack;
              if (!pinTrack) {
                pinTrack = { nodeId, property: 'puppet_pins', keyframes: [] };
                animation.tracks.push(pinTrack);

                // Auto-insert rest-pose pin keyframe at startFrame
                if (currentTimeMs > startMs) {
                  const restPins = node.puppetWarp.pins.map(p => ({ id: p.id, x: p.restX, y: p.restY }));
                  upsertKeyframe(pinTrack.keyframes, startMs, restPins, 'linear');
                }
              }

              upsertKeyframe(pinTrack.keyframes, currentTimeMs, pinValue, 'linear');
            }
          }
        }
      });

      // Clear draft for committed nodes so the keyframe value takes over
      for (const nodeId of selectedIds) {
        anim.clearDraftPoseForNode(nodeId);
      }
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
          // Clear blend shapes on remesh since vertex count/order changed
          if (node.blendShapes?.length > 0) {
            console.warn(`[Stretchy] Blend shapes on "${node.name}" cleared after remesh — topology changed.`);
            node.blendShapes = [];
            node.blendShapeValues = {};
          }

          node.mesh = { vertices, uvs: Array.from(uvs), triangles, edgeIndices };

          // Compute skin weights if this part belongs to a limb
          const parentGroup = proj.nodes.find(n => n.id === node.parent);
          if (parentGroup && parentGroup.boneRole) {
            const roleMap = {
              'leftArm': 'leftElbow', 'rightArm': 'rightElbow',
              'leftLeg': 'leftKnee', 'rightLeg': 'rightKnee'
            };
            const childRole = roleMap[parentGroup.boneRole];
            if (childRole) {
              const jointBone = proj.nodes.find(n => n.parent === parentGroup.id && n.boneRole === childRole);
              if (jointBone) {
                const jx = jointBone.transform.pivotX;
                const jy = jointBone.transform.pivotY;

                // Build a direction vector from the shoulder (parentGroup pivot) → elbow (jointBone pivot).
                // Projecting vertices onto this axis gives correct weights regardless of arm orientation.
                const sx = parentGroup.transform.pivotX;
                const sy = parentGroup.transform.pivotY;
                const axDx = jx - sx;
                const axDy = jy - sy;
                const axLen = Math.sqrt(axDx * axDx + axDy * axDy) || 1;
                const axX = axDx / axLen;
                const axY = axDy / axLen;

                // Blend zone: 40px centred on the elbow pivot along the arm axis
                const blend = 40;
                node.mesh.boneWeights = vertices.map(v => {
                  // Signed distance of vertex past the elbow pivot (along arm axis)
                  const proj2 = (v.x - jx) * axX + (v.y - jy) * axY;
                  // proj2 < 0 → upper arm (rigid to shoulder), > 0 → lower arm (follows elbow)
                  const w = proj2 / blend + 0.5;
                  return Math.max(0, Math.min(1, w));
                });
                node.mesh.jointBoneId = jointBone.id;
                console.log(`[Skinning] ${node.name} → ${childRole} (${vertices.length} verts, pivot ${jx.toFixed(0)},${jy.toFixed(0)})`);
              }
            }
          }

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

  /* ── Auto-mesh all unmeshed parts with smart sizing ─────────────────────── */
  const autoMeshAllParts = useCallback(() => {
    const proj = projectRef.current;
    const parts = proj.nodes.filter(n => n.type === 'part' && !n.mesh);
    for (const node of parts) {
      const opts = computeSmartMeshOpts(node.imageBounds);
      remeshPart(node.id, opts);
    }
  }, [remeshPart]);

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
        proj.canvas.width = img.width;
        proj.canvas.height = img.height;
        proj.textures.push({ id: partId, source: url });
        proj.nodes.push({
          id: partId,
          type: 'part',
          name: basename(file.name),
          parent: null,
          draw_order: proj.nodes.filter(n => n.type === 'part').length,
          opacity: 1,
          visible: true,
          clip_mask: null,
          transform: { ...DEFAULT_TRANSFORM(), pivotX: img.width / 2, pivotY: img.height / 2 },
          meshOpts: null,
          mesh: null,
          imageWidth: img.width,
          imageHeight: img.height,
          imageBounds: imageBounds || { minX: 0, minY: 0, maxX: img.width, maxY: img.height },
        });
        ver.textureVersion++;
      });

      centerView(img.width, img.height);

      const scene = sceneRef.current;
      if (scene) {
        scene.parts.uploadTexture(partId, img);
        scene.parts.uploadQuadFallback(partId, img.width, img.height);
        isDirtyRef.current = true;
      }
    };
    img.src = url;
  }, [updateProject]);

  /* ── PSD import: finalize (shared by all import paths) ──────────────────── */
  const finalizePsdImport = useCallback((psdW, psdH, layers, partIds, groupDefs, assignments) => {
    const setExpandedGroups = useEditorStore.getState().setExpandedGroups;
    const setActiveLayerTab = useEditorStore.getState().setActiveLayerTab;

    // Auto-expand all new groups and switch to Groups tab
    if (groupDefs.length > 0) {
      setExpandedGroups(groupDefs.map(g => g.id));
      setActiveLayerTab('groups');
    }

    updateProject((proj, ver) => {
      proj.canvas.width = psdW;
      proj.canvas.height = psdH;

      // Create group nodes first (so parent IDs exist when parts reference them)
      for (const g of groupDefs) {
        proj.nodes.push({
          id: g.id,
          type: 'group',
          name: g.name,
          parent: g.parentId,
          opacity: 1,
          visible: true,
          boneRole: g.boneRole ?? null,
          transform: {
            ...DEFAULT_TRANSFORM(),
            pivotX: g.pivotX ?? 0,
            pivotY: g.pivotY ?? 0,
          },
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
          id: partId,
          type: 'part',
          name: layer.name,
          parent: assignment?.parentGroupId ?? null,
          draw_order: assignment?.drawOrder ?? (layers.length - 1 - i),
          opacity: layer.opacity,
          visible: layer.visible,
          clip_mask: null,
          transform: { ...DEFAULT_TRANSFORM(), pivotX: psdW / 2, pivotY: psdH / 2 },
          meshOpts: null,
          mesh: null,
          imageWidth: psdW,
          imageHeight: psdH,
          imageBounds: imageBounds || { minX: 0, minY: 0, maxX: psdW, maxY: psdH },
        });
      });

      ver.textureVersion++;
    });

    centerView(psdW, psdH);
  }, [updateProject, centerView]);

  /* ── Wizard: cancel import (called by PsdImportWizard) ─────────────────── */
  const handleWizardCancel = useCallback(() => {
    setWizardPsd(null);
    setWizardStep(null);
  }, []);

  /* ── Wizard: finalize with rig (called by PsdImportWizard) ──────────────── */
  const handleWizardFinalize = useCallback((groupDefs, assignments, meshAllParts) => {
    const { psdW, psdH, layers, partIds } = wizardPsd;
    // Snapshot project state before modifying (supports Back from adjust step)
    // Only snapshot if we don't already have one (e.g. from an earlier rig attempt)
    if (!preImportSnapshotRef.current) {
      preImportSnapshotRef.current = JSON.stringify(useProjectStore.getState().project);
    }
    finalizePsdImport(psdW, psdH, layers, partIds, groupDefs, assignments);
    meshAllPartsRef.current = meshAllParts;
    useEditorStore.getState().setShowSkeleton(true);
    useEditorStore.getState().setSkeletonEditMode(true);
    setWizardStep('adjust');
  }, [wizardPsd, finalizePsdImport]);

  /* ── Wizard: enter reorder stage (finalize without rig) ────────────────── */
  const handleWizardReorder = useCallback(() => {
    const { psdW, psdH, layers, partIds } = wizardPsd;
    if (!preImportSnapshotRef.current) {
      preImportSnapshotRef.current = JSON.stringify(useProjectStore.getState().project);
    }
    finalizePsdImport(psdW, psdH, layers, partIds, [], null);
    setWizardStep('reorder');
  }, [wizardPsd, finalizePsdImport]);

  /* ── Wizard: apply rig to existing part nodes ──────────────────────────── */
  const handleWizardApplyRig = useCallback((groupDefs, assignments, meshAllParts) => {
    updateProject((proj) => {
      // 0. Remove any existing rig groups generated by previous attempts in this import session
      const psdPartIds = new Set(wizardPsd.partIds);
      const toDelete = new Set();
      let currentLevel = proj.nodes.filter(n => psdPartIds.has(n.id));
      while (currentLevel.length > 0) {
        let nextLevel = [];
        for (const n of currentLevel) {
          if (n.parent && !toDelete.has(n.parent)) {
            toDelete.add(n.parent);
            const parentNode = proj.nodes.find(p => p.id === n.parent);
            if (parentNode && parentNode.type === 'group') {
              nextLevel.push(parentNode);
            }
          }
        }
        currentLevel = nextLevel;
      }
      if (toDelete.size > 0) {
        proj.nodes = proj.nodes.filter(n => !toDelete.has(n.id));
      }

      // 1. Create group nodes first
      for (const g of groupDefs) {
        proj.nodes.push({
          id: g.id,
          type: 'group',
          name: g.name,
          parent: g.parentId,
          opacity: 1,
          visible: true,
          boneRole: g.boneRole ?? null,
          transform: {
            ...DEFAULT_TRANSFORM(),
            pivotX: g.pivotX ?? 0,
            pivotY: g.pivotY ?? 0,
          },
        });
      }

      // 2. Update existing part nodes with new parents and draw orders
      assignments.forEach((assign, index) => {
        const partId = wizardPsd.partIds[index];
        const node = proj.nodes.find(n => n.id === partId);
        if (node) {
          node.parent = assign.parentGroupId;
          node.draw_order = assign.drawOrder;
        }
      });
    });

    const setExpandedGroups = useEditorStore.getState().setExpandedGroups;
    const setActiveLayerTab = useEditorStore.getState().setActiveLayerTab;
    if (groupDefs.length > 0) {
      setExpandedGroups(groupDefs.map(g => g.id));
      setActiveLayerTab('groups');
    }

    meshAllPartsRef.current = meshAllParts;
    useEditorStore.getState().setShowSkeleton(true);
    useEditorStore.getState().setSkeletonEditMode(true);
    setWizardStep('adjust');
  }, [wizardPsd, updateProject]);

  /* ── Wizard: skip rigging (called by PsdImportWizard) ──────────────────── */
  const handleWizardSkip = useCallback((meshAllParts) => {
    const { psdW, psdH, layers, partIds } = wizardPsd;
    finalizePsdImport(psdW, psdH, layers, partIds, [], null);
    if (meshAllParts) {
      // Auto-mesh will happen asynchronously as textures are uploaded
      // Schedule it after a short delay to let finalizePsdImport complete
      setTimeout(() => autoMeshAllParts(), 100);
    }
    setWizardPsd(null);
    setWizardStep(null);
  }, [wizardPsd, finalizePsdImport, autoMeshAllParts]);

  /* ── Wizard: complete (called by PsdImportWizard adjust step) ──────────── */
  const handleWizardComplete = useCallback((meshAllParts) => {
    if (meshAllParts ?? meshAllPartsRef.current) {
      // Auto-mesh all unmeshed parts with smart sizing
      autoMeshAllParts();
    }
    setWizardStep(null);
    setWizardPsd(null);
    useEditorStore.getState().setSkeletonEditMode(false);
    preImportSnapshotRef.current = null;
  }, [autoMeshAllParts]);

  /* ── Wizard: back from adjust (revert to snapshot, reopen wizard) ──────── */
  const handleWizardBack = useCallback(() => {
    if (preImportSnapshotRef.current) {
      useProjectStore.setState({ project: JSON.parse(preImportSnapshotRef.current) });
      preImportSnapshotRef.current = null;
    }
    useEditorStore.getState().setSkeletonEditMode(false);
    useEditorStore.getState().setShowSkeleton(false);
    setWizardStep('review');
  }, []);


  /* ── Wizard: split merged parts into left/right ────────────── */
  const handleWizardSplitParts = useCallback((splits) => {
    setWizardPsd(prev => {
      if (!prev) return prev;
      const newLayers = [...prev.layers];
      const newPartIds = [...prev.partIds];

      const sortedSplits = [...splits].sort((a, b) => b.mergedIdx - a.mergedIdx);

      for (const { mergedIdx, rightLayer, leftLayer } of sortedSplits) {
        const replacements = [];
        if (rightLayer) replacements.push({ layer: rightLayer, partId: uid() });
        if (leftLayer) replacements.push({ layer: leftLayer, partId: uid() });
        
        newLayers.splice(mergedIdx, 1, ...replacements.map(r => r.layer));
        newPartIds.splice(mergedIdx, 1, ...replacements.map(r => r.partId));
      }

      return { ...prev, layers: newLayers, partIds: newPartIds };
    });
  }, []);

  const handleWizardUpdatePsd = useCallback((updates) => {
    setWizardPsd(prev => (prev ? { ...prev, ...updates } : prev));
  }, []);

  /* ── Save/Load project ────────────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    try {
      const blob = await saveProject(projectRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project.stretch';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to save project:', err);
    }
  }, []);

  useEffect(() => { if (saveRef) saveRef.current = handleSave; }, [saveRef, handleSave]);

  const handleLoadProject = useCallback(async (file) => {
    if (!file) return;
    try {
      const { project: loadedProject, images } = await loadProject(file);

      // Destroy all GPU resources
      if (sceneRef.current) {
        sceneRef.current.parts.destroyAll();
      }

      // Load project into store
      useProjectStore.getState().loadProject(loadedProject);

      // Rebuild imageDataMapRef from loaded textures
      imageDataMapRef.current.clear();
      for (const [partId, img] of images) {
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        imageDataMapRef.current.set(partId, imageData);
      }

      // Re-upload to GPU
      for (const node of loadedProject.nodes) {
        if (node.type !== 'part') continue;
        if (images.has(node.id)) {
          sceneRef.current?.parts.uploadTexture(node.id, images.get(node.id));
        }
        if (node.mesh) {
          sceneRef.current?.parts.uploadMesh(node.id, node.mesh);
        } else if (node.imageWidth && node.imageHeight) {
          sceneRef.current?.parts.uploadQuadFallback(node.id, node.imageWidth, node.imageHeight);
        }
      }

      // Reset animation playback state
      useAnimationStore.getState().resetPlayback?.();

      // Reset editor selection
      useEditorStore.getState().setSelection([]);

      isDirtyRef.current = true;

      // Center the loaded project view
      const cw = loadedProject.canvas?.width || 800;
      const ch = loadedProject.canvas?.height || 600;
      centerView(cw, ch);
    } catch (err) {
      console.error('Failed to load project:', err);
    }
  }, [centerView]);

  useEffect(() => {
    if (loadRef) loadRef.current = handleLoadProject;
  }, [loadRef, handleLoadProject]);

  /* ── PSD import helper ───────────────────────────────────────────────── */
  const processPsdFile = useCallback((file) => {
    file.arrayBuffer().then((buffer) => {
      let parsed;
      try { parsed = importPsd(buffer); }
      catch (err) { console.error('[PSD Import]', err); return; }

      const { width: psdW, height: psdH, layers } = parsed;
      if (!layers.length) return;

      const partIds = layers.map(() => uid());

      if (detectCharacterFormat(layers)) {
        // See-through character detected → open import wizard
        setWizardPsd({ psdW, psdH, layers, partIds });
        setWizardStep('review');
      } else {
        finalizePsdImport(psdW, psdH, layers, partIds, [], null);
      }
    });
  }, [finalizePsdImport]);

  const importPsdFile = useCallback((file) => {
    const proj = projectRef.current;
    if (proj.nodes.length > 0) {
      setPendingFile(file);
      setConfirmWipeOpen(true);
    } else {
      processPsdFile(file);
    }
  }, [processPsdFile]);

  const importStretchFile = useCallback((file) => {
    const proj = projectRef.current;
    if (proj.nodes.length > 0) {
      setPendingFile(file);
      setConfirmWipeOpen(true);
    } else {
      handleLoadProject(file);
    }
  }, [handleLoadProject]);

  const handleConfirmWipe = useCallback(() => {
    if (pendingFile) {
      const isStretch = pendingFile.name.toLowerCase().endsWith('.stretch');
      resetProject();
      animRef.current.resetPlayback();

      if (isStretch) {
        handleLoadProject(pendingFile);
      } else {
        processPsdFile(pendingFile);
      }
      setPendingFile(null);
    }
    setConfirmWipeOpen(false);
  }, [pendingFile, processPsdFile, handleLoadProject, resetProject]);

  /* ── Drag-and-drop ───────────────────────────────────────────────────── */
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.stretch')) {
      importStretchFile(file);
    } else if (file.name.toLowerCase().endsWith('.psd')) {
      importPsdFile(file);
    } else if (file.type.startsWith('image/')) {
      importPng(file);
    }
  }, [importPng, importPsdFile, importStretchFile]);

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

    const proj = projectRef.current;

    // When skeleton is visible, we disable standard layer selection/dragging
    // to focus exclusively on bone interactions.
    // BUGFIX: If showSkeleton is true but NO armature exists (e.g. at start or skip rigging),
    // we MUST allow standard selection, otherwise the user is stuck.
    const hasArmature = proj.nodes.some(n => n.type === 'group' && n.boneRole);
    if (editorRef.current.showSkeleton && hasArmature) return;

    const [worldX, worldY] = clientToCanvasSpace(canvas, e.clientX, e.clientY, view);

    // Build effective nodes: apply animation pose overrides so world matrices
    // and vertex positions match what is visually displayed on the canvas.
    const animNow = animRef.current;
    const isAnimMode = editorRef.current.editorMode === 'animation';
    const activeAnim = isAnimMode
      ? (proj.animations.find(a => a.id === animNow.activeAnimationId) ?? null)
      : null;
    const kfOverrides = isAnimMode ? computePoseOverrides(activeAnim, animNow.currentTime) : null;
    const ANIM_TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];

    const effectiveNodes = (isAnimMode && (kfOverrides?.size || animNow.draftPose.size))
      ? proj.nodes.map(node => {
        const kfOv = kfOverrides?.get(node.id);
        const drOv = animNow.draftPose.get(node.id);
        if (!kfOv && !drOv) return node;
        const tr = { ...node.transform };
        if (kfOv) { for (const k of ANIM_TRANSFORM_KEYS) { if (kfOv[k] !== undefined) tr[k] = kfOv[k]; } }
        if (drOv) { for (const k of ANIM_TRANSFORM_KEYS) { if (drOv[k] !== undefined) tr[k] = drOv[k]; } }
        return {
          ...node,
          transform: tr,
          opacity: drOv?.opacity ?? kfOv?.opacity ?? node.opacity,
          visible: drOv?.visible ?? kfOv?.visible ?? node.visible,
        };
      })
      : proj.nodes;

    // Compute world matrices once for picking — from effective (animated) transforms
    const worldMatrices = computeWorldMatrices(effectiveNodes);

    // Get parts sorted by draw order descending (front to back) for correct hit testing
    const sortedParts = effectiveNodes
      .filter(n => n.type === 'part')
      .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

    // ── select tool: vertex drag and part selection ──────────────────────
    // When mesh edit mode is active, restrict interaction to the selected part only.
    const { meshEditMode, toolMode } = editorRef.current;
    const currentSelection = editorRef.current.selection ?? [];
    if (meshEditMode && currentSelection.length > 0) {
      const selNode = effectiveNodes.find(n => n.id === currentSelection[0] && n.type === 'part' && n.mesh);
      if (selNode) {
        const wm = worldMatrices.get(selNode.id) ?? mat3Identity();
        const iwm = mat3Inverse(wm);
        const [lx, ly] = worldToLocal(worldX, worldY, iwm);

        if (toolMode === 'add_vertex') {
          // Compute new mesh data first, then upload and persist atomically
          const newVerts = [...selNode.mesh.vertices, { x: lx, y: ly, restX: lx, restY: ly }];
          const oldUvs = selNode.mesh.uvs;
          const newUvs = new Float32Array(oldUvs.length + 2);
          newUvs.set(oldUvs);
          newUvs[oldUvs.length] = lx / (selNode.imageWidth ?? 1);
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
            node.mesh.vertices = result.vertices;
            node.mesh.uvs = Array.from(result.uvs);
            node.mesh.triangles = result.triangles;
          });

        } else if (toolMode === 'remove_vertex') {
          const idx = findNearestVertex(selNode.mesh.vertices, lx, ly, 14 / view.zoom);
          if (idx >= 0 && selNode.mesh.vertices.length > 3) {
            // Compute new mesh data first
            const newVerts = selNode.mesh.vertices.filter((_, i) => i !== idx);
            const oldUvs = selNode.mesh.uvs;
            const newUvs = new Float32Array(oldUvs.length - 2);
            for (let i = 0; i < idx; i++) { newUvs[i * 2] = oldUvs[i * 2]; newUvs[i * 2 + 1] = oldUvs[i * 2 + 1]; }
            for (let i = idx; i < newVerts.length; i++) { newUvs[i * 2] = oldUvs[(i + 1) * 2]; newUvs[i * 2 + 1] = oldUvs[(i + 1) * 2 + 1]; }
            const oldEdge = selNode.mesh.edgeIndices ?? new Set();
            const newEdge = new Set();
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
              node.mesh.vertices = result.vertices;
              node.mesh.uvs = Array.from(result.uvs);
              node.mesh.triangles = result.triangles;
              node.mesh.edgeIndices = newEdge;
            });
          }
        } else {
          // Default select tool in deform mode: brush-based multi-vertex drag
          const { brushSize, brushHardness, meshSubMode } = editorRef.current;
          const worldRadius = brushSize / view.zoom;

          // Use the effective (pose-overridden) vertex positions so the brush
          // hits where the mesh is visually displayed, not the base mesh.
          let effectiveVerts =
            animNow.draftPose.get(selNode.id)?.mesh_verts
            ?? kfOverrides?.get(selNode.id)?.mesh_verts
            ?? selNode.mesh.vertices;

          // In blend shape edit mode, apply existing deltas (active shape at full influence)
          // so each drag continues from the visually correct position, not from rest.
          if (editorRef.current.blendShapeEditMode && selNode.blendShapes?.length) {
            const activeShapeId = editorRef.current.activeBlendShapeId;
            effectiveVerts = selNode.mesh.vertices.map((v, i) => {
              let bx = v.restX, by = v.restY;
              for (const shape of selNode.blendShapes) {
                const d = shape.deltas[i];
                if (!d) continue;
                const inf = shape.id === activeShapeId
                  ? 1.0  // active shape always at full influence during editing
                  : (selNode.blendShapeValues?.[shape.id] ?? 0);
                bx += d.dx * inf;
                by += d.dy * inf;
              }
              return { x: bx, y: by };
            });
          }

          const affected = [];
          for (let i = 0; i < effectiveVerts.length; i++) {
            const dx = effectiveVerts[i].x - lx, dy = effectiveVerts[i].y - ly;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const w = meshSubMode === 'deform'
              ? brushWeight(dist, worldRadius, brushHardness)
              : (dist <= 14 / view.zoom ? 1 : 0); // adjust: exact vertex pick
            if (w > 0) affected.push({ index: i, startX: effectiveVerts[i].x, startY: effectiveVerts[i].y, weight: w });
          }
          if (affected.length > 0 || meshSubMode === 'deform') {
            dragRef.current = {
              mode: 'brush',
              partId: selNode.id,
              startWorldX: worldX,
              startWorldY: worldY,
              // Snapshot of effective vertex positions at drag start
              verticesSnap: effectiveVerts.map(v => ({ ...v })),
              allUvs: new Float32Array(selNode.mesh.uvs),
              imageWidth: selNode.imageWidth,
              imageHeight: selNode.imageHeight,
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
      const wm = worldMatrices.get(node.id) ?? mat3Identity();
      const iwm = mat3Inverse(wm);
      const [lx, ly] = worldToLocal(worldX, worldY, iwm);

      // Check vertex hit first if mesh exists (priority for dragging)
      if (node.mesh) {
        const nodeEffVerts =
          animNow.draftPose.get(node.id)?.mesh_verts
          ?? kfOverrides?.get(node.id)?.mesh_verts
          ?? node.mesh.vertices;
        const idx = findNearestVertex(nodeEffVerts, lx, ly, 14 / view.zoom);
        if (idx >= 0) {
          dragRef.current = {
            partId: node.id,
            vertexIndex: idx,
            startWorldX: worldX,
            startWorldY: worldY,
            startLocalX: nodeEffVerts[idx].x,
            startLocalY: nodeEffVerts[idx].y,
            imageWidth: node.imageWidth,
            imageHeight: node.imageHeight,
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
      const inDeformMode = (editorRef.current.meshEditMode && editorRef.current.meshSubMode === 'deform')
        || editorRef.current.blendShapeEditMode;
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

      // Blend shape edit mode — write to shape key deltas instead of mesh or draftPose
      if (editorRef.current.blendShapeEditMode) {
        const shapeId = editorRef.current.activeBlendShapeId;
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === partId);
          const shape = node?.blendShapes?.find(s => s.id === shapeId);
          if (!shape) return;
          for (const { index, weight } of affected) {
            const nx = verticesSnap[index].x + localDx * weight;
            const ny = verticesSnap[index].y + localDy * weight;
            shape.deltas[index] = {
              dx: nx - node.mesh.vertices[index].restX,
              dy: ny - node.mesh.vertices[index].restY,
            };
          }
        });
        return;
      }

      // In animation mode + deform: store to draftPose — don't bake into base mesh.
      // The user will press K to commit as a keyframe.
      if (editorRef.current.editorMode === 'animation' && meshSubMode === 'deform') {
        animRef.current.setDraftPose(partId, { mesh_verts: newVerts.map(v => ({ x: v.x, y: v.y })) });
        return;
      }

      // Staging mode (or adjust sub-mode): persist directly to the base mesh
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === partId);
        if (!node?.mesh) return;
        for (const { index, startX, startY, weight } of affected) {
          const nx = startX + localDx * weight;
          const ny = startY + localDy * weight;
          node.mesh.vertices[index].x = nx;
          node.mesh.vertices[index].y = ny;
          if (meshSubMode === 'adjust') {
            node.mesh.uvs[index * 2] = nx / (imageWidth ?? 1);
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
        node.mesh.vertices[vertexIndex].x = newLocalX;
        node.mesh.vertices[vertexIndex].y = newLocalY;
        node.mesh.uvs[vertexIndex * 2] = newLocalX / (imageWidth ?? 1);
        node.mesh.uvs[vertexIndex * 2 + 1] = newLocalY / (imageHeight ?? 1);
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
      if (editorRef.current.autoKeyframe && editorRef.current.editorMode === 'animation') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    }
  }, []);

  /* ── File Upload Handlers ───────────────────────────────────────────── */
  const handlePanelClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.stretch')) {
      importStretchFile(file);
    } else if (file.name.toLowerCase().endsWith('.psd')) {
      importPsdFile(file);
    } else if (file.type.startsWith('image/')) {
      importPng(file);
    }

    // Clear input so same file can be uploaded again if needed
    e.target.value = '';
  }, [importStretchFile, importPsdFile, importPng]);

  /**
   * Reset the current project to empty state.
   */
  const handleReset = useCallback(() => {
    // 1. Destroy GPU resources
    if (sceneRef.current) {
      sceneRef.current.parts.destroyAll();
    }

    // 2. Clear store
    useProjectStore.getState().resetProject();

    // 3. Clear local cache
    imageDataMapRef.current.clear();

    // 4. Reset editor state
    useAnimationStore.getState().resetPlayback?.();
    useEditorStore.getState().setSelection([]);

    isDirtyRef.current = true;

    // 5. Center view
    centerView(800, 600);
  }, [centerView]);

  useEffect(() => {
    if (resetRef) resetRef.current = handleReset;
  }, [resetRef, handleReset]);

  /**
   * Capture a thumbnail of the current staging area.
   */
  const captureStaging = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Create an offscreen canvas for downsizing
    const off = document.createElement('canvas');
    const MAX_W = 400;
    const scale = Math.min(1, MAX_W / canvas.width);
    off.width = canvas.width * scale;
    off.height = canvas.height * scale;

    const ctx = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0, off.width, off.height);

    return off.toDataURL('image/webp', 0.8);
  }, []);

  useEffect(() => {
    if (thumbCaptureRef) thumbCaptureRef.current = captureStaging;
  }, [thumbCaptureRef, captureStaging]);

  /* ── Export frame capture ────────────────────────────────────────────── */
  const captureExportFrame = useCallback(({
    animId, timeMs, bgEnabled, bgColor,
    exportWidth, exportHeight,
    format = 'png', quality = 0.92,
    cropOffset = null,
    loopKeyframes = false,
  }) => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return null;

    // Set canvas to export dimensions
    canvas.width = exportWidth;
    canvas.height = exportHeight;

    // Mock editor: 1:1 pixel space, no overlays
    const panX = cropOffset ? -cropOffset.x : 0;
    const panY = cropOffset ? -cropOffset.y : 0;
    const exportEditor = {
      ...editorRef.current,
      view: { zoom: 1, panX, panY },
      selection: [],
      meshEditMode: false,
      overlays: {
        showImage: true, showWireframe: false,
        showVertices: false, showEdgeOutline: false,
        irisClipping: editorRef.current.overlays?.irisClipping ?? true,
      },
    };

    // Export project with overridden bg (always render transparent, composite later)
    const exportProject = {
      ...projectRef.current,
      canvas: { ...projectRef.current.canvas, bgEnabled: false },
    };

    // Compute pose at timeMs
    let poseOverrides = null;
    if (animId) {
      const anim = exportProject.animations.find(a => a.id === animId);
      if (anim) {
        poseOverrides = computePoseOverrides(anim, timeMs, loopKeyframes, anim.duration ?? 0);

        // Compute mesh deformations (blend shapes + puppet warp) for export frame
        for (const node of exportProject.nodes) {
          if (node.type !== 'part' || !node.mesh) continue;

          let currentMeshVerts = null;

          // 1. Blend shapes
          if (node.blendShapes?.length) {
            const influences = node.blendShapes.map(shape => {
              const prop = `blendShape:${shape.id}`;
              return poseOverrides.get(node.id)?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;
            });
            if (influences.some(v => v !== 0)) {
              currentMeshVerts = node.mesh.vertices.map((v, i) => {
                let bx = v.restX, by = v.restY;
                for (let j = 0; j < node.blendShapes.length; j++) {
                  const d = node.blendShapes[j].deltas[i];
                  if (d) { bx += d.dx * influences[j]; by += d.dy * influences[j]; }
                }
                return { x: bx, y: by };
              });
            }
          }

          // 2. Puppet warp (applied on top of blended vertices if they exist)
          if (node.puppetWarp?.enabled && node.puppetWarp.pins.length) {
            const kfOv = poseOverrides.get(node.id);
            const basePins = node.puppetWarp.pins;
            const rawPins = kfOv?.puppet_pins ?? null;
            const effectivePins = rawPins
              ? rawPins.map(p => {
                const base = basePins.find(b => b.id === p.id);
                return { restX: base?.restX ?? p.x, restY: base?.restY ?? p.y, x: p.x, y: p.y };
              })
              : basePins;

            if (effectivePins.length) {
              const inputVerts = (currentMeshVerts ?? node.mesh.vertices).map(v => ({ x: v.x ?? v.restX, y: v.y ?? v.restY }));
              currentMeshVerts = applyPuppetWarp(inputVerts, effectivePins);
            }
          }

          if (currentMeshVerts) {
            const existing = poseOverrides.get(node.id) ?? {};
            poseOverrides.set(node.id, { ...existing, mesh_verts: currentMeshVerts });
          }
        }
      }
    }

    // Upload deformed mesh vertices to GPU before rendering
    const exportMeshOverridden = [];
    if (poseOverrides) {
      for (const [nodeId, ov] of poseOverrides) {
        if (!ov.mesh_verts) continue;
        const node = exportProject.nodes.find(n => n.id === nodeId);
        if (node?.mesh) {
          scene.parts.uploadPositions(nodeId, ov.mesh_verts, new Float32Array(node.mesh.uvs));
          exportMeshOverridden.push(nodeId);
        }
      }
    }

    // Render with export flags
    scene.draw(exportProject, exportEditor, isDarkRef.current, poseOverrides, {
      skipResize: true,
      exportMode: true,
    });

    // Composite bg color if needed, otherwise capture transparent
    const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    let dataUrl;
    if (bgEnabled && bgColor) {
      const off = document.createElement('canvas');
      off.width = exportWidth; off.height = exportHeight;
      const ctx2d = off.getContext('2d');
      ctx2d.fillStyle = bgColor;
      ctx2d.fillRect(0, 0, exportWidth, exportHeight);
      ctx2d.drawImage(canvas, 0, 0);
      dataUrl = off.toDataURL(mimeType, quality);
    } else {
      dataUrl = canvas.toDataURL(mimeType, quality);
    }

    // Restore original mesh positions after capture is complete
    for (const nodeId of exportMeshOverridden) {
      const node = exportProject.nodes.find(n => n.id === nodeId);
      if (node?.mesh) {
        scene.parts.uploadPositions(nodeId, node.mesh.vertices, new Float32Array(node.mesh.uvs));
      }
    }

    // Mark dirty for rAF to restore canvas size via resize guard
    isDirtyRef.current = true;
    return dataUrl;
  }, []);

  useEffect(() => { if (exportCaptureRef) exportCaptureRef.current = captureExportFrame; }, [exportCaptureRef, captureExportFrame]);

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

      {/* Transform gizmo SVG overlay — hidden when skeleton is showing AND exists */}
      {(!editorState.showSkeleton || !project.nodes.some(n => n.type === 'group' && n.boneRole)) && <GizmoOverlay />}

      {/* Armature skeleton overlay (staging mode, when rig exists) */}
      <SkeletonOverlay
        view={editorState.view}
        editorMode={editorState.editorMode}
        showSkeleton={editorState.showSkeleton}
        skeletonEditMode={editorState.skeletonEditMode}
      />


      {/* Drop hint overlay */}
      {project.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".stretch,.psd,image/*"
            className="hidden"
          />
          <div
            onClick={handlePanelClick}
            className="max-w-md w-full flex flex-col items-center gap-8 p-10 rounded-[3rem] 
                       border border-border/40 bg-card/30 backdrop-blur-2xl 
                       hover:bg-card/40 hover:border-primary/30 hover:scale-[1.01]
                       transition-all duration-300 group cursor-pointer shadow-2xl ring-1 ring-white/5
                       animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out pointer-events-auto"
          >
            {/* Upload Button */}
            <div className="w-24 h-24 rounded-[2rem] bg-primary/10 flex items-center justify-center 
                            border border-primary/20 group-hover:bg-primary/20 group-hover:scale-110 
                            transition-all duration-500 shadow-xl shadow-primary/10">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-primary">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <div className="space-y-3">
              <p className="text-3xl font-bold tracking-tight text-foreground/90 leading-tight">
                Drop or <span className="text-primary">click</span> to upload a <br />
                <span className="text-foreground underline underline-offset-8 decoration-primary/30">.stretch</span> or <span className="text-foreground underline underline-offset-8 decoration-primary/30">PSD/PNG</span>
              </p>
              <p className="text-sm text-muted-foreground/60 select-none">
                Character rigging and animation in seconds.
              </p>
            </div>

            {/* Separator */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

            {/* Help / Guidance Card Section */}
            <div className="w-full space-y-4 pt-2">
              <h3 className="text-xs font-bold text-foreground/70 uppercase tracking-widest">Don't have a layered PSD?</h3>

              <a
                href="https://huggingface.co/spaces/24yearsold/see-through-demo"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl 
                           bg-primary text-primary-foreground text-xs font-black 
                           hover:brightness-110 active:scale-[0.98] transition-all 
                           shadow-lg shadow-primary/25"
              >
                LAYER-IFY YOUR IMAGE <br /> (Free HuggingFace Space)
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-80">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>

              <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-[280px] mx-auto pointer-events-auto">
                Provided by the authors of <a href="https://github.com/shitagaki-lab/see-through" target="_blank" rel="noopener noreferrer" className="text-primary/80 hover:underline font-medium" onClick={(e) => e.stopPropagation()}>See-through</a>,
                an AI model that automatically decomposes single character illustrations into ready-to-animate layers.
              </p>
            </div>
          </div>
        </div>
      )}


      {/* PSD import wizard — step-by-step rigging setup */}
      {wizardStep && wizardPsd && (
        <PsdImportWizard
          step={wizardStep}
          onSetStep={setWizardStep}
          pendingPsd={wizardPsd}
          onnxSessionRef={onnxSessionRef}
          onFinalize={handleWizardFinalize}
          onSkip={handleWizardSkip}
          onCancel={handleWizardCancel}
          onComplete={handleWizardComplete}
          onBack={handleWizardBack}
          onSplitParts={handleWizardSplitParts}
          onUpdatePsd={handleWizardUpdatePsd}
          onReorder={handleWizardReorder}
          onApplyRig={handleWizardApplyRig}
        />
      )}

      {/* Wipe project confirmation */}
      <AlertDialog open={confirmWipeOpen} onOpenChange={setConfirmWipeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wipe current project?</AlertDialogTitle>
            <AlertDialogDescription>
              Importing a new project or PSD will permanently delete all existing layers,
              meshes, and animations in your current project. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmWipe} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Wipe & Load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
