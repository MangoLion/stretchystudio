# Session 16 Prompt — Animate Remaining Standard Parameters

> **STATUS: COMPLETED (2026-04-17).** This was the initial planning prompt for Session 16.
> Actual results (different in several ways from this plan) are documented in
> [SESSION16_FINDINGS.md](SESSION16_FINDINGS.md) Part II. Mouth was deferred to Session 17.
> See [SESSION17_PROMPT.md](SESSION17_PROMPT.md) for the next session plan.

## Context

Read documentation in `docs/live2d-export/`:
- `WARP_DEFORMERS.md` — coordinate system + Structural Warp Chain (Session 15 findings)
- `TEMPLATES.md` — Standard deformer hierarchy from Hiyori
- `PROGRESS.md` — project status (Session 15 complete)

## What's Done (Sessions 14-15)

### Structural warp chain — WORKING
4-layer chain matching Hiyori's architecture:
```
ROOT
├─ Body Warp Z (ParamBodyAngleZ, Canvas coords, 5×5)
│  └─ Body Warp Y (ParamBodyAngleY, DeformerLocal, 5×5)
│     └─ Breath Warp (ParamBreath, DeformerLocal, 5×5)
│        └─ Body X Warp (ParamBodyAngleX, DeformerLocal, 5×5)
│           ├─ per-part warps (all 37 tags, no-op ParamOpacity binding)
│           ├─ Neck rotation → targets Body X
│           │  └─ Head rotation → targets Neck
│           ├─ Arm L rotation → targets Body X
│           ├─ Arm R rotation → targets Body X
│           └─ (torso/eyes rotation deformers REMOVED — matching Hiyori)
├─ Leg L rotation → ROOT
├─ Leg R rotation → ROOT
└─ bothLegs → ROOT
```

### Working parameters (confirmed in Cubism Editor):
| Parameter | Type | Effect |
|-----------|------|--------|
| ParamBodyAngleZ | Body Z warp | Spine curve from belly pivot, progressive head→groin |
| ParamBodyAngleY | Body Y warp | Bell-curve vertical compression/stretch |
| ParamBodyAngleX | Body X warp | Body bowing (center leans, edges counter-shift) |
| ParamBreath | Breath warp | Chest compression, subtle |

### Parameters CREATED but NOT BOUND (18 standard params):
| Parameter | Hiyori binding | SS tag mapping |
|-----------|---------------|----------------|
| ParamAngleX | Face Rotation (2D: AngleX × AngleY) | head group rotation |
| ParamAngleY | Face Rotation (2D: AngleX × AngleY) | head group rotation |
| ParamAngleZ | Hair warps (NOT rotation deformer!) | hair per-part warps |
| ParamEyeLOpen | Eye L mesh keyforms | eyelash-l, eyewhite-l |
| ParamEyeROpen | Eye R mesh keyforms | eyelash-r, eyewhite-r |
| ParamEyeBallX | Eye iris warp X shift | irides-l, irides-r |
| ParamEyeBallY | Eye iris warp Y shift | irides-l, irides-r |
| ParamBrowLY | Brow L warp Y shift | eyebrow-l |
| ParamBrowRY | Brow R warp Y shift | eyebrow-r |
| ParamMouthForm | Mouth warp shape | mouth |
| ParamMouthOpenY | Mouth warp Y stretch | mouth |
| ParamHairFront | Front hair warp sway | front hair |
| ParamHairSide | Side hair warp sway | back hair (sides) |
| ParamHairBack | Back hair warp sway | back hair |

### Rotation deformers (per-group, generic params):
Each non-bone, non-torso, non-eyes group gets `ParamRotation_GroupName` with 3 keyforms at ±30°.
These exist but only affect the rotation chain (no per-part warps route through them yet).

## KNOWN ISSUES

### Per-part warps don't route through rotation deformers
All per-part warps target Body X Warp directly. In Hiyori, face warps target Face Rotation, which chains through Neck → Breath. When we tried routing warps through rotation deformers, parts became tiny (coordinate space mismatch between warp grid DeformerLocal positions and rotation deformer space).

**Deferred investigation**: the CoordType patch from "Canvas" to "DeformerLocal" may not propagate correctly through the XmlBuilder shared node system. Or rotation deformers may interpret child warp coordinates differently than warp→warp chains.

### Face Rotation should use ParamAngleX × ParamAngleY (2D grid)
Hiyori's Face Rotation is controlled by a 3×3 keyform grid (ParamAngleX × ParamAngleY), not a single parameter. This requires changing the head rotation deformer from 1D (ParamRotation_head) to 2D binding. The `emitSingleParamKfGrid` helper only supports 1D — need a 2D variant or manual construction.

## MAIN TASK: Bind Standard Parameters to Deformers

### Priority 1: Face/Head Parameters (biggest visual impact)

**ParamAngleX + ParamAngleY — Head rotation (face parallax)**
In Hiyori: Face Rotation deformer with 2D 3×3 grid (9 keyforms). Each keyform has different angle.
For SS: Option A — bind head rotation deformer to ParamAngleX × ParamAngleY. Requires 2D keyform grid.
Option B — use per-part face warp keyforms for parallax (shift face parts based on head angle). Simpler but less authentic.

**ParamAngleZ — Head tilt**
In Hiyori: NOT a rotation deformer. Applied to hair warps (hair sways with head tilt).
For SS: Could add keyforms to front/back hair per-part warps. Or bind head rotation deformer to ParamAngleZ as a secondary binding.

### Priority 2: Eye Parameters

**ParamEyeLOpen / ParamEyeROpen — Eye open/close**
In Hiyori: mesh keyforms on eyelash/eyewhite art meshes. At 0: eye closed (eyelash covers eye). At 1: eye open.
For SS: Add keyforms to eyelash-l, eyelash-r, eyewhite-l, eyewhite-r meshes. Keyform at 0: squish Y to simulate closed eye. Keyform at 1: rest position.

**ParamEyeBallX / ParamEyeBallY — Eyeball movement**
In Hiyori: iris mesh position shifts within eye white area.
For SS: Add keyforms to irides-l, irides-r per-part warps. Shift grid X/Y within small range.

### Priority 3: Mouth, Brows, Hair

**ParamMouthForm / ParamMouthOpenY — Mouth shape**
Bind to mouth per-part warp. Form: stretch/compress X. Open: stretch Y.

**ParamBrowLY / ParamBrowRY — Brow position**
Bind to eyebrow-l, eyebrow-r per-part warps. Shift grid Y.

**ParamHairFront / ParamHairSide / ParamHairBack — Hair sway**
Bind to front hair, back hair per-part warps. Shift grid X for sway effect.

## Implementation Approach

### Step 1: Upgrade per-part warps from no-op to real bindings
Currently all per-part warps have a single rest keyform bound to ParamOpacity.
Change: for tagged parts, replace the binding with the appropriate standard parameter.

Code location: `cmo3writer.js` section 3c (~line 1660). After creating the warp, instead of always using `emitKfBinding(... pidParamOpacity, ['1.0'] ...)`, check the mesh tag and use the appropriate parameter with multiple keyforms.

### Step 2: Tag → parameter mapping
```javascript
const TAG_PARAM_MAP = {
  'irides-l':    { param: 'ParamEyeBallX', keys: [-1, 0, 1], axis: 'x', shift: 0.05 },
  'irides-r':    { param: 'ParamEyeBallX', keys: [-1, 0, 1], axis: 'x', shift: 0.05 },
  'eyebrow-l':   { param: 'ParamBrowLY',   keys: [-1, 0, 1], axis: 'y', shift: 0.03 },
  'eyebrow-r':   { param: 'ParamBrowRY',   keys: [-1, 0, 1], axis: 'y', shift: 0.03 },
  'mouth':       { param: 'ParamMouthOpenY', keys: [0, 1],   axis: 'y', shift: 0.04 },
  'front hair':  { param: 'ParamHairFront', keys: [-1, 0, 1], axis: 'x', shift: 0.02 },
  'back hair':   { param: 'ParamHairBack',  keys: [-1, 0, 1], axis: 'x', shift: 0.02 },
  // ... etc
};
```

### Step 3: Generate keyforms per binding
For each tagged per-part warp: create N keyforms (instead of 1), each with grid positions shifted by `shift * keyValue` along the specified axis.

### Step 4: Eye open/close (mesh keyforms, not warp keyforms)
This is different — it requires CArtMeshForm keyforms (vertex positions), not warp grid positions. The eyelash mesh at ParamEyeOpen=0 should have squished vertices (closed eye). This goes in section 4 (mesh keyforms), not section 3c.

### Step 5: Face parallax (if time permits)
Add subtle X/Y shifts to all face warps based on ParamAngleX/Y. When head turns, face parts shift in parallax (nose moves more than ears, etc.). This is the per-part warp version of what Hiyori does through Face Rotation.

## Key Files

- `src/io/live2d/cmo3writer.js` — sections 3c (per-part warps), 3d (structural), 4 (mesh keyforms)
- `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml` — reference for all parameter bindings
- `docs/live2d-export/WARP_DEFORMERS.md` — Structural Warp Chain section
- `docs/live2d-export/TEMPLATES.md` — tag-to-part mapping

## Reference: Current section 3c structure

Per-part warps are created in a loop over `perMesh`. Each gets:
1. Bounding box from mesh vertices
2. Grid positions in Body X's 0..1 space (via `canvasToBodyXX/Y`)
3. Single rest keyform with ParamOpacity binding (no-op)
4. CWarpDeformerSource targeting ROOT (re-parented to Body X in 3d)

To add real parameter bindings: replace step 3 with tag-specific N-keyform binding.

## Reference: Standard params in cmo3writer

All 18 standard params are created in the `if (generateRig)` block at line ~420. Their PIDs are in `paramDefs` array. Look up with `paramDefs.find(p => p.id === 'ParamEyeBallX')?.pid`.

## Approach

1. Start with the simplest bindings (brow Y shift, iris X/Y shift, hair sway)
2. Test each in Cubism Editor before moving to the next
3. Tackle eye open/close (mesh keyforms) — more complex
4. Face parallax last (most complex, least priority)
