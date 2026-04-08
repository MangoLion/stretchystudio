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
import React, { useRef, useEffect } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { computeWorldMatrices, mat3Identity } from '@/renderer/transforms';

const MOVE_RADIUS   = 8;
const ROT_RADIUS    = 6;
const ROT_OFFSET_PX = 52; // screen-space distance from pivot to rotation handle

export function GizmoOverlay() {
  const svgRef      = useRef(null);
  const dragRef     = useRef(null); // { type, nodeId, startClientX, startClientY, startX, startY, startRotation, pivotScreenX, pivotScreenY }

  const toolMode      = useEditorStore(s => s.toolMode);
  const selection     = useEditorStore(s => s.selection);
  const view          = useEditorStore(s => s.view);
  const nodes         = useProjectStore(s => s.project.nodes);
  const updateProject = useProjectStore(s => s.updateProject);

  // Keep live refs so event handlers always have fresh values without stale closures
  const viewRef   = useRef(view);
  const nodesRef  = useRef(nodes);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Only show in select mode with exactly one selection
  const selectedNode = (toolMode === 'select' && selection.length === 1)
    ? nodes.find(n => n.id === selection[0])
    : null;

  if (!selectedNode) return null;

  // ── Compute gizmo screen position ──────────────────────────────────────
  const { zoom, panX, panY } = view;

  const worldMap = computeWorldMatrices(nodes);
  const wm       = worldMap.get(selectedNode.id) ?? mat3Identity();

  const t      = selectedNode.transform ?? {};
  const pivX   = t.pivotX ?? 0;
  const pivY   = t.pivotY ?? 0;

  // Pivot position in world space
  const worldPivX = wm[0] * pivX + wm[3] * pivY + wm[6];
  const worldPivY = wm[1] * pivX + wm[4] * pivY + wm[7];

  // World → canvas-element screen space
  const screenX = worldPivX * zoom + panX;
  const screenY = worldPivY * zoom + panY;

  // Rotation handle: 52px above the pivot in screen space
  const rotHandleX = screenX;
  const rotHandleY = screenY - ROT_OFFSET_PX;

  // ── Pointer event handlers ──────────────────────────────────────────────

  function startMoveDrag(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      type:         'move',
      nodeId:       selectedNode.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX:       t.x ?? 0,
      startY:       t.y ?? 0,
    };
  }

  function startRotateDrag(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const svgRect = svgRef.current.getBoundingClientRect();
    const dx = e.clientX - (svgRect.left + screenX);
    const dy = e.clientY - (svgRect.top  + screenY);
    dragRef.current = {
      type:          'rotate',
      nodeId:        selectedNode.id,
      startAngle:    Math.atan2(dy, dx),
      startRotation: t.rotation ?? 0,
      pivotScreenX:  screenX,
      pivotScreenY:  screenY,
    };
  }

  function onDragMove(e) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === 'move') {
      const { zoom: z } = viewRef.current;
      const dx = (e.clientX - drag.startClientX) / z;
      const dy = (e.clientY - drag.startClientY) / z;
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === drag.nodeId);
        if (!node) return;
        if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        node.transform.x = drag.startX + dx;
        node.transform.y = drag.startY + dy;
      });
      return;
    }

    if (drag.type === 'rotate') {
      const svgRect = svgRef.current.getBoundingClientRect();
      const dx = e.clientX - (svgRect.left + drag.pivotScreenX);
      const dy = e.clientY - (svgRect.top  + drag.pivotScreenY);
      const currentAngle = Math.atan2(dy, dx);
      const delta = (currentAngle - drag.startAngle) * (180 / Math.PI);
      updateProject((proj) => {
        const node = proj.nodes.find(n => n.id === drag.nodeId);
        if (!node) return;
        if (!node.transform) node.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        node.transform.rotation = drag.startRotation + delta;
      });
    }
  }

  function onDragEnd(e) {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full overflow-visible"
      style={{ pointerEvents: 'none' }}
    >
      {/* Dashed line from pivot to rotation handle */}
      <line
        x1={screenX} y1={screenY}
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
        style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
        onPointerDown={startRotateDrag}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />

      {/* Move handle (blue circle at pivot) */}
      <circle
        cx={screenX}
        cy={screenY}
        r={MOVE_RADIUS}
        fill="rgba(80,160,255,0.85)"
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="1.5"
        style={{ pointerEvents: 'auto', cursor: 'move' }}
        onPointerDown={startMoveDrag}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />

      {/* Crosshair inside move handle */}
      <line
        x1={screenX - 4} y1={screenY}
        x2={screenX + 4} y2={screenY}
        stroke="white" strokeWidth="1.5"
        style={{ pointerEvents: 'none' }}
      />
      <line
        x1={screenX} y1={screenY - 4}
        x2={screenX} y2={screenY + 4}
        stroke="white" strokeWidth="1.5"
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  );
}
