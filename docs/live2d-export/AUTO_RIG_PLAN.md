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
