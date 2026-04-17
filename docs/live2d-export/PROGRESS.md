# Live2D Export — Progress Tracker

## Current Status: Face chain complete — parallax + AngleZ head tilt working (Session 20, 2026-04-17)

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

## Phase 5: Standard Live2D Rig — IN PROGRESS

### Session 12: Standard parameters + warp deformer research (2026-04-16)
- [x] Upstream merge (audio tracks, shapekeys, IndexedDB save/load, preferences modal)
- [x] Template & 3D parallax research documented (TEMPLATES.md — 500+ lines)
- [x] SS already has full semantic classification via KNOWN_TAGS + boneRole
- [x] "Generate standard Live2D rig" checkbox added to ExportModal (default: on)
- [x] 18 standard parameter IDs added when checkbox enabled (ParamAngleX/Y/Z, ParamBody*, ParamEye*, ParamBrow*, ParamMouth*, ParamHair*)
- [x] **Confirmed in Cubism Editor 5.0** — standard params visible in palette, model not broken
- [x] Warp deformer coordinate system reverse-engineered from Java bytecode
- [x] **KEY FINDING**: Warp local space = always 0..1 (`GRectF(0,0,1,1)` in transformCanvasToLocal)
- [x] Warp grid positions = parent deformer space; mesh keyform positions = 0..1 warp local
- [x] Documented in WARP_DEFORMERS.md
- [ ] Extend to all face/body parts per TAG_DEFORMER_SPEC

### Session 13: Warp deformers working (2026-04-16)
- [x] ROOT warp grid space determined from Hiyori "Body Warp Z" — **canvas pixel space, CoordType "Canvas"**
- [x] Child warp grid space confirmed — parent's 0..1 space, CoordType "DeformerLocal"
- [x] Mesh keyforms under warp — always 0..1 warp-local, CoordType "DeformerLocal"
- [x] Single topwear warp deformer implemented (3×3 grid, ROOT parent, section 3c in cmo3writer)
- [x] **Precision bug found & fixed**: 0..1 keyform positions need toFixed(6), not toFixed(1) — toFixed(1) caused "chewed" texture
- [x] **Confirmed in Cubism Editor 5.0** — topwear visible, textured, grid draggable, deforms correctly
- [x] WARP_DEFORMERS.md updated with ROOT space resolution + precision trap
- [x] SESSION14_PROMPT.md written — extend warps to limbs, head, face
- [x] Extend to all body/limb parts (Phase 1) — **37 tags** in RIG_WARP_TAGS Map
- [x] Extend to all face/head parts with per-part grid sizes (Phase 2) — per-tag col×row from TEMPLATES.md
- [x] **Confirmed in Cubism Editor 5.0** — all parts have warp deformers, grid draggable

### Session 14: Body Warp hierarchy + parameter bindings (2026-04-16)
- [x] RIG_WARP_TAGS converted from Set to Map with per-tag {col, row} grid sizes
- [x] Baked-keyform meshes (arms/legs) skipped from per-part warps
- [x] ParamBreath working on body parts — confirmed chest-rise effect in Cubism Editor
- [x] ParamBodyAngleX working — lean effect on body parts confirmed
- [x] **KEY LEARNING**: per-part body/breath bindings cause tearing (each part shifts independently)
- [x] **KEY LEARNING**: Hiyori uses ONE structural Body Warp wrapping everything, not per-part bindings
- [x] Structural Body Warp created but BROKEN (wrong architecture — single 2D grid instead of 3-chain)

### Session 15: 3-Chain Architecture + Artistic Body Parameters (2026-04-16)
- [x] **Deep Hiyori investigation**: 3 chained structural warps, NOT one 2D parameter grid
- [x] **3-chain implemented**: Body Z (ParamBodyAngleZ, Canvas) → Body Y (ParamBodyAngleY, DeformerLocal) → Breath (ParamBreath, DeformerLocal)
- [x] **Body X Warp as 4th structural layer**: Breath → Body X → all children. Body bowing effect matching Hiyori.
- [x] **Bug 1 fixed**: array-based re-parenting replaces `_pendingBodyWarpPatch` flag
- [x] **Bug 2 fixed**: rotation deformer origins converted via `canvasToBodyXX/Y` (4-chain inverse)
- [x] **CoordType fix**: rotation deformers patched from "Canvas" to "DeformerLocal" when re-parented
- [x] **Body Warp Z grid**: computed from actual mesh bounding box (not hardcoded canvas percentages)
- [x] **Flattened hierarchy matching Hiyori**: no torso/eyes rotation deformers; neck/arms target Breath directly
- [x] **Leg exclusion**: `LEG_ROLES` set keeps legs at ROOT; `FEET_FRAC=0.75` pins lower legs completely
- [x] **Artistic Body Z**: spine-curve bowing from belly pivot, progressive (groin slight → head max), lower legs static
- [x] **Artistic Body Y**: bell-curve compression/stretch, center columns shift most, asymmetric magnitude
- [x] **Artistic Body X**: body bowing (center lean + edge counter-shift), Hiyori-matching pattern
- [x] **Breath**: chest compression effect, ~10× Hiyori's values for visibility on smaller canvases
- [x] **Confirmed in Cubism Editor 5.0**: all 4 body params produce visible, artistic effects
- [x] WARP_DEFORMERS.md enriched with "Structural Warp Chain" section (exact Hiyori values)
- [ ] Per-part warps still target Body X (not group rotation deformers) — face/head rotation not connected yet
- [ ] Standard params (ParamAngleX/Y/Z, ParamEye*, ParamBrow*, ParamMouth*, ParamHair*) — created but not bound to anything

**KEY FINDINGS (Session 15):**
1. Hiyori has NO torso rotation deformer — body lean via Body X Warp
2. Hiyori has NO eyes rotation deformer — eyes via warp/parallax
3. ParamBodyAngleX is a per-part warp child of Breath, NOT on structural chain
4. Face Rotation in Hiyori uses 2D ParamAngleX × ParamAngleY grid (9 keyforms)
5. ParamAngleZ is NOT on any rotation deformer — it's on hair warps only
6. Legs at ROOT, independent of body rotation
7. Per-part warps targeting rotation deformers cause "tiny parts" bug (coordinate space mismatch) — deferred

### Session 16: Per-Part Parameter Bindings (2026-04-17)

Goal: bind standard face/head parameters (ParamHair*, ParamBrow*, ParamEyeBall*, ParamEyeOpen) to per-part warps.

- [x] **Deep Hiyori investigation**: 5 parallel subagents mapped every face deformer
- [x] Found Hiyori's actual patterns for iris, brows, mouth, hair, eye open/close
- [x] Mapped complete face hierarchy (Face Rotation → 11+ child warps, each with AngleX×AngleY parallax)
- [x] Documented architectural insight: nose/ears/contour only get face parallax, no own params
- [x] **Hair swing** (ParamHairFront/HairBack): 1D tips-swing, quadratic Y curl — working
- [x] **Brow position** (ParamBrowLY/RY): 1D uniform Y translate (15% of grid height) — working
- [x] **Iris position** (ParamEyeBallX/Y): 2D uniform translate (9% X, 7.5% Y) — working
- [x] **Eye open/close** (ParamEyeLOpen/ROpen): parabola-fit zipper curve from eyewhite bottom — working
- [x] **Right eye symmetry**: all three parts (-r) use same curve infrastructure
- [x] **Extended smart closure**: covers all 6 eye part meshes (L and R), plus generic `eyelash`/`eyewhite`/`irides`
- [x] Generic 1D/2D binding framework in cmo3writer.js (N keyforms via keyCombos dispatch)
- [x] meshCtx pre-pass: curve sampled from matching eyewhite (fallback: eyelash)
- [x] Linear extrapolation for wing vertices beyond curve X range
- [x] SESSION16_FINDINGS.md — 700+ lines documenting investigation + implementation
- [ ] **Mouth open** (ParamMouthOpenY) — deferred to Session 17

**KEY FINDINGS (Session 16):**
1. **Eyewhite bottom = lower eyelid = closure line** (NOT eyelash's lower edge, which is UPPER eye opening)
2. **Parabola fit** (least-squares, Cramer's rule) produces smooth anatomical curve from noisy bin data
3. **Bin-max-Y** (not percentile) extracts true mesh boundary without interior triangulation noise
4. **Normalize X to [-1, 1]** before parabola fit — avoids x⁴ overflow for canvas coords
5. **Sample within fit-data X range only** — extrapolating parabola beyond data diverges quadratically
6. **Linear extrapolation of curve** at wings (slope of first/last segment) — natural eye corner shape
7. **factor = k** (linear) for all eye parts → all collapse to SAME line at closed. `factor = 0.05 + 0.95*k` caused parallel lines.
8. **Full bbox (no percentile filter)** for face parts — percentile caused outlier vertex extrapolation peaks
9. **Hiyori patterns**: iris 2D EyeBallY×X, brow 4-layer chain, mouth is mesh-vertex-only, hair 3-layer (parallax→AngleZ→swing)

### Session 17: Mouth + Per-Vertex Eye Closure (2026-04-17)

Goal: mouth open + optional mouth form + iris gaze fix. Expanded into architectural pivot for eye closure.

- [x] **Mouth open** (ParamMouthOpenY) — warp-grid Y-stretch from top pivot, quadratic acceleration
- [x] **Eye closure refactor**: switched from warp-grid keyforms to per-vertex CArtMeshForm
- [x] **Static band algorithm**: eyelash bottom contour offset upward by 5% of mesh height = band upper Y
- [x] **Eyelash closure**: above-band vertices clamp to bandY, at/below stay (keeps visible lash thickness)
- [x] **Eyewhite/iris closure**: ALL vertices snap to bandY (fully hidden behind lash)
- [x] **Upward shift**: closed state shifted up by 10% of mesh height for natural positioning
- [x] **Both sides** (L and R): mirrored logic, each eyelash's own band extracted per side
- [x] **RigWarp passthrough**: removed `eyelash-l/r`, `eyewhite-l/r`, `irides-l/r` from `TAG_PARAM_BINDINGS` — their warps are now identity pass-throughs; mesh deforms itself
- [x] SESSION17_FINDINGS.md — architecture pivot, discarded approaches, tuning knobs
- [ ] ParamMouthForm — deferred
- [ ] Iris gaze during closure — deferred to Session 18 (restored there)

### Session 18: Iris Gaze Restore (2026-04-17)

Goal: re-enable ParamEyeBallX/Y on the iris after Session 17's mesh-level closure refactor stripped the old warp binding.

- [x] Added `irides-l` / `irides-r` entries to `TAG_PARAM_BINDINGS` with 2D `ParamEyeBallX × ParamEyeBallY` bindings (9 keyforms per iris, 3×3 grid)
- [x] Pure uniform translation: every grid point shifts by `(kX × gxSpan × 0.09, -kY × gySpan × 0.075)` — Hiyori-referenced magnitudes
- [x] No nested warps needed: closure stays at the CArtMeshSource level (Session 17), gaze lives on the RigWarp above
- [x] **Confirmed in Cubism Editor 5.0** — user reports "eyeballs move"
- [ ] Face parallax (ParamAngleX/Y on every face part) — still deferred

**KEY FINDING (Session 18):**
- Closure and gaze are **independent transformations on separate layers** (mesh-level vertex keyforms vs warp-level grid keyforms). They can coexist in the same deformer chain without stacking warps or combining parameters into a single 3D keyform grid. When the iris is closed (mesh collapses behind the lash), the warp still translates — but the translation isn't visible because the iris is hidden. This clean separation is what made the Session 17 passthrough pattern worth breaking for this one feature.

### Session 19: Face Parallax — research + ship (2026-04-17)

Goal: add `ParamAngleX/Y` face parallax matching Hiyori's 3D-rotation illusion. Started as implementation of Option B (procedural 3D projection with per-part depth, 7 warps). Pivoted mid-session after user testing revealed per-warp approaches look "monolithic" regardless of rotation math. Shipped a **single-warp Body-X-pattern** version.

**Research phase (first):**
- [x] **Verified Hiyori's face parallax** directly from `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
- [x] **Corrected Session 18 errors**: magnitudes off ~30×; translation non-uniform; Hair Back nested in Hair Front, Ear L in Ear R; grid is 6×6 (col=5,row=5 means 5×5 Bezier patches); ParamAngleZ range ±10 not ±30
- [x] Documented chain, grid structure, depth ordering (Hair Back deepest → Ears shallowest)
- [x] Four options evaluated (A=copy data, B=procedural 3D, C=uniform translation, D=phased)
- [x] SESSION19_FINDINGS.md Part I written (research, options, decision)
- [x] SESSION19_PROMPT.md marked SUPERSEDED

**Implementation phase (pivoted):**
- [x] Option B attempted — 7 FaceParallax warps, per-part 3D rotation around face pivot. Face parts displaced to chest when routed through Face Rotation deformer → FaceParallax retargeted to Body X directly (Face Rotation emitted but unused; bypass preserved for future fix).
- [x] Option B (bypassed Face Rotation) worked structurally but user feedback: movement looked "monolithic", "pieces moving independently", "no deformation parallax happening".
- [x] Attempted shared-pivot 3D rotation across warps — still felt discrete because Cubism treats each warp as an independent field (can't interpolate between warps).
- [x] **Pivot: collapsed 7 warps into ONE FaceParallax warp** covering the union face bbox. All face rig warps re-parent to it. Matches user's "Blender proportional-edit with smooth falloff" mental model.
- [x] **Adopted Session 15 Body-X pattern** for the single warp's keyform deformation: parametric `1.5·sin(π·cf) - 0.5` bow, uniform across the grid. User confirmed: "It works fine."
- [x] **Artistic enhancement pass**: layered four effects (Body Z/Y pattern) — base bow + asymmetric perspective + cross-axis Y-on-AngleX (tilt while turning) + row/column fade. User confirmed: "It's okay for now."
- [x] SESSION19_FINDINGS.md Part II written — implementation journey, key lessons, deferrals
- [x] **Confirmed in Cubism Editor**: single-warp face parallax on AngleX/Y producing a coherent 3D rotation illusion on the user's test character
- [x] **Face Rotation shipped in Session 20** — coord-space resolved; chain is Body X → Face Rotation → FaceParallax → face rig warps. ParamAngleZ tilts head around chin pivot. User-confirmed in Cubism Editor.
- [ ] **Deferred: per-part depth parallax** — collapsed into single-warp. If hair-back-moves-more-than-ears effect is wanted, add spatial depth mapping (vary deformation magnitude by grid region) in a future session.
- [ ] **Deferred: nesting** (Hair Back in Hair Front, Ear L in Ear R, as Hiyori has) — not needed for current character roster.

**KEY FINDINGS (Session 19):**
1. **Cubism warps don't interpolate between each other.** For coherent deformation across a region, use ONE warp. This is structural — no amount of shared rotation math across multiple warps will look continuous. The user's "pieces moving independently" feedback pointed directly at this.
2. **Reference-first means "copy what already works in your own code too."** Session 15 Body X was the nearest precedent. When the user pushed back on invented approaches, copying Body X's pattern (sine bow + non-uniform deformation) directly shipped.
3. **Richer formula on single warp > simple formula on many warps.** The shipped deformation (base bow + asymmetric perspective + cross-axis shift + row/col fade) runs on ONE warp and beats anything the 7-warp Option B produced.
4. **Per-part depth is a refinement, not a prerequisite.** A coherent single-warp deformation without per-part depth feels better than depth-varied independent pieces. Spatial depth mapping inside the single warp can add per-region parallax later.
5. **User feedback loop was load-bearing.** Every iteration was driven by concrete visual feedback — implement → export → open Cubism → iterate. Without that loop, I'd have shipped the technically-correct-but-visually-wrong multi-warp approach.
6. **Agent research is unreliable for load-bearing numbers.** Session 18's prompt baked in an agent's research table; five numbers were wrong. Re-verification by direct XML inspection is required for anything that drives code.

**KEY FINDINGS (Session 17):**
1. **Warp-grid coarseness limit**: 3×3 grid can't preserve a fine per-vertex contour; fundamental, not a bug. Per-vertex `CArtMeshForm` is the correct tool for detailed facial features (Hiyori's choice).
2. **RigWarp as passthrough**: deleting a tag's entry from `TAG_PARAM_BINDINGS` while keeping it in `RIG_WARP_TAGS` produces a no-op warp with single rest keyform. Structural routing (Body chain) still flows through it.
3. **Dual per-vertex rules**: eyelash needs a thickness (clamp above-band, keep below) to be visible; eyewhite/iris need to fully hide (snap all to band line).
4. **Canvas-space band computation**: work in canvas pixels until the final conversion. Mesh vertices arrive in canvas space; the existing rwBox/dfOrigin conversion path handles canvas→warp-local. No body-X detour needed.
5. **Side-agnostic closure detection**: one set of tags (`EYE_CLOSURE_TAGS`), a `closureSide` derived from `-l`/`-r` suffix, and `closureParamPid` picked by side — cleaner than duplicating L/R branches.
6. **Upward shift separately from band thickness**: conflating them thickened the lash whenever we moved it up. Two knobs (`EYELASH_BAND_FRAC`, `EYELASH_CLOSED_SHIFT_FRAC`) tune independently.

**DEFERRED (to future sessions):**
- ParamMouthForm (smile/frown — would need 2D binding or CArtMeshForm)
- ParamBrowAngle/Form (complex tilt + shape morph)
- ParamEyeSmile (interaction with EyeOpen)
- ParamHairSide (Hiyori uses bone chains — skip)
- ParamAngleX/Y face parallax — **shipped Session 19** (single-warp Body-X pattern with artistic layers)
- ParamAngleZ head tilt — **shipped Session 20** (Face Rotation chained; rotation-deformer local-frame coord-space reverse-engineered)
- Per-part depth parallax inside the single face warp (spatial depth mapping) — possible refinement
- Teeth/tongue (oral mesh) — requires user to split mouth into sub-meshes

### Session 20: ParamAngleZ head tilt — coord-space fix + Neck Warp (2026-04-17)

- [x] Diagnosed Session 19's "face displaced to chest" failure mode by enumerating all 50+ Hiyori rotation deformers and classifying by parent type
- [x] Discovered the rotation-deformer local-frame rule: a rotation deformer exposes a coord frame of **canvas-pixel offsets centered on its own pivot** to its children, regardless of the `DeformerLocal` CoordType label
- [x] Fixed FaceParallax grid emission — now canvas-pixel offsets from `facePivotCx/Cy` (not nested Body-X 0..1)
- [x] Re-enabled chain: FaceParallax → Face Rotation → Body X
- [x] User-confirmed in Cubism Editor: ParamAngleZ tilts head around chin pivot; AngleX/Y continue to work; user reported Body Angle X/Y/Z also reads cleaner now (face chain composes correctly with body motion)
- [x] WARP_DEFORMERS.md: new section "Rotation Deformer Local Frame" documenting the rule with Hiyori evidence
- [x] SESSION20_FINDINGS.md: full diagnosis, evidence table, fix, methodology note
- [x] **Neck Warp** (follow-up on user ask: *"Would it make sense at least the upper neck region to move with the head/face?"*) — new section 3d.1 in cmo3writer.js. Dedicated `NeckWarp` CWarpDeformerSource targets Body X, bound to `ParamAngleZ`, 3 keyforms. Y-gradient deformation: top row shifts 8% of neck width at ±30°, bottom row pinned at shoulders (matches Hiyori's Neck Warp pattern, albeit Hiyori binds hers to `PARAM_BODY_ANGLE_X`). Tuning knob: `NECK_TILT_FRAC`.

**KEY FINDING (Session 20):**
`CoordType = DeformerLocal` is not a unit — it means "parent's local frame". The local frame depends on the parent's type:

| Parent | Local frame |
|---|---|
| ROOT | Canvas pixels |
| Warp | Warp's own 0..1 input domain |
| Rotation deformer | Canvas-pixel offsets from the rotation deformer's own pivot |

Passing Body-X-nested-0..1 values (~0.5) through a rotation deformer collapses them to sub-pixel offsets, rendering the affected region at canvas ≈ (pivot) with ~1-pixel footprint. That was Session 19's "displaced to chest, scaled down" symptom.

**Methodology lesson**: user direction *"stop theorizing, verify"* pivoted the session from speculation to a 1-minute Python enumeration of Hiyori's rotation deformers. The pattern was immediate and unambiguous. Evidence gathering beat ten rounds of guessing.

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
