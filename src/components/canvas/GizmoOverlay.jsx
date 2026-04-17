/**
 * GizmoOverlay — SVG transform gizmo rendered on top of the canvas.
 *
 * Shows for the currently selected node (part or group) when in 'select' mode.
 *
 * Handles:
 *  - Blue circle at pivot  → drag to translate (updates transform.x / transform.y)
 *  - Orange circle 50px above pivot → drag to rotate (updates transform.rotation)
 *
 * Coordinate conventions:
 *  - worldX/Y: image-pixel space (same as mesh vertices)
 *  - screenX/Y: canvas-element-relative pixels
 *    screenX = worldX * zoom + panX
 *    screenY = worldY * zoom + panY
 */
import React, { useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { computePoseOverrides } from '@/renderer/animationEngine';
import { computeWorldMatrices, mat3Identity, mat3Inverse } from '@/renderer/transforms';
import { beginBatch, endBatch } from '@/store/undoHistory';

const MOVE_RADIUS   = 8;
const ROT_RADIUS    = 6;
const ROT_OFFSET_PX = 52; // screen-space distance from pivot to rotation handle

export function GizmoOverlay() {
  const svgRef      = useRef(null);
  const dragRef     = useRef(null); // { type, nodeId, startClientX, startClientY, startX, startY, startRotation, pivotScreenX, pivotScreenY }

  const toolMode      = useEditorStore(s => s.toolMode);
  const selection     = useEditorStore(s => s.selection);
  const editorMode    = useEditorStore(s => s.editorMode);
  const view          = useEditorStore(s => s.view);
  const nodes         = useProjectStore(s => s.project.nodes);
  const animations    = useProjectStore(s => s.project.animations);
  const updateProject = useProjectStore(s => s.updateProject);
  const animCurrentTime       = useAnimationStore(s => s.currentTime);
  const animActiveAnimationId = useAnimationStore(s => s.activeAnimationId);
  const animDraftPose         = useAnimationStore(s => s.draftPose);
  const animLoopKeyframes     = useAnimationStore(s => s.loopKeyframes);
  const animFps               = useAnimationStore(s => s.fps);
  const animEndFrame          = useAnimationStore(s => s.endFrame);
  const setDraftPose          = useAnimationStore(s => s.setDraftPose);

  // Keep live refs so event handlers always have fresh values without stale closures
  const viewRef        = useRef(view);
  const nodesRef       = useRef(nodes);
  const editorModeRef  = useRef(editorMode);
  const setDraftPoseRef = useRef(setDraftPose);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { editorModeRef.current = editorMode; }, [editorMode]);
  useEffect(() => { setDraftPoseRef.current = setDraftPose; }, [setDraftPose]);

  const ANIM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];

  // Build effective nodes: keyframe overrides first, then draftPose on top.
  const effectiveNodes = useMemo(() => {
    if (editorMode !== 'animation') return nodes;
    const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
    const endMs = (animEndFrame / animFps) * 1000;
    const overrides  = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);
    const hasDraft   = animDraftPose.size > 0;
    if (!overrides.size && !hasDraft) return nodes;
    return nodes.map(node => {
      const ov = overrides.get(node.id);
      const dr = animDraftPose.get(node.id);
      if (!ov && !dr) return node;
      const transformOv = { ...node.transform };
      if (ov) { for (const k of ANIM_KEYS) { if (ov[k] !== undefined) transformOv[k] = ov[k]; } }
      if (dr) { for (const k of ANIM_KEYS) { if (dr[k] !== undefined) transformOv[k] = dr[k]; } }
      return {
        ...node,
        transform: transformOv,
        opacity: dr?.opacity ?? ov?.opacity ?? node.opacity,
      };
    });
  }, [editorMode, nodes, animations, animActiveAnimationId, animCurrentTime, animDraftPose, animLoopKeyframes, animFps, animEndFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show in select mode with exactly one selection
  const selectedNode = (toolMode === 'select' && selection.length === 1)
    ? effectiveNodes.find(n => n.id === selection[0])
    : null;

  if (!selectedNode) return null;

  // ── Compute gizmo screen position ──────────────────────────────────────
  const { zoom, panX, panY } = view;

  const worldMap = computeWorldMatrices(effectiveNodes);
  const wm       = worldMap.get(selectedNode.id) ?? mat3Identity();

  const t      = selectedNode.transform ?? {};
  const pivX   = t.pivotX ?? 0;
  const pivY   = t.pivotY ?? 0;

  // Pivot position in world/screen space
  const worldPivX = wm[0] * pivX + wm[3] * pivY + wm[6];
  const worldPivY = wm[1] * pivX + wm[4] * pivY + wm[7];
  const pivotScreenX = worldPivX * zoom + panX;
  const pivotScreenY = worldPivY * zoom + panY;

  // Compute local bounding box
  const iswm = mat3Inverse(wm);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function pushPoint(wx, wy) {
     const lx = iswm[0] * wx + iswm[3] * wy + iswm[6];
     const ly = iswm[1] * wx + iswm[4] * wy + iswm[7];
     if (lx < minX) minX = lx;
     if (lx > maxX) maxX = lx;
     if (ly < minY) minY = ly;
     if (ly > maxY) maxY = ly;
  }

  function traverse(node) {
    if (node.type === 'part') {
      if (node.mesh?.vertices) {
        // Use mesh vertices for bounding box
        const nwm = worldMap.get(node.id) ?? mat3Identity();
        for (const v of node.mesh.vertices) {
          const wx = nwm[0] * v.x + nwm[3] * v.y + nwm[6];
          const wy = nwm[1] * v.x + nwm[4] * v.y + nwm[7];
          pushPoint(wx, wy);
        }
      } else if (node.imageBounds) {
        // Fallback: use opaque pixel bounds for mesh-less parts
        const nwm = worldMap.get(node.id) ?? mat3Identity();
        const { minX, minY, maxX, maxY } = node.imageBounds;
        const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
        for (const [vx, vy] of corners) {
          pushPoint(nwm[0]*vx + nwm[3]*vy + nwm[6], nwm[1]*vx + nwm[4]*vy + nwm[7]);
        }
      }
    }
    const children = effectiveNodes.filter(c => c.parent === node.id);
    for (const c of children) traverse(c);
  }
  traverse(selectedNode);

  if (minX === Infinity) {
    minX = -50; maxX = 50; minY = -50; maxY = 50;
  }

  function toScreen(lx, ly) {
    const wx = wm[0] * lx + wm[3] * ly + wm[6];
    const wy = wm[1] * lx + wm[4] * ly + wm[7];
    return [wx * zoom + panX, wy * zoom + panY];
  }

  const [pt0X, pt0Y] = toScreen(minX, minY);
  const [pt1X, pt1Y] = toScreen(maxX, minY);
  const [pt2X, pt2Y] = toScreen(maxX, maxY);
  const [pt3X, pt3Y] = toScreen(minX, maxY);
  const bboxPoints = `${pt0X},${pt0Y} ${pt1X},${pt1Y} ${pt2X},${pt2Y} ${pt3X},${pt3Y}`;

  const localCx = (minX + maxX) / 2;
  const localCy = (minY + maxY) / 2;
  const [tcScreenX, tcScreenY] = toScreen(localCx, minY);
  const [ccScreenX, ccScreenY] = toScreen(localCx, localCy);

  // Rotation handle: rotated "up" vector in screen space
  const upX = -wm[3] * zoom;
  const upY = -wm[4] * zoom;
  const len = Math.sqrt(upX*upX + upY*upY) || 1;
  const dirX = upX / len;
  const dirY = upY / len;
  const rotHandleX = tcScreenX + dirX * ROT_OFFSET_PX;
  const rotHandleY = tcScreenY + dirY * ROT_OFFSET_PX;

  // ── Pointer event handlers ──────────────────────────────────────────────

  function startMoveDrag(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (editorModeRef.current === 'staging') {
      beginBatch(useProjectStore.getState().project);
    }
    dragRef.current = {
      type:         'move',
      nodeId:       selectedNode.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX:       t.x ?? 0,   // reads effective (keyframe + draft) value
      startY:       t.y ?? 0,
      isAnimMode:   editorModeRef.current === 'animation',
    };
  }

  function startRotateDrag(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (editorModeRef.current === 'staging') {
      beginBatch(useProjectStore.getState().project);
    }
    const svgRect = svgRef.current.getBoundingClientRect();
    const px = svgRect.left + pivotScreenX;
    const py = svgRect.top  + pivotScreenY;
    const dx = e.clientX - px;
    const dy = e.clientY - py;

    dragRef.current = {
      type:          'rotate',
      nodeId:        selectedNode.id,
      startAngle:    Math.atan2(dy, dx),
      startRotation: t.rotation ?? 0,  // reads effective value
      pivotScreenX:  pivotScreenX,
      pivotScreenY:  pivotScreenY,
      isAnimMode:    editorModeRef.current === 'animation',
    };
  }

  function startPivotDrag(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (editorModeRef.current === 'staging') {
      beginBatch(useProjectStore.getState().project);
    }
    dragRef.current = {
      type:         'pivot',
      nodeId:       selectedNode.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPivotX:  t.pivotX ?? 0,
      startPivotY:  t.pivotY ?? 0,
      startX:       t.x ?? 0,
      startY:       t.y ?? 0,
      iswm:         mat3Inverse(wm), // current inverse world matrix
    };
  }

  function centerPivot() {
    if (minX === Infinity) return;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const dLx = cx - (t.pivotX ?? 0);
    const dLy = cy - (t.pivotY ?? 0);
    
    updateProject((proj) => {
      const node = proj.nodes.find(n => n.id === selectedNode.id);
      if (!node?.transform) return;
      const t = node.transform;
      const { rotation = 0, scaleX: sX = 1, scaleY: sY = 1 } = t;
      const θ = rotation * (Math.PI / 180);
      const c = Math.cos(θ), s = Math.sin(θ);

      const m0 = sX * c;
      const m1 = sX * s;
      const m3 = -sY * s;
      const m4 = sY * c;

      // Adjust x,y to counter-act the pivot move
      t.x += dLx * (m0 - 1) + dLy * m3;
      t.y += dLx * m1 + dLy * (m4 - 1);
      t.pivotX = cx;
      t.pivotY = cy;
    });
  }

  function onDragMove(e) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === 'move') {
      const { zoom: z } = viewRef.current;
      const dx = (e.clientX - drag.startClientX) / z;
      const dy = (e.clientY - drag.startClientY) / z;
      if (drag.isAnimMode) {
        // In animation mode: write to draftPose, don't touch node.transform
        setDraftPoseRef.current(drag.nodeId, { x: drag.startX + dx, y: drag.startY + dy });
      } else {
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === drag.nodeId);
          if (!node) return;
          if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
          node.transform.x = drag.startX + dx;
          node.transform.y = drag.startY + dy;
        }, { skipHistory: true });
      }
      return;
    }

    if (drag.type === 'rotate') {
      const svgRect = svgRef.current.getBoundingClientRect();
      const dx = e.clientX - (svgRect.left + drag.pivotScreenX);
      const dy = e.clientY - (svgRect.top  + drag.pivotScreenY);
      const currentAngle = Math.atan2(dy, dx);
      let delta = (currentAngle - drag.startAngle) * (180 / Math.PI);

      // Shift modifier for 15 degree snapping
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;

      if (drag.isAnimMode) {
        setDraftPoseRef.current(drag.nodeId, { rotation: drag.startRotation + delta });
      } else {
        updateProject((proj) => {
          const node = proj.nodes.find(n => n.id === drag.nodeId);
          if (!node) return;
          if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
          node.transform.rotation = drag.startRotation + delta;
        }, { skipHistory: true });
      }
      return;
    }

    if (drag.type === 'pivot') {
      const { zoom: z } = viewRef.current;
      const dx = (e.clientX - drag.startClientX) / z;
      const dy = (e.clientY - drag.startClientY) / z;

      // Convert world delta to local delta using inverse matrix
      const { iswm } = drag;
      const dLx = iswm[0] * dx + iswm[3] * dy;
      const dLy = iswm[1] * dx + iswm[4] * dy;

      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === drag.nodeId);
        if (!node?.transform) return;
        const t = node.transform;
        const { rotation = 0, scaleX: sX = 1, scaleY: sY = 1 } = t;
        const θ = rotation * (Math.PI / 180);
        const c = Math.cos(θ), s = Math.sin(θ);

        const m0 = sX * c;
        const m1 = sX * s;
        const m3 = -sY * s;
        const m4 = sY * c;

        t.pivotX = drag.startPivotX + dLx;
        t.pivotY = drag.startPivotY + dLy;
        // x' = x - (Tx(newPivot) - Tx(oldPivot))
        // This keeps world position stable while moving pivot
        t.x = drag.startX + dLx * (m0 - 1) + dLy * m3;
        t.y = drag.startY + dLx * m1 + dLy * (m4 - 1);
      }, { skipHistory: true });
    }
  }

  function onDragEnd(e) {
    endBatch();
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (useEditorStore.getState().autoKeyframe && useEditorStore.getState().editorMode === 'animation') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full overflow-visible"
      style={{ pointerEvents: 'none' }}
    >
      {/* Bounding box polygon */}
      <polygon
        points={bboxPoints}
        fill="none"
        stroke="rgba(255,60,60,0.8)"
        strokeWidth="1.2"
        strokeDasharray="4 2"
      />

      {/* Pivot handle (crosshair) */}
      <g 
        style={{ pointerEvents: 'auto', cursor: 'move' }}
        onPointerDown={startPivotDrag}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <circle cx={pivotScreenX} cy={pivotScreenY} r={12} fill="transparent" />
        <g stroke="#ff4444" strokeWidth="2">
          <line x1={pivotScreenX - 6} y1={pivotScreenY} x2={pivotScreenX + 6} y2={pivotScreenY} />
          <line x1={pivotScreenX} y1={pivotScreenY - 6} x2={pivotScreenX} y2={pivotScreenY + 6} />
        </g>
        <circle cx={pivotScreenX} cy={pivotScreenY} r={2} fill="#ff4444" stroke="white" strokeWidth="0.5" />
      </g>

      {/* Dashed line from top center to rotation handle */}
      <line
        x1={tcScreenX} y1={tcScreenY}
        x2={rotHandleX} y2={rotHandleY}
        stroke="rgba(255,200,80,0.5)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />

      {/* Rotation handle (orange circle) */}
      <circle
        cx={rotHandleX}
        cy={rotHandleY}
        r={ROT_RADIUS}
        fill="rgba(255,180,60,0.9)"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="1"
        style={{ pointerEvents: 'auto', cursor: 'alias' }}
        onPointerDown={startRotateDrag}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />

      {/* Move handle (blue circle at bounding box center) */}
      <circle
        cx={ccScreenX}
        cy={ccScreenY}
        r={MOVE_RADIUS}
        fill="rgba(80,160,255,0.85)"
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="1.5"
        style={{ pointerEvents: 'auto', cursor: 'move' }}
        onPointerDown={startMoveDrag}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onDoubleClick={centerPivot}
      />

      {/* Crosshair inside move handle */}
      <line
        x1={ccScreenX - 4} y1={ccScreenY}
        x2={ccScreenX + 4} y2={ccScreenY}
        stroke="white" strokeWidth="1.5"
        style={{ pointerEvents: 'none' }}
      />
      <line
        x1={ccScreenX} y1={ccScreenY - 4}
        x2={ccScreenX} y2={ccScreenY + 4}
        stroke="white" strokeWidth="1.5"
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  );
}
