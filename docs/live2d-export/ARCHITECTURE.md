# Live2D Export — Architecture & Design

Design decisions, data mapping, and keyform binding system.

---

## Architecture Decisions

### ADR-001: Export module location
All Live2D export code in `src/io/live2d/`. Follows existing `src/io/` convention.

### ADR-002: JSON first, binary last
JSON formats (.model3.json, .cdi3.json, .motion3.json) implemented before .moc3 binary. JSON is inspectable and validates data mapping before binary serialization.

### ADR-003: Reference-driven development
Every feature starts by RE'ing the Hiyori reference export, then replicating. Never invent from scratch. Reference: `reference/live2d-sample/Hiyori/`.

### ADR-004: .moc3 version V4.00
Generate V4.00 (version=3). Matches Hiyori reference, required for `quad_transforms` SOT[101]. Compatible with Cubism SDK 4.0+ (Ren'Py 8.5 ships SDK 5.x).

### ADR-005: Rotation deformers with auto-parenting (Session 6-7)
~~MVP exports rest-pose vertices only.~~ As of Session 7, rotation deformers are exported per group with meshes auto-parented. Deformer origins use SS pivot positions (or descendant mesh bounding box center as fallback). Warp deformers and animation-driven parameters remain future work.

### ADR-006: py-moc3 as format reference
`Ludentes/py-moc3` is authoritative for .moc3 binary layout. Verified read+write implementation with correct section ordering.

### ADR-007: Atlas packing — MaxRects BSSF + auto-upscale
Crop parts to opaque bounds, binary-search for max uniform scale factor, pack with MaxRects Best Short Side Fit.

### ADR-008: Single-PSD texture pattern (.cmo3)
Session 4 discovery: Cubism Editor requires ONE CLayeredImage with N CLayers inside one CLayerGroup. N separate CLayeredImages = geometry visible but NO textures. See [CMO3_FORMAT.md](CMO3_FORMAT.md) for details.

### ADR-009: Generic parameter bindings for rotation deformers (Session 8, updated Session 11)
Each rotation deformer gets a `ParamRotation_GroupName` parameter with range [-30, +30] and 3 keyforms. Baked keyforms (art mesh bone-weight bending) use a wider range [-90, +90] for more dramatic elbow/knee motion. This is "Approach B" from the session prompt — generic ranges that give the user a controllable model immediately. Hiyori uses tuned per-deformer ranges, but generic ranges let users adjust in Editor. The `KeyformBindingSource` structure matches Hiyori exactly (circular ref with `KeyformGridSource`, `KeyOnParameter` with keyIndex, LINEAR interpolation).

### ADR-010: Part hierarchy mapping (.cmo3)
Session 5: Stretchy Studio groups map to CPartSource with nested parent-child relationships. Root Part → CPartGuid children (groups) → CDrawableGuid children (meshes). Meshes without a group go directly under Root Part.

---

## Data Mapping: Stretchy Studio to Live2D

### Part (with mesh) to ArtMesh

| Stretchy Studio | .moc3 field | Notes |
|-----------------|-------------|-------|
| `node.id` | `art_mesh.ids` | Generated as `ArtMesh0`, `ArtMesh1`, etc. |
| `node.name` | `.cdi3.json` display name | Human-readable |
| `mesh.vertices.length` | `art_mesh.position_index_counts` | Rendering vertex count (misleading name!) |
| `mesh.triangles.length * 3` | `art_mesh.vertex_counts` | Flat index count (misleading name!) |
| `mesh.vertices` | `keyform_position.xys` | Normalized: `(px - origin) / PPU` |
| `mesh.uvs` | `uv.xys` | Remapped from PSD-space to atlas-space |
| `mesh.triangles` (flat) | `position_index.indices` | Int16 triangle indices |
| `node.opacity` | `art_mesh_keyform.opacities` | Float 0-1 |
| `node.parent` | `art_mesh.parent_part_indices` | Index into parts array |
| Texture atlas | `art_mesh.texture_indices` | Atlas sheet index |
| — | `art_mesh.drawable_flags` | Always 4 (Hiyori pattern) |

### Group to Part (visibility group)

| Stretchy Studio | .moc3 / .cmo3 field | Notes |
|-----------------|---------------------|-------|
| `node.id` | Part ID | 64-byte string in .moc3, CPartId in .cmo3 |
| `node.name` | `.cdi3.json` display name | |
| `node.parent` | Parent part index / parentGuid | Nested hierarchy |

### Animations to .motion3.json

| Stretchy Studio | .motion3.json | Notes |
|-----------------|---------------|-------|
| `animation.duration` | `Meta.Duration` | Convert ms to seconds |
| `animation.fps` | `Meta.Fps` | Direct |
| Track keyframes | `Curves[].Segments` | Segment encoding: 0=linear, 1=bezier, 2=stepped |

### Files per Runtime Export

| File | Required | Content |
|------|----------|---------|
| `*.model3.json` | Yes | Manifest referencing all files |
| `*.moc3` | Yes | Binary model data |
| `*.png` (atlas) | Yes | Packed textures |
| `*.cdi3.json` | Optional | Display info (names) |
| `*.motion3.json` | Optional | Animations |

---

## Keyform Binding System

Every visible ArtMesh MUST have a keyform binding (or a parent deformer that has one). Without bindings, Cubism SDK loads the model but does not apply vertex positions.

### Binding Chain (.moc3)

```
ArtMesh[i]
  → keyform_binding_band_indices[i] → band_idx
    → band.begin_indices[band_idx] → bind_start
    → band.counts[band_idx] → bind_count
      → binding_index.indices[bind_start..+bind_count] → binding_idx
        → binding.keys_begin[binding_idx] → key_start
        → binding.keys_counts[binding_idx] → key_count
          → keys.values[key_start..+key_count] → parameter values
```

### Critical Rules

1. **keys_count == keyform_count**: For a mesh with N keyforms and a binding with K keys, K must equal N.

2. **Parts use null bands (count=0)**: Parts never have direct parameter bindings. Sharing a non-null band between Part and ArtMesh crashes the SDK.

3. **Band separation**: ArtMesh bands at indices 0..M-1, Part bands at M..M+P-1 (all count=0).

4. **SDK validator quirk**: `begin < total` checked even when `count=0`. Null band begin must be `0` (not `N`). Mask begin must be `0` with `DRAWABLE_MASKS >= 1` (dummy entry).

### Minimum Binding for Static Models

Per ArtMesh: 1 band (count=1) → 1 binding_index → 1 binding (keys_count=1) → 1 key at parameter default value.

### Coordinate System

- `keyform_position.xys`: Normalized to PPU: `position = (pixel - origin) / ppu`
- Ren'Py shader: `gl_Position = a_position.xy * u_live2d_ppu`

---

## .cmo3 Texture Pipeline

```
CLayeredImage (one "PSD")
  └─ CLayerGroup (root)
      └─ CLayer per mesh
          └─ CImageResource (canvas-sized PNG)

CTextureManager
  └─ _rawImages: [LayeredImageWrapper → CLayeredImage]
  └─ _modelImageGroups: [CModelImageGroup]
      └─ _modelImages: [CModelImage per mesh]
          └─ ModelImageFilterSet (CLayerSelector → CLayerFilter)
              └─ CLayerSelectorMap → specific CLayer
```

Each CModelImage's filter env selects which CLayer to render via CLayerSelectorMap, keyed by the shared CLayeredImageGuid.

---

## .cmo3 Part Hierarchy

Hiyori pattern (27 parts):

```
Root Part (__RootPart__)
  └─ _childGuids: CPartGuid refs (child groups)
      └─ Each child CPartSource:
          ├─ parentGuid → parent's CPartGuid
          └─ _childGuids: mix of CDeformerGuid + CDrawableGuid
```

`_childGuids` can contain: CPartGuid (sub-groups), CDeformerGuid (deformers), CDrawableGuid (meshes).

Stretchy Studio mapping: group nodes → CPartSource. Ungrouped meshes → Root Part._childGuids directly.

---

## Coordinate Spaces & Deformer Parenting (Session 6-7 Findings)

### The Dual-Position System (CRITICAL TRAP)

Each CArtMeshSource in .cmo3 has **two separate position arrays**:

| Array | Coordinate Space | Purpose |
|-------|-----------------|---------|
| `CArtMeshSource > positions` | **Canvas pixel space** | Texture mapping, base reference |
| `CArtMeshForm > positions` (in keyforms) | **Parent deformer's local space** | Rendering, deformation |
| `GEditableMesh2 > point` | **Canvas pixel space** | Editing, texture baking |

**TRAP**: Setting all three to the same space breaks either textures (if all deformer-local) or deformation (if all canvas). Discovered in Session 7 after empty-texture debugging.

Evidence from Hiyori ArtMesh102 (parented to Rotation22):
- `meshSrc > positions`: `1184.7, 2314.2, ...` (canvas pixel coords, 2976x4175 canvas)
- `keyform > positions`: `109.9, 39.9, ...` (deformer-local, small relative values)

### Deformer Origin Coordinate Chain

Each CRotationDeformerForm's `originX/originY` is in its **parent deformer's local space**, not canvas space. For nested deformers:

```
Canvas origin (0, 0)
  └─ Deformer A: origin = (500, 300) in canvas space
      └─ Deformer B: origin = (100, -50) in A's local space
          └─ Mesh: vertices in B's local space
              vertex_local = vertex_canvas - B_world_origin
              B_world_origin = A_origin + B_local_origin = (600, 250)
```

### Computing World-Space Pivot from SS Transform

SS group transform: `T(x+pivotX, y+pivotY) × R(rotation) × S(scaleX, scaleY) × T(-pivotX, -pivotY)`

The pivot point (rotation center) always maps to `(x + pivotX, y + pivotY)` in parent space, regardless of rotation/scale. In world space:

```javascript
const worldMatrix = computeWorldMatrices(groups); // from transforms.js
const pivotWorld = worldMatrix × [pivotX, pivotY, 1];
```

### Auto-Parenting Transform

To parent a mesh to its group's deformer (rest pose, angle=0, scale=1):

```javascript
// 1. Compute deformer world origin (canvas space)
const dfWorldOrigin = deformerWorldOrigins.get(parentGroupId);

// 2. Keyform positions: canvas → deformer-local
const localX = canvasX - dfWorldOrigin.x;
const localY = canvasY - dfWorldOrigin.y;

// 3. Base positions + editable mesh: keep in canvas space (for textures)
// 4. UVs: keep as computed from canvas positions (texture mapping)
```

### Key Reference

- Live2D parent-child docs: https://docs.live2d.com/en/cubism-editor-manual/system-of-parent-child-relation/
- Hiyori reference: `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
- SS transforms: `src/renderer/transforms.js` (makeLocalMatrix, computeWorldMatrices)

---

## Bone Weights → Baked Keyforms (Session 10 Design Decision)

### The Problem

SS uses per-vertex bone weights on monolithic limb meshes. A single arm piece has vertices weighted 0→1 from shoulder to wrist, and the elbow controller bends the arm by rotating each vertex by `angle × weight`.

Live2D has **no native bone weight system**. Rotation deformers rotate all child content as a rigid body. Exporting an arm with a rotation deformer produces rigid rotation of the entire limb — no smooth bending.

### Options Considered

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A: Mesh splitting** | Split mesh at weight=0.5 boundary into two art meshes | Standard Live2D setup, easy to refine | Complex (triangle splitting, UV recomputation, visible seam) |
| **B: Baked keyforms** | Store pre-computed weighted vertex positions as art mesh keyforms | Preserves single mesh, smooth result, simpler implementation | Non-standard (but editable in Cubism Editor) |
| **C: Manual** | Export deformers only, user splits/deforms in Cubism Editor | Minimal implementation | Defeats purpose of SS as rigging tool |

### Decision: Option B — Baked Keyforms

**Rationale**: SS's core value is "rig quickly, export working puppet." Users have monolithic limb pieces (one PSD layer per arm) — that's the default armature wizard workflow. Baked keyforms give them a working elbow out of the box, and they can refine vertex positions in Cubism Editor if needed.

### Architecture (Session 11 — Implemented)

```
Deformer hierarchy:
  Rotation_rightArm (shoulder — rotates whole arm)
    └─ [no elbow deformer — bone nodes skip deformer creation]

Art mesh (handwear-r):
  - Parented to: Rotation_rightArm deformer
  - Bound to parameter: ParamRotation_rightElbow
  - 3 keyforms:
    - At param=-90: each vertex at rotate(rest, -90° × boneWeight, elbowPivot)
    - At param=0:   rest positions
    - At param=+90: each vertex at rotate(rest, +90° × boneWeight, elbowPivot)
```

### Vertex Position Computation

For each vertex `i` at keyform angle `θ`:
```javascript
const w = boneWeights[i];          // 0 (shoulder end) → 1 (wrist end)
const wθ = θ × w × (π / 180);     // weighted angle in radians
const dx = restX[i] - elbowPivotX; // relative to elbow pivot
const dy = restY[i] - elbowPivotY;
const cos = Math.cos(wθ), sin = Math.sin(wθ);
keyformX[i] = elbowPivotX + dx * cos - dy * sin;
keyformY[i] = elbowPivotY + dx * sin + dy * cos;
```

All positions are in the parent deformer's local space (arm deformer-local, matching the dual-position system).

### Integration Points

1. **exporter.js**: Pass `boneWeights`, `jointBoneId`, `jointPivotX/Y` per mesh to cmo3writer
2. **cmo3writer.js**: For meshes with boneWeights:
   - Pre-create bone rotation parameters (before per-mesh loop)
   - Skip rotation deformer creation for bone nodes (no orphan deformers)
   - Keep mesh under parent arm deformer (NOT elbow deformer)
   - 3-keyform KeyformGridSource bound to bone rotation parameter (keys: -90, 0, +90)
   - Compute baked vertex positions per keyform
3. **moc3writer.js**: Same keyform pattern for runtime export (TODO)
4. **motion3json.js**: Elbow rotation tracks already map to ParamRotation_* (no change needed)

### Future: Multi-bone Baked Keyforms (bothLegs with two knees)

When a monolithic `legwear` mesh needs two knee bones, the single-bone baked keyform approach extends to a 2D parameter grid:

```
Art mesh (legwear):
  - Parented to: Rotation_bothLegs deformer (or ROOT)
  - Bound to TWO parameters: ParamRotation_leftKnee × ParamRotation_rightKnee
  - 3×3 = 9 keyforms (all combinations of -90°, 0°, +90° for each knee)
  - Each vertex assigned to exactly ONE knee (left-of-center → leftKnee, right → rightKnee)
  - Since weights don't overlap, rotations are independent per side

mesh.skinBones = [
  { id: leftKneeId, weights: [0, 0, 0.5, 1.0, 0, 0, ...] },  // left-side verts only
  { id: rightKneeId, weights: [0, 0, 0, 0, 0.5, 1.0, ...] },  // right-side verts only
]
```

See `docs/live2d-export/sessions/SESSION12_PROMPT.md` for full implementation plan.

---

## Warp Deformers (Session 9 Findings)

### Hiyori Warp Deformer Pattern

All 50 warp deformers in Hiyori use 5×5 grids (36 control points × 2 = 72 floats). Key observations:

- **Coordinate space depends on parent**: under a warp deformer → 0-1 normalized; under a rotation deformer → pixel offsets from parent origin
- **CWarpDeformerBezierExtension**: 2 per deformer (editLevel 2 and 3), can skip for MVP
- **Same KeyformBindingSource pattern** as rotation deformers (circular ref with KeyformGridSource)

### SS → Warp Deformer Mapping

For meshes with `mesh_verts` animation tracks (vertex deformation keyframes):

1. Create CWarpDeformerSource (3×3 grid = 16 control points) parented under mesh's rotation deformer
2. Re-parent mesh to warp deformer (warp sits between rotation deformer and mesh)
3. Grid positions computed via IDW (inverse distance weighting) from vertex deltas
4. Parameter `ParamDeform_MeshName` with range [0, N-1] drives keyform selection
5. motion3.json maps time → keyframe index via linear curve

**Note**: This feature is dormant — SS vertex deformation keyframes require specific workflow (animation mode + mesh edit + deform sub-mode + brush drag). Normal limb animations use group rotation tracks.

---

## .can3 Animation Format (Session 9 RE)

### Container
Same CAFF archive as .cmo3 — single `main.xml`, XOR obfuscated, ZIP compressed. Existing `caffPacker.js` works.

### XML Structure
```
root
  shared/
    CSceneSource (one per animation clip)
    CMvTrack_Group_Source (root track per scene)
    CMvTrack_Live2DModel_Source (model track per scene)
    CMvAttrF (parameter animation attributes — Bezier keyframes)
    CMvAttrPt (xy position attribute)
    CMvEffect_Live2DParameter (contains all param attributes)
    CMvEffect_Live2DPartsVisible (part visibility)
    CMvEffect_VisualDefault (track-level transforms: xy, scale, rotate, opacity)
    CResourceManager → CResource_Linked_Model (links to .cmo3 file)
    CAnimation (root animation container)
  main/
    CAnimation xs.ref="..." (reference to shared CAnimation)
```

### Keyframe Format (CBezierPt)
```xml
<CBezierPt>
  <CSeqPt xs.n="anchor">
    <i xs.n="pos">6</i>          <!-- frame number -->
    <d xs.n="doubleValue">-8.0</d> <!-- parameter value -->
  </CSeqPt>
  <CBezierCtrlPt xs.n="next">     <!-- right bezier handle -->
    <f xs.n="posF">8.333</f>      <!-- frame (float) -->
    <d xs.n="doubleValue">-8.0</d>
  </CBezierCtrlPt>
  <CBezierCtrlPt xs.n="prev">     <!-- left bezier handle -->
    <f xs.n="posF">4.0</f>
    <d xs.n="doubleValue">-8.0</d>
  </CBezierCtrlPt>
</CBezierPt>
```

### Critical Discoveries
1. **CFixedSequence ≠ ACValueSequence**: CFixedSequence only has `<d xs.n="value">`, NOT curMin/keyPts2/etc.
2. **CAnimation must be shared**: main section just references it via xs.ref
3. **Parameter IDs prefixed**: `live2dParam_ParamRotation_*` in can3, not bare `ParamRotation_*`
4. **Frame-based positions**: keyframes use integer frame numbers, not milliseconds

### .can3 Deserialization Rules (Session 10 — all RESOLVED)

These rules were discovered by node-by-node diff with Hiyori's .can3 after three cascading NPEs:

**Rule 1: Every ICMvAttr and ICMvEffect needs `track` back-reference**

The Kotlin classes have a `lateinit var track` property. The XML deserializer sets it from `<CMvTrack_Live2DModel_Source xs.n="track" xs.ref="..." />` which must be the **last child** of every `ICMvAttr > super` and `ICMvEffect > super` block. Without it → `UninitializedPropertyAccessException`.

**Rule 2: CMvEffect_VisualDefault has 9 named fields**

After the `ICMvEffect` super block, the Java class expects these specific named attribute references as direct children:
```xml
<CMvAttrPt xs.n="attrXY" xs.ref="..." />
<CMvAttrF xs.n="attrScaleX" xs.ref="..." />
<CMvAttrF xs.n="attrScaleY" xs.ref="..." />
<CMvAttrF xs.n="attrRotate" xs.ref="..." />
<CMvAttrPt xs.n="attrAnchorXY" xs.ref="..." />
<CMvAttrF xs.n="attrShear" xs.ref="..." />
<CMvAttrF xs.n="attrOpacity" xs.ref="..." />
<CMvAttrI xs.n="attrFrameStep" xs.ref="..." />
<CMvAttrF xs.n="attrArtPathWidth" xs.ref="..." />
```
Without these → NPE in `CMvEffect_VisualDefault.deserialize()`.

**Rule 3: `attrMap` belongs inside ICMvEffect super**

The `<hash_map xs.n="attrMap">` must be a child of `ICMvEffect > super`, not a direct child of the effect element. Each entry needs `xs.n="key"` on CAttrId and `xs.n="value"` on the attribute ref.

**Rule 4: VisualDefault attrs use CMutableSequence**

Even for constant (non-animated) transform attributes, Hiyori uses `CMutableSequence` with `count="0"` points — not `CFixedSequence`. The full ACValueSequence super block is required (curMin, curMax, posStart, keyPts2, keyMin, keyMax, lastValue, lastPos, attr back-ref, baseValue).

**Rule 5: Effect-specific fields after ICMvEffect**

Each effect type has its own fields after the generic ICMvEffect super:
- **EyeBlink**: `effectParameterAttrIds` (carray_list), `invert` (bool), `relative` (bool)
- **LipSync**: `effectParameterAttrIds` (carray_list), `syncTrackGuid` (null), `isInvert` (bool), `isRelative` (bool)
- **Live2DParameter**: `parameterGroupList` (carray_list of CMvParameter_Group) — NOT "parameterGroups"
- **PartsVisible**: no extra fields needed

**Rule 6: Parts use "NOT INITIALIZED" deformer GUID**

CPartSource's `targetDeformerGuid` must point to `uuid="00000000-0000-0000-0000-000000000000"` (note="NOT INITIALIZED"), not the ROOT deformer GUID. Using the ROOT GUID causes "recover targetDeformer: deformer=null" warnings.
