# Warp Deformer Implementation

This document describes the native warp deformer system in Stretchy Studio — its current
architecture, what is and isn't wired into each export path, and the road map for full
Live2D and Spine export unification.

---

## 1. What was built

### 1.1 Data model

Three new first-class concepts were added to `project.*`:

#### `project.parameters[]`
Named sliders that drive tracks in real time, stored persistently in the project file.

```js
{
  id:      string,        // e.g. "ParamAngleX"
  name:    string,
  min:     number,        // slider minimum
  max:     number,        // slider maximum
  default: number,        // rest-pose value
  bindings: [
    {
      animationId: string,   // which animation clip holds the track
      nodeId:      string,   // which node's track this parameter drives
      property:    string,   // 'mesh_verts' | 'rotation' | 'opacity' | …
    }
  ]
}
```

Runtime slider values live in a **separate `parameterStore`** (not persisted, not in undo
history) so rapid slider drags never flood the undo stack.

#### `project.physicsRules[]`
Editable array of pendulum/spring rules (same shape as the old hardcoded `PHYSICS_RULES`
in `cmo3/physics.js`). The export falls back to the hardcoded defaults for projects that
have not yet configured native rules.

#### `warpDeformer` node type
A scene-tree node that acts like a group but carries a lattice grid and a parameter binding.

```js
{
  id:          string,
  type:        'warpDeformer',
  name:        string,
  parent:      string | null,
  visible:     boolean,
  col:         number,        // lattice columns  (default 2)
  row:         number,        // lattice rows     (default 2)
  gridX:       number,        // canvas-space bounds
  gridY:       number,
  gridW:       number,
  gridH:       number,
  parameterId: string | null, // which parameter drives keyform interpolation
}
```

Grid control point positions (keyforms) are stored as `mesh_verts` animation tracks on
the warp deformer node itself, keyed by animation time. Time↔parameter-value mapping is
handled by `computeParameterDrivenOverrides` in `animationEngine.js`:

```
norm   = (paramValue − param.min) / (param.max − param.min)
timeMs = track.keyframes[0].time + norm × (lastKf.time − firstKf.time)
```

### 1.2 Canvas authoring UI

| Component | Purpose |
|-----------|---------|
| `LayerPanel` — "+ Warp" button | Creates a `warpDeformer` node |
| `WarpDeformerPanel` (Inspector) | Edits col/row, grid bounds, parameter binding; "Fit to children" auto-sizes |
| `ParametersPanel` | Creates parameters, adds `mesh_verts` bindings targeting warp deformers |
| `WarpLatticeOverlay` | SVG control-point grid shown when warp deformer is selected; drag commits keyframes |
| `GizmoOverlay` | Early-exits to `WarpLatticeOverlay` when the selected node is a warp deformer |

### 1.3 Real-time preview

`CanvasViewport` rAF loop runs two passes after blend-shape evaluation:

1. **Parameter-driven overrides** (`computeParameterDrivenOverrides`) — maps each
   parameter's current slider value to an interpolated `mesh_verts` value for any bound
   node (including warp deformer nodes). Result merged into `poseOverrides`.

2. **Bilinear warp pass** — for every `warpDeformer` node that has active `mesh_verts` in
   `poseOverrides`, recurses into all descendant mesh parts (through nested groups AND nested
   warpDeformers) and bilinearly remaps each vertex through the deformed grid. Deformations
   accumulate additively: each warp uses REST vertex positions for UV parameterization, then
   adds its delta on top of any previously-applied warp offsets. This ensures nested warps
   compose correctly regardless of evaluation order.

#### Nested warp deformer support

When a warp deformer contains another warp deformer as a child (e.g., `BodyWarp` contains
`head` group which contains `FaceWarp`), both warps are evaluated in the bilinear pass:
- The parent warp (`BodyWarp`) recurses through its entire subtree, including nested warp
  nodes, and deforms all descendant mesh parts.
- Each child warp (`FaceWarp`) is also evaluated independently, using only direct part
  children for deformation targets.
- Vertex positions accumulate: `final = rest + parent_delta + child_delta`.

Grid bounds are initialized via `autoGenerateWarpDeformers` with recursive bounding box
collection that includes all descendants through groups and warp deformers, so the parent
warp encompasses the entire visual area (head + torso) from the start.

The "Fit to Children" button in `WarpDeformerPanel` updates grid bounds and remaps all
keyframe control points proportionally, maintaining UV/control-point consistency.

#### 2.5D Perspective Auto-Generation
The `buildWarpKeyframes` utility (in `CanvasViewport.jsx`) uses non-linear math to simulate 3D rotation from 2D lattices:
- **Parabolic X-Shift**: For `face_angle_x`, the center (nose) protrudes further while far edges wrap inward.
- **Perspective Z-Scaling**: Near sides scale up vertically (`dy` adjustment) while far sides shrink, creating a depth effect.

---

## 2. Export status

### 2.1 `.cmo3` — Cubism Editor project export  ✅ Fully connected

| SS concept | CMO3 output |
|-----------|-------------|
| `project.parameters[]` | `CParameterGuid` + `CParameterSource` entries |
| `warpDeformer` node | `CWarpDeformerSource` with native col/row and authored grid bounds |
| Warp deformer keyforms | `CWarpDeformerForm` entries (IDW-propagated from child `mesh_verts` tracks) |
| Native `parameterId` | Parameter link replaces the old auto-generated `ParamDeform_*` |
| Meshes under nested groups | Correctly grouped under shared warp deformer (ancestry walk) |
| `project.physicsRules[]` | `CPhysicsSettingsSourceSet` (falls back to hardcoded defaults if empty) |
| Animations | `.can3` file alongside `.cmo3` |

**Path through code:**  
`exportLive2DProject` → `generateCmo3` (section 3b.0 native warp groups) → `emitPhysicsSettings`

### 2.2 `.moc3` — Live2D SDK runtime export  ✅ Fully connected

| SS concept | MOC3 output |
|-----------|-------------|
| `project.parameters[]` | Parameter table with min/max/default |
| `warpDeformer` node | `CDeformer` (type=0 warp) with native col/row |
| Warp deformer keyforms | Grid positions per keyform in PPU-normalized space |
| Native `parameterId` | Parameter link drives `warp_deformer.keyform_binding_band_indices` |
| Meshes under warp deformers | Linked via `art_mesh.parent_deformer_indices` (ancestry walk) |
| Parameter keyform bindings | Evenly-spaced parameter values across keyform range |

**Path through code:**  
`exportLive2D` → `generateMoc3` (via `buildSectionData` in `moc3writer.js`):
- Collects `warp_deformer` nodes from `project.nodes`
- Builds `mesh_verts` track map from `project.animations`
- Computes PPU-normalized grid positions and appends to `keyform_position.xys`
- Populates `deformer.*`, `warp_deformer.*`, `warp_deformer_keyform.*` sections
- Wires `art_mesh.parent_deformer_indices` via ancestry walk
- Assigns parameter keyform bindings (contiguous per parameter)

### 2.3 Spine export  ❌ Warp deformers not translated

Spine has no warp deformer primitive. The current `exportSpine.js` exports groups as
bones, parts as slot/region attachments, and mesh geometry as weighted mesh attachments.
Warp deformer nodes are silently ignored.

---

## 3. Road map

### 3.1 `.moc3` warp deformer support — ✅ COMPLETE (2026-04-27)

**Implementation summary:**

In `buildSectionData` (lines 349–786):
- Moved `paramList` definition earlier (before warp deformer analysis)
- Collect `warpDeformer` nodes and `mesh_verts` tracks from animations
- Build per-warp-deformer metadata: col, row, gridPts, kfs, numKf, param binding, paramIdx
- Sort bound warp deformers by paramIdx (ensures contiguous parameter ownership ranges)
- Ancestry walk: map each mesh part to its nearest warp deformer ancestor
- Populate counts: `WARP_DEFORMERS`, `WARP_DEFORMER_KEYFORMS`, `DEFORMERS`
- Extend `KEYFORM_POSITIONS` count to include warp grid XY pairs
- Update binding system: add deformer null bands (M+P..M+P+W-1) and warp real bands (M+P+W..M+P+2W-1)
- Append warp grid positions to `keyform_position.xys` in PPU-normalized space (row-major order)
- Populate deformer sections: ids, binding band indices, visibility, parent part/deformer, types, specific indices
- Populate warp_deformer sections: binding band indices, keyform begin/count, vertex count, rows, cols
- Populate warp_deformer_keyform sections: opacities (1.0), keyform position begin indices
- Assign parameter keyform bindings: evenly-spaced parameter values from min to max across keyforms
- Update `parameter.keyform_binding_begin_indices/counts` to correctly assign bindings to parameters

In `generateMoc3` (lines 856–863):
- Write `quad_transforms` section with one Bool32 per warp deformer (0 = bilinear, not quad)

**The binary section layout already exists. The additions required:

**Counts to populate:**
- `COUNT_IDX.WARP_DEFORMERS` — number of native warp deformer nodes
- `COUNT_IDX.WARP_DEFORMER_KEYFORMS` — total keyforms across all warp deformers
- `COUNT_IDX.DEFORMERS` — total deformers (warp + rotation)

**Sections to write per warp deformer:**
```
warp_deformer.keyform_binding_band_indices  → index into keyform binding band
warp_deformer.keyform_begin_indices         → offset into keyform table
warp_deformer.keyform_counts                → number of keyforms (e.g., 2)
warp_deformer.vertex_counts                 → (col+1) × (row+1) grid points
warp_deformer.rows                          → row
warp_deformer.cols                          → col
```

**Per keyform:**
```
warp_deformer_keyform.opacities                     → 1.0
warp_deformer_keyform.keyform_position_begin_indices → offset into positions array
```

**Grid positions array:**  
Flat `[x0,y0, x1,y1, …]` for every control point, per keyform, in normalized
deformer-local space `[0..1]` (same convention as the `.cmo3` warp form positions).

**Mesh linkage:**
```
art_mesh.parent_deformer_indices  → index of the warp deformer that owns this mesh
deformer.parent_deformer_indices  → -1 for root-level deformers
deformer.types                    → 0 = warp, 1 = rotation
deformer.specific_indices         → index into warp_deformer / rotation_deformer arrays
```

**Keyform binding:**  
One binding band per warp deformer, linking the parameter index and its key values
(`[param.min, param.max]`) to the keyform range.

**Implementation completed (all steps below):**
1. ✅ Collect `warpDeformerNodes` from `project.nodes` (no signature change needed; data comes from `project`)
2. ✅ Build warp deformer index map and parameter lookup in the data analysis phase
3. ✅ Write `deformer.*` sections covering all warp deformers (ids, visibility, parent linkage, type, specific index)
4. ✅ Write `warp_deformer.*` sections (binding band index, keyform begin/count, vertex count, grid dims)
5. ✅ Write `warp_deformer_keyform.*` sections and append grid positions to `keyform_position.xys`
6. ✅ Update `art_mesh.parent_deformer_indices` to reference owning deformer via ancestry walk
7. ✅ Add keyform binding bands and parameter ownership linking for each warp deformer parameter

### 3.2 Spine export — baked deform timelines

Spine has no warp deformer primitive, but it has **deform timelines** (`slot.deform`) that
store per-vertex position deltas for mesh attachments at specific animation times. The
correct strategy is to **bake** the warp deformer's effect into deform keyframes.

**Algorithm (per warp deformer with a bound parameter):**

```
For N sample points across [param.min … param.max]:
  1. Set paramValue = sample[i]
  2. Compute current grid via interpolateMeshVerts on the warp deformer's track
  3. For each descendant mesh part:
     a. Bilinearly warp all rest vertices through the current grid
     b. Compute per-vertex deltas from rest positions
     c. Emit as a Spine `deform` keyframe at time = (i / N-1) * totalDuration
```

This produces smooth Spine deform animations that mirror the SS warp preview exactly,
without Spine needing to understand the grid primitive.

**Schema (Spine 4.0):**
```json
"animations": {
  "WarpParam": {
    "slots": {
      "PartName": {
        "attachment": [
          {
            "time": 0.0,
            "name": "PartName",
            "vertices": [dx0,dy0, dx1,dy1, ...]
          }
        ]
      }
    }
  }
}
```

**Key decisions for implementation:**
- Number of samples N: 3–5 is sufficient for most deformers; expose as an export option
- Animation name: use the parameter's `name` field (e.g. `"ParamAngleX"`)
- Coordinate system: Spine is Y-up; flip all `dy` values when writing deform deltas
- If the warp deformer has no bound parameter, skip it (no animation to generate)

**Suggested implementation order:**
1. Add `collectDescendantMeshParts` util to `exportSpine.js` (mirrors the one in CanvasViewport)
2. After the existing animation loop, add a warp-deformer bake pass
3. For each warp deformer node with a `parameterId` binding, run the sample algorithm
4. Merge baked deform keyframes into the Spine animation under the parameter's name

### 3.3 `warpDeformer` as a transparent pass-through for Spine hierarchy

Currently `exportSpine.js` maps `type === 'group'` to bones. A `warpDeformer` node is a
group-like container — its children should attach to the parent bone of the warp deformer,
not to the warp deformer itself (since Spine has no equivalent node). Update the Spine
exporter:

- `warpDeformer` nodes: skip as bones, but treat their children as belonging to the warp
  deformer's *parent* bone
- Mesh parts whose direct or indirect parent is a `warpDeformer`: resolve the bone
  attachment by walking up to the first non-warp-deformer ancestor

### 3.4 Standard Live2D Coverage Gap — ✅ COMPLETE (2026-04-27)

The auto-rigger expanded from a "Minimum Viable Rig" (2 warp deformers, 18 parameters) to full 41-parameter standard set with 13 warp deformers.

#### Parameters (41 total)
All standard Live2D parameters are now in `LIVE_RIG_PARAMS`:
- **Face rotation** (3): `ParamAngleX/Y/Z`
- **Eyes** (11): `ParamEyeLOpen/ROpen`, `ParamEyeLSmile/RSmile`, `ParamEyeBallX/Y/Form`, `ParamTear`
- **Brows** (8): `ParamBrowLY/RY`, `ParamBrowLX/RX`, `ParamBrowLAngle/RAngle`, `ParamBrowLForm/RForm`
- **Mouth** (2): `ParamMouthForm`, `ParamMouthOpenY`
- **Body rotation** (3): `ParamBodyAngleX/Y/Z`
- **Breath** (1): `ParamBreath`
- **Arms** (6): `ParamArmLA/RA`, `ParamArmLB/RB`, `ParamHandL/R`
- **Shoulders** (1): `ParamShoulderY`
- **Bust** (2): `ParamBustX/Y`
- **Hair** (3): `ParamHairFront/Side/Back`
- **Global** (4): `ParamCheek`, `ParamHairFluffy`, `ParamBaseX/Y`

#### Warp Deformers (13 total)
- **Top-level groups** (3): `FaceWarp` (head), `BodyWarp` (torso), `NeckWarp` (neck)
- **Nested in head** (6): `EyeLWarp`, `EyeRWarp`, `MouthWarp`, `EyebrowLWarp`, `EyebrowRWarp`, `HairFrontWarp`, `HairBackWarp`
- **Nested in torso/root** (2): `TopWearWarp` (torso), `BottomWearWarp` (root)

#### Warp Math Types (8 new + 2 existing = 10 total)
- Existing: `face_angle_x`, `body_angle_x`
- New: `neck_follow`, `face_angle_y`, `body_angle_y`, `eye_open`, `mouth_open`, `brow_y`, `hair_sway`

#### Implementation Details

**`LIVE_RIG_PARAMS` array** (`CanvasViewport.jsx:109–156`):
- All 41 parameters defined with correct min/max/default
- Organized by semantic group (Face, Eye, Brow, Mouth, Body, Hair, Global)

**`WARP_SPECS` array** (`CanvasViewport.jsx:158–185`):
- **Two modes**: `boneRole` (wraps all children of a bone group) and `layerTags` (finds specific tagged parts within a subtree)
- **boneRole mode** (3 specs): FaceWarp, BodyWarp, NeckWarp — wraps entire group contents
- **layerTags mode** (10 specs): Eye, mouth, eyebrow, hair, topwear, bottomwear warps — targets tagged parts within a parent
- Each spec carries `warpType` for `buildWarpKeyframes` lookup
- Multiple specs can bind to the same `paramSsId` (e.g., both EyeLWarp and EyeRWarp → `ParamEyeLOpen`)

**`buildWarpKeyframes` function** (`CanvasViewport.jsx:142–361`):
- 10 warp type cases: `face_angle_x`, `body_angle_x`, `neck_follow`, `face_angle_y`, `body_angle_y`, `eye_open`, `mouth_open`, `brow_y`, `hair_sway`
- Each type returns 2–3 keyframes (time→grid deformation mapping)
- Math uses normalized row/column coordinates (0..1) and `scale` parameter for amplitude control

**`autoGenerateWarpDeformers` function** (`CanvasViewport.jsx:1327–1415`):
- Refactored to support both `boneRole` and `layerTags` modes
- **boneRole**: Wraps all direct children of the bone group (existing behavior)
- **layerTags**: Recursively finds parts matching tags within a subtree, creates warp as child of innermost group/warp
- Stores `warpType` on the node for later lookup during strength adjustments
- Multiple warp nodes per parameter each get a separate binding entry
- Calls `collectBounds` and `collectTaggedParts` utilities for tree traversal

**`handleWarpStrength` function** (`CanvasViewport.jsx:1417–1438`):
- Now handles multiple warp nodes per parameter
- Uses `warpNode.warpType` (fallback to WARP_SPECS lookup) to rebuild keyframes at new scale

#### Known Gaps — Parameters Without Warp Specs (32 of 41)

While all 41 parameters are now defined and can be created, only **9 parameters have active warp deformers**:
- ✅ `ParamAngleX` (FaceWarp, NeckWarp)
- ✅ `ParamBodyAngleX` (BodyWarp)
- ✅ `ParamEyeLOpen`, `ParamEyeROpen` (EyeLWarp, EyeRWarp)
- ✅ `ParamMouthOpenY` (MouthWarp)
- ✅ `ParamBrowLY`, `ParamBrowRY` (EyebrowLWarp, EyebrowRWarp)
- ✅ `ParamHairFront/Side/Back` (HairFrontWarp, HairBackWarp)

**Missing warp specs** (32 parameters need warp deformers):
- **Face rotation**: `ParamAngleY` (pitch), `ParamAngleZ` (roll)
- **Eyes** (8): `ParamEyeLSmile`, `ParamEyeRSmile`, `ParamEyeBallX/Y`, `ParamEyeBallForm`, `ParamTear`
- **Brows** (6): `ParamBrowLX`, `ParamBrowRX`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowRForm`
- **Mouth** (1): `ParamMouthForm`
- **Body rotation** (2): `ParamBodyAngleY`, `ParamBodyAngleZ`
- **Arms & Breath** (10): `ParamBreath`, `ParamArmLA/RA`, `ParamArmLB/RB`, `ParamHandL/R`, `ParamShoulderY`
- **Bust** (2): `ParamBustX/Y`
- **Global** (4): `ParamCheek`, `ParamHairFluffy`, `ParamBaseX/Y`

To complete the rig, each missing parameter needs:
1. A new `WARP_SPECS` entry with `layerTags` targeting the relevant character parts
2. A corresponding `buildWarpKeyframes` warp type (e.g., `eye_gaze`, `eye_smile`, `bust_wobble`, etc.)

---

## 4. Shared invariants across all exporters

These contracts must hold regardless of target format:

| Invariant | Why it matters |
|-----------|---------------|
| Keyforms stored as `mesh_verts` tracks on the warp deformer node, keyed by time | All export paths read from the same source; no format-specific authoring |
| `computeParameterDrivenOverrides` is the single interpolation path | Preview and baked-export use identical math; no drift |
| `collectDescendants(parentId)` recurses through nested `warpDeformer` nodes | Parent warps always reach grandchild parts; all mesh parts are deformed by all ancestor warps |
| UV parameterization uses REST vertices, not current-warped positions | Each warp computes its delta independently; deltas accumulate: `final = rest + Σ(deltas)` |
| `warpDeformerParentId` found by ancestry walk, not just `part.parent` | Supports meshes nested arbitrarily deep inside groups under a warp deformer |
| Grid bounds initialization includes all descendants (recursive) | `autoGenerateWarpDeformers` uses bounding box collection through groups and warp deformers |
| "Fit to Children" remaps keyframe points proportionally when resizing | Maintains UV parameterization consistency: `new_pt = new_grid_origin + (old_relative_pos) * (new_size / old_size)` |
| Parameter `min/max` define the full deformation range | `.moc3` keyform binding bands, Spine animation duration, and `.cmo3` parameter all read the same field |

---

## 5. Files reference

| File | Role |
|------|------|
| `src/store/projectStore.js` | `warpDeformer` node schema, `createWarpDeformer`, parameter/physics CRUD |
| `src/store/parameterStore.js` | Runtime slider values (not persisted) |
| `src/renderer/animationEngine.js` | `computeParameterDrivenOverrides`, `interpolateMeshVerts`, `upsertKeyframe` |
| `src/components/canvas/CanvasViewport.jsx` | Bilinear warp pass in rAF loop |
| `src/components/canvas/WarpLatticeOverlay.jsx` | Canvas control-point editing UI |
| `src/components/canvas/GizmoOverlay.jsx` | Routes to `WarpLatticeOverlay` for warp deformer selection |
| `src/components/inspector/WarpDeformerPanel.jsx` | Grid size, bounds, parameter binding, "Fit to children" |
| `src/components/parameters/ParametersPanel.jsx` | Parameter sliders + binding management |
| `src/components/export/ExportModal.jsx` | Physics tab, `generateRig` toggle |
| `src/io/live2d/exporter.js` | Ancestry walk for `warpDeformerParentId`; passes `warpDeformerNodes` to `generateCmo3` |
| `src/io/live2d/cmo3writer.js` | Section 3b.0: native warp group → `CWarpDeformerSource` |
| `src/io/live2d/moc3writer.js` | `buildSectionData`: warp deformer sections (deformer, warp_deformer, warp_deformer_keyform); `generateMoc3`: quad_transforms output |
| `src/io/live2d/cmo3/physics.js` | `emitPhysicsSettings` accepts `rules` param |
| `src/io/exportSpine.js` | **TODO**: bake warp deform timelines; skip warp deformers in hierarchy (pass children to parent bone) |
