# Session 15 Prompt — Fix Body Warp Hierarchy (3-Chain Architecture)

## Context

Read documentation in `docs/live2d-export/`:
- `WARP_DEFORMERS.md` — coordinate system + **Structural Warp Chain** section (Session 15 findings)
- `TEMPLATES.md` — Standard deformer hierarchy from Hiyori
- `ARCHITECTURE.md` — data mapping
- `PROGRESS.md` — project status (Session 14 bugs listed)

## What's Done (Session 14)

### Per-part warps for all tags — WORKING (before Body Warp)
- 37 tags in `RIG_WARP_TAGS` Map with per-tag `{col, row}` grid sizes
- All parts get warp deformers, confirmed in Cubism Editor
- Grid draggable, textures correct

### Single Body Warp attempt — BROKEN
Created one Body Warp with 2D parameter grid (ParamBodyAngleX × ParamBreath).
Two bugs: re-parenting fails (parts squished) and arms don't move.

## KEY FINDING: Hiyori Uses 3-Chain, Not 2D Grid

**Session 15 investigation** revealed the architecture is fundamentally different from what we built.

### Hiyori's actual structure
```
ROOT
├─ Body Warp Z (ParamBodyAngleZ, Canvas coords, 5×5, 3 keyforms)
│  └─ Body Warp Y (ParamBodyAngleY, DeformerLocal, 5×5, 3 keyforms)
│     └─ Breath Warp (ParamBreath, DeformerLocal, 5×5, 2 keyforms)
│        ├─ per-part warps (Skirt, Collar, Tie, Body X, etc.)
│        ├─ rotation deformers (Neck, Shoulder L/R)
│        └─ ... everything else
├─ Leg L Position (at ROOT, NOT under Body Warp)
├─ Leg R Position (at ROOT, NOT under Body Warp)
└─ Glue warps
```

### What we got wrong
| Aspect | Our implementation | Hiyori reality |
|--------|-------------------|----------------|
| Structure | ONE warp, 2D grid (BodyAngleX × Breath) | THREE chained warps, each single-param |
| ParamBodyAngleX | On structural warp | Per-part warp, child of Breath |
| Re-parent target | Body Warp (outermost) | Breath Warp (innermost) |
| Legs | Under Body Warp | At ROOT (independent) |
| Body Warp grid | Full canvas (0→canvasW) | Body area only (~13% margin each side) |
| Breath magnitude | 2% of canvas (~80px) | ~0.1% (~1-3px) |
| Grid margins (0..1) | 0.0→1.0 | 0.055→0.945 (~5.5% margin) |

## IMPLEMENTATION PLAN

### Step 1: Delete current Body Warp (section 3d)

Remove the entire section 3d (single 2D Body Warp). We'll rebuild from scratch.

### Step 2: Create 3-chain structural warps

Create three separate CWarpDeformerSource nodes, each with ONE parameter binding:

**Body Warp Z** (outermost):
- Parent: root part. Target: ROOT deformer
- 5×5 grid, CoordType "Canvas"
- Grid: covers body area with ~13% margin (NOT full canvas)
  - X: `canvasW * 0.13` to `canvasW * 0.87`
  - Y: `canvasH * -0.01` to `canvasH * 0.73`
  - (Match Hiyori proportions: 395/2976=0.133, 2581/2976=0.867, -38/4175=-0.009, 3029/4175=0.725)
- Parameter: ParamBodyAngleZ, keys: -10, 0, +10
- Keyform shifts: bottom row pinned, top row shifts (gradient)
  - At -10: top-left ΔX ≈ -148px (relative to 2976px canvas), ΔY ≈ +136px
  - At +10: top-left ΔX ≈ +244px, ΔY ≈ -32px
  - Scale proportionally to canvas size

**Body Warp Y** (middle):
- Parent: root part. Target: Body Warp Z deformer GUID
- 5×5 grid, CoordType "DeformerLocal"
- Grid: uniform in 0..1 with ~6.5% margin (0.065 → 0.935, spacing ~0.174)
- Parameter: ParamBodyAngleY, keys: -10, 0, +10
- Keyform shifts: edge points pinned, interior shifts Y by ~0.005-0.01 max
  - Very subtle perspective effect

**Breath Warp** (innermost):
- Parent: root part. Target: Body Warp Y deformer GUID
- 5×5 grid, CoordType "DeformerLocal"
- Grid: uniform in 0..1 with ~5.5% margin (0.055 → 0.945, spacing ~0.178)
- Parameter: ParamBreath, keys: 0, 1
- Keyform shifts: VERY subtle
  - Row 1-2: Y shifts ~-0.001 to -0.002 (chest compression)
  - X shifts: ±0.001 (center columns move inward)
  - Edges and bottom: pinned (no change)

### Step 3: Fix per-part warp re-parenting

**Bug 1 fix:** Replace `_pendingBodyWarpPatch` flag with a `rigWarpTargetNodesToReparent` array:
```javascript
const rigWarpTargetNodesToReparent = []; // collect in section 3c

// In section 3c, per warp:
rigWarpTargetNodesToReparent.push(rigWarpTargetNode);

// In section 3d, after Breath Warp is created:
for (const node of rigWarpTargetNodesToReparent) {
  node.attrs['xs.ref'] = pidBreathWarpGuid; // target BREATH, not Body Z
}
```

### Step 4: Re-parent rotation deformers to Breath

All rotation deformers currently targeting ROOT should be re-parented to **Breath Warp** (the innermost structural warp), EXCEPT:
- **Leg L/R** rotation deformers → stay at ROOT
- **Child rotation deformers** (those targeting another rotation deformer) → keep as-is

Detection: check `boneRole` on the group. Legs have roles like "leftLeg", "rightLeg", "bothLegs".

For re-parented rotation deformers:
- Origins convert from canvas pixels to Breath Warp's 0..1 space
- But Breath is child of Body Y, child of Body Z, child of ROOT
- So Breath's 0..1 space maps through Body Y's 0..1 → Body Z's canvas → ROOT canvas
- For REST position: Breath 0..1 maps linearly to Body Z's grid range
- Origin in Breath space: `(canvasOriginX - bodyZMinX) / bodyZWidth` → Body Z local
  Then through Body Y: already 0..1 of Body Z → need to account for Body Y's grid range
  Then through Breath: 0..1 of Body Y → account for Breath's grid range

**Simplified approach:** Since all three rest grids are regular/uniform, the mapping is:
```
breathLocalX = (canvasX - bwzMinX) / bwzWidth  // canvas → Body Z 0..1
// This is already in Body Z local. Body Y's grid maps its 0..1 → Body Z's 0..1
// Since Body Y rest grid is uniform with margin m: breathLocalX stays approximately the same
// (margin accounts for grid not being 0..1 edge-to-edge)
```

Actually, the proper conversion for a point at canvas position (cx, cy):
1. Body Z 0..1: `(cx - bwzGridMinX) / bwzGridWidth` → gives position in Body Z local
2. Body Y 0..1: inverse of Body Y grid transform at rest → since Body Y grid is uniform from 0.065 to 0.935, the inverse maps Body Z local back to Body Y local
3. Breath 0..1: same inverse through Breath grid

For uniform grids, the inverse is: `localPos = (parentPos - gridMin) / (gridMax - gridMin)`

So: `breathLocal = (bodyYLocal - breathGridMin) / (breathGridMax - breathGridMin)`
Where: `bodyYLocal = (bodyZLocal - bodyYGridMin) / (bodyYGridMax - bodyYGridMin)`
Where: `bodyZLocal = (canvasPos - bwzGridMin) / (bwzGridWidth)`

### Step 5: Verify rotation deformer origins

Only TOP-LEVEL rotation deformers (those currently targeting ROOT) need origin conversion.
Child rotation deformers (targeting parent rotation deformer) keep relative origins as-is.

### Step 6: Handle legs

Identify leg groups by `boneRole`:
- "leftLeg", "rightLeg", "bothLegs" — keep at ROOT
- Leg-related tags: "legwear", "legwear-l", "legwear-r", "footwear", etc.

Per-part warps for leg meshes should also stay at ROOT (Canvas coords, NOT under Breath).
Or: skip per-part warps for legs entirely (they have rotation deformers).

### Step 7: Standard parameters

Ensure these parameters exist:
- ParamBodyAngleZ (new — wasn't in our standard params before)
- ParamBodyAngleY (new)
- ParamBodyAngleX (existing — but now used on per-part warp, not structural)
- ParamBreath (existing)

Remove ParamBodyAngleX from the structural warp. If we want Body X lean:
- Create a separate per-part "Body X Warp" child of Breath (like Hiyori's #3560)
- Bind to ParamBodyAngleX with 3 keyforms (-10, 0, +10)
- Grid in Breath's 0..1 space covering the torso area

## Key Files

- `src/io/live2d/cmo3writer.js` — sections 3, 3c, 3d, 4
- `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
- `docs/live2d-export/WARP_DEFORMERS.md` — "Structural Warp Chain" section has all exact values

## Reference: Hiyori exact numbers

### Body Warp Z rest grid (canvas pixels, 6×6 points)
```
X: 394.98  832.19  1269.40  1706.60  2143.81  2581.02
Y: -37.89  575.47  1188.82  1802.18  2415.53  3028.89
```
Canvas: 2976×4175. X covers 73% (13% margin). Y: -1% to 73%.

### Body Warp Y rest grid (DeformerLocal, 6×6 points)
```
Both X and Y: 0.0652  0.2391  0.4130  0.5870  0.7609  0.9348
```
Spacing: 0.174. Margin: 6.5%.

### Breath Warp rest grid (DeformerLocal, 6×6 points)
```
Both X and Y: 0.0547  0.2328  0.4109  0.5891  0.7672  0.9453
```
Spacing: 0.178. Margin: 5.5%.

### Body Warp Z shift magnitudes (canvas 2976×4175)
At ParamBodyAngleZ=-10, top-left corner shift: ΔX=-148, ΔY=+136
At ParamBodyAngleZ=+10, top-left corner shift: ΔX=+244, ΔY=-32
Bottom row: pinned (no shift). Gradient: linear top→bottom.

### Breath shift magnitudes (0..1 space)
At ParamBreath=1: Row 1 center ΔY≈-0.0014, Row 2 center ΔY≈-0.0016
Edges pinned. X shifts ≈ ±0.001. Extremely subtle.

## Approach

1. Delete current section 3d (single 2D Body Warp)
2. Build 3-chain: Body Z → Body Y → Breath
3. Fix per-part warp re-parenting (array approach, target Breath)
4. Fix rotation deformer re-parenting (target Breath, skip legs)
5. Test in Cubism Editor — verify:
   - All parts visible at correct positions
   - ParamBodyAngleZ leans character (bottom pinned)
   - ParamBodyAngleY perspective shift
   - ParamBreath subtle chest compression
   - Arms move with body (rotation deformers under Breath)
   - Legs stay independent (at ROOT)
   - Per-part warp grids still draggable
