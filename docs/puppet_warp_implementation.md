# Puppet Warp Implementation Report

**Completion Date:** 2026-04-16  
**Status:** Complete and functional

---

## Executive Summary

Puppet Warp is a mesh deformation feature that allows intuitive animation of layer meshes using control pins. Instead of manually editing individual mesh vertices, users can place pins on a layer and drag them to deform the mesh around those control points. The implementation uses **Inverse Distance Weighted (IDW)** interpolation to distribute deformation across the mesh, with unpinned areas acting as natural anchors.

The feature integrates with:
- **Animation system:** pins can be keyframed via the K key
- **Skeleton overlay:** pins render alongside armature controls
- **Blend shapes:** pin movements can be recorded as shape key vertex deltas
- **Both staging and animation modes:** full drag-to-deform support in both contexts

---

## Architecture Overview

### Core Algorithm: Inverse Distance Weighted (IDW)

**File:** [`src/mesh/puppetWarp.js`](../src/mesh/puppetWarp.js)

IDW deformation computes a displacement for each mesh vertex as a weighted average of pin displacements:

```javascript
export function applyPuppetWarp(vertices, pins) {
  if (!pins || pins.length === 0) return vertices;

  return vertices.map(v => {
    let totalWeight = 0;
    let dx = 0, dy = 0;

    for (const pin of pins) {
      const ex = v.x - pin.restX;
      const ey = v.y - pin.restY;
      const dist2 = ex * ex + ey * ey;

      // Weight = 1 / distance^2 (exact-match shortcut if dist ≈ 0)
      const w = dist2 < 1e-6 ? 1e10 : 1.0 / dist2;

      totalWeight += w;
      dx += w * (pin.x - pin.restX);  // pin displacement in X
      dy += w * (pin.y - pin.restY);  // pin displacement in Y
    }

    if (totalWeight < 1e-10) return { x: v.x, y: v.y };

    return {
      x: v.x + dx / totalWeight,
      y: v.y + dy / totalWeight,
    };
  });
}
```

**Why IDW instead of MLS-Rigid:**
- **Simplicity:** no SVD decomposition, ~20 ops per vertex
- **Anchoring:** unmoved pins naturally dominate their region (zero displacement)
- **Performance:** O(V × P) per frame, negligible for typical meshes (V ≈ 100–400 verts, P ≈ 3–8 pins)

See [Problem: MLS-Rigid Mesh Breakage](#problem-mls-rigid-mesh-breakage) for why an earlier ARAP-style approach was rejected.

---

## Data Schema

### Project Store — Node Schema

**File:** [`src/store/projectStore.js`](../src/store/projectStore.js) (lines 36–39, 193)

Each part node (type `'part'`) has a `puppetWarp` property:

```javascript
puppetWarp: {
  enabled: boolean,
  pins: [
    {
      id: string,              // UUID for matching across keyframes
      restX: number,           // image-space position when pin was placed
      restY: number,
      x: number,               // current posed position (= rest when unstaged)
      y: number,
    }
  ]
} | null
```

### Blend Shapes — Pin Delta Support

**File:** [`src/store/projectStore.js`](../src/store/projectStore.js) (line 34)

Blend shapes can now record puppet pin movements as `pinDeltas`:

```javascript
blendShapes: [
  {
    id: string,
    name: string,
    deltas: [{ dx: number, dy: number }],           // per-vertex deltas
    pinDeltas: [{ pinId: string, dx: number, dy: number }] | null  // NEW: pin displacements
  }
] | null
```

When a blend shape has `pinDeltas`, those pins are stored with their displacement from `restX/restY`. The vertex `deltas` are recomputed via IDW during editing, so playback applies both pin and vertex deformations correctly.

**Forward Compatibility Guard** (line 193):
```javascript
if (node.puppetWarp === undefined) node.puppetWarp = null;
```

### Project Store Actions

**File:** [`src/store/projectStore.js`](../src/store/projectStore.js) (lines 210–248)

- **`setPuppetWarpEnabled(nodeId, enabled)`** — toggle puppet warp on/off for a layer
- **`addPuppetPin(nodeId, restX, restY)`** — place a new pin at image-space coords (initializes `x=restX, y=restY`)
- **`removePuppetPin(nodeId, pinId)`** — remove a pin by ID
- **`setPuppetPinPosition(nodeId, pinId, x, y)`** — drag pin in staging mode (updates both `x` and `y`)

### Editor Store — Edit Mode Flags

**File:** [`src/store/editorStore.js`](../src/store/editorStore.js) (lines 75–78, 158–169)

```javascript
state: {
  puppetPinEditMode: false,     // true when user is placing pins
  puppetPinPartId: null,        // id of layer being edited (or null)
}

actions: {
  enterPuppetPinEditMode(partId),   // clears meshEditMode + blendShapeEditMode
  exitPuppetPinEditMode(),
}
```

**Auto-clear logic** (line 103–111): when `setSelection` changes to a different node, puppet pin edit mode is cleared.

### Animation Keyframe Format

**File:** [`src/renderer/animationEngine.js`](../src/renderer/animationEngine.js) (line 228–229)

New animation track property: `'puppet_pins'`

```javascript
{
  nodeId: string,
  property: 'puppet_pins',
  keyframes: [
    {
      time: number (ms),
      value: [
        { id: string, x: number, y: number },  // Note: no restX/restY in keyframes
        ...
      ],
      easing: string
    }
  ]
}
```

**Important:** keyframe values store only `{id, x, y}`. The `restX`/`restY` are merged from the base node's `puppetWarp.pins` at warp time (see [Problem: Missing restX/restY in Keyframes](#problem-missing-restxresty-in-keyframes)).

---

## File-by-File Implementation

### 1. [`src/mesh/puppetWarp.js`](../src/mesh/puppetWarp.js)

**New file.** Contains the IDW deformation algorithm.

**Exports:**
- `applyPuppetWarp(vertices, pins)` — main deformation function

**Usage:**
- Called from `CanvasViewport.jsx` rAF tick (line 334)
- Called from `SkeletonOverlay.jsx` onPointerMove for blend shape edit mode

---

### 2. [`src/store/projectStore.js`](../src/store/projectStore.js)

**Changes:**
1. Added `puppetWarp` to part node schema (lines 36–39)
2. Forward-compat guard in `loadProject` (line 193)
3. Four new actions (lines 210–248):
   - `setPuppetWarpEnabled`
   - `addPuppetPin`
   - `removePuppetPin`
   - `setPuppetPinPosition`

---

### 3. [`src/store/editorStore.js`](../src/store/editorStore.js)

**Changes:**
1. Added state flags (lines 75, 78):
   - `puppetPinEditMode: false`
   - `puppetPinPartId: null`
2. Updated `setSelection` logic (lines 103–111) to clear puppet pin edit mode when selection changes away
3. Two new actions (lines 158–169):
   - `enterPuppetPinEditMode(partId)`
   - `exitPuppetPinEditMode()`

---

### 4. [`src/renderer/animationEngine.js`](../src/renderer/animationEngine.js)

**Changes:**
1. Added `interpolatePuppetPins(keyframes, timeMs, loopKeyframes, endMs)` helper — matches pins by `id`, linearly interpolates x/y between keyframes
2. Added `lerpPinArrays(pinsA, pinsB, t)` helper — weighted interpolation between two pin arrays
3. Updated `computePoseOverrides` (line 228–229) to handle `'puppet_pins'` property tracks

**Matching by ID:** pins are matched by ID (not index) to be robust if pins are added/removed in future

---

### 5. [`src/components/canvas/SkeletonOverlay.jsx`](../src/components/canvas/SkeletonOverlay.jsx)

**Largest implementation file.** 800+ lines. Key changes:

#### Imports (line 21)
```javascript
import { applyPuppetWarp } from '@/mesh/puppetWarp';
```

#### Store Subscriptions (lines 80–95)
```javascript
const puppetPinEditMode = useEditorStore(s => s.puppetPinEditMode);
const puppetPinPartId = useEditorStore(s => s.puppetPinPartId);
const enterPuppetPinEditMode = useEditorStore(s => s.enterPuppetPinEditMode);
const exitPuppetPinEditMode = useEditorStore(s => s.exitPuppetPinEditMode);
const addPuppetPin = useProjectStore(s => s.addPuppetPin);
const removePuppetPin = useProjectStore(s => s.removePuppetPin);
```

#### Early-Exit Guard (lines 514–517)
```javascript
const hasPuppetPins = effectiveNodes.some(n => n.puppetWarp?.enabled && n.puppetWarp.pins.length > 0);
if (!hasArmature && !hasPuppetPins) return null;
if (!showSkeleton && !puppetPinEditMode) return null;
```

Renders overlay if either armature OR puppet pins exist. In pin edit mode, render even if skeleton is hidden.

#### Helper: `getPuppetPins` (lines 506–510)
```javascript
function getPuppetPins(node, draftPose, poseOverrides) {
  return draftPose.get(node.id)?.puppet_pins
    ?? poseOverrides?.get(node.id)?.puppet_pins
    ?? node?.puppetWarp?.pins ?? [];
}
```

Priority: draft pose > keyframe overrides > base node pins

#### Blend Shape Integration — Subscriptions (lines 74–75)

```javascript
const blendShapeEditMode = useEditorStore(s => s.blendShapeEditMode);
const activeBlendShapeId = useEditorStore(s => s.activeBlendShapeId);
```

When blend shape edit mode is active on a node with puppet warp, pins are shown at their shape-delta positions and dragging records pin movements to `shape.pinDeltas`.

#### Pointer Down Handler (lines 220–330)
Extended `onPointerDown` to detect and handle puppet pin drags:

```javascript
else if (dragType === 'puppetPin') {
  const node = effectiveNodes.find(n => n.id === nodeId);
  if (!node?.puppetWarp) return;
  const pin = node.puppetWarp.pins.find(p => p.id === pinId);
  if (!pin) return;

  // Check if blend shape edit mode is active on this node
  const bsState = useEditorStore.getState();
  const bsShapeId = bsState.blendShapeEditMode ? bsState.activeBlendShapeId : null;
  const isBlendShapeMode = !!bsShapeId && !!node.blendShapes?.some(s => s.id === bsShapeId);

  // In blend shape edit mode, start from pinDelta-adjusted rest position
  let startPinX = pin.x;
  let startPinY = pin.y;
  if (isBlendShapeMode) {
    const activeShape = node.blendShapes.find(s => s.id === bsShapeId);
    const pd = activeShape?.pinDeltas?.find(d => d.pinId === pin.id);
    startPinX = pin.restX + (pd?.dx ?? 0);
    startPinY = pin.restY + (pd?.dy ?? 0);
  }

  dragRef.current = {
    type: 'puppetPin', partId: nodeId, pinId,
    startPinX, startPinY,
    startScreenX: cssX, startScreenY: cssY,
    isAnimMode: editorModeRef.current === 'animation' && !isBlendShapeMode,
    isBlendShapeMode,
    blendShapeId: bsShapeId,
    iwm,  // inverse world matrix for screen→image conversion
  };
}
```

**Critical:** inverse world matrix (`iwm`) is precomputed at drag start to convert screen-space deltas to image-space pin positions. In blend shape mode, pins start from delta-adjusted rest positions.

#### Pointer Move Handler (lines 421–495)
New branches for `drag.type === 'puppetPin'`:

**Blend Shape Edit Mode** (lines 456–495):
```javascript
if (drag.isBlendShapeMode) {
  const node = effectiveNodes.find(n => n.id === drag.partId);
  if (!node?.puppetWarp || !node.mesh) return;
  const basePins = node.puppetWarp.pins;
  const activeShape = node.blendShapes?.find(s => s.id === drag.blendShapeId);
  const existingDeltas = activeShape?.pinDeltas ?? [];

  // Build effective pins: dragged pin at new position, all others at shape delta
  const effectivePins = basePins.map(p => {
    if (p.id === drag.pinId) {
      return { restX: p.restX, restY: p.restY, x: newX, y: newY };
    }
    const ex = existingDeltas.find(d => d.pinId === p.id);
    return { restX: p.restX, restY: p.restY, x: p.restX + (ex?.dx ?? 0), y: p.restY + (ex?.dy ?? 0) };
  });

  // Apply IDW to rest vertices to get warped positions
  const restVerts = node.mesh.vertices.map(v => ({ x: v.restX, y: v.restY }));
  const warpedVerts = applyPuppetWarp(restVerts, effectivePins);

  // Compute pinDeltas for storage (skip zero-delta pins)
  const newPinDeltas = basePins
    .map(p => {
      if (p.id === drag.pinId) return { pinId: p.id, dx: newX - p.restX, dy: newY - p.restY };
      const ex = existingDeltas.find(d => d.pinId === p.id);
      return ex ? { ...ex } : null;
    })
    .filter(d => d && (d.dx !== 0 || d.dy !== 0));

  updateProject((proj) => {
    const pnode = proj.nodes.find(n => n.id === drag.partId);
    const shape = pnode?.blendShapes?.find(s => s.id === drag.blendShapeId);
    if (!shape) return;
    shape.pinDeltas = newPinDeltas.length > 0 ? newPinDeltas : null;
    shape.deltas = node.mesh.vertices.map((v, i) => ({
      dx: warpedVerts[i].x - v.restX,
      dy: warpedVerts[i].y - v.restY,
    }));
  });
  return;
}
```

**Animation Mode** (lines 496–509):
1. Compute screen delta → world delta (divide by zoom)
2. Apply inverse world matrix to get image-space delta
3. **Merge `restX`/`restY` from base pins** — handles keyframe pins that lack this info
4. Update `puppet_pins` in `draftPose`

```javascript
else if (drag.isAnimMode) {
  const rawPins = getPuppetPins(node, animDraftPose, keyframeOverrides);
  const currentPins = rawPins.map(p => {
    const base = node.puppetWarp.pins.find(b => b.id === p.id);
    return { restX: base?.restX ?? p.restX ?? p.x, restY: base?.restY ?? p.restY ?? p.y, ...p };
  });
  const updatedPins = currentPins.map(p =>
    p.id === drag.pinId ? { ...p, x: newX, y: newY } : p
  );
  setDraftPoseRef.current(drag.partId, { puppet_pins: updatedPins });
}
```

#### Pointer Up Handler (lines 468–474)
Auto-keyframe support: dispatch synthetic K key event if `autoKeyframe && isAnimMode`:

```javascript
if (drag && drag.type === 'puppetPin' && drag.isAnimMode) {
  const autoKeyframe = useEditorStore.getState().autoKeyframe;
  if (autoKeyframe) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
  }
}
```

#### SVG Click Handler for Pin Placement (lines 745–765)
When `puppetPinEditMode` is active:

```javascript
const handleSVGClick = (e) => {
  if (!puppetPinEditMode) return;
  e.stopPropagation();
  e.preventDefault();

  const rect = e.currentTarget.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const [imgX, imgY] = toImage(cssX, cssY, zoom, panX, panY);

  // Convert to puppet pin part's local image-space
  const iwm = mat3Inverse(worldMap.get(puppetPinPartId));
  const localX = iwm[0] * imgX + iwm[3] * imgY + iwm[6];
  const localY = iwm[1] * imgX + iwm[4] * imgY + iwm[7];

  addPuppetPin(puppetPinPartId, localX, localY);
};
```

**Key:** `e.stopPropagation()` + `e.preventDefault()` prevent click-through to canvas selection.

#### SVG Rendering — Pointer Events Control (lines 744–745)
```javascript
<svg
  style={{ pointerEvents: puppetPinEditMode ? 'all' : 'none' }}
  // ... other props
>
```

Overrides Tailwind `pointer-events-none` class to capture clicks in pin edit mode.

#### Joint Circles — Edit Mode Blocking (line 563)
```javascript
style={{ cursor: skeletonEditMode ? 'grab' : 'pointer', pointerEvents: puppetPinEditMode ? 'none' : 'auto' }}
```

Prevents rotation handles from firing when placing pins.

#### Rotation Arcs — Edit Mode Blocking (line 668)
```javascript
pointerEvents: puppetPinEditMode ? 'none' : 'visibleStroke'
```

#### Trackpad Rect — Edit Mode Blocking (line 640)
```javascript
pointerEvents: puppetPinEditMode ? 'none' : 'auto'
```

#### Puppet Pin Circle Rendering (lines 744–783)

Two rendering modes:

**Blend Shape Edit Mode** (lines 747–754):
Pins shown at their shape-delta positions (`restX + pinDelta.dx`), allowing visual feedback during editing:
```javascript
const isBlendShapeEditNode = blendShapeEditMode && activeBlendShapeId && selection.includes(node.id);
if (isBlendShapeEditNode) {
  const activeShape = node.blendShapes?.find(s => s.id === activeBlendShapeId);
  const pinDeltas = activeShape?.pinDeltas ?? [];
  const deltaMap = new Map(pinDeltas.map(d => [d.pinId, d]));
  displayPins = (node.puppetWarp.pins ?? []).map(p => {
    const pd = deltaMap.get(p.id);
    return { ...p, x: p.restX + (pd?.dx ?? 0), y: p.restY + (pd?.dy ?? 0) };
  });
}
```

**Normal Mode with Blend Shape Influence** (lines 755–783):
Pins automatically move with blend shape influence to visually match mesh deformation:
```javascript
} else {
  // Accumulate blend shape pin displacements at their current influences
  const pinDisp = new Map();
  if (node.blendShapes) {
    const draft = animDraftPose.get(node.id);
    const kfOv = keyframeOverrides?.get(node.id);
    for (const shape of node.blendShapes) {
      if (!shape.pinDeltas?.length) continue;
      const prop = `blendShape:${shape.id}`;
      const influence = draft?.[prop] ?? kfOv?.[prop] ?? node.blendShapeValues?.[shape.id] ?? 0;
      if (!influence) continue;
      for (const pd of shape.pinDeltas) {
        const cur = pinDisp.get(pd.pinId) ?? { dx: 0, dy: 0 };
        pinDisp.set(pd.pinId, { dx: cur.dx + pd.dx * influence, dy: cur.dy + pd.dy * influence });
      }
    }
  }
  if (pinDisp.size > 0) {
    // Use node's base pins for restX/restY (keyframe pins may lack them)
    const basePinMap = new Map((node.puppetWarp.pins ?? []).map(p => [p.id, p]));
    const rawPins = getPuppetPins(node, animDraftPose, keyframeOverrides);
    displayPins = rawPins.map(p => {
      const d = pinDisp.get(p.id);
      if (!d) return p;
      const base = basePinMap.get(p.id);
      const restX = base?.restX ?? p.restX ?? p.x;
      const restY = base?.restY ?? p.restY ?? p.y;
      return { ...p, x: restX + d.dx, y: restY + d.dy };
    });
  } else {
    displayPins = getPuppetPins(node, animDraftPose, keyframeOverrides);
  }
}
```

Pin circle rendering remains the same:
```javascript
for (const pin of displayPins) {
  // Transform via world matrix
  const sx = wm[0] * pin.x + wm[3] * pin.y + wm[6];
  const sy = wm[1] * pin.x + wm[4] * pin.y + wm[7];
  const cx = sx * zoom + panX;
  const cy = sy * zoom + panY;
  // Render circle, handle drag/context-menu
}
```

**Visual Feedback:** At blend shape influence 0.5, pins appear halfway between rest and delta positions, matching the mesh deformation.

---

### 6. [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx)

**Changes:**

#### Import (line 26)
```javascript
import { applyPuppetWarp } from '@/mesh/puppetWarp';
```

#### rAF Puppet Warp Block (lines 313–339)
Inserted between blend shapes and GPU upload:

```javascript
// Apply puppet warp — deform mesh using IDW based on pin positions
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
```

**Pipeline order:** blend shapes → bone skinning → **puppet warp** → GPU upload. Puppet warp always overwrites `mesh_verts`, consuming both blend shape and bone-skinned output.

#### K Key Handler — Puppet Pins Track (lines 539–562)
When user presses K to insert a keyframe:

```javascript
if (node.type === 'part' && node.puppetWarp?.enabled) {
  const hasPinDraft = draft?.puppet_pins !== undefined;
  let pinTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'puppet_pins');
  
  if (hasPinDraft || pinTrack) {
    const pinValue = draft?.puppet_pins
      ?? kfValues?.puppet_pins
      ?? node.puppetWarp.pins.map(p => ({ id: p.id, x: p.x, y: p.y }));
    
    if (!pinTrack) {
      pinTrack = { nodeId, property: 'puppet_pins', keyframes: [] };
      animation.tracks.push(pinTrack);
      
      // Auto-insert rest pose at clip start if not at beginning
      if (currentTimeMs > startMs) {
        const restPins = node.puppetWarp.pins.map(p => ({ id: p.id, x: p.restX, y: p.restY }));
        upsertKeyframe(pinTrack.keyframes, startMs, restPins, 'linear');
      }
    }
    upsertKeyframe(pinTrack.keyframes, currentTimeMs, pinValue, 'linear');
  }
}
```

**Auto-insert at start:** if user is not at the animation's start time, automatically place a rest-pose keyframe at the start to anchor the animation.

---

### 7. [`src/components/inspector/Inspector.jsx`](../src/components/inspector/Inspector.jsx)

**Changes:**

#### New Component: `PuppetWarpPanel` (lines 523–578)

```javascript
function PuppetWarpPanel({ node }) {
  const setPuppetWarpEnabled = useProjectStore(s => s.setPuppetWarpEnabled);
  const puppetPinEditMode = useEditorStore(s => s.puppetPinEditMode);
  const puppetPinPartId = useEditorStore(s => s.puppetPinPartId);
  const enterPuppetPinEditMode = useEditorStore(s => s.enterPuppetPinEditMode);
  const exitPuppetPinEditMode = useEditorStore(s => s.exitPuppetPinEditMode);

  if (!node || node.type !== 'part' || !node.mesh) return null;

  const isEnabled = node.puppetWarp?.enabled ?? false;
  const pins = node.puppetWarp?.pins ?? [];
  const isEditing = puppetPinEditMode && puppetPinPartId === node.id;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>Puppet Warp</SectionTitle>
        <Switch
          checked={isEnabled}
          onCheckedChange={(on) => {
            setPuppetWarpEnabled(node.id, on);
            if (!on && isEditing) exitPuppetPinEditMode();
          }}
          className="scale-75 origin-right"
        />
      </div>

      {isEnabled && (
        <>
          <Row label="Pins">
            <span className="text-xs tabular-nums">{pins.length}</span>
          </Row>

          {isEditing ? (
            <div className="space-y-1.5">
              <div className="rounded bg-primary/10 border border-primary/30 px-2 py-1.5 text-xs text-primary">
                Click canvas to place pins. Right-click a pin to remove it.
              </div>
              <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={exitPuppetPinEditMode}>
                Done Placing Pins
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => enterPuppetPinEditMode(node.id)}>
              Edit Pins
            </Button>
          )}
        </>
      )}
    </div>
  );
}
```

#### Panel Insertion in Inspector JSX (around line 817)
```jsx
{effectiveNode.mesh && (
  <>
    <Separator />
    <PuppetWarpPanel node={effectiveNode} />
    <Separator />
    <ShapeKeysPanel node={effectiveNode} />
  </>
)}
```

Positioned between `<MeshPanel>` and `<ShapeKeysPanel>`.

---

## Problems Encountered and Solutions

### Problem: MLS-Rigid Mesh Breakage

**Symptom:** User reported: "the moment I started dragging the pin to deform, the mesh completely broke."

**Root Cause:** An earlier implementation used **MLS-Rigid** (Moving Least Squares, Schaefer et al. 2006) — a more sophisticated algorithm that extracts a rigid transform (rotation + translation) for each vertex using 2×2 SVD. The implementation had an analytic SVD solver (~100 lines) with potential numerical instabilities or incorrect matrix assembly.

**Solution:** Reverted to simple **IDW (Inverse Distance Weighted)** deformation:
- No SVD, no rotation extraction — just weighted average of pin displacements
- Mathematically simpler, fewer edge cases
- Performance identical for typical pin counts (P ≤ 8)
- Trade-off: IDW doesn't capture rotation directly (mesh shears near rotated pins), but this is acceptable for intuitive pin-based deformation

**User Request:** "Revert to more straightforward puppet warp deform method"

**Commit/File:** [`src/mesh/puppetWarp.js`](../src/mesh/puppetWarp.js) — contains final IDW implementation only.

---

### Problem: Missing `restX`/`restY` in Keyframes

**Symptom:** Mesh disappeared during animation playback.

**Root Cause:** 
1. Animation keyframe `puppet_pins` values store only `{id, x, y}` (not `restX`/`restY`) to minimize serialization size
2. During playback, `pin.restX === undefined`, so distance calculation: `dist2 = NaN`
3. Weight: `w = NaN`, all displacements: `NaN`, vertex positions: `NaN`
4. GPU renders degenerate geometry → invisible mesh

**Solution:** Merge `restX`/`restY` from base node pins at **two points**:

1. **In `CanvasViewport.jsx` rAF tick** (lines 324–329):
   ```javascript
   const effectivePins = rawPins
     ? rawPins.map(p => {
         const base = basePins.find(b => b.id === p.id);
         return { restX: base?.restX ?? p.x, restY: base?.restY ?? p.y, x: p.x, y: p.y };
       })
     : basePins;
   ```

2. **In `SkeletonOverlay.jsx` onPointerMove** (lines 441–445):
   ```javascript
   const currentPins = rawPins.map(p => {
     const base = node.puppetWarp.pins.find(b => b.id === p.id);
     return { restX: base?.restX ?? p.restX ?? p.x, restY: base?.restY ?? p.restY ?? p.y, ...p };
   });
   ```

**Result:** Keyframe pins now always have complete `{restX, restY, x, y}` info when passed to `applyPuppetWarp`.

---

### Problem: Pin Placement UI Interference

**Symptom:** User reported: "after pressing once to add a pin, the original layer is unselected because a new layer under the cursor is selected instead. Or the user could press a joint's rotating disk in the skeleton overlay that rotated the joint instead of adding a new pin."

**Root Cause:** 
1. SVG overlay had Tailwind `pointer-events-none` class → clicks passed through to canvas beneath
2. Joint circles and rotation arcs had active `onPointerDown` handlers → fired even in pin edit mode
3. Joint clicks triggered layer selection logic → selected the layer under cursor

**Solution:** Three-part fix:

1. **SVG pointer events inline style** (line 744–745):
   ```jsx
   <svg style={{ pointerEvents: puppetPinEditMode ? 'all' : 'none' }} ...>
   ```
   Overrides Tailwind class when pin edit mode is active.

2. **SVG onClick guard** (line 747):
   ```javascript
   const handleSVGClick = (e) => {
     if (!puppetPinEditMode) return;
     e.stopPropagation();
     e.preventDefault();
     // ... pin placement logic
   };
   ```

3. **Conditional pointer events on skeleton elements:**
   - Joint circles (line 563): `pointerEvents: puppetPinEditMode ? 'none' : 'auto'`
   - Rotation arcs (line 668): `pointerEvents: puppetPinEditMode ? 'none' : 'visibleStroke'`
   - Trackpad rect (line 640): `pointerEvents: puppetPinEditMode ? 'none' : 'auto'`

**Result:** In pin edit mode, only the SVG captures clicks. Skeleton controls are disabled.

---

### Problem: Keyframe Overrides Computed Too Late

**Symptom:** Runtime error: `ReferenceError: Cannot access 'keyframeOverrides' before initialization`

**Root Cause:** `keyframeOverrides` was computed in the render section (after early-exit guards) but referenced in `useCallback` hooks' dependency arrays (before early-exit). JavaScript hoisting rules trigger "temporal dead zone" error.

**Solution:** Moved `keyframeOverrides` computation to the very top of the component, before all hooks:

```javascript
// BEFORE: early-exit guards
const activeAnim = animations.find(a => a.id === animActiveAnimationId) ?? null;
const endMs = (animEndFrame / animFps) * 1000;
const keyframeOverrides = computePoseOverrides(activeAnim, animCurrentTime, animLoopKeyframes, endMs);

// THEN: early-exit guards
if (!hasArmature && !hasPuppetPins) return null;
if (!showSkeleton && !puppetPinEditMode) return null;

// THEN: useCallback hooks (can now safely reference keyframeOverrides)
const onPointerMove = useCallback(() => {
  // ... uses keyframeOverrides
}, [keyframeOverrides, ...]);
```

**Result:** `keyframeOverrides` is always available to hooks, no temporal dead zone errors.

---

### Problem: Pins Not Tracking Blend Shape Influence

**Symptom:** User changed blend shape slider → mesh deformed smoothly → pins stayed at rest positions, causing visual confusion about where the actual deformation was being applied.

**Root Cause:** Pin rendering only used base `node.puppetWarp.pins` or animation-override pins, with no accumulation of blend shape `pinDelta` displacements weighted by shape influence.

**Solution:** In `SkeletonOverlay.jsx` pin rendering (lines 755–783), accumulate blend shape pin displacements:

```javascript
// For each blend shape with pinDeltas, add its displacement weighted by influence
const pinDisp = new Map();
for (const shape of node.blendShapes) {
  if (!shape.pinDeltas?.length) continue;
  const influence = /* get shape influence from draft/keyframe/base */;
  for (const pd of shape.pinDeltas) {
    const cur = pinDisp.get(pd.pinId) ?? { dx: 0, dy: 0 };
    pinDisp.set(pd.pinId, { 
      dx: cur.dx + pd.dx * influence, 
      dy: cur.dy + pd.dy * influence 
    });
  }
}

// Apply accumulated displacements to pin display positions
displayPins = rawPins.map(p => {
  const d = pinDisp.get(p.id);
  if (!d) return p;
  return { ...p, x: restX + d.dx, y: restY + d.dy };
});
```

**Result:** Pins visually move as blend shapes are adjusted, providing clear feedback about which deformation is active.

---

## Testing Checklist

The feature has been verified to work correctly in all these scenarios:

### Core Puppet Warp
- ✅ Enable puppet warp toggle on a part in Inspector
- ✅ Click "Edit Pins" → enter pin edit mode
- ✅ Click canvas multiple times → place pins (purple circles appear)
- ✅ Right-click a pin → remove it
- ✅ Exit pin edit mode
- ✅ **Staging mode:** Drag a pin → mesh deforms around pin; other pins hold position
- ✅ **Animation mode:** Drag a pin → mesh deforms; drag updates `draftPose`
- ✅ Press K in animation mode → `puppet_pins` keyframe track created
- ✅ Scrub timeline → mesh deforms correctly between keyframes
- ✅ Animation playback (non-interactive) → mesh interpolates pin positions smoothly
- ✅ Toggle skeleton visibility → puppet pins hidden/shown appropriately
- ✅ Pins visible alongside bone joints in skeleton overlay
- ✅ Layer with pins + armature both render correctly
- ✅ No interference between pin dragging and bone rotation in staging mode

### Blend Shape Integration
- ✅ Select layer with puppet warp + blend shapes
- ✅ Click blend shape "Edit" in Inspector → enter blend shape edit mode
- ✅ Drag puppet pins → `pinDeltas` recorded in active shape
- ✅ Vertex `deltas` recomputed via IDW deformation
- ✅ Exit blend shape edit → pins show at rest positions
- ✅ Adjust blend shape slider → mesh deforms, pins smoothly track influence
- ✅ At influence 0.5 → pins appear halfway between rest and delta positions
- ✅ Multiple shapes with `pinDeltas` → pin displacements blend additively
- ✅ Save and reload project → `pinDeltas` persist correctly
- ✅ Animation playback → blend shapes + puppet warp both apply correctly

---

## Performance

**Complexity:** O(V × P) per frame, where:
- V = vertex count (typically 100–400)
- P = pin count (typically 3–8)

**Typical calculation:**
- 300 vertices × 6 pins = 1,800 iterations per frame
- ~20 ops per iteration (distance calc, weight, accumulation)
- **Total:** ~36,000 ops per frame @ 60 fps = **negligible** relative to GPU draw calls

No observable performance impact on test scenes.

---

## Integration Points

### Animation Engine
- File: [`src/renderer/animationEngine.js`](../src/renderer/animationEngine.js)
- New: `interpolatePuppetPins`, `lerpPinArrays`
- Updated: `computePoseOverrides` (line 228–229)

### Skeleton Overlay
- File: [`src/components/canvas/SkeletonOverlay.jsx`](../src/components/canvas/SkeletonOverlay.jsx)
- Pin rendering, drag handlers, click-to-place UI

### Canvas Rendering
- File: [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx)
- rAF warp insertion (line 313–339)
- K key `puppet_pins` track recording (line 539–562)

### Inspector UI
- File: [`src/components/inspector/Inspector.jsx`](../src/components/inspector/Inspector.jsx)
- `PuppetWarpPanel` component (line 523–578)

---

## Blend Shape Pin Delta Integration

**Status:** Fully implemented and functional (2026-04-17)

Puppet warp pins can now be edited within blend shape edit mode, allowing shape keys to record pin movements as `pinDeltas`. This enables richer shape key animations where the mesh deformation is both vertex-based and pin-based.

### Usage Flow
1. Select a layer with puppet warp enabled + blend shapes
2. Click Inspector → "Shape Keys" → Edit desired shape
3. With blend shape edit active, click Inspector → "Edit Pins" (or drag pins directly)
4. Drag pins → `pinDeltas` are recorded, vertex `deltas` recomputed via IDW
5. Exit pin edit, adjust blend shape slider → pins and mesh both move with influence

### Visual Feedback
When a blend shape has `pinDeltas`:
- **In edit mode:** pins show at their exact shape-delta positions
- **During playback:** pins smoothly interpolate: `position = restX + influence * pinDelta.dx`
- **Mesh vertices:** updated via IDW, with pins as control points

Multiple blend shapes with `pinDeltas` on the same node blend additively (both pin and vertex displacements).

---

## Future Considerations

1. **Pin Behavior:** Pins are currently treated as point masses (exact-match shortcut when dist < 1e-6). This can produce sharp "pinching" if multiple pins are very close. In practice, spacing pins at least 20–30 pixels apart works well.

2. **Undo/Redo:** All pin operations go through `updateProject` or `setDraftPose`, which integrate with the existing undo/redo system. No special handling needed.

3. **Keyframe Easing:** Puppet pins use the keyframe easing specified in the `puppet_pins` track. Linear easing (current default) is recommended; other easings may produce unintuitive intermediate frames.

4. **Multi-Layer Puppet Warp:** Pins on multiple layers with armature could be grouped or linked in future (not currently supported).

---

## Diagnostics

If puppet warp is not working as expected:

1. **Pins don't appear:**
   - Check: `node.puppetWarp.enabled === true`
   - Check: `node.puppetWarp.pins.length > 0`
   - Check: SkeletonOverlay is rendered (`showSkeleton === true` or in pin edit mode)

2. **Mesh doesn't deform:**
   - Check: `node.mesh !== null`
   - Check: `applyPuppetWarp` input has `{restX, restY, x, y}` for all pins
   - Check: vertex positions are not NaN (inspect `inputVerts` in CanvasViewport.jsx line 333)

3. **Pin placement selects wrong layer:**
   - Check: `puppetPinEditMode === true`
   - Check: SVG has `pointerEvents: 'all'` (not 'none')
   - Check: `e.stopPropagation()` called before placing pin (SkeletonOverlay.jsx line 748)

4. **Keyframes not recording:**
   - Check: `autoKeyframe === true` (or user pressed K manually)
   - Check: animation mode (`editorMode === 'animation'`)
   - Check: `node.puppetWarp.enabled === true`
   - Check: `draftPose.get(nodeId).puppet_pins` has been populated

5. **Animation playback broken:**
   - Check: keyframe `puppet_pins` values have complete `{id, x, y}` (confirmed during merge at line 325–328 of CanvasViewport.jsx)
   - Check: `restX`/`restY` are being merged from base pins (not skipped)

6. **Pins don't move with blend shape slider:**
   - Check: blend shape has `pinDeltas` populated (`shape.pinDeltas !== null`)
   - Check: blend shape is active (influence > 0)
   - Check: pin display computation in SkeletonOverlay accumulates displacements (lines 755–783)
   - Check: blend shape influence is being read correctly (`draft?.[prop]` or `kfOv?.[prop]`)

---

## References

### Key Functions
- `applyPuppetWarp` → [`src/mesh/puppetWarp.js:17`](../src/mesh/puppetWarp.js#L17)
- `computePoseOverrides` → [`src/renderer/animationEngine.js:220`](../src/renderer/animationEngine.js#L220)
- `interpolatePuppetPins` → [`src/renderer/animationEngine.js:162`](../src/renderer/animationEngine.js#L162)

### State Management
- Project store puppet warp actions → [`src/store/projectStore.js:210–248`](../src/store/projectStore.js#L210)
- Editor store pin edit mode → [`src/store/editorStore.js:75–169`](../src/store/editorStore.js#L75)

### UI Components
- Skeleton overlay puppet pin rendering → [`src/components/canvas/SkeletonOverlay.jsx:690–730`](../src/components/canvas/SkeletonOverlay.jsx#L690)
- Inspector puppet warp panel → [`src/components/inspector/Inspector.jsx:523–578`](../src/components/inspector/Inspector.jsx#L523)

### Core Logic Files
- Mesh deformation → [`src/mesh/puppetWarp.js`](../src/mesh/puppetWarp.js)
- rAF puppet warp block → [`src/components/canvas/CanvasViewport.jsx:313–339`](../src/components/canvas/CanvasViewport.jsx#L313)
- Keyframe interpolation → [`src/renderer/animationEngine.js:162–190`](../src/renderer/animationEngine.js#L162)

---

## Conclusion

**Puppet Warp is a complete, production-ready feature** (as of 2026-04-17) providing intuitive mesh deformation animation with full ecosystem integration:

- **Core deformation:** IDW algorithm handles pin-based mesh warping with excellent performance
- **Animation support:** Full keyframe recording and playback with smooth interpolation
- **Blend shape integration:** Puppet pins can be edited in blend shape mode, with vertex deltas recomputed via IDW; pins visually track blend shape influence during playback
- **Staging mode:** Direct pin dragging with persistent mesh updates
- **Animation mode:** Draft pose management with auto-keyframing support
- **Skeleton integration:** Pins render alongside armature controls with no interference
- **UI/UX:** Inspector panel for toggle/editing, click-to-place pin mode, contextual pin removal

The implementation uses a straightforward IDW algorithm that avoids the complexity of MLS-Rigid while providing excellent visual results for typical use cases (3–8 pins, 100–400 vertices). All operations integrate with the existing undo/redo system through `updateProject` and `setDraftPose` patterns.
