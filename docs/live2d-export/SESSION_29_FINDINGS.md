# Session 29 Findings — Physics emission (hair + skirt pendulums)

**Date:** 2026-04-21 (continues from Session 28; user requested autonomous
work on clothing/hair physics while away, backup branch
`backup/pre-physics-20260421` created before starting).

**Scope:** first pass of Live2D physics (pendulum simulations) written
directly into `.cmo3` as `CPhysicsSettingsSourceSet`. Three starter rules
ship — Hair Front, Hair Back, and Skirt — each gated on the presence of a
matching mesh tag so generic projects don't get stray physics nodes.

**Status at session end:** infrastructure in place, 48-check verification
suite passes, end-to-end `generateCmo3` smoke test produces a 22 KB cmo3
with all three rules emitted. Pending: user validation in Cubism Editor
on a real character.

---

## 1. Problem statement

Nothing in our export chain authored physics. Runtime exports
(`.physics3.json`) would be empty / hand-authored by the user after import.
For hair/skirt to actually swing when the head or body moves, three pieces
must exist together:

1. **Output parameter** (e.g. `ParamHairFront`) — already in the standard
   param table.
2. **Warp binding** on a mesh that reads the output parameter — already
   present for `front hair`, `back hair`; `bottomwear` added this session.
3. **Physics setting** that drives the output from `ParamAngleX/Z` or
   `ParamBodyAngleX/Z` with pendulum dynamics — this session adds it.

Without (3), (1) and (2) don't animate at runtime: the parameter only
moves when the user directly tweaks it, not in response to head/body
motion.

---

## 2. Reverse-engineering the format

Hiyori's `main.xml` has 11 `CPhysicsSettingsSource` entries wrapped in a
`CPhysicsSettingsSourceSet` that sits between `CPartSourceSet` and the
`rootPart` ref (lines 128753–130446 of the decompressed reference).

### Container shape

```xml
<CPhysicsSettingsSourceSet xs.n="physicsSettingsSourceSet">
  <carray_list xs.n="_sourceCubismPhysics" count="N">
    <CPhysicsSettingsSource>…</CPhysicsSettingsSource> * N
  </carray_list>
  <CPhysicsSettingsGuid xs.n="selectedCubismPhysics" uuid="…" />
  <null xs.n="settingFPS" />
</CPhysicsSettingsSourceSet>
```

The `selectedCubismPhysics` GUID in Hiyori does **not** match any of the 11
`CPhysicsSettingsGuid` values — it's a standalone Editor-UI "last selected"
field, safe to mint a random uuid for.

### Per-setting shape

Each `CPhysicsSettingsSource` has exactly six ordered blocks:

1. `<s xs.n="name">` — human-readable name
2. `<CPhysicsSettingsGuid xs.n="guid">` — declared inline, not a ref
3. `<CPhysicsSettingId xs.n="id" idstr="PhysicsSettingN">`
4. `<carray_list xs.n="inputs" count="K">` — K `CPhysicsInput`
5. `<carray_list xs.n="outputs" count="1">` — one `CPhysicsOutput`
6. `<carray_list xs.n="vertices" count="M">` — M `CPhysicsVertex`
7. Six `<f>` floats for `normalizedPosition/Angle{Min,Max,Default}Value`

`CPhysicsInput` fields: guid, source (CParameterGuid ref), `angleScale=0.0`,
`translationScale` (both 0), `weight` (0–100), `CPhysicsSourceType type`
(`SRC_TO_X`, `SRC_TO_Y`, or `SRC_TO_G_ANGLE`), `isReverse`.

`CPhysicsOutput` fields: guid, destination (CParameterGuid ref),
`vertexIndex` (0-based into the vertex chain — last vertex for a simple
2-vertex pendulum), `translationScale`, `angleScale` (the Hiyori "Scale"
runtime knob — degrees at full pendulum swing), `weight=100`, type,
`isReverse`.

`CPhysicsVertex` fields: guid, `position` (x,y in setting-local space —
arbitrary unit, only relative magnitudes matter), `mobility` (0–1),
`delay` (0–1), `acceleration` (1.0–2.0), `radius`.

### Field-level diff vs Hiyori's Hair Front

Emitted structure matches byte-for-byte except for the fresh UUIDs. The
`<f>` integer-formatting (`1` vs `1.0`) was tightened to always emit `.0`
on integers so diffs against Hiyori are readable.

---

## 3. What ships

### New files

- **src/io/live2d/cmo3/physics.js** — 200 lines. Exports `PHYSICS_RULES`
  (extensible rule table) and `emitPhysicsSettings(x, ctx)`. Rules self-
  skip when required params are absent or `requireTag` isn't present in
  the mesh set; result is reported via `{ emittedCount, skipped }` and
  (optionally) into `rigDebugLog.physics`.
- **scripts/verify_physics.mjs** — 48-check suite: direct XML emission,
  skip-when-param-absent, skip-when-tag-absent, full `generateCmo3`
  integration, `generatePhysics=false` gating, all 9 import PIs present.

### Modified files

- **src/io/live2d/cmo3/constants.js** — IMPORT_PIS gains 9 `CPhysics*`
  FQCNs (physics classes live under `com.live2d.cubism.doc.gameData.physics`
  plus three scattered elsewhere).
- **src/io/live2d/cmo3writer.js**:
  - `generatePhysics` option (defaults to `generateRig`).
  - `ParamSkirt` added to the standard-param table (±1).
  - `'bottomwear'` added to `TAG_PARAM_BINDINGS` — bottom-row (hem) sways
    via cubic-frac gradient, same pattern as `front hair` / `back hair`.
    Magnitude ~6% X / 2% Y of grid span; physics pendulum amplifies the
    perceived motion via phase lag.
  - `emitPhysicsSettings(x, { parent: model, paramDefs, meshes, rigDebugLog })`
    called between `CPartSourceSet` and the `rootPart` ref, matching
    Hiyori's XML ordering.

### The three starter rules

| ID | Output param | Warp binding | Inputs | Pendulum (y/mobility/delay/accel) |
|---|---|---|---|---|
| PhysicsSetting1 | `ParamHairFront` | `TAG_PARAM_BINDINGS['front hair']` | AngleX×60, AngleZ×60, BodyAngleX×40, BodyAngleZ×40 | 3 / 0.95 / 0.9 / 1.5 |
| PhysicsSetting2 | `ParamHairBack` | `TAG_PARAM_BINDINGS['back hair']` | same | 15 / 0.95 / 0.8 / 1.5 |
| PhysicsSetting3 | `ParamSkirt` | `TAG_PARAM_BINDINGS['bottomwear']` (new) | BodyAngleX×100, BodyAngleZ×100 | 10 / 0.9 / 0.6 / 1.5 |

Values copy Hiyori's Hair Front / Back Hair / Move Skirt X templates
verbatim — so the default feel matches Cubism's sample-model tuning.

---

## 4. Why ship a restricted starter set

Two alternatives were considered and rejected:

**A. Emit physics settings for every standard rig param.** Would produce
10+ settings (AngleX / Y / Z / Breath / …). Useless — those params are
*inputs* to physics, not outputs; driving them via physics would create
feedback loops.

**B. Ship rules for `sleeve-l` / `sleeve-r` / `ribbon` too.** Sleeves
require dedicated mesh tags the project doesn't yet produce (topwear is
the torso fabric, not the sleeve). Emitting physics for absent tags either
runs inert (param exists but no deformer reads it) or creates an
uninitialized warp. Adding these properly needs:

1. New tags in the SS tagging UI (sleeve-l, sleeve-r).
2. New warp bindings in `TAG_PARAM_BINDINGS` for those tags.
3. New rotation deformers anchored at the shoulder so sleeves pivot
   around the correct point.

None of that exists upstream. Out of scope for an autonomous session.

The rule table is open for extension — adding a new entry to
`PHYSICS_RULES` in `physics.js` plus a warp binding in `TAG_PARAM_BINDINGS`
makes it a one-file change. Self-skip logic means adding a rule without
its warp binding is harmless (rule runs, output parameter wiggles, but
nothing visually responds).

---

## 5. Verification performed

1. `node --check` on `cmo3/physics.js`, `cmo3/constants.js`,
   `cmo3writer.js` — all pass.
2. `scripts/verify_physics.mjs` — 48 assertions across six test groups:
   structural XML diff, param-missing skip, tag-missing skip, full
   `generateCmo3` run, `generatePhysics=false` gating, IMPORT_PIS content.
   All pass.
3. End-to-end: `generateCmo3({ generateRig: true })` with six tagged
   meshes (face, front/back hair, neck, topwear, bottomwear) produces a
   22 KB cmo3. Without physics it was ~21 KB; the 1 KB difference matches
   hand-counting the three serialized settings.
4. `rigDebugLog.physics` reports `{ emittedCount: 3, emittedIds: [PhysicsSetting1..3], skipped: [] }`.
5. **Still pending:** user confirmation in Cubism Editor 5.0 that the
   cmo3 opens without warnings, the three settings appear in the Physics
   panel, and the pendulums animate correctly when AngleX/Z are dragged.

---

## 6. Tunable constants

All inline in `src/io/live2d/cmo3/physics.js` (`PHYSICS_RULES` array). No
new config-system introduced. Key knobs:

- **`outputScale`** — max degrees produced at full pendulum swing. Copies
  Hiyori's per-character tuning (1.522 front, 2.061 back, 1.434 skirt).
- **`vertices[1].y`** — pendulum length in setting-local units; longer =
  more lag. 3 for front strands, 15 for long back hair, 10 for skirt.
- **`mobility`** — 0.95 for hair (stiff, snappy return), 0.9 for skirt
  (slightly heavier).
- **`delay`** — 0.9 front / 0.8 back / 0.6 skirt (matches Hiyori
  characteristic lag per part).
- **`normalization.posMin/Max`** — param-unit ceiling; `-10/+10` matches
  ParamBodyAngleX/Z's ±10 range so weights = 100 maps naturally.

Skirt-warp magnitudes live separately in `TAG_PARAM_BINDINGS['bottomwear']`
in `cmo3writer.js` (X = 6% of grid span, Y = 2%). Kept small because the
physics pendulum already amplifies perceived motion via phase lag.

---

## 7. Deferred / next

- **User validation in Cubism Editor** — open the test export, verify the
  Physics panel lists the three settings, verify pendulums swing when
  ParamBodyAngle* is dragged. Only real test of the XML's correctness.
- **Sleeve physics** — requires new `sleeve-l`/`sleeve-r` mesh tags
  upstream (SS tagging UI + mesh-splitting logic), plus shoulder-pivoted
  rotation deformers. Big change; pushed to its own session.
- **Hair Side L/R** — `ParamHairSide` exists but has no warp binding and
  no physics rule. Adding symmetric L/R would need splitting into
  `ParamHairSideL` / `ParamHairSideR` and tagging hair-strand meshes.
- **Physics3.json export** — runtime-side `.physics3.json` is currently
  not derived from our cmo3's physics set. Cubism Editor does this when a
  user clicks "Export for SDK", but automating it from our side is a
  separate generator pass.
- **Body ribbon / bust** — Hiyori has these; no corresponding meshes in
  SS projects yet.
