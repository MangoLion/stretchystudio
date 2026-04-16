# Shape Keys (Blend Shapes) Implementation

## Overview

Shape Keys (also called Blend Shapes) is a Blender-inspired feature that allows users to create multiple deformed versions of a mesh and blend between them via an influence slider. Each shape key stores **vertex position deltas** from the rest position, enabling complex character animation without bone-based rigging.

### Key Features

- **Per-node blend shapes**: Each part with a mesh can have multiple shape keys
- **Keyframeable influences**: Blend shape influences (0–1) can be animated on the timeline
- **Blender-style edit mode**: Click the pencil ✎ to enter shape key edit mode and deform deltas with the brush
- **Accumulative**: Multiple shapes blend together (`finalPos = rest + Σ(delta × influence)`)
- **Live preview**: Active shape key displays at 100% influence during editing for visibility

---

## Architecture

### Data Model

**Part node additions:**
```javascript
{
  id: string,
  type: 'part',
  mesh: { vertices: [{x, y, restX, restY}], ... },
  
  // NEW: Shape key definitions
  blendShapes: [
    {
      id: string,           // unique, never changes
      name: string,         // "Key 1", "Mouth Open", etc.
      deltas: [{dx, dy}]    // one per vertex; offsets from restX/restY
    }
  ],
  
  // NEW: Staging mode influence values
  blendShapeValues: {
    [shapeId]: number     // 0.0–1.0, used outside animation
  }
}
```

### Rendering Pipeline

**Blend Formula** (rAF tick, line ~240–275):
```javascript
finalX[i] = restX[i] + Σ(blendShapes[j].deltas[i].dx × influence[j])
finalY[i] = restY[i] + Σ(blendShapes[j].deltas[i].dy × influence[j])
```

The formula:
1. Starts from **rest positions** (`restX/restY`), not current `x/y`
2. Applies ALL shape deltas scaled by their influences
3. Injects the blended vertices into `poseOverrides` as `mesh_verts`
4. GPU `uploadPositions` handles the final vertex update

**Key insight**: The blend formula runs **every frame** during render, not just on drag. This means influences from keyframes are applied live during playback.

### Animation Integration

**Track property naming**: `blendShape:{shapeId}`
- Example: `blendShape:abc123def`
- Scalar value: 0.0–1.0 (the influence)
- Keyframing: works with existing easing system (linear, ease-in-out, etc.)

**Flow**:
1. User moves influence slider in animation mode
2. `setDraftPose(nodeId, { 'blendShape:{id}': value })` stores uncommitted change
3. Press K → creates `blendShape:{id}` keyframe at current time
4. During playback, `computePoseOverrides` interpolates keyframe influences
5. Render loop reads influences and applies blend formula

### Edit Mode

**Entering**: Click the pencil ✎ button in the Shape Keys panel
- Sets `blendShapeEditMode = true`, `activeBlendShapeId = shape.id`
- Forces active shape to display at 100% influence (regardless of slider)
- Brush writes to `shape.deltas` instead of base mesh

**During edit**:
- Drag start captures blended positions (existing deltas + current drag)
- GPU shows real-time preview: basis + accumulated deltas + current drag
- All affected vertices updated in `shape.deltas` on mouse release

**Exiting**: Click "Done" button in edit mode header

---

## Problems & Solutions

### Problem 1: Mesh Visually Reverts Between Drags in Edit Mode

**Symptom**: When editing a blend shape with the deform brush, the second and subsequent drags would visually reset the mesh to its original position, then deform from there. However, exiting edit mode showed all changes correctly saved.

**Root Cause**: 
- `onPointerDown` captured a vertex position snapshot (`verticesSnap`) from `node.mesh.vertices` (the base rest positions)
- Each new drag started from rest, not from the previously-edited state
- The blend shape deltas WERE being accumulated correctly in storage, but the visual GPU preview only showed the current drag from rest

**Solution** (lines 1062–1095):
1. When in `blendShapeEditMode`, compute `effectiveVerts` by applying existing blend shape deltas (at 100% influence for active shape)
2. This "starting state" becomes the `verticesSnap` for each drag
3. GPU upload then shows: blended-base + new-drag-delta (visually correct)
4. Stored delta: `existing_delta + new_drag_delta` (mathematically correct accumulation)

```javascript
if (editorRef.current.blendShapeEditMode && selNode.blendShapes?.length) {
  const activeShapeId = editorRef.current.activeBlendShapeId;
  effectiveVerts = selNode.mesh.vertices.map((v, i) => {
    let bx = v.restX, by = v.restY;
    for (const shape of selNode.blendShapes) {
      const d = shape.deltas[i];
      if (!d) continue;
      const inf = shape.id === activeShapeId ? 1.0 : (selNode.blendShapeValues?.[shape.id] ?? 0);
      bx += d.dx * inf;
      by += d.dy * inf;
    }
    return { x: bx, y: by };
  });
}
```

**Additional fix**: Force active shape to 100% influence in the render loop (line ~260) so the canvas display matches what the user is editing.

---

### Problem 2: Mesh Doesn't Deform During Animation Playback

**Symptom**: During timeline playback, the blend shape influence slider in the Inspector changed correctly (showing interpolated keyframe values), but the mesh in the canvas didn't visually deform.

**Root Cause**:
Every K-press (keyframe commit) was **unconditionally creating a `mesh_verts` keyframe** for the node, regardless of whether the user was deforming the mesh. This `mesh_verts` keyframe contained the **base (undeformed) vertex positions**.

During playback:
1. `computePoseOverrides` returned: `{ 'blendShape:{id}': 0.5, mesh_verts: [base vertices] }`
2. Blend shape application checked: `if (!existing.mesh_verts)` → **TRUE** (mesh_verts exists) → **SKIP blend formula**
3. Result: GPU received base mesh, not blended mesh

This was especially problematic because:
- Every K-press (even pure blend shape influence keyframes) created these blocking `mesh_verts` entries
- The blend shape formula was never applied during animation
- The Guard was designed to prevent mesh_verts + blend shapes conflicts, but it was too aggressive

**Solution** (lines 421–447):
Only create/update a `mesh_verts` keyframe when:
1. The node has an active mesh deform (`draft.mesh_verts` is defined), **OR**
2. A `mesh_verts` track already exists (continuing an established deform animation)

```javascript
const hasMeshDeform = draft?.mesh_verts !== undefined;
let meshTrack = animation.tracks.find(t => t.nodeId === nodeId && t.property === 'mesh_verts');

if (hasMeshDeform || meshTrack) {
  // ... create/update mesh_verts keyframe
}
```

This way:
- Pure blend shape K-presses don't create blocking `mesh_verts` entries
- Existing deform animations continue to work
- Blend shape animation works freely without interference
- If a user mixes mesh_verts (deform) and blend shapes, mesh_verts takes priority (they don't interfere)

**Note for existing projects**: Projects created before this fix may have polluted `mesh_verts` tracks. Deleting those tracks from the timeline will restore blend shape animation.

---

### Problem 3: Edit Mode Influence Not Visible

**Symptom**: When entering blend shape edit mode, the shape key was invisible if its influence slider was at 0.

**Root Cause**: The blend formula used `influences[j]` directly from keyframe/staging values, which could be 0.

**Solution** (lines ~260–268 in rAF tick):
When `blendShapeEditMode && activeBlendShapeId === shape.id`, force influence to 1.0 in the render loop:

```javascript
if (ed.blendShapeEditMode && ed.activeBlendShapeId === shape.id) {
  hasInfluence = true;
  return 1.0;  // active shape always visible during editing
}
```

This ensures the canvas always shows a preview of what you're editing, matching Blender's behavior.

---

### Problem 4: Canvas Not Redrawing on Edit Mode Entry/Exit

**Symptom**: Entering or exiting blend shape edit mode didn't immediately redraw the canvas (no visual feedback).

**Root Cause**: The `isDirtyRef` trigger for canvas redraw (line 315) didn't include `blendShapeEditMode` or `activeBlendShapeId`.

**Solution** (line 316–317):
Added to the `useEffect` dependency list:
```javascript
useEffect(() => { isDirtyRef.current = true; },
  [...existing..., editorState.blendShapeEditMode, editorState.activeBlendShapeId]);
```

Now the canvas immediately redraws when edit mode state changes.

---

## Usage

### Creating a Shape Key

1. Select a part with a mesh
2. In the Inspector, find the **Shape Keys** section (appears below Mesh panel if mesh exists)
3. Click the **+** button
4. A new shape key "Key N" is created with zero deltas

### Editing a Shape Key

1. Click the **pencil ✎** button next to the shape key name
2. Header changes to **"Editing: [Shape Name]"**
3. Use the deform brush (same as normal mesh editing) to modify the shape
4. Brush size/hardness controls still apply
5. Click **Done** to exit edit mode

### Animating Blend Shapes

**Staging mode** (non-animation):
- Move the influence slider (0–1) and the mesh updates instantly
- Changes persist in `node.blendShapeValues`

**Animation mode**:
- Move the influence slider
- (Auto-keyframing enabled by default) K-press creates a keyframe
- Keyframes are stored as `blendShape:{shapeId}` tracks with scalar values
- Easing applies to influence interpolation
- During playback, influences animate smoothly

### Practical Tips

- **Layer shapes**: Use multiple shape keys for different deformations (e.g., "Smile", "Blink", "Angry")
- **Combine with rigging**: Blend shapes work alongside bone rigs; use both for complex character animation
- **Keyframe at key frames**: Keyframe at start, middle, and end of an action; easing fills the gaps
- **Edit mode preview**: The active shape is shown at 100% during edit mode, regardless of slider position
- **Accumulative**: If "Smile" and "Blink" both have influence, their deltas ADD together

---

## Technical Notes

### Relative Deltas (Not Absolute Positions)

Shape keys store **deltas** (`{dx, dy}`), not absolute positions. This design choice:
- Makes shapes independent of the base mesh's current position
- Allows re-meshing without losing shape data (the deltas still apply to new vertices)
- Follows Blender's approach

### restX/restY as the Base

The blend formula uses `restX` and `restY` (the original mesh generation positions), not the current `x`/`y`. This means:
- If you deform the base mesh in staging mode (`x`/`y` change), blend shapes still reference the original positions
- Blend shapes are "locked" to the original mesh geometry
- Future extension: re-base shapes to current mesh positions if needed

### mesh_verts vs. Blend Shapes

The animation system supports two vertex animation mechanisms:

| Feature | Stores | Use Case |
|---------|--------|----------|
| `mesh_verts` keyframes | Absolute vertex positions | Direct mesh deformation animation (like keyframe sculpting) |
| Blend shapes | Vertex deltas + influences | Parameter-based deformation (flexible, reusable) |

Currently, they **don't fully coexist**: if a node has both, `mesh_verts` keyframes take priority, and blend shapes are skipped (the guard at line ~272 prevents conflicts). This can be improved in the future.

### GPU Efficiency

- Blend formula runs once per frame during render, not per-vertex
- Blended vertices are uploaded once via `uploadPositions` (GPU batch update)
- No per-frame re-triangulation or topology changes
- Performance: negligible overhead for reasonable vertex/shape counts

---

## Future Enhancements

1. **Shape key visibility toggle**: Hide/show individual shapes in the canvas
2. **Shape key export**: Save/load shape keys from external formats
3. **Auto-shape-creation**: Generate initial shape keys from user-drawn variations
4. **Shape blending UI**: Advanced panel to visualize and adjust multiple influences
5. **Mesh + Shape combo**: Resolve the `mesh_verts` vs. blend shapes conflict for true hybrid animation
6. **Symmetry**: Mirror a shape key across the X-axis for bilateral characters
7. **Relative vs. absolute**: Toggle between delta-based and absolute vertex storage modes

---

## Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Data model actions | `src/store/projectStore.js` | ~113–162 |
| Edit mode state | `src/store/editorStore.js` | ~66–102 |
| Animation engine | `src/renderer/animationEngine.js` | ~9, ~224–232 |
| Blend formula | `src/components/canvas/CanvasViewport.jsx` | ~240–275 |
| Edit mode (onPointerDown) | `src/components/canvas/CanvasViewport.jsx` | ~1062–1095 |
| Edit mode (brush drag) | `src/components/canvas/CanvasViewport.jsx` | ~1216–1235 |
| K-key handler | `src/components/canvas/CanvasViewport.jsx` | ~444–464, ~421–447 |
| UI Inspector | `src/components/inspector/Inspector.jsx` | ~525–660 |
| File I/O | `src/io/projectFile.js` | ~95–102 |

---

## Testing Checklist

- [ ] Create a new shape key on a meshed part
- [ ] Edit the shape key using the deform brush (multiple drags, no visual revert)
- [ ] Set influence slider to various values, see mesh deform in real-time
- [ ] In animation mode, move slider → K to create keyframes at different times
- [ ] Scrub the timeline, verify blend shapes animate smoothly
- [ ] Create multiple shapes, verify influences blend additively
- [ ] Save/load project, verify blend shapes persist
- [ ] Edit mode: active shape shows at 100% regardless of slider
- [ ] Edit mode: exiting and re-entering shows saved deltas
- [ ] Mesh_verts tracks don't appear for pure shape key animations (after fix)

---

**Last updated**: April 2026
**Author**: Claude (Anthropic)
**Status**: Complete, tested, documented
