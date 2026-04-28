import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useTheme } from '@/contexts/ThemeProvider';
import { useProjectStore, DEFAULT_TRANSFORM } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { computePoseOverrides, computeParameterDrivenOverrides, KEYFRAME_PROPS, getNodePropertyValue, upsertKeyframe } from '@/renderer/animationEngine';
import { useParameterStore } from '@/store/parameterStore';
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

/** Standard Live2D parameter definitions used by the liverig wizard step */
const LIVE_RIG_PARAMS = [
  // Face rotation
  { id: 'ParamAngleX',      name: 'Angle X',        group: 'Face',    min: -30, max:  30, default: 0 },
  { id: 'ParamAngleY',      name: 'Angle Y',        group: 'Face',    min: -30, max:  30, default: 0 },
  { id: 'ParamAngleZ',      name: 'Angle Z',        group: 'Face',    min: -30, max:  30, default: 0 },
  // Eyes
  { id: 'ParamEyeLOpen',    name: 'Eye L Open',     group: 'Eye',     min:   0, max:   1, default: 1 },
  { id: 'ParamEyeROpen',    name: 'Eye R Open',     group: 'Eye',     min:   0, max:   1, default: 1 },
  { id: 'ParamEyeLSmile',   name: 'Eye L Smile',    group: 'Eye',     min:   0, max:   1, default: 0 },
  { id: 'ParamEyeRSmile',   name: 'Eye R Smile',    group: 'Eye',     min:   0, max:   1, default: 0 },
  { id: 'ParamEyeBallX',    name: 'Eyeball X',      group: 'Eyeball', min:  -1, max:   1, default: 0 },
  { id: 'ParamEyeBallY',    name: 'Eyeball Y',      group: 'Eyeball', min:  -1, max:   1, default: 0 },
  { id: 'ParamEyeBallForm', name: 'Eyeball Form',   group: 'Eyeball', min:  -1, max:   1, default: 0 },
  { id: 'ParamTear',        name: 'Tear',           group: 'Eye',     min:   0, max:   2, default: 0 },
  // Brows
  { id: 'ParamBrowLY',      name: 'Brow L Y',       group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowRY',      name: 'Brow R Y',       group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowLX',      name: 'Brow L X',       group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowRX',      name: 'Brow R X',       group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowLAngle',  name: 'Brow L Angle',   group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowRAngle',  name: 'Brow R Angle',   group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowLForm',   name: 'Brow L Form',    group: 'Brow',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBrowRForm',   name: 'Brow R Form',    group: 'Brow',    min:  -1, max:   1, default: 0 },
  // Mouth
  { id: 'ParamMouthForm',   name: 'Mouth Form',     group: 'Mouth',   min:  -1, max:   1, default: 0 },
  { id: 'ParamMouthOpenY',  name: 'Mouth Open',     group: 'Mouth',   min:   0, max:   1, default: 0 },
  // Body rotation
  { id: 'ParamBodyAngleX',  name: 'Body Angle X',   group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamBodyAngleY',  name: 'Body Angle Y',   group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamBodyAngleZ',  name: 'Body Angle Z',   group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamBreath',      name: 'Breath',         group: 'Body',    min:   0, max:   1, default: 0 },
  // Arms
  { id: 'ParamArmLA',       name: 'Arm L A',        group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamArmRA',       name: 'Arm R A',        group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamArmLB',       name: 'Arm L B',        group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamArmRB',       name: 'Arm R B',        group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamHandL',       name: 'Hand L',         group: 'Body',    min:  -1, max:   1, default: 0 },
  { id: 'ParamHandR',       name: 'Hand R',         group: 'Body',    min:  -1, max:   1, default: 0 },
  { id: 'ParamShoulderY',   name: 'Shoulder Y',     group: 'Body',    min: -10, max:  10, default: 0 },
  { id: 'ParamBustX',       name: 'Bust X',         group: 'Body',    min:  -1, max:   1, default: 0 },
  { id: 'ParamBustY',       name: 'Bust Y',         group: 'Body',    min:  -1, max:   1, default: 0 },
  // Hair
  { id: 'ParamHairFront',   name: 'Hair Front',     group: 'Hair',    min:  -1, max:   1, default: 0 },
  { id: 'ParamHairSide',    name: 'Hair Side',      group: 'Hair',    min:  -1, max:   1, default: 0 },
  { id: 'ParamHairBack',    name: 'Hair Back',      group: 'Hair',    min:  -1, max:   1, default: 0 },
  // Global
  { id: 'ParamCheek',       name: 'Cheek',          group: 'Global',  min:   0, max:   1, default: 0 },
  { id: 'ParamHairFluffy',  name: 'Hair Fluffy',    group: 'Global',  min:   0, max:   1, default: 0 },
  { id: 'ParamBaseX',       name: 'Base X',         group: 'Global',  min: -10, max:  10, default: 0 },
  { id: 'ParamBaseY',       name: 'Base Y',         group: 'Global',  min: -10, max:  10, default: 0 },
];

/**
 * Warp deformers to auto-create during rig generation.
 *
 * Two modes:
 *   boneRole — wraps ALL children of the group node with that boneRole
 *   layerTags + insideBoneRole — finds parts by tag within the named group's subtree
 *
 * Multiple specs may share the same paramSsId; the parameter receives a binding
 * for each resulting warp deformer.
 */
const WARP_SPECS = [
  // ── Top-level: wrap all children of a bone group ──────────────────────────
  { boneRole: 'head',  paramSsId: 'ParamAngleX',    warpName: 'FaceWarp',   warpType: 'face_angle_x' },
  { boneRole: 'torso', paramSsId: 'ParamBodyAngleX', warpName: 'BodyWarp',   warpType: 'body_angle_x' },
  { boneRole: 'neck',  paramSsId: 'ParamAngleX',    warpName: 'NeckWarp',   warpType: 'neck_follow'  },

  // ── Nested: find tagged parts within the head subtree ─────────────────────
  { layerTags: ['irides', 'irides-l', 'eyewhite', 'eyewhite-l', 'eyelash', 'eyelash-l'],
    insideBoneRole: 'head', paramSsId: 'ParamEyeLOpen',   warpName: 'EyeLWarp',      warpType: 'eye_open'   },
  { layerTags: ['irides-r', 'eyewhite-r', 'eyelash-r'],
    insideBoneRole: 'head', paramSsId: 'ParamEyeROpen',   warpName: 'EyeRWarp',      warpType: 'eye_open'   },
  { layerTags: ['mouth'],
    insideBoneRole: 'head', paramSsId: 'ParamMouthOpenY', warpName: 'MouthWarp',     warpType: 'mouth_open' },
  { layerTags: ['eyebrow', 'eyebrow-l'],
    insideBoneRole: 'head', paramSsId: 'ParamBrowLY',     warpName: 'EyebrowLWarp',  warpType: 'brow_y'     },
  { layerTags: ['eyebrow-r'],
    insideBoneRole: 'head', paramSsId: 'ParamBrowRY',     warpName: 'EyebrowRWarp',  warpType: 'brow_y'     },
  { layerTags: ['front hair'],
    insideBoneRole: 'head', paramSsId: 'ParamHairFront',  warpName: 'HairFrontWarp', warpType: 'hair_sway'  },
  { layerTags: ['back hair'],
    insideBoneRole: 'head', paramSsId: 'ParamHairBack',   warpName: 'HairBackWarp',  warpType: 'hair_sway'  },

  // ── Nested: tagged parts within body/root groups ───────────────────────────
  { layerTags: ['topwear'],
    insideBoneRole: 'torso', paramSsId: 'ParamBodyAngleX', warpName: 'TopWearWarp',    warpType: 'body_angle_x' },
  { layerTags: ['bottomwear'],
    insideBoneRole: 'root',  paramSsId: 'ParamBodyAngleX', warpName: 'BottomWearWarp', warpType: 'body_angle_x' },
];

/**
 * Build warp-deformer keyframes for a named deformation type.
 * `scale` (0–1) controls amplitude so strength adjustments re-use this without
 * re-authoring: scale=1 = 100% strength, scale=0.5 = 50%, etc.
 * Returns [{time, value:[{x,y},...]}] matching the interpolateMeshVerts format.
 */
function buildWarpKeyframes(warpType, gridX, gridY, gridW, gridH, col, row, scale = 1) {
  function makeGrid(deltaFn) {
    const arr = [];
    for (let r = 0; r <= row; r++) {
      for (let c = 0; c <= col; c++) {
        const bx = gridX + (col > 0 ? c * gridW / col : 0);
        const by = gridY + (row > 0 ? r * gridH / row : 0);
        const d = deltaFn(col > 0 ? c / col : 0, row > 0 ? r / row : 0);
        arr.push({ x: bx + (d?.dx ?? 0) * scale, y: by + (d?.dy ?? 0) * scale });
      }
    }
    return arr;
  }
  const flat = () => makeGrid(() => null);

  if (warpType === 'face_angle_x') {
    // 2.5D Perspective face turn
    // time=1000 is turning screen right (+Angle X)
    const rightTurn = (cn, rn) => {
      // Parabolic horizontal shift: nose (center) protrudes right, far edge wraps inward
      // cn=0 (near): dx=0.02, cn=0.5 (center): dx=0.15, cn=1.0 (far): dx=-0.05
      const dx = (-0.66 * cn * cn + 0.59 * cn + 0.02) * gridW;
      
      // Perspective Z-scaling: near side gets slightly taller, far side gets shorter
      const zScale = 1.0 + (0.5 - cn) * 0.1;
      const dy = (rn - 0.5) * (zScale - 1) * gridH;
      
      return { dx, dy };
    };

    const leftTurn = (cn, rn) => {
      // Mirror of right turn
      const mirroredCn = 1 - cn;
      const d = rightTurn(mirroredCn, rn);
      return { dx: -d.dx, dy: d.dy };
    };

    return [
      { time:    0, value: makeGrid(leftTurn) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(rightTurn) },
    ];
  }

  if (warpType === 'body_angle_x') {
    // 2.5D Perspective body turn
    // time=1000 is turning screen right
    const rightTurnBody = (cn, rn) => {
      // Horizontal shear combined with perspective
      // Top moves more than bottom. Left shoulder (near) moves right, right shoulder (far) wraps inward
      const topDxRatio = -0.4 * cn * cn + 0.32 * cn + 0.10;
      const dx = topDxRatio * (1 - rn) * gridW;

      // Perspective Z-scaling: near shoulder gets larger/lower, far shoulder lifts/shrinks
      const zScale = 1.0 + (0.5 - cn) * 0.15;
      const dy = (rn - 0.5) * (zScale - 1) * gridH;

      return { dx, dy };
    };

    const leftTurnBody = (cn, rn) => {
      const mirroredCn = 1 - cn;
      const d = rightTurnBody(mirroredCn, rn);
      return { dx: -d.dx, dy: d.dy };
    };

    return [
      { time:    0, value: makeGrid(leftTurnBody) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(rightTurnBody) },
    ];
  }

  if (warpType === 'neck_follow') {
    // Neck shears to follow the head turn at reduced amplitude
    const rightTurn = (cn, rn) => {
      const dx = (-0.66 * cn * cn + 0.59 * cn + 0.02) * gridW * 0.35;
      const zScale = 1.0 + (0.5 - cn) * 0.06;
      const dy = (rn - 0.5) * (zScale - 1) * gridH;
      return { dx, dy };
    };
    const leftTurn = (cn, rn) => { const d = rightTurn(1 - cn, rn); return { dx: -d.dx, dy: d.dy }; };
    return [
      { time:    0, value: makeGrid(leftTurn) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(rightTurn) },
    ];
  }

  if (warpType === 'face_angle_y') {
    // Head pitch — looking up (time=1000) / looking down (time=0)
    const lookUp = (cn, rn) => ({
      dy: -(0.5 - rn) * 0.28 * gridH,
      dx: (cn - 0.5) * rn * 0.08 * gridW,
    });
    const lookDown = (cn, rn) => ({
      dy:  (0.5 - rn) * 0.28 * gridH,
      dx: (cn - 0.5) * (1 - rn) * 0.08 * gridW,
    });
    return [
      { time:    0, value: makeGrid(lookDown) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(lookUp) },
    ];
  }

  if (warpType === 'body_angle_y') {
    // Body pitch — leaning back (time=0) / leaning forward (time=1000)
    const leanBack    = (cn, rn) => ({ dy:  (0.5 - rn) * 0.20 * gridH, dx: (cn - 0.5) * (1 - rn) * 0.06 * gridW });
    const leanForward = (cn, rn) => ({ dy: -(0.5 - rn) * 0.20 * gridH, dx: (cn - 0.5) * rn        * 0.06 * gridW });
    return [
      { time:    0, value: makeGrid(leanBack) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(leanForward) },
    ];
  }

  if (warpType === 'eye_open') {
    // Eyelid close: top row squishes toward center row
    // time=0 closed (param=0), time=1000 open (param=1, default)
    const closed = (_cn, rn) => ({ dx: 0, dy: (0.5 - rn) * 0.65 * gridH });
    return [
      { time:    0, value: makeGrid(closed) },
      { time: 1000, value: flat() },
    ];
  }

  if (warpType === 'mouth_open') {
    // Jaw drop: top row moves up, bottom row moves down
    // time=0 closed (param=0, flat), time=1000 open (param=1)
    const open = (_cn, rn) => ({ dx: 0, dy: (rn - 0.5) * 0.55 * gridH });
    return [
      { time:    0, value: flat() },
      { time: 1000, value: makeGrid(open) },
    ];
  }

  if (warpType === 'brow_y') {
    // Uniform vertical translation: down (time=0, param=-1) → up (time=1000, param=1)
    const shift = 0.25 * gridH;
    return [
      { time:    0, value: makeGrid(() => ({ dx: 0, dy:  shift })) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(() => ({ dx: 0, dy: -shift })) },
    ];
  }

  if (warpType === 'hair_sway') {
    // Tip-biased horizontal sway (rn=0 is root/top, rn=1 is tip/bottom)
    const rightSway = (_cn, rn) => ({ dx: rn * rn * 0.20 * gridW, dy: 0 });
    const leftSway  = (_cn, rn) => ({ dx: -rn * rn * 0.20 * gridW, dy: 0 });
    return [
      { time:    0, value: makeGrid(leftSway) },
      { time:  500, value: flat() },
      { time: 1000, value: makeGrid(rightSway) },
    ];
  }

  return [{ time: 0, value: flat() }, { time: 1000, value: flat() }];
}

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
  const updateParameter = useProjectStore(s => s.updateParameter);
  const resetProject = useProjectStore(s => s.resetProject);
  const editorState = useEditorStore();
  const setBrush = useEditorStore(s => s.setBrush);
  const setEditorMode = useEditorStore(s => s.setEditorMode);
  const { setSelection, setView } = editorState;
  const { themeMode, osTheme } = useTheme();

  const animStore = useAnimationStore();
  const animRef = useRef(animStore);
  animRef.current = animStore;

  const paramStore = useParameterStore();
  const paramRef = useRef(paramStore);
  paramRef.current = paramStore;

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
  // Redraw whenever parameter sliders change
  useEffect(() => { isDirtyRef.current = true; }, [paramStore.values]);
  
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

        // Parameter-driven overrides: apply where animation keyframes haven't already set a value.
        // Works in both staging and animation mode — parameters are always-on interactive sliders.
        {
          const proj = projectRef.current;
          if (proj.parameters?.length > 0) {
            const paramOverrides = computeParameterDrivenOverrides(
              proj.animations,
              proj.parameters,
              paramRef.current.values,
            );
            if (paramOverrides.size > 0) {
              if (!poseOverrides) poseOverrides = new Map();
              for (const [nodeId, ov] of paramOverrides) {
                const existing = poseOverrides.get(nodeId) ?? {};
                for (const [prop, val] of Object.entries(ov)) {
                  if (!(prop in existing)) existing[prop] = val;
                }
                poseOverrides.set(nodeId, existing);
              }
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

        // Apply warp deformer nodes: bilinear grid deformation on child meshes.
        // Runs after blend shapes so the warp sees the fully-blended vertex positions.
        for (const wd of projectRef.current.nodes) {
          if (wd.type !== 'warpDeformer') continue;
          const wdOv = poseOverrides?.get(wd.id);
          const gridPts = wdOv?.mesh_verts;
          if (!gridPts?.length) continue; // no active grid deformation

          const { col = 2, row = 2, gridX = 0, gridY = 0, gridW = 1, gridH = 1 } = wd;
          const safeW = gridW || 1, safeH = gridH || 1;

          // Recursively collect all descendant mesh parts, traversing through groups
          // AND nested warpDeformers so parent warps always reach grandchild parts.
          const collectDescendants = (parentId) => {
            const result = [];
            for (const n of projectRef.current.nodes) {
              if (n.parent !== parentId) continue;
              if (n.type === 'part' && n.mesh) result.push(n);
              else if ((n.type === 'group' || n.type === 'warpDeformer') && n.visible !== false)
                result.push(...collectDescendants(n.id));
            }
            return result;
          };
          const childParts = collectDescendants(wd.id);
          for (const child of childParts) {
            // Use REST vertices for UV parameterization so that accumulated deltas
            // from parent warps don't corrupt the UV → grid mapping.
            const restVerts = child.mesh.vertices;
            const curVerts  = poseOverrides?.get(child.id)?.mesh_verts ?? restVerts;
            const warped = restVerts.map((rv, vi) => {
              const px = rv.x ?? rv.restX, py = rv.y ?? rv.restY;
              const s  = Math.max(0, Math.min(1, (px - gridX) / safeW));
              const t  = Math.max(0, Math.min(1, (py - gridY) / safeH));
              const ci = Math.min(Math.floor(s * col), col - 1);
              const ri = Math.min(Math.floor(t * row), row - 1);
              const u  = s * col - ci;
              const vv = t * row - ri;
              const p00 = gridPts[ri * (col + 1) + ci];
              const p10 = gridPts[ri * (col + 1) + ci + 1];
              const p01 = gridPts[(ri + 1) * (col + 1) + ci];
              const p11 = gridPts[(ri + 1) * (col + 1) + ci + 1];
              if (!p00 || !p10 || !p01 || !p11) return { x: curVerts[vi].x ?? px, y: curVerts[vi].y ?? py };
              // Bilinear target position driven by this warp's grid
              const tx = (1-u)*(1-vv)*p00.x + u*(1-vv)*p10.x + (1-u)*vv*p01.x + u*vv*p11.x;
              const ty = (1-u)*(1-vv)*p00.y + u*(1-vv)*p10.y + (1-u)*vv*p01.y + u*vv*p11.y;
              // Accumulate delta on top of any previously-applied warp offsets
              const cv = curVerts[vi];
              return { x: (cv.x ?? px) + (tx - px), y: (cv.y ?? py) + (ty - py) };
            });
            if (!poseOverrides) poseOverrides = new Map();
            const ex = poseOverrides.get(child.id) ?? {};
            poseOverrides.set(child.id, { ...ex, mesh_verts: warped });
          }
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
  const handleWizardReorder = useCallback((splits) => {
    let { psdW, psdH, layers, partIds } = wizardPsd;

    if (splits && splits.length > 0) {
      const newLayers = [...layers];
      const newPartIds = [...partIds];
      const sortedSplits = [...splits].sort((a, b) => b.mergedIdx - a.mergedIdx);

      for (const { mergedIdx, rightLayer, leftLayer } of sortedSplits) {
        const replacements = [];
        if (rightLayer) replacements.push({ layer: rightLayer, partId: uid() });
        if (leftLayer) replacements.push({ layer: leftLayer, partId: uid() });

        newLayers.splice(mergedIdx, 1, ...replacements.map(r => r.layer));
        newPartIds.splice(mergedIdx, 1, ...replacements.map(r => r.partId));
      }
      layers = newLayers;
      partIds = newPartIds;
      setWizardPsd({ psdW, psdH, layers, partIds });
    }

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
  const handleWizardSkip = useCallback((meshAllParts, splits) => {
    let { psdW, psdH, layers, partIds } = wizardPsd;

    if (splits && splits.length > 0) {
      const newLayers = [...layers];
      const newPartIds = [...partIds];
      const sortedSplits = [...splits].sort((a, b) => b.mergedIdx - a.mergedIdx);

      for (const { mergedIdx, rightLayer, leftLayer } of sortedSplits) {
        const replacements = [];
        if (rightLayer) replacements.push({ layer: rightLayer, partId: uid() });
        if (leftLayer) replacements.push({ layer: leftLayer, partId: uid() });

        newLayers.splice(mergedIdx, 1, ...replacements.map(r => r.layer));
        newPartIds.splice(mergedIdx, 1, ...replacements.map(r => r.partId));
      }
      layers = newLayers;
      partIds = newPartIds;
    }

    finalizePsdImport(psdW, psdH, layers, partIds, [], null);
    if (meshAllParts) {
      // Auto-mesh will happen asynchronously as textures are uploaded
      // Schedule it after a short delay to let finalizePsdImport complete
      setTimeout(() => autoMeshAllParts(), 100);
    }
    setWizardPsd(null);
    setWizardStep(null);
  }, [wizardPsd, finalizePsdImport, autoMeshAllParts]);

  /* ── Wizard: auto-generate warp deformers + Live2D parameters ──────────── */
  const autoGenerateWarpDeformers = useCallback(() => {
    updateProject((proj) => {
      // Ensure a "Parameters" animation clip exists
      let paramAnim = proj.animations.find(a => a.name === 'Parameters');
      if (!paramAnim) {
        const animId = uid();
        proj.animations.push({ id: animId, name: 'Parameters', duration: 2000, fps: 24, tracks: [], audioTracks: [] });
        paramAnim = proj.animations[proj.animations.length - 1];
      }

      // paramId → warpId[] (array; multiple warp deformers may share one parameter)
      const warpNodeIds = {};

      // Collect imageBounds from ALL descendants (through groups and warpDeformers)
      const collectBounds = (proj, parentId, state) => {
        for (const n of proj.nodes) {
          if (n.parent !== parentId) continue;
          if (n.imageBounds) {
            state.minX = Math.min(state.minX, n.imageBounds.minX);
            state.minY = Math.min(state.minY, n.imageBounds.minY);
            state.maxX = Math.max(state.maxX, n.imageBounds.maxX);
            state.maxY = Math.max(state.maxY, n.imageBounds.maxY);
          }
          if (n.type === 'group' || n.type === 'warpDeformer') collectBounds(proj, n.id, state);
        }
      };

      // Find parts matching layerTags anywhere within a subtree (skips into groups/warps)
      const collectTaggedParts = (parentId, tagSet, result = []) => {
        for (const n of proj.nodes) {
          if (n.parent !== parentId) continue;
          const tag = matchTag(n.name);
          if (tag && tagSet.has(tag)) {
            result.push(n);
          } else if (n.type === 'group' || n.type === 'warpDeformer') {
            collectTaggedParts(n.id, tagSet, result);
          }
        }
        return result;
      };

      // For a given boneRole group, return the direct-child warp deformer if one
      // was already created (so nested specs attach inside it, not alongside it).
      const findWarpChildOf = (boneRole) => {
        const group = proj.nodes.find(n => n.boneRole === boneRole);
        if (!group) return null;
        return proj.nodes.find(n => n.parent === group.id && n.type === 'warpDeformer') ?? group;
      };

      const createWarp = (spec, parentNode, targetChildren) => {
        if (targetChildren.length === 0) return;
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const n of targetChildren) {
          if (n.imageBounds) {
            bounds.minX = Math.min(bounds.minX, n.imageBounds.minX);
            bounds.minY = Math.min(bounds.minY, n.imageBounds.minY);
            bounds.maxX = Math.max(bounds.maxX, n.imageBounds.maxX);
            bounds.maxY = Math.max(bounds.maxY, n.imageBounds.maxY);
          }
          // Also recurse for groups/warpDeformers to capture child bounds
          if (n.type === 'group' || n.type === 'warpDeformer') {
            collectBounds(proj, n.id, bounds);
          }
        }
        if (bounds.minX === Infinity) return; // no bounds — skip

        const PAD = 12;
        const gridX = bounds.minX - PAD, gridY = bounds.minY - PAD;
        const gridW = (bounds.maxX - bounds.minX) + 2 * PAD;
        const gridH = (bounds.maxY - bounds.minY) + 2 * PAD;
        const col = 2, row = 2;
        const warpId = uid();

        proj.nodes.push({
          id: warpId, type: 'warpDeformer', name: spec.warpName,
          parent: parentNode.id, transform: DEFAULT_TRANSFORM(),
          visible: true, opacity: 1,
          col, row, gridX, gridY, gridW, gridH,
          parameterId: spec.paramSsId,
          warpType: spec.warpType,
        });

        for (const child of targetChildren) child.parent = warpId;

        paramAnim.tracks.push({
          nodeId: warpId, property: 'mesh_verts',
          keyframes: buildWarpKeyframes(spec.warpType, gridX, gridY, gridW, gridH, col, row, 1),
        });

        if (!warpNodeIds[spec.paramSsId]) warpNodeIds[spec.paramSsId] = [];
        warpNodeIds[spec.paramSsId].push(warpId);
      };

      for (const spec of WARP_SPECS) {
        if (spec.boneRole) {
          // ── boneRole mode: wrap all direct children of this bone group ──
          const group = proj.nodes.find(n => n.type === 'group' && n.boneRole === spec.boneRole);
          if (!group) continue;
          const children = proj.nodes.filter(n => n.parent === group.id);
          if (children.length === 0) continue;

          // Use full-subtree bounds so BodyWarp encompasses head sub-group area too
          const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          collectBounds(proj, group.id, bounds);
          if (bounds.minX === Infinity) { bounds.minX = 0; bounds.minY = 0; bounds.maxX = proj.canvas.width; bounds.maxY = proj.canvas.height; }

          const PAD = 20;
          const gridX = bounds.minX - PAD, gridY = bounds.minY - PAD;
          const gridW = (bounds.maxX - bounds.minX) + 2 * PAD;
          const gridH = (bounds.maxY - bounds.minY) + 2 * PAD;
          const col = 2, row = 2;
          const warpId = uid();

          proj.nodes.push({
            id: warpId, type: 'warpDeformer', name: spec.warpName,
            parent: group.id, transform: DEFAULT_TRANSFORM(),
            visible: true, opacity: 1,
            col, row, gridX, gridY, gridW, gridH,
            parameterId: spec.paramSsId,
            warpType: spec.warpType,
          });

          for (const child of children) child.parent = warpId;

          paramAnim.tracks.push({
            nodeId: warpId, property: 'mesh_verts',
            keyframes: buildWarpKeyframes(spec.warpType, gridX, gridY, gridW, gridH, col, row, 1),
          });

          if (!warpNodeIds[spec.paramSsId]) warpNodeIds[spec.paramSsId] = [];
          warpNodeIds[spec.paramSsId].push(warpId);

        } else if (spec.layerTags) {
          // ── tag mode: find tagged parts within a bone group's subtree ──
          const searchRoot = findWarpChildOf(spec.insideBoneRole);
          if (!searchRoot) continue;

          const tagSet = new Set(spec.layerTags);
          const targets = collectTaggedParts(searchRoot.id, tagSet);
          createWarp(spec, searchRoot, targets);
        }
      }

      // Create all standard Live2D parameters; wire bindings for warp-linked ones
      for (const spec of LIVE_RIG_PARAMS) {
        const warpIds = warpNodeIds[spec.id] ?? [];
        const bindings = warpIds.map(wid => ({ animationId: paramAnim.id, nodeId: wid, property: 'mesh_verts' }));
        proj.parameters.push({
          id: spec.id, name: spec.name,
          min: spec.min, max: spec.max, default: spec.default,
          bindings,
        });
      }
    });
  }, [updateProject]);

  /* ── Wizard: adjust warp strength (slider drag) ─────────────────────────── */
  const handleWarpStrength = useCallback((paramId, strength) => {
    const baseDef = LIVE_RIG_PARAMS.find(p => p.id === paramId);
    if (!baseDef) return;
    const s = strength / 100;
    const newMin = baseDef.min === 0 ? 0 : baseDef.min * s;
    const newMax = baseDef.max * s;

    updateParameter(paramId, { min: newMin, max: newMax });

    const hasSpec = WARP_SPECS.some(ws => ws.paramSsId === paramId);
    if (hasSpec) {
      updateProject(proj => {
        const paramAnim = proj.animations.find(a => a.name === 'Parameters');
        if (!paramAnim) return;
        const warpNodes = proj.nodes.filter(n => n.type === 'warpDeformer' && n.parameterId === paramId);
        for (const warpNode of warpNodes) {
          const track = paramAnim.tracks.find(t => t.nodeId === warpNode.id && t.property === 'mesh_verts');
          if (!track) continue;
          const warpType = warpNode.warpType ?? WARP_SPECS.find(ws => ws.paramSsId === paramId)?.warpType;
          if (!warpType) continue;
          track.keyframes = buildWarpKeyframes(
            warpType, warpNode.gridX, warpNode.gridY, warpNode.gridW, warpNode.gridH,
            warpNode.col, warpNode.row, s,
          );
        }
      }, { skipHistory: true });
    }

    useParameterStore.getState().setParameterValue(paramId, newMax);
  }, [updateParameter, updateProject]);

  /* ── Wizard: create Idle animation clip with bone rotation + blink tracks ── */
  const createIdleAnimation = useCallback(() => {
    updateProject((proj) => {
      if (proj.animations.find(a => a.name === 'Idle')) return;

      const tracks = [];
      const torso = proj.nodes.find(n => n.type === 'group' && n.boneRole === 'torso');
      const head  = proj.nodes.find(n => n.type === 'group' && n.boneRole === 'head');

      if (torso) {
        tracks.push({
          nodeId: torso.id, property: 'rotation',
          keyframes: [
            { time:    0, value: 0 },
            { time: 1000, value: -3 },
            { time: 2000, value: 0 },
            { time: 3000, value: 3 },
            { time: 4000, value: 0 },
          ],
        });
      }
      if (head) {
        tracks.push({
          nodeId: head.id, property: 'rotation',
          keyframes: [
            { time:    0, value:  0 },
            { time: 1000, value:  1 },
            { time: 2000, value:  0 },
            { time: 3000, value: -1 },
            { time: 4000, value:  0 },
          ],
        });
      }

      // Opacity blink on any part whose name starts with "eyelash" or "eyelid"
      for (const node of proj.nodes) {
        if (node.type !== 'part') continue;
        if (!/^eyelash|^eyelid/i.test(node.name)) continue;
        tracks.push({
          nodeId: node.id, property: 'opacity',
          keyframes: [
            { time:    0, value: 1 },
            { time: 3400, value: 1 },
            { time: 3550, value: 0 },
            { time: 3700, value: 1 },
            { time: 4000, value: 1 },
          ],
        });
      }

      proj.animations.push({
        id: uid(), name: 'Idle', duration: 4000, fps: 24,
        tracks, audioTracks: [],
      });
    });
  }, [updateProject]);

  /* ── Wizard: enter liverig step (auto-generate then show param panel) ───── */
  const handleWizardLiveRig = useCallback((meshAllParts) => {
    meshAllPartsRef.current = meshAllParts;
    autoGenerateWarpDeformers();
    createIdleAnimation();
    // Generate meshes now so warp deformers have geometry to deform during the preview
    if (meshAllParts) autoMeshAllParts();
    useEditorStore.getState().setSkeletonEditMode(false);
    setWizardStep('liverig');
    // Start idle playback after updateProject flushes (next tick)
    setTimeout(() => {
      const idleClip = useProjectStore.getState().project.animations.find(a => a.name === 'Idle');
      if (idleClip) {
        useAnimationStore.getState().switchAnimation(idleClip);
        useAnimationStore.getState().play();
      }
    }, 0);
  }, [autoGenerateWarpDeformers, createIdleAnimation, autoMeshAllParts]);

  /* ── Wizard: complete (called by PsdImportWizard adjust/liverig step) ───── */
  const handleWizardComplete = useCallback((meshAllParts) => {
    useAnimationStore.getState().pause();
    useParameterStore.getState().clearAll();
    // autoMeshAllParts only meshes parts that don't yet have a mesh, so calling it
    // here is safe even if liverig already triggered it (idempotent on already-meshed parts)
    if (meshAllParts ?? meshAllPartsRef.current) autoMeshAllParts();
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

        // Compute mesh deformations (blend shapes) for export frame
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
          onUpdatePsd={handleWizardUpdatePsd}
          onReorder={handleWizardReorder}
          onApplyRig={handleWizardApplyRig}
          onLiveRig={handleWizardLiveRig}
          liveRigParams={project.parameters}
          onWarpStrength={handleWarpStrength}
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
