# Live2D Export — Progress Tracker

## Current Status: Baked Keyforms COMPLETE — .cmo3 Project Export (Session 11, 2026-04-15)

---

## Phase 0: Research & Foundation -- COMPLETE

- [x] Fork setup, remotes configured (origin=pelmentor, upstream=MangoLion)
- [x] Reference export analyzed (Hiyori: 24 parts, 134 art meshes, 70 params)
- [x] py-moc3 verified, MOC3 format fully mapped (100+ sections)
- [x] Data mapping drafted (see [ARCHITECTURE.md](ARCHITECTURE.md))

## Phase 1: Runtime Export (.moc3) -- COMPLETE

**Goal**: Export model that loads in Cubism Viewer and Ren'Py.

- [x] All JSON generators: .model3.json, .cdi3.json, .motion3.json
- [x] Texture atlas packer (MaxRects BSSF + auto-upscale)
- [x] .moc3 binary writer (V4.00, full section layout)
- [x] Main exporter + ZIP packaging
- [x] UI integration in ExportModal
- [x] **Renders correctly in Cubism Viewer 5.0** (20 drawables, correct textures)
- [x] Loads in Ren'Py (confirmed via log)

Key bugs fixed: field name swap (vertex_counts/position_index_counts), keyform binding chain, SDK validator quirks, SOT padding. See [MOC3_FORMAT.md](MOC3_FORMAT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 2: Project Export (.cmo3) -- COMPLETE

**Goal**: Export .cmo3 that opens in Cubism Editor 5.0 for further editing.

### Session 3: Initial .cmo3
- [x] CAFF container RE'd and implemented
- [x] Full texture pipeline (CLayeredImage → CLayer → CModelImage filter graph)
- [x] Java decompile fixes (LayeredImageWrapper, CPartSource self-ref, CDeformerGuid ROOT, etc.)
- [x] Opens in Cubism Editor without "(recovered)" status

### Session 4: Multi-mesh + JS port
- [x] Single-PSD pattern discovered (ONE CLayeredImage, N CLayers)
- [x] CAFF packer + .cmo3 generator ported to JavaScript
- [x] "Live2D Project" option in ExportModal
- [x] Real Stretchy Studio project exports with textures + correct draw order

### Session 5: Part hierarchy + parameters
- [x] Hiyori RE: 27 nested CPartSource, 70 params, 104 deformers (documented)
- [x] Groups → CPartSource with proper parent-child nesting
- [x] All project.parameters exported as CParameterSource
- [x] Error handling: failures shown in UI
- [x] **Confirmed in Cubism Editor 5.0** -- parts panel shows group hierarchy

### Session 6: Rotation deformers + upstream merge
- [x] Rotation deformers: one CRotationDeformerSource per group
- [x] Origin fallback: SS pivot → descendant mesh bounding box center → canvas center
- [x] Deformer chain follows group hierarchy (parent group → parent deformer)
- [x] Meshes under ROOT (canvas-space) — auto-parenting deferred
- [x] Critical finding: Live2D child positions in PARENT'S LOCAL coord space
- [x] Upstream merge (Spine export, anim curves, UI improvements)
- [x] Docs reorganized (README, ARCHITECTURE, archived sessions)

### Session 7: Auto-parenting + coordinate transforms
- [x] World-space pivot computation (using `makeLocalMatrix` / `mat3Mul` chain)
- [x] Deformer origins now in parent-relative local coords (matching Hiyori pattern)
- [x] Meshes auto-parented to their group's deformer (not ROOT)
- [x] Dual-position system: keyform positions in deformer-local, base positions in canvas space
- [x] **Confirmed in Cubism Editor 5.0** — rotation controllers move limbs correctly

### Session 8: Parameter bindings + animation wiring
- [x] Each rotation deformer bound to `ParamRotation_GroupName` parameter (range [-30, +30])
- [x] 3 keyforms per deformer: angle=-30°, angle=0° (rest), angle=+30°
- [x] KeyformBindingSource + KeyformGridSource structure matching Hiyori pattern
- [x] motion3json: rotation animation tracks mapped to ParamRotation_* parameter IDs
- [x] exporter.js builds parameterMap and passes to generateMotion3Json
- [x] **Confirmed in Cubism Editor 5.0** — parameter sliders control deformer rotation

## Phase 3: Animation Export -- COMPLETE

### Session 9: .can3 animation + warp deformers + XmlBuilder refactor
- [x] RE: Hiyori warp deformer structure (50 deformers, all 5×5 grids, IDW for vertex→grid mapping)
- [x] RE: Animations stored in .can3 (separate CAFF archive), NOT embedded in .cmo3
- [x] RE: .can3 format fully mapped (CAnimation → CSceneSource → CMvTrack_Live2DModel_Source → CMvAttrF with CBezierPt keyframes)
- [x] XmlBuilder extracted to shared module (`xmlbuilder.js`) for reuse across cmo3/can3 writers
- [x] Warp deformer generation in cmo3writer (CWarpDeformerSource, 3×3 grid, IDW, ParamDeform_*)
- [x] mesh_verts tracks wired to warp parameters in motion3json + exporter
- [x] can3writer.js — .can3 generator (CAnimation, CSceneSource, parameter keyframes)
- [x] Export pipeline: project export now produces ZIP with .cmo3 + .can3 when animations exist
- [x] .motion3.json generator exists (runtime export)
- [x] Parameters from animation tracks (rotation → ParamRotation_GroupName)

### Session 10: .can3 deserialization fixes + .cmo3 targetDeformer fix
- [x] Fix: `track` back-reference added to ALL ICMvEffect super blocks and ICMvAttr super blocks
- [x] Fix: CMvEffect_VisualDefault named fields (attrXY, attrScaleX, attrScaleY, attrRotate, attrAnchorXY, attrShear, attrOpacity, attrFrameStep, attrArtPathWidth)
- [x] Fix: Missing 4 attributes (shear, anchor CMvAttrPt, frameStep CMvAttrI, artPathWidth CMvAttrF)
- [x] Fix: attrMap placed inside ICMvEffect super (not on effect element)
- [x] Fix: EyeBlink/LipSync effect-specific fields (effectParameterAttrIds, invert, relative, syncTrackGuid)
- [x] Fix: parameterGroups → parameterGroupList for Live2DParameter effect
- [x] Fix: VisualDefault attrs use CMutableSequence with count=0 (matching Hiyori pattern)
- [x] Fix: Parts use "NOT INITIALIZED" GUID for targetDeformerGuid (was ROOT deformer GUID)
- [x] **Confirmed in Cubism Editor 5.0** — .can3 loads, model renders, animation plays on timeline
- [x] Fix: Mesh targetDeformerGuid uses jointBoneId's deformer (elbow/knee) when available
- [x] Fix: Keyform vertex positions computed in jointBone's deformer-local space
- [x] Explicit boneWeights/jointBoneId serialization in projectFile.js (defensive)
- [x] **Confirmed in Cubism Editor 5.0** — "recover targetDeformer" warnings eliminated
- [x] **RESOLVED**: Baked bone-weight keyforms (Session 11) — smooth elbow/knee bending via art mesh keyforms

### Session 11: Baked bone-weight keyforms + texture fix
- [x] Fix: Rest-position texture bug — exporter uses `restX/restY` (not deformed `x/y`) for vertex positions and UVs
- [x] Bone weight data passed from exporter (boneWeights array + elbow pivot coordinates)
- [x] Baked keyforms: art meshes with boneWeights get 3 keyforms bound to elbow rotation parameter
- [x] Vertex positions baked at -30°, 0°, +30° using `rotate(rest, angle × boneWeight, elbowPivot)` formula
- [x] Mesh parented to ARM deformer (shoulder), not elbow deformer — baked keyforms handle bending
- [x] Bone nodes (groups referenced as jointBoneId) skip rotation deformer creation — no orphan deformers
- [x] Baked angle range increased to ±90° (was ±30°) for more dramatic elbow bending
- [x] **Confirmed in Cubism Editor 5.0** — elbow parameter slider bends arm smoothly
- [ ] Handle .moc3 runtime keyforms (if needed for Ren'Py)

## Phase 4: Future Work

### Multi-bone calf/knee controllers for merged legs (USER REQUEST)

When a PSD has a single `legwear` layer (no `-l`/`-r` split), SS creates one `bothLegs` group with no knee bones. The user wants `leftKnee`/`rightKnee` bones as children of `bothLegs`, so that one monolithic leg mesh gets weight-based knee bending — same as how a monolithic arm mesh already gets elbow bending.

**Why it doesn't "just work" like elbows**: Each arm is a separate PSD layer (`handwear-l`/`handwear-r`) → separate mesh → single bone per mesh. Merged legs = ONE mesh → TWO bones (leftKnee + rightKnee). The current bone weight system supports one bone per mesh.

**Implementation plan**:
1. **armatureOrganizer.js**: Add `leftKnee`/`rightKnee` to `needGroup` when `bothLegs=true`. Parent them to `bothLegs`. Fix `CREATE_ORDER` so `bothLegs` comes before knees. Pivots already available (`kp.lKnee`, `kp.rKnee`).
2. **CanvasViewport.jsx**: Extend Remesh roleMap — `'bothLegs': ['leftKnee', 'rightKnee']`. For each vertex, assign to nearest knee (x-position heuristic: left-of-center → leftKnee, right → rightKnee). Compute weight per knee independently (distance-based blend along hip→knee axis). Store as `mesh.skinBones = [{ id, weights }, ...]`.
3. **SkeletonOverlay.jsx**: Support multi-bone rotation — iterate `skinBones` array, apply each bone's rotation independently per vertex.
4. **projectFile.js**: Save/load `skinBones` array (backwards compat: keep `jointBoneId`/`boneWeights` for single-bone).
5. **exporter.js + cmo3writer.js**: For multi-bone meshes, create 2D KeyformGridSource with N×M keyform grid (3×3=9 keyforms for two knees). Each keyform position = cumulative rotation from both bones. Since weights don't overlap (left knee weight=0 for right-side vertices), positions are independent per side.

**Estimated complexity**: Medium. armatureOrganizer change is trivial. The multi-bone weight system + 2D keyform grid is the bulk of the work.

**Workaround (current)**: Split `legwear` in PSD into `legwear-l` + `legwear-r`. SS automatically creates separate leg groups with knee bones. Everything works with existing single-bone code.

### Runtime enhancements
- [ ] .physics3.json generator (hair/clothing physics simulation)
- [ ] .pose3.json generator (part visibility toggle groups — e.g. outfit swaps)
- [ ] .exp3.json generator (facial expressions as parameter presets)
- [ ] Verify .motion3.json works with Ren'Py playback

### Project enhancements
- [ ] Multi-parameter keyform interpolation (2D parameter grids)
- [ ] Warp deformer animation (when SS supports mesh_verts keyframes)
- [ ] Full .cdi3.json with parameter groups
- [ ] Export validation (check for missing textures, empty meshes)

---

## Key Findings (for future reference)

1. **ICMvEffect and ICMvAttr both require `track` back-reference**: Every effect's ICMvEffect super and every attribute's ICMvAttr super must have `<CMvTrack_Live2DModel_Source xs.n="track" xs.ref="..." />` as the last child. Without this, Kotlin `lateinit` properties fail.

2. **CMvEffect_VisualDefault has named fields**: The Java class has specific instance variables (`attrXY`, `attrScaleX`, `attrScaleY`, `attrRotate`, `attrAnchorXY`, `attrShear`, `attrOpacity`, `attrFrameStep`, `attrArtPathWidth`) that must appear as direct children after the ICMvEffect super block.

3. **attrMap belongs inside ICMvEffect super**: Not as a direct child of the effect element.

4. **Parts use "NOT INITIALIZED" deformer GUID**: `uuid="00000000-0000-0000-0000-000000000000"` for targetDeformerGuid, not the ROOT deformer GUID.

5. **CFixedSequence is NOT ACValueSequence**: Only has `<d xs.n="value">`, no curMin/keyPts2/etc.

6. **CAnimation must be shared**: Main section references it via xs.ref, not inline.
