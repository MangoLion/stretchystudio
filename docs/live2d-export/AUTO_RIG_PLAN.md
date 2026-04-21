# Auto-Rig Plan (post-Session 20)

## Problem

Auto-rig flag (`generateRig`) produces good results on Hiyori-like proportions
(`girl.psd`) but looks bad across all parameters on anime/chibi/waifu-style
characters (`waifu.psd`). Iterating style-by-style would compound magic
constants indefinitely and hasn't scaled — past sessions have repeatedly hit
style-specific breakage (Sessions 13–20 each patched one or two issues).

## Research findings

1. **No tool fully solves this.** Cubism uses AI + templates; CartoonAlive
   (2025) uses ML + Mediapipe landmarks; Spine / Inochi2D / Character Animator
   all treat auto-rig as a rough starting point that a human finishes in an
   authoring tool. Expecting "paste PSD → polished rig" across arbitrary
   styles is a goal no professional tool achieves without per-character human
   input or training data.

2. **The "~30 Hiyori-baked constants" claim was overstated.** Code audit of
   `cmo3writer.js` rig logic counts 43 numeric constants. Classification:
   - 14 BBOX_REL — multiply a mesh/face bbox dimension, auto-scale with character size
   - 16 NORMALIZED_01 — warp-local 0..1 space, unitless
   - 5 RATIO — unitless (sine phase, blend ratios, etc.)
   - ~4 truly aesthetic-tuned fractions (`FP_BOW_X_FRAC=0.04`,
     `FP_PERSP_X_FRAC=0.02`, `NECK_TILT_FRAC=0.08`, Body Z bow `0.05`)
     — but even these are multiplied by bbox spans, so pixel output scales
     with character size. Only the *aesthetic* fraction is Hiyori-flavored.
   Hand-computed shift magnitudes on girl vs waifu face parallax differ by
   <10% — not enough to explain "all params look bad."

3. **Clipping mask assumption was wrong.** `waifu.psd` contains zero clipping
   masks and zero layer masks (verified with `psd-tools`). Planned Phase 3
   (emit `CClipMaskSource`) would fix nothing on this character.

4. **Symmetry correction is uncertain.** `girl.psd` has 20 px L/R eye-centerY
   delta (7.1% of face H) and works fine; `waifu.psd` has 33.5 px (16.7%) and
   breaks. Asymmetry alone isn't the bug — thresholds chosen to fire on waifu
   would also fire on girl and potentially regress it.

## Goal

A tool that:
- (a) produces acceptable rigs on ~80–90% of input PSDs out of the box
- (b) honestly tells the user when it can't, and why

**Explicitly NOT** a fully-automated rig that always produces polished
results. No industry tool achieves that without ML training data or
per-character templates.

## Architecture: measure-first

Shift from "apply Hiyori-baked assumptions" to "measure → decide → report":

1. **Pure-geometry analysis** (no multi-character training data needed):
   - Style indicators: face aspect, eye-to-face ratio, iris-to-eyewhite ratio
   - Symmetry: L/R pair deltas, drawn-in tilt detection
   - Anatomical anchors: chin from mouth + neck geometry; neck-base from neck
     mesh top edge; between-eyes midpoint; forehead from face ∩ front-hair
   - Topology coverage: which parameters can be applied from which meshes

2. **Pre-export report in modal**: user sees per-param confidence
   (`high / medium / low / n/a`), detected style indicators, and a
   completeness score (0–100%) before committing to export.

3. **Data-driven pivots**: replace bbox-center heuristics (e.g.,
   `facePivotCy = faceUnionBbox.maxY`) with anatomical anchors.

4. **Debug artifacts**: every auto-rig export emits `{name}.rig.log.json`
   alongside the `.cmo3` for inspection and override.

5. **Override file**: `{name}.rig.json` next to the PSD overrides
   auto-computed values; enables fast tuning loop without re-importing PSD.

## Phased plan

Each phase ships independently. Do not commit to later phases without
evidence from earlier ones — this is the explicit "measure before building"
constraint.

| # | Scope | Status |
|---|---|---|
| 0 | Diagnostic logging — emit `rig.log.json` on export. Run on girl + waifu; compare numerically. | ✅ shipped; see Evidence log below |
| 1 | `rigAnalyzer.js` — pure-geometry measurement module | deferred until Phase 0 evidence |
| 2 | Export modal report UI — display Phase 1 output | deferred |
| 3 | Clipping mask export | **dropped** — `waifu.psd` has no clipping data |
| 4 | Wire anatomical anchors into rig generation | deferred |
| 5 | Symmetry correction | **uncertain** — revisit after Phase 0 evidence |
| 6 | `rig.json` overrides + re-export loop | deferred |
| 7 | Regression on girl + waifu + optional third character | deferred |

## What needs multi-character reference data (deferred)

Style classification and style-preset bundles (e.g., "anime-waifu uses
`hair_sway = 0.18` instead of `0.12`") would need ≥3 rigged references,
human-calibrated. Pure-geometry phases (0, 1, 2, 4) do not depend on this.

If post-Phase-4 results are still unsatisfactory, revisit the data-collection
question. Candidate references: free Cubism samples (Natori, Haru, Koharu,
Wanko, etc. — free for study, restricted redistribution; presets would live
as numeric tables, not bundled assets, so legally safe).

## Process constraints

- **No more theorizing rounds.** Phase 0 is specifically to gather evidence
  before committing to later phases.
- **Independent, reversible phases.** Each phase is shippable on its own.
- **Girl must not regress.** Any change that improves waifu but breaks girl
  is a net loss — girl is the known-working baseline.
- **Honest reporting.** If auto-rig can't do something well on a given PSD,
  it should say so — not silently produce broken output.

## Evidence log

- **Phase 0 diagnostic instrumented** in `cmo3writer.js` + `exporter.js`.
  Every auto-rig export emits `{name}.rig.log.json` inside a ZIP alongside
  the `.cmo3`. Captures: per-mesh bboxes, tag coverage, face/neck union
  bboxes, face pivot, neck warp spans, face parallax shifts at extremes,
  eye-closure parabola fits.
- **First diff on girl vs waifu revealed a smoking gun:** face pivot was
  using `faceUnionBbox.maxY` (bottom of hair+face+ears union) as a "chin
  proxy". Measured offsets below the actual chin: **104 px on girl**
  (37% of face H), **151 px on waifu** (74% of face H). That made ParamAngleZ
  rotate waifu's head around a point far below the neck.
- **P0 fix applied** at `cmo3writer.js:2112`: anchor facePivot to the
  `face`-tagged mesh's bottom + X-center, falling back to face union if no
  face mesh is tagged. User A/B test on waifu: **"not worse" — not visibly
  better either**. Rules out pivot position as the dominant cause of waifu's
  breakage.
- **Neck tilt magnitude anomaly logged but not fixed:** waifu's `maxShiftX`
  in Body X 0..1 space is 0.014 vs girl's 0.034 — i.e., **waifu's neck
  tilts 2.4× less than girl's** for the same ParamAngleZ swing. Because
  `NECK_TILT_FRAC * nwSpanX_bx` scales by neck-span-in-Body-X-domain, and
  waifu's neck bbox is smaller relative to the Body X deformer's coverage.
  Candidate P1 fix: rescale neck tilt by neck-to-head ratio, not by neck
  span in Body X space.
- **P2 fix (band shift-down) applied, then superseded by P3.** P2 targeted
  the specific case where iris/eyewhite extends below eyelash (anime
  big-iris topology), shifting the band down to compensate. Shipped, but
  then root-cause analysis revealed three independent defects in the
  underlying bin-max band algorithm — P2 only patched one.
- **P3 fix (eye closure rewrite) applied at `cmo3writer.js:627-707`.**
  Replaced ~105 lines of bin-max + parabola + P2 shift with ~70 lines of
  union-bbox + parametric smile arc. Root cause fix for three observed
  defects, confirmed from rig.log data:
    1. Narrow X coverage — old "central 60% of vertices" gave only 29–50%
       of eye width on dense-middle meshes → canthi didn't close.
    2. Zigzag Y values — bin-max on sparse triangulation produced
       non-smooth curves (girl R: `181, 183, 175, 183, 187` = jagged).
    3. Wrong shape direction — girl produced a hill (middle higher on
       screen, ∩) while anime closed eyes are a smile (∪).
  User test (P3 defaults DROOP=0.10, ARCH=0.05): waifu visibly improved
  but line slightly too high; girl still looks wrong because the 1.4 px
  arc is visually invisible on a 28-px eye.
- **P4 tuning (Apr 2026) applied at `cmo3writer.js:644-646`:**
    - `EYE_CLOSURE_DROOP_FRAC`  0.10 → **0.20** (band at ~70–80% from top
      instead of mid-eye)
    - `EYE_CLOSURE_ARCH_FRAC`   0.05 → **0.10** (2.8–5.2 px arc, visibly
      curved instead of flat)
  Awaiting user re-test.
- **Observation — girl's head is naturally tilted to the viewer's right
  in her rest pose.** L/R eyelash centerY delta = 20 px on a canvas of
  1920 (≈ 7% of face height). The closure algorithm handles this
  correctly per-side (each eye uses its own bbox, so closure lands in
  the right place for each eye individually), but the closure lines
  are canvas-horizontal, not aligned with the head tilt's natural eye
  axis. Out of scope for current closure pass; documented for future work.
- **Path C per-vertex diagnostic revealed the real bug.** Added
  rig.log.perVertexClosure with rest/closed canvas + warp-local samples
  for each eye-part mesh. First diff revealed girl irides-r
  `closedWarpLocalXY.y` values of **1.038, 1.070, 1.056** — all > 1.0.
  Cubism extrapolates outside the warp's 0..1 domain → closure renders
  far from eye region. **Root cause:** closed Y is computed from eye
  UNION bbox, but each mesh has its own (smaller) bbox. Iris (H ≈ 20 px
  on girl) can't contain a band positioned for the union (H = 34 px).
  Not an algorithm bug, not a chain bug — missing per-mesh clamp.
- **P5 fix applied at `cmo3writer.js:3659-3679`:** clamp each mesh's
  closedY to its own `rwBox` range `[gridMinY, gridMinY + gridH]`.
  One-liner safety net. Iris vertices now close to their own bottom
  edge (warp-local 1.0 exactly, no extrapolation). No effect on
  eyelash/eyewhite which already had headroom.
- **P6 lash strip compression + artStyle branch shipped, then rolled back.**
  P6 replaced the "preserve below band" eyelash logic with a thin-strip
  scale (all lash vertices compressed to `bandY ± strip_half`), so the
  curve is visibly rendered through the lash instead of being hidden
  behind a flat preserved-below contour. artStyle flag (radio UI + plumbing)
  added for per-style constants (anime = thicker strip, western = thinner).
  P7 made the closure curve data-driven, which also removed the need for
  a style-specific lash strip fraction, so the artStyle flag was later
  removed entirely to keep the UI clean.
- **P7 eye closure redesign (user-requested, confirmed perfect on girl):**
  replaced parametric smile-arc band with a parabola fit to the eyewhite's
  OWN lower edge per side. X-uniform bins (not vertex-index) → max-Y per
  bin → least-squares parabola fit. The parabola IS the closure target;
  evaluated per-vertex at closure time. Extrapolates naturally beyond
  eyewhite X range (no clamping at fit boundary). All eye meshes (lash,
  white, iris) blend Y to `curve(vertexX)`; X stays. Fallback: if no
  eyewhite mesh, fit to eyelash bottom with curvature flip. User test on
  girl: "perfect."
- **P8 face parallax redesign — depth-weighted ellipsoidal 3D rotation.**
  Replaced ~70 lines of hand-tuned bow/perspective/cross-axis parametric
  math with ~70 lines of geometric 3D rotation of a virtual hemisphere
  centered on the face mesh. Each grid point gets a Z proportional to
  distance from face center; at each keyform, rotate `(u, v, z)` around
  Y (yaw) and X (pitch) axes, orthographic-project back. Three tunables
  replaced six FP_ fractions: `FP_DEPTH_K` (center bulge), `FP_MAX_ANGLE_X_DEG`
  (virtual yaw at ±30), `FP_MAX_ANGLE_Y_DEG` (virtual pitch at ±30).
  Natural perspective, edge falloff, and asymmetric-rest-pose handling
  emerge from the geometry instead of hand tuning.
- **P9 protected regions (user-requested, addressed eye stretch).**
  P8 made features like eyes stretch because the sphere gives differing
  Z across their tiny bbox → different shifts across the eye. Solution:
  per-tag protection values (eyes 0.95–1.00, brows 0.5, nose/mouth 0.3,
  face/hair 0.0). Each grid point computes (a) natural depth-weighted
  shift and (b) rigid shift at each protected region's center. Weighted
  blend by proximity × protection: inside an eye region → near-rigid
  translate; far from protected regions → full parallax. Tunables:
  `FP_PROTECTION_STRENGTH` (global multiplier), `FP_PROTECTION_FALLOFF_BUFFER`.
- **Edge-depth floor added (user: "edges felt weak on AngleX").**
  Introduced `FP_EDGE_DEPTH_K = 0.30` — Z floor so face edges retain
  depth even at `|u|=1`. Changes Z formula from pure hemisphere
  `Z = FP_DEPTH_K · √(1−u²−v²)` to `Z = FP_EDGE + (FP_DEPTH − FP_EDGE) · √(...)`.
  Edge shift went from 3.5 px to 11.4 px on girl at ParamAngleX=+30.
  Center shift unchanged.
- **P10 cylindrical dome (user: "AngleY eye stretch / looking up/down
  unbelievable").** Full ellipsoid (Z varies with both u and v) gave
  pitch a vertical-compression artifact: face center shifted most,
  top/bottom lagged → face "squished" during pitch. Fix: cylindrical
  dome — Z varies along U only, constant along V. Pitch now produces
  a clean translation per column with subtle chin-tuck from the
  `v·(cos−1)` term. Eye stretch on pitch: negligible because Z is
  uniform across the small eye V range. Girl confirmed: "decent" → "пойдет".
- **P11 eye-union rwBox extension (user: waifu L eye lash/eyewhite gap).**
  On anime big-iris topology (waifu: eyewhite extends 19 px below
  eyelash), the P7 closure band lands below the eyelash mesh's own
  bbox. P5 clamp then squashes lash vertices to their own bbox max,
  producing a visible gap between the closed-lash line and the
  closed-eyewhite/iris line. Fix: compute per-side eye-union bbox
  (eyelash + eyewhite + iris); extend the rig warp bbox of ANY
  eye-part mesh to this union before applying the 10% padding.
  Band then falls inside the rig warp's domain — no clamp needed,
  no gap. No-op on girl (where eyelash already contains iris/white).
- **artStyle flag removed.** Added during P6 when the lash strip
  thickness was the last style-specific constant; removed after P7
  made the algorithm fully data-driven (all curves come from the
  character's own anatomy). UI radio buttons deleted; exporter and
  cmo3writer param plumbing removed. Cleaner default, no user-facing
  toggle that does nothing.
- **P12 PSD alpha closure contour (user-requested, confirmed on all
  three test characters):** P7 used bin-max on mesh vertices to find
  the eyewhite's lower edge, but SS auto-triangulation clusters many
  interior vertices in the middle of eye meshes. Bin-max grabbed
  those interior vertices in central X-bins instead of the true
  bottom edge → parabola fit gave wrong direction (∩ "hill" instead
  of ∪ "лодочка"/bowl). Girl had this bug too at 14% amplitude —
  subtle, user called it "perfect" without noticing. Shelby's smaller
  mesh made it dramatic (38% amplitude, clearly inverted direction).
  **Fix:** new helper `extractBottomContourFromLayerPng()` decodes
  the layer's canvas-sized PNG via Image + OffscreenCanvas, scans
  alpha from bottom of canvas upward per X column, returns the true
  drawn bottom edge in canvas coords. These points feed the parabola
  fit directly, bypassing mesh triangulation. Fallback to mesh
  bin-max if decode fails. ~50ms overhead per layer × 4 eye layers
  ≈ 200ms additional export time. Source-format-agnostic (uses the
  PNG SS has in memory regardless of whether the original was PSD
  or direct PNG layers). User tested on girl/waifu/shelby: "отлично
  работает" — all three have correct ∪ direction now.
- **PR #1 merged upstream on 2026-04-19** by MangoLion. All our P0–P12
  work + Sessions 13–20 in the main MangoLion repo. Upstream added
  two commits on top: `fc091d0` (neck head rotation bug fix —
  possibly resolves our deferred P1 candidate about neck tilt
  scaling) and `1267b52` (UI refactor — touches ExportModal,
  LayerPanel, ArmaturePanel, etc.). Fast-forward merged into our
  master (safe because our commits are ancestors of upstream HEAD).
  Backup branch: `backup-before-upstream-merge-20260420`. Build
  passes, our P0–P12 auto-rig logic intact (30+ identifier matches
  verified via grep).

- **Session 23 (Apr 2026)** — deep face-parallax iteration +
  cross-style auto-rig (see `SESSION_23_FINDINGS.md` for detail).
  Shipped: See-Through depth PSD integration, geometric EDT
  fallback with plausibility check, iris clipping mask
  (`irides` masked by `eyewhite`), body-parallax improvements
  (shoulder-feet midbody hip fallback for wide-shouldered
  characters, head t-cap, neck rotation deformer skip, bow
  amplitude reduction, spine outlier filter), super-group for
  eye sub-meshes (iris+eyewhite+eyelash as one protected unit),
  inner-bbox full protection + outer fade, Export UX polish
  (modelName auto-fill from project, reset-on-project-change,
  widened dialog). Plus research Round 2 (Sýkora 2010 Sparse
  Depth Inequalities, Monster Mash 2020, Depth Anything V2 —
  notes in `research/NOTES.md`).

  Key diagnosis: geometric EDT parallax "perfect" result on girl
  (western with drawn head-tilt) was an accidental alignment
  between algorithm asymmetry and art asymmetry — doesn't
  transfer to symmetric art (shelby → goblinification under
  AMP=3.0). Conclusion: no single algorithm serves both symmetric
  (front-facing) and asymmetric (drawn-tilt) rest poses. Session
  24 plan = `tiltedNeck` UI toggle + input-level pre-symmetrization
  (force-symmetric face bbox, mirror-averaged depth sampling,
  symmetric protected region positions) for front-facing default
  + raw asymmetric for tiltedNeck. Then Phase B = Poisson
  inflation replaces EDT (Ink-and-Ray); Phase C = Laplace
  inter-region smoothing (Sýkora 2010).

- **Session 24 (Apr 2026)** — ATTEMPTED architectural pivot, REVERTED.
  Hypothesis from reverse-engineering a 175-frame tutorial recording:
  "reference rig uses RotationDeformer keyed to ParamAngleX (±12°
  chin-pivot swing) PLUS WarpDeformer, and our exporter was missing
  the rotation part." Implemented it; user tested; result was **head
  severed from neck, rigidly pivoting around chin** — cartoon head-on-
  a-stick. Fundamental reason: a 2D RotationDeformer in Live2D rotates
  only around the canvas Z-axis = that's a lean/tilt, mathematically
  impossible to produce a left-right head yaw with it. The entire
  head-turn illusion in Live2D rigs is carried by WARP GRID SHAPEKEYS
  (keyform control-point displacements) — no rotation deformer is
  layered on top. Frame 142's "green rotation arc" I saw was just the
  warp deformer's convex-hull outline in its deformed state, not a
  separate rotation deformer.

  cmo3writer.js fully reverted to pre-Session-24 state.
  Session 23 Phase A (warp-only + pre-symmetrization + `tiltedNeck`
  toggle) is back on the critical path. See SESSION_24_FINDINGS.md §0
  for the post-mortem.

- **Session 25 (Apr 2026)** — shipped Phase A items A.1–A.4 in the
  warp-only architecture (all gated on `!tiltedNeck`):
  - **A.1**: `fpRadiusX` forced symmetric via max(halfLeft, halfRight)
    so u=±1 land at equal canvas distances from face center.
  - **A.2**: depth sampled at both `canvasGx` and its mirror across
    `faceMeshCxLocal`, averaged — kills L/R noise in EDT hemispheres
    and See-Through depth PSDs.
  - **A.3**: post-process `protectedRegions` to pair `foo-l`/`foo-r`
    by forcing equal `|u|`, averaged `v`/`z`/half-extents/falloffs.
  - **A.4**: `FP_DEPTH_AMP` bumped from 1.6 (default) → 3.0 globally;
    safe after A.1–A.3 because the noise that caused Session 23
    goblinification is gone at the input level.

  A.5 (UI toggle for `tiltedNeck`) still pending. Until A.5 ships
  everyone uses the symmetrized path. See SESSION_25_FINDINGS.md.

- **Session 26 (Apr 2026)** — closed out the "stroke-face" asymmetry,
  shipped two 3D effects, and removed depth PSD + `tiltedNeck`
  entirely after cross-character testing:
  - **A.6**: inner full-protection zone switched from inscribed ellipse
    (covered only ~78% of bbox) to RECTANGLE (Chebyshev). Eye-corner
    mesh vertices now get full rigid protection. Necessary but not
    sufficient.
  - **A.6b** (the fix that worked): warp grid is sparse (6×6), and
    eye region halfU ≈ 0.1 is much smaller than one cell (≈0.3–0.5 u).
    Small regions left grid corners around their mesh vertices OUTSIDE
    the rigid zone, so bilinear interp pulled position-dependent natural
    shifts → L/R asymmetry on drawn art. Expanded every region's
    halfU/halfV by one `cellU`/`cellV` post-A.3. Mesh-scale `meshHalfU/V`
    stashed on regions for tightly-scoped effects like #5.
  - **#3 eye parallax amp**: `regionShifts[ri].shiftU *= 1.3` for
    `eye-l` / `eye-r` — eyes "pop" on the face's convex dome.
  - **#5 far-eye squash**: grid-level (not ART_MESH keyforms).
    Post-process in `computeFpKeyform` shifts grid points on the far
    eye's OUTER side toward the eye center, scoped to `meshHalfU/V`
    (pre-A.6b bbox) so compression stays local. Condition
    `r.u * sinX < 0` identifies far eye. Reads as perspective
    foreshortening.
  - **Failed ear-tuck experiment (Session 25d)**: `shiftU *= 3.0` for
    ears compounded with A.6b's wide rigid zones → whole side of face
    dragged with the ear (25% face compression, neck exposed). Reverted.
    Lesson: amplifying shifts in high-protection regions that have
    been A.6b-expanded drags adjacent meshes. Keep amps ≤ 1.5×.
  - **`tiltedNeck` removed**: after shipping A.5 as a checkbox + flag,
    testing showed the default path (A.6b + #3 + #5 + AMP=3.0 + A.1–A.3
    symmetrization) works on all three test characters (shelby front,
    girl 3/4, waifu anime). The `tiltedNeck=true` fallback was dead
    code. Removed entirely from ExportModal + exporter + cmo3writer
    (~80 lines).
  - **Depth PSD removed**: user tested waifu (the most likely
    beneficiary, being the only anime character with a Marigold-derived
    depth PSD) and got BETTER results without it. Only consumer was
    face parallax `fpZAt`; body parallax never used depth. Deleted
    `src/io/depthPsd.js` + `src/io/geometricDepth.js` (≈480 lines)
    and their usages in cmo3writer (`effectiveDepth`, `sampleDepthSigned`,
    `computeGeometricDepth`, `isDepthPsdPlausible`). `fpZAt` is now a
    pure cylindrical dome.
  - **Net**: cmo3writer 5028 → 4983 lines (many blocks simplified);
    ExportModal 776 → 711 lines; two modules deleted. See
    SESSION_26_FINDINGS.md.

- **Session 27 (2026-04-21) — cmo3writer refactor (pure structural).**
  4983 → 3700 LoC (−25.7%). Split into five modules under
  `src/io/live2d/cmo3/` (constants, pngHelpers, deformerEmit, bodyRig,
  faceParallax). No behavior changes; end-to-end smoke test passes on
  `generateRig=true` with 14-mesh tagged character. Byte-equivalence
  vs. Session 26 baseline confirmed by user via browser export.
  See `SESSION_27_FINDINGS.md`.

- **Session 28 (2026-04-22) — two feature fixes on the refactored base.**
  - **Neck-corner shapekey on ParamAngleX**. Per-vertex `CArtMeshForm`
    at −30/0/+30 on the `neck` mesh. Shift formula:
    `cornerness = smoothstep(tx) · smoothstep(ty)` where
    `tx / ty` are plateau-thresholded edge distances.
    Final constants: `NECK_CORNER_TILT_FRAC = 0.05`,
    `NECK_X_PLATEAU = 0.7`, `NECK_Y_PLATEAU = 0.7`. Five tuning rounds
    (POW-based falloff tried first, abandoned because POW<1 has vertical
    tangent at zero → visible "stroke" on the boundary; smoothstep +
    plateau gives a soft S-curve with zero derivative at both ends).
    Fixes the head-to-neck seam that appeared under head yaw.
  - **Eyewhite mask warp-level identity keyforms**. `eyewhite-l/-r`
    rig warp gains a 3×3 binding on ParamEyeBallX × ParamEyeBallY with
    an identity `shiftFn` (no displacement). Structurally mirrors the
    iris's rig-warp binding. Silences Cubism Editor's "Mask Artmeshes
    have problems" warning. A first attempt at mesh-level keyforms
    (18 `KeyformOnGrid` entries on the eyewhite ArtMesh) emitted
    plausible XML but failed to silence the warning — Cubism validates
    keyform presence at the deformer-chain level, so the fix must live
    on the warp parallel to the clipped child's warp.
  See `SESSION_28_FINDINGS.md`.

- **Session 29 (2026-04-21) — first physics pass.** Three starter rules
  emit as `CPhysicsSettingsSourceSet` between `CPartSourceSet` and the
  rootPart ref, matching Hiyori's layout:
  - `PhysicsSetting1` Hair Front → `ParamHairFront` (pendulum y=3,
    mobility=0.95, delay=0.9)
  - `PhysicsSetting2` Hair Back → `ParamHairBack` (y=15, delay=0.8)
  - `PhysicsSetting3` Skirt → `ParamSkirt` (y=10, delay=0.6)
  Each rule self-skips if its output param or `requireTag` isn't
  present. A new `bottomwear` warp binding reads `ParamSkirt`
  (cubic-frac gradient, hem sways 6% X / 2% Y) so the physics output
  actually moves geometry. New file: `src/io/live2d/cmo3/physics.js`
  (+ `PHYSICS_RULES` table for extension). New option
  `generatePhysics` (defaults to `generateRig`). IMPORT_PIS extended
  with 9 `CPhysics*` FQCNs. Verification: 48-check suite in
  `scripts/verify_physics.mjs` + 22 KB round-trip smoke test.
  See `SESSION_29_FINDINGS.md`. Pending: user validation in Cubism
  Editor.

## Future directions (not scheduled)

### Eye-axis-aligned closure arcs (for drawn-in head tilts)

Current P3/P4 closure is a per-side canvas-horizontal arc using the eye's
own bbox. Works correctly for frontal-facing characters but not
geometrically aligned with the eye's natural axis when the character's
rest pose has a drawn-in head tilt (e.g., `girl.psd` has a 20 px
L/R eye centerY delta).

**Idea:** compute each eye's principal axis from its inner/outer
canthus positions (leftmost and rightmost eyelash vertices, approximately
at eye-vertical-center). Rotate the arch curve to align with that axis
instead of canvas-horizontal. Closure then follows the drawn eye's own
orientation regardless of head tilt.

**When to revisit:** if users report closed eyes looking "skewed" on
tilted-head characters after P4 lands. Not blocking — the current
approach produces anatomically correct closure *per eye individually*;
the issue is purely cosmetic alignment.

### Depth-weighted face parallax (replaces hand-tuned bow curves)

Current FaceParallax uses six aesthetic-tuned fractions (`FP_BOW_X_FRAC`,
`FP_PERSP_X_FRAC`, `FP_CROSS_Y_FRAC`, etc.) combined with `sin(π·cf)` bow
curves and asymmetric perspective terms. All tuned on Hiyori. Works
roughly on girl + waifu but not principled.

**Idea:** replace the curve math with ellipsoidal-depth-weighted parallax:

1. For each FaceParallax grid point, compute a virtual `Z` from distance to
   face center (ellipsoidal falloff — high Z at center, Z≈0 at edges).
2. Shift magnitude proportional to `Z × sin(angle)`. Center of face shifts
   most, edges least — emerges from geometry.

**Honest framing** (lessons from the initial audit):

- Not "physically accurate" — to match current visual magnitude we'd have
  to inflate `Z` beyond real face depth, so the "physics" is partly rhetoric.
- Not "one parameter" — needs `Rx`, `Ry`, `Rz_factor`, internal rotation
  angle, and out-of-face-region behavior. Realistically ~1 tunable scalar
  plus 3–4 sensible defaults.
- Cross-axis feel (`tilt-while-turning`) does NOT emerge from geometry —
  pure sphere rotation around Y produces zero Y-shift. Artistic layer still
  needed if we want that feel.
- Code size roughly the same as current, not smaller.

**Real wins** (justify the refactor when the time comes):

- Replaces six opaque FP_ fractions with one `DEPTH_K` scalar.
- Handles asymmetric rest poses correctly (current symmetric perspective
  assumes face is centered; depth-weighted naturally accounts for pivot
  offset from grid center).
- Edge falloff is geometric, not a separately-tuned `rowFade × colFade`.

**When to revisit:** only after the core measure-first phases (1, 2, 4)
and any P1–P2 fixes from evidence land. Face parallax on both girl and
waifu today produces roughly plausible shifts (22 / 31 px peaks,
proportional to face size) — it's the least-broken part of the rig.
This refactor is polish, not a fix. Scope: ~1 focused session, low
regression risk because keyforms are parametric and easy to A/B.
