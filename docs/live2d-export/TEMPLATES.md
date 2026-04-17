# Live2D Templates & 3D Effects — Research & Feasibility

Research into Live2D Cubism Editor's template system and 3D parallax effects,
with analysis of what Stretchy Studio can realistically automate during .cmo3 export.

## Table of Contents

1. [What Are Live2D Templates?](#what-are-live2d-templates)
2. [Template File Format](#template-file-format)
3. [Template Application Process](#template-application-process)
4. [Standard Parameter Set](#standard-parameter-set)
5. [Standard Deformer Hierarchy](#standard-deformer-hierarchy)
6. [3D Parallax / Depth Effect](#3d-parallax--depth-effect)
7. [Auto Generation Features in Cubism Editor](#auto-generation-features)
8. [What SS Already Exports](#what-ss-already-exports)
9. [Gap Analysis: SS vs Template-Quality Export](#gap-analysis)
10. [Feasibility: "Apply Template" Checkbox](#feasibility-apply-template-checkbox)
11. [Feasibility: 3D Head Rotation Effect](#feasibility-3d-head-rotation)
12. [Implementation Roadmap](#implementation-roadmap)
13. [Template PSD Workflow (from official tutorial)](#template-psd-workflow-from-official-tutorial)
14. [Hiyori Reference Model Analysis](#hiyori-reference-model-analysis)
15. [Sources](#sources)

---

## What Are Live2D Templates?

A **model template** is a complete, rigged Live2D model (.cmo3) packaged so its
rigging structure can be transferred onto new artwork. It contains:

- **Parts** (organizational layer groups)
- **Deformer hierarchies** (warp + rotation deformers, full parent-child tree)
- **Parameters with keyforms** (all movement data — the artistic work)
- **Physics groups** (hair swing, clothing simulation)
- **Motion-sync settings** (audio lip sync)
- **ArtMesh structures** (polygon subdivision)
- **Draw order, blend modes, masks, culling**

Templates are the "professional motion framework" — applying one to raw PSD artwork
gives you a model that moves immediately, though manual cleanup is typically needed.

**Key insight from the blog post (midea684):** "Live2D has a model template feature
where professional-created motion frameworks can be applied in one operation. However,
the face collapsed when applying templates, so it didn't work well." This is the classic
ArtMesh mapping failure — when source geometry doesn't match template expectations.

## Template File Format

Templates use **two files** — no special binary format:

### `.template.json` (metadata manifest)
```json
{
  "FormatVersion": "1.0.0",
  "ModelVersion": "1.0.0",
  "Name": "Display Name",
  "BaseModel": "model.cmo3",
  "Thumbnail": "thumbnail.png",
  "Description": "Template description",
  "Author": "Creator name",
  "AttachmentFiles": []
}
```

### `.cmo3` (the actual template model)
Standard Cubism Model Object 3 file — the same CAFF-packaged XML format
our `cmo3writer.js` already generates.

**Storage:** Official templates live in
`C:\Users\[user]\AppData\Roaming\Live2D\Cubism5.1_Editor\cache\template_official_xx\`

**Note:** The `.template.json` format is NOT in Live2D's public CubismSpecs repo.
It's internal to Cubism Editor only.

### Adjustment Parameters (@-prefixed)

Template models contain special parameters with IDs prefixed with `@`:
- Used **only** during the layout/positioning phase
- Let the user adjust position, scale, angle of the template overlay
- **Automatically deleted** after template application
- They are temporary alignment tools, not permanent parameters

## Template Application Process

This is a **GUI-only** process inside Cubism Editor — no API exists.

1. **Select target ArtMeshes** on the destination model
2. **Open template dialog:** Modeling → Model template → Apply template
3. **Layout:** Template overlays the model; bounding box for move/scale/rotate
4. **Fine-tune** via `@`-prefixed adjustment parameters
5. **ArtMesh mapping** — two auto strategies:
   - "Same name preferred" — matches by ArtMesh name
   - "Match position and shape" — spatial/geometric matching
   - Manual mapping also available
6. **Apply:** Transfers parts, deformers, parameters, keyforms to destination
7. **Cleanup:** Reorganize parts, fix draw order, reshape meshes

### Parameter ID Conflicts

Two resolution strategies:
- **"Same ID overwrites"** — template params merge into existing same-ID params
- **"Different ID addition"** — template params get new unique IDs

### Programmatic Access: NONE

- **Cubism SDK** (Web/Native/Unity) — only renders .moc3, no template functions
- **Cubism Editor External API** — parameter get/set only, zero template functions
- **No CLI, no batch mode, no scripting** for template application

## Standard Parameter Set

The ~38 standard parameters that SDK-compatible applications recognize:

### Face / Head
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamAngleX` | Head left/right | -30 | 0 | 30 |
| `ParamAngleY` | Head up/down | -30 | 0 | 30 |
| `ParamAngleZ` | Head tilt | -30 | 0 | 30 |

### Eyes
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamEyeLOpen` | Left eye open/close | 0 | 1 | 1 |
| `ParamEyeLSmile` | Left eye smile | 0 | 0 | 1 |
| `ParamEyeROpen` | Right eye open/close | 0 | 1 | 1 |
| `ParamEyeRSmile` | Right eye smile | 0 | 0 | 1 |
| `ParamEyeBallX` | Gaze left/right | -1 | 0 | 1 |
| `ParamEyeBallY` | Gaze up/down | -1 | 0 | 1 |
| `ParamEyeBallForm` | Pupil size | -1 | 0 | 1 |

### Eyebrows
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamBrowLY` | Left brow up/down | -1 | 0 | 1 |
| `ParamBrowRY` | Right brow up/down | -1 | 0 | 1 |
| `ParamBrowLX` | Left brow in/out | -1 | 0 | 1 |
| `ParamBrowRX` | Right brow in/out | -1 | 0 | 1 |
| `ParamBrowLAngle` | Left brow angle | -1 | 0 | 1 |
| `ParamBrowRAngle` | Right brow angle | -1 | 0 | 1 |
| `ParamBrowLForm` | Left brow deform | -1 | 0 | 1 |
| `ParamBrowRForm` | Right brow deform | -1 | 0 | 1 |

### Mouth
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamMouthForm` | Smile/Anger shape | -1 | 0 | 1 |
| `ParamMouthOpenY` | Mouth open/close | 0 | 0 | 1 |
| `ParamCheek` | Blush | 0 | 0 | 1 |

### Body
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamBodyAngleX` | Body left/right | -10 | 0 | 10 |
| `ParamBodyAngleY` | Body up/down | -10 | 0 | 10 |
| `ParamBodyAngleZ` | Body tilt | -10 | 0 | 10 |
| `ParamBreath` | Breathing | 0 | 0 | 1 |
| `ParamShoulderY` | Shrug | -10 | 0 | 10 |

### Arms / Hands
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamArmLA` | Left arm A | -30 | 0 | 30 |
| `ParamArmRA` | Right arm A | -30 | 0 | 30 |
| `ParamArmLB` | Left arm B | -30 | 0 | 30 |
| `ParamArmRB` | Right arm B | -30 | 0 | 30 |
| `ParamHandL` | Left hand | -10 | 0 | 10 |
| `ParamHandR` | Right hand | -10 | 0 | 10 |

### Hair (physics-driven)
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamHairFront` | Front hair sway | -1 | 0 | 1 |
| `ParamHairSide` | Side hair sway | -1 | 0 | 1 |
| `ParamHairBack` | Back hair sway | -1 | 0 | 1 |
| `ParamHairFluffy` | Hair volume | -1 | 0 | 1 |

### Overall Position
| Parameter ID | Name | Min | Default | Max |
|---|---|---|---|---|
| `ParamBaseX` | Overall X | -10 | 0 | 10 |
| `ParamBaseY` | Overall Y | -10 | 0 | 10 |

### SDK Parameter Groups
```
ParamGroupFace, ParamGroupHead, ParamGroupEyes, ParamGroupEyeballs,
ParamGroupBrows, ParamGroupMouth, ParamGroupBody, ParamGroupHands,
ParamGroupHandL, ParamGroupHandR, ParamGroupArms, ParamGroupArmL,
ParamGroupArmR, ParamGroupLegs, ParamGroupLegL, ParamGroupLegR,
ParamGroupSway, ParamGroupExpression, ParamGroupHair, ParamGroupOverall
```

### SDK Hit Area / Parts IDs
```
HitAreaPrefix = "HitArea"
HitAreaHead = "Head"
HitAreaBody = "Body"
PartsIdCore = "Parts01Core"
PartsArmPrefix = "Parts01Arm_"
PartsArmLPrefix = "Parts01ArmL_"
PartsArmRPrefix = "Parts01ArmR_"
```

## Standard Deformer Hierarchy

The "professional" Live2D model uses this deformer tree (from Live2D Cookbook + tutorials):

```
Root
├─ Leg L Rotation (rotation deformer)
├─ Leg R Rotation (rotation deformer)
└─ Body Z (warp, ParamBodyAngleZ)
   └─ Body Y (warp, ParamBodyAngleY)
      └─ Breath (warp, ParamBreath)
         ├─ Face Rotation Z (rotation deformer, ParamAngleZ, pivot at chin)
         │  ├─ Contour XY (warp 2×3, ParamAngleX/Y)
         │  ├─ Eye L XY (warp 3×3, ParamAngleX/Y)
         │  ├─ Eye R XY (warp 3×3, ParamAngleX/Y)
         │  ├─ Nose XY (warp 2×2 or 2×3, ParamAngleX/Y)
         │  ├─ Mouth XY (warp 3×2, ParamAngleX/Y)
         │  ├─ Eyebrow L XY (warp 2×2, ParamAngleX/Y)
         │  ├─ Eyebrow R XY (warp 2×2, ParamAngleX/Y)
         │  ├─ Ear L XY (warp 2×2, ParamAngleX/Y)
         │  ├─ Ear R XY (warp 2×2, ParamAngleX/Y)
         │  ├─ Hair Front XY (warp 2×2, ParamAngleX/Y)
         │  │  └─ Hair Front Swing (warp 2×2, ParamHairFront — physics)
         │  ├─ Hair Side L XY (warp 2×3, ParamAngleX/Y)
         │  │  └─ Hair Side L Swing (warp 2×3, ParamHairSide — physics)
         │  ├─ Hair Side R XY (warp 2×3, ParamAngleX/Y)
         │  │  └─ Hair Side R Swing (warp 2×3, ParamHairSide — physics)
         │  └─ Hair Back XY (warp 2×3, ParamAngleX/Y)
         │     └─ Hair Back Swing (warp 2×3, ParamHairBack — physics)
         ├─ Body X (warp, ParamBodyAngleX)
         ├─ Arm L Rotation (rotation deformer)
         └─ Arm R Rotation (rotation deformer)
```

**Key structural rules:**
- Most deformers are **warp deformers** (grid-based), not rotation
- Rotation deformers: face tilt Z (pivot at chin), arms, legs
- Physics-driven parts (hair) nest physics deformer **inside** the angle XY deformer
- Each facial part gets its **own** warp deformer for independent parallax
- Hair XY deformers are **parents** of hair swing deformers (XY wraps around swing)

### Bezier Division Spec (from official tutorials)

| Part | Bezier Divisions | Rationale |
|------|-----------------|-----------|
| Contour / face outline | 2×3 | Vertically long |
| Eyes (L/R each) | 3×3 | Square, needs fine control |
| Nose (small/dot) | 2×2 | Small square |
| Nose (realistic/sharp) | 2×3 | Vertically long |
| Mouth | 3×2 | Horizontally long |
| Eyebrows (L/R each) | 2×2 | Small square |
| Ears (L/R each) | 2×2 | Small square |
| Hair bangs/short | 2×2 | Short parts |
| Hair long/side/back | 2×3 | Vertically long parts |
| Hair swing (initial) | 2×2 (conversion 5×5) | Simple swing motion |

**Rule of thumb:** 2×3 for vertical parts, 3×2 for horizontal, 2×2 or 3×3 for square.

### Face Rotation Z (Angle Z) Setup

The face tilt (head tilting left/right like a curious dog) uses a **rotation deformer**,
not a warp deformer:
- Pivot point at the **chin** (not center of head)
- 3 keyform values: -10°, 0°, +10° (or -30°, 0°, 30°)
- All face parts are children of this deformer
- Created by: select all face ArtMeshes → Create Rotation Deformer → "Set as Parent"

### XY Head Rotation (Angle X/Y) — The 3D Effect

This is the "3D parallax" that makes the model look volumetric. Each facial part's
warp deformer gets 3 keyforms on ParamAngleX (-30, 0, +30) and 3 on ParamAngleY:

**The perspective principle:**
- When head turns RIGHT (ParamAngleX = +30): left side of face gets **wider**, right side **narrower**
- When head turns LEFT (ParamAngleX = -30): right side **wider**, left side **narrower**
- Same for up/down with ParamAngleY
- Each part moves by different amount = **parallax** = 3D illusion

**Per-part parallax amounts (how much each deformer moves):**
- Nose: moves the MOST (closest to camera)
- Front hair/bangs: moves a lot (in front of face)
- Eyes: moderate movement
- Eyebrows: moderate movement
- Ears: move the LEAST / opposite direction (furthest back)
- Back hair: moves least / opposite
- Contour: moderate, but also **changes shape** (compresses on far side)

**Auto Generate 4 Corners:**
After X and Y keyforms are made separately, diagonal combinations (e.g. looking
upper-right) are generated automatically:
1. Select all objects with the parameter
2. Menu → Auto Generate 4 Corners
3. Parameter 1 = Angle X, Parameter 2 = Angle Y
4. Target = Selected Objects
5. This creates the 3×3 grid (9 keyform combinations) from just 5 manual keyforms

## 3D Parallax / Depth Effect

The "3D look" when a Live2D head turns is achieved through two mechanisms:

### Mechanism A: Manual Parallax (Traditional)

Each facial part has its own warp deformer bound to `ParamAngleX`/`ParamAngleY`.
The artist manually creates keyforms where **each part moves by a different amount**:

- **"Closer" parts** (nose, front bangs) → move MORE when head turns
- **"Further" parts** (ears, back hair) → move LESS
- The artist shapes deformers "with perspective in mind" — narrowing the far side

This is purely **manual artistic work**. There is no automatic depth value.
The "Auto Generate 4 Corners" feature only interpolates diagonal keyforms
from hand-made left/right/up/down keyforms.

### Mechanism B: 3D Rotation Expression (Cubism 5.0+)

A newer semi-automatic feature that simulates 3D rotation:

1. **Flattening** — establishes baseline 2D rotation keyforms
2. **Depth estimation** — analyzes existing keyforms to infer Z-axis depth per point
3. **Z-Offset** — each deformer gets a depth value:
   - Positive = toward camera (closer)
   - Negative = away from camera (further)
4. **Camera position** — XY coordinates + Z (distance)
5. **Perspective strength** — 0 = parallel projection, >0 = perspective distortion
6. **Angle range** — how much rotation is applied
7. **Rotation method** — X-then-Y, Y-then-X, or simultaneous XY
8. **Symmetry** — horizontal/vertical Z-position symmetry for warp deformers

**Requirements:**
- A default-value keyform as reference
- Front-facing face only
- Center of rotation at XY coordinates (Z fixed at 0)

**Mathematical principle:**
The further a point is from the rotation center AND the more Z-offset it has,
the greater its apparent movement during rotation. This creates perspective-correct
parallax from simple Z-depth values.

## Auto Generation Features

### Auto Generate Face Deformer
AI-based: estimates which ArtMesh belongs to which facial part, creates
appropriately sized/positioned warp deformers. Configurable subdivision counts.

### Auto Generate Facial Motion
Takes generated deformers and creates ParamAngleX/Y keyforms with adjustable:
- **Shift Level** — controls movement amount per part
- **Deformation Level** — controls deformation degree
- Four-corner auto-generation

**Limitation:** Only works for front-facing faces.

### Auto Generate Deformer (Body)
Creates the entire body deformer hierarchy automatically using AI estimation
of body part positions. Generates a fixed hierarchy regardless of model.

## What SS Already Exports

Current `cmo3writer.js` capabilities (updated after Session 16, 2026-04-17):

| Feature | Status |
|---------|--------|
| ArtMesh geometry (vertices, triangles, UVs) | ✅ Done |
| Per-mesh textures (CLayeredImage pipeline) | ✅ Done |
| Part hierarchy (groups → CPartSource) | ✅ Done |
| Rotation deformers (CRotationDeformerSource) | ✅ Done |
| Parameter bindings (KeyformBindingSource) | ✅ Done |
| Baked bone-weight keyforms (elbow bending) | ✅ Done |
| Draw order | ✅ Done |
| Animation export (.can3) | ✅ Done |
| **Warp deformers** | ✅ Done (Session 13) — all 37 tags get per-part warps |
| **Standard parameter IDs** (ParamAngleX etc.) | ✅ Done (Session 12) — 18 standard params created |
| **Standard parameter groups** | ❌ Not implemented |
| **Physics groups** (.physics3.json) | ❌ Not implemented |
| **Body deformer hierarchy** (warp-based 4-chain) | ✅ Done (Session 15) — Body Z → Y → Breath → Body X |
| **Body params** (AngleX/Y/Z, Breath) | ✅ Done (Session 15) — procedural artistic keyforms |
| **Hair sway** (ParamHairFront/Back) | ✅ Done (Session 16) — 1D tips-swing |
| **Brow position** (ParamBrowLY/RY) | ✅ Done (Session 16) — 1D uniform Y translate |
| **Iris gaze** (ParamEyeBallX/Y) | ✅ Done (Session 18) — 2D warp translation (9% X, 7.5% Y), coexists with mesh-level closure |
| **Eye open/close** (ParamEyeLOpen/ROpen) | ✅ Done (Session 17) — per-vertex CArtMeshForm + static band, works both sides |
| **Mouth open/close** (ParamMouthOpenY) | ✅ Done (Session 17) — warp-grid Y-stretch from top pivot |
| **Mouth form** (ParamMouthForm) | ⏭ Deferred |
| **Face deformer hierarchy** (AngleX/Y parallax) | ✅ Session 19 — single FaceParallax warp under Body X, Body-X-pattern deformation |
| **3D parallax keyforms** (AngleX×AngleY on the face warp) | ✅ Session 19 — 6×6 grid, 9 keyforms, layered deformation (bow + perspective + cross-axis + fade) |
| **ParamAngleZ** (head tilt rotation) | ✅ Session 20 — Face Rotation chained between Body X and FaceParallax; rotation-deformer local-frame coord-space reverse-engineered (canvas-pixel offsets from pivot) |
| **Neck Warp** (neck follows head tilt) | ✅ Session 20 — dedicated NeckWarp bound to ParamAngleZ, Y-gradient (top row shifts 8% of neck width, bottom row pinned at shoulders). Mirrors Hiyori's Neck Warp pattern. |
| **ParamBrowAngle/Form**, **ParamEyeSmile** | ❌ Deferred |
| **ParamHairSide** | ❌ Not applicable (Hiyori uses bone chains) |

For implementation details see SESSION15_PROMPT.md (body), SESSION16_FINDINGS.md (face bindings),
SESSION17_FINDINGS.md (mouth + eye closure pivot), PROGRESS.md (milestone tracker).

## Gap Analysis

### What a "template-quality" export would need

To go from "raw model that opens in Cubism Editor" to "model that moves like a
template was applied", SS would need to generate:

#### Tier 1: Structural (Medium difficulty)
1. **Warp deformers** (CWarpDeformerSource + CWarpDeformerForm)
   - Grid-based deformers with configurable subdivision
   - Our cmo3writer already handles rotation deformers; warp is similar but grid-based
2. **Standard parameter IDs** — rename our custom params to match SDK conventions
3. **Standard parameter groups** — organize params into Face/Eyes/Body/etc.
4. **Body warp deformer hierarchy** — Body Z → Body Y → Breath → Face Rotation

#### Tier 2: Motion Data (Hard — requires artistic/heuristic decisions)
5. **ParamAngleX/Y keyforms** — the 3D head rotation effect
   - Need per-part parallax amounts (how much each part moves)
   - Requires knowing which mesh = nose, which = ear, which = hair
   - Either manual annotation in SS or AI/heuristic classification
6. **Eye open/close keyforms** — mesh deformation for blinking
7. **Mouth open/close keyforms** — mesh deformation for talking
8. **Breathing keyforms** — subtle vertical scale on body warp

#### Tier 3: Simulation (Hard)
9. **Physics groups** — hair/clothing swing simulation
   - Input/output parameter mapping, pendulum physics settings
   - The `.physics3.json` format is well-documented
10. **Motion-sync** — audio lip sync settings

### What SS already knows about the model

SS has **full semantic classification** via `armatureOrganizer.js`:

**KNOWN_TAGS** — every part is classified:
```
face, front hair, back hair, headwear,
irides/irides-l/irides-r, eyebrow/eyebrow-l/eyebrow-r,
eyewhite/eyewhite-l/eyewhite-r, eyelash/eyelash-l/eyelash-r,
ears/ears-l/ears-r, nose, mouth, neck, neckwear,
topwear, bottomwear, legwear, footwear, handwear (+ -l/-r variants),
tail, wings, objects
```

**boneRole on groups** — skeleton joint classification:
```
root, torso, neck, head, eyes,
leftArm, rightArm, leftElbow, rightElbow, bothArms,
leftLeg, rightLeg, leftKnee, rightKnee, bothLegs
```

**Other data available:**
- `matchTag(layerName)` → canonical tag (e.g. "front hair 2" → "front hair")
- `boneForTag(tag)` → skeleton bone (e.g. "irides" → "eyes")
- Group hierarchy with `transform.pivotX/Y` from skeleton keypoints
- Mesh geometry (vertices, triangles, UVs, boneWeights)
- `node.imageBounds` — opaque pixel bounding box per part

**Tag → Live2D deformer mapping** (what we can infer automatically):
| SS Tag | Live2D Deformer | Bezier | Depth (Z) |
|--------|----------------|--------|-----------|
| `face` | Contour XY | 2×3 | +1 |
| `irides*` | Eye L/R XY | 3×3 | +2 |
| `eyelash*` | Eye L/R XY | 3×3 | +2 |
| `eyewhite*` | Eye L/R XY | 3×3 | +1 |
| `eyebrow*` | Eyebrow L/R XY | 2×2 | +1.5 |
| `nose` | Nose XY | 2×2 | +3 |
| `mouth` | Mouth XY | 3×2 | +1 |
| `ears*` | Ear L/R XY | 2×2 | -3 |
| `front hair` | Hair Front XY | 2×2 | +4 |
| `back hair` | Hair Back XY | 2×3 | -5 |
| `headwear` | Headwear XY | 2×2 | +2 |

SS does NOT currently know:
- Z-depth/parallax values per part (but can be **derived from tags** — see table above)
- How to deform eyes for blinking or mouth for talking (mesh deformation knowledge)

## Feasibility: "Apply Template" Checkbox

### Option A: Bundle a .cmo3 template and merge at export time

**Concept:** Ship a professional .cmo3 template with SS. During export, read the
template's deformer hierarchy + parameters + keyforms, then merge them with the
user's art meshes (matching by name or position).

**Pros:**
- Reuses Live2D's own format — no need to reinvent motion data
- Could ship multiple templates (male, female, chibi, etc.)
- Template updates are just file replacements

**Cons:**
- Reimplements Cubism Editor's template application logic (ArtMesh matching, keyform transfer)
- ArtMesh name matching requires SS layers to follow a naming convention
- Position-based matching is an AI/heuristic problem (Cubism uses ML for this)
- The blog post author specifically noted templates failing: "the face collapsed"
- We'd need to parse .cmo3 (CAFF → XML → deformer tree) — our caffPacker only writes

**Verdict: HARD.** The matching problem is the crux. Without reliable mesh-to-template
mapping, the result will be broken models. Cubism Editor itself uses AI for this and
it still fails sometimes.

### Option B: Generate a standard deformer hierarchy from SS data

**Concept:** During export, SS automatically creates the standard warp deformer tree
(Body Z → Body Y → Breath → Face Rotation → per-part XY deformers) and populates
keyforms with reasonable defaults based on mesh positions.

**Pros:**
- No external template file needed
- Can use SS's group hierarchy to infer body structure
- Can use relative positions to estimate parallax amounts
- Incrementally implementable (start with body rotation, add face later)

**Cons:**
- Generating good keyforms requires per-part semantic knowledge
- Default parallax values will look generic (not hand-tuned)
- Still needs facial part classification

**Verdict: MEDIUM.** More tractable than Option A. The structural part (deformer tree +
standard params) is straightforward. The motion data (keyform shapes) is the hard part.

### Option C: Hybrid — structure from SS, motion from user adjustment

**Concept:** SS exports the standard deformer hierarchy with empty/minimal keyforms.
Parameters exist with correct IDs so the model is immediately compatible with
face tracking and VTube Studio. User adds motion keyforms in Cubism Editor.

**Pros:**
- Much simpler to implement (structural only)
- No risk of broken keyforms
- Model opens in Cubism Editor with proper param IDs, ready for manual rigging
- Face tracking apps (VTube Studio) see the standard params immediately
- User can use Cubism's "Auto Generate Facial Motion" on the exported structure

**Cons:**
- Model doesn't "move" out of the box — needs manual keyform work in Cubism
- Not the "one-click professional template" dream

**Verdict: EASIEST and most reliable.** This is essentially what professional Live2D
artists do: create the structure first, then hand-animate keyforms. SS can automate
the tedious structural setup, leaving only the creative work.

### Recommendation

**Start with Option C**, then incrementally add Option B capabilities:

1. **Phase 1:** Standard deformer hierarchy + parameter IDs (Option C)
   - User opens exported .cmo3, sees proper ParamAngleX/Y/Z, ParamBody*, etc.
   - Deformer tree matches the standard template layout
   - Compatible with face tracking immediately (params exist, just no motion)

2. **Phase 2:** Basic auto-keyforms for body rotation (Option B, partial)
   - ParamBodyAngleX/Y/Z — simple translation of body parts
   - ParamBreath — subtle Y-scale oscillation
   - These are structurally simple (whole-body transforms)

3. **Phase 3:** Parallax-based head rotation keyforms (Option B, full)
   - Assign Z-depth per part based on group names or user annotation
   - Generate ParamAngleX/Y keyforms with perspective-based parallax
   - This is the "3D effect" — technically the hardest, most impactful feature

## Feasibility: 3D Head Rotation

### Can we automate 3D parallax during export?

**Partially yes**, with caveats:

#### What we'd need:
1. **Part classification** — know which mesh is nose/eyes/ears/hair/etc.
   - Could use SS layer names with naming convention
   - Could use relative position heuristics (topmost = hair, center = face, etc.)
   - Could let user tag parts with "depth" values in SS UI

2. **Z-depth assignment** — each part gets a depth value
   - Nose: high Z (closest to camera)
   - Eyes: medium Z
   - Ears: low Z (furthest)
   - Back hair: lowest Z

3. **Parallax math** — for each part at each angle:
   ```
   offset_x = depth * sin(angle_x) * perspective_factor
   offset_y = depth * sin(angle_y) * perspective_factor
   scale_x = 1 - abs(sin(angle_x)) * depth * compression_factor
   ```

4. **Warp deformer keyforms** — grid control points displaced by parallax amounts

#### Implementation approach:
- **Simplest:** User assigns depth values per group in SS (a "Depth" field in inspector)
- **Medium:** Heuristic depth from group names ("hair_back" → Z=-5, "nose" → Z=+3)
- **Advanced:** Use mesh bounding boxes — center-of-face parts get higher Z

#### Realistic quality expectation:
Auto-generated parallax will look **acceptable but generic** — like a "beginner Live2D"
model. Professional models have hand-tuned keyforms with per-vertex artistic decisions
(eye squash, cheek compression, etc.) that no algorithm can replicate.

For VTubing / Ren'Py use cases, auto-generated parallax would be **good enough**.
For professional-grade models, it's a starting point that needs manual polish.

## Implementation Roadmap

### Phase 5A: Standard Structure (prerequisite for everything)

**Scope:** Warp deformers + standard params + deformer hierarchy

1. Add `CWarpDeformerSource` + `CWarpDeformerForm` to cmo3writer
2. Generate standard deformer hierarchy based on SS group tree
3. Map SS parameters to standard Live2D parameter IDs
4. Add parameter groups (ParamGroupFace, ParamGroupBody, etc.)
5. Export checkbox: "Use standard Live2D parameters"

**Estimated complexity:** Medium (similar to rotation deformer work in Sessions 7-8)

### Phase 5B: Body Motion Keyforms

**Scope:** ParamBodyAngleX/Y/Z, ParamBreath

1. Generate body warp deformer with keyforms for body sway
2. Generate breath warp deformer with subtle Y-scale
3. ParamShoulderY for shrug motion

**Estimated complexity:** Medium

### Phase 5C: 3D Head Parallax — ✅ shipped Session 19

**Shipped approach:** single `FaceParallax` warp under Body X, parametric layered deformation following the Session 15 Body X/Z pattern. Not the per-part 3D projection originally planned. See [SESSION19_FINDINGS.md Part II](sessions/SESSION19_FINDINGS.md) for the journey and pivots.

1. One `FaceParallax` `CWarpDeformerSource` (6×6 grid, 9 keyforms on `ParamAngleX × ParamAngleY`), targeting Body X
2. All face-tagged meshes (`face`, `nose`, `eyebrow-l/r`, `eyewhite/irides/eyelash-l/r`, `mouth`, `ears-l/r`, `front hair`, `back hair`) re-parent their rig warps to this one warp
3. Keyform deformation: base sine bow + asymmetric perspective + cross-axis Y-on-AngleX shift + row/col fade. Same formula family as Session 15 Body X Warp, adapted for 2D (AngleX × AngleY).
4. Face Rotation deformer (ParamAngleZ) **emitted but not in chain** — deferred, coord-space quirk with rotation-deformer-as-warp-parent unresolved this session

**Key structural insight:** Cubism warps don't interpolate between each other. A single warp covering the whole face gives the coherent deformation Hiyori has; multiple per-part warps with shared rotation math still look discrete. See SESSION19_FINDINGS.md Part II for full reasoning.

**Tuning knobs:** `FP_BOW_X_FRAC`, `FP_PERSP_X_FRAC`, `FP_CROSS_Y_FRAC` (and Y mirrors) in `cmo3writer.js` section 3d.2. All default to small fractions of face warp span.

### Phase 5D: Physics Groups

**Scope:** Hair/clothing physics simulation data

1. Generate .physics3.json with pendulum settings
2. Map hair parameters to physics inputs/outputs
3. Add physics group definitions to .cmo3

**Estimated complexity:** Medium (format is well-documented)

### Phase 5E: Face Animation (Stretch Goal)

**Scope:** Eye blink, mouth open, eyebrow raise

1. Requires mesh deformation knowledge per facial part
2. Needs facial landmark detection or user annotation
3. Generate keyforms that reshape eye/mouth meshes

**Estimated complexity:** Very Hard (requires per-vertex artistic decisions)

## Template PSD Workflow (from official tutorial)

Live2D's official template system works like this:

1. **PSD with guide lines** — user opens a template PSD (e.g. "SD Template_Boy.psd")
   that has guide lines showing where to draw each part
2. **Draw following guides** — each group (Head, Body) has sub-groups with named layers
   for line art + fill. Sample layers labeled "(for example)" show what goes where.
3. **Material rules:**
   - Draw extra hidden areas (become visible during motion)
   - Eyelids/mouth need skin-filled parts to prevent gaps
   - Eyebrow/mouth shapes will be deformed, so follow guide shape
4. **Merge layers** — each part = single layer (Photoshop scripts provided)
5. **Load into Cubism Editor** → drag PSD → File → Apply Template
6. **Template selection** — dialog shows available templates (Koharu/Haruto for SD, etc.)
7. **Auto-mapping** — template maps your layers to its parts by name/position
8. **Manual fixes** — select mismatched parts, click "Match Selected Elements"
9. **Result** — model with full parameter set, deformers, and keyforms

**Key insight for SS:** Steps 1-4 are what SS's PSD import + KNOWN_TAGS already does.
Steps 5-8 are what our export needs to replicate — but since SS already knows the
semantic classification, we skip the unreliable name/position matching entirely.

## Hiyori Reference Model Analysis

The Hiyori .cmo3 (at `reference/live2d-sample/Hiyori/`) is our reference for
professional-quality structure:

### Parameters (70 total in Hiyori)
- ParamAngleX/Y/Z: -30 to 30, combined=true for X
- ParamEyeLOpen/ROpen: 0 to **1.2** (note: max > 1.0 for exaggerated open)
- ParamBodyAngleX/Y/Z: standard -10 to 10
- ParamBrowLY/RY, ParamBrowLAngle/RAngle: -1 to 1
- ParamMouthForm, ParamMouthOpenY: standard ranges
- Plus ~30 custom parameters for specific features

### Warp Deformer Grid Structure
- Base grid: 5×5 (col=5, row=5) → 6×6 = 36 control points
- Bezier extension levels (2 levels): EditLevel 2 = 2×2, EditLevel 3 = 1×1
- Each keyform = 72 float values (36 points × 2 coordinates)

### KeyformBinding Pattern
- ParamAngleX binding: 3 key values at **-30.0, 0.0, 30.0**
- Interpolation: LINEAR (both normal and extended)
- Each art mesh bound via KeyformGridSource → KeyformBindingSource → CParameterGuid
- Grid has keyformsOnGrid entries with KeyIndex 0, 1, 2 mapping to CFormGuid refs

### Physics System (11 physics groups)
- "Hair Front" example:
  - Inputs: ParamAngleX (weight 60), ParamAngleZ (weight 60), 2 custom params (weight 40 each)
  - Input types: SRC_TO_X (translation) and SRC_TO_G_ANGLE (gravity angle)
  - Vertices: 2 pendulum nodes (root fixed + tip with mobility 0.95, delay 0.9)
  - Output: mapped to hair sway parameter with angle scale 1.52

## Sources

### Official Live2D Documentation — Manuals
- [About Model Templates](https://docs.live2d.com/en/cubism-editor-manual/template/)
- [How to Apply Model Templates](https://docs.live2d.com/en/cubism-editor-manual/applying-the-model-template/)
- [Creating/Exporting Model Templates](https://docs.live2d.com/en/cubism-editor-manual/creating-exporting-the-model-template/)
- [Standard Parameter List](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/)
- [3D Rotation Expression](https://docs.live2d.com/en/cubism-editor-manual/apply-3d-rotation-expression/)
- [3D Rotation Expression Settings](https://docs.live2d.com/en/cubism-editor-manual/apply-3d-rotation-expression-settings/)
- [Auto Generation of Facial Motion](https://docs.live2d.com/en/cubism-editor-manual/face-auto-edit/)
- [Auto Generation of Deformer](https://docs.live2d.com/en/cubism-editor-manual/auto-generation-of-deformer/)
- [Parent-Child Hierarchy](https://docs.live2d.com/en/cubism-editor-manual/system-of-parent-child-relation/)
- [File Types and Extensions](https://docs.live2d.com/en/cubism-editor-manual/file-type-and-extension/)
- [External API Integration](https://docs.live2d.com/en/cubism-editor-manual/external-application-integration-api-list/)

### Official Live2D Tutorials (step-by-step, with screenshots)
- [Easy Modeling with Template Function](https://docs.live2d.com/en/cubism-editor-tutorials/template/) — PSD guide lines, template application, part mapping
- [1. Illustration Processing (PSD)](https://docs.live2d.com/en/cubism-editor-tutorials/psd/) — part separation rules, drawing hidden areas
- [4. Adding Body Movement (Deformers)](https://docs.live2d.com/en/cubism-editor-tutorials/deformer/) — rotation/warp deformer creation, hair swing, arm rotation
- [5. Adding XY Facial Movement](https://docs.live2d.com/en/cubism-editor-tutorials/xy/) — **3D head rotation**, per-part warp deformers, Bezier specs, Auto Generate 4 Corners
- [Adding Facial Expressions](https://docs.live2d.com/en/cubism-editor-tutorials/expression/)
- [Eye Blink](https://docs.live2d.com/en/cubism-editor-tutorials/eye-blink/)
- [Mouth AIUEO](https://docs.live2d.com/en/cubism-editor-tutorials/mouth-aiueo/)
- [Physics Settings](https://docs.live2d.com/en/cubism-editor-tutorials/physical-calculation-settings/)

### SDK / Format Specs
- [CubismSpecs File Formats](https://github.com/Live2D/CubismSpecs/tree/master/FileFormats)
- [SDK Default Parameter IDs](https://github.com/Live2D/CubismWebFramework/blob/develop/src/cubismdefaultparameterid.ts)

### Community Resources
- [Live2D Cookbook — Deformer Hierarchy](https://r3dhummingbird.gitbook.io/live2d-cubism-cookbook/modeling-and-rigging/deformer-hierarchy)
- [Blog: AI Illustration to Live2D (midea684)](https://note.com/midea684/n/n335df9e3b32c) — experience report with templates + See-Through
