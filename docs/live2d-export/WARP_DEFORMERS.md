# Warp Deformer Coordinate System — Reverse Engineering Notes

Reverse-engineered from Cubism Editor 5.0 Java bytecode + Hiyori .cmo3 reference.

## Key Finding: Local Space = Normalized 0..1

From `CWarpDeformer.transformCanvasToLocal()` bytecode:

```java
// For quad mode:
new GRectF(0, 0, 1, 1)  // srcRect defining the local space
CSimpleGrid grid = new CSimpleGrid(col, row, positions);
CGridTransform transform = new CGridTransform(srcRect, grid, col, row);
transform.inverseTransform(canvasPoints, 0, localPoints, 0, count, true);

// For non-quad (bezier) mode:
new Rect(0, 0, 1, 1)  // same 0..1 local space
SimpleGrid grid = new SimpleGrid(col, row, positions_as_double);
GridTransform transform = new GridTransform(srcRect, grid, col, row);
transform.inverseTransform(canvasPoints_double, 0, localPoints_double, 0, count);
```

**The warp deformer's local coordinate space is always (0,0)-(1,1).**

The `GridTransform` maps:
- **Input:** points in local space (0..1)
- **Output:** points in parent deformer space (the grid's `positions` array)

The grid `positions` are the CONTROL POINTS that define WHERE each grid point maps to
in the PARENT deformer's coordinate space.

## Coordinate System Summary

```
ArtMesh keyform positions    →  Warp local space (0..1)
                                    ↓ (grid interpolation)
Warp grid form positions     →  Parent deformer space
                                    ↓ (parent deformer transform)
                                Canvas pixel space
```

### For a warp deformer at ROOT:
- Mesh keyform positions: 0..1 (normalized)
- Grid form positions: parent space = ROOT = ?

### For a warp deformer under another deformer:
- Mesh keyform positions: 0..1 (normalized)
- Grid form positions: parent deformer's local space

## Hiyori "Collar" Example

Canvas: 2976 x 4175 pixels

### ArtMesh "Collar" (ArtMesh96)
- targetDeformerGuid: Collar Front Warp (#3567)
- Base positions (GEditableMesh2 > point): canvas pixels, e.g. (1220, 1092)
- Keyform positions (CArtMeshForm): 0..1 range, e.g. (0.065, 0.354)
- CoordType: xs.ref="#1186" (shared with warp form)

### CWarpDeformerSource "Collar Front Warp" (#3566)
- col: 5, row: 5 (grid: 6x6 = 36 control points)
- targetDeformerGuid: #3536 (parent deformer)
- Grid form positions: ~0.31..0.66 X, ~0.27..0.45 Y (parent deformer space)
- CoordType: xs.ref="#1186" (same as mesh keyforms)

### Coordinate relationship
```
Mesh base (canvas pixels):  (1220, 1092)
Mesh keyform (warp local):  (0.065, 0.354)  ← in 0..1 warp space
Warp grid (parent space):   0.31..0.66 X, 0.27..0.45 Y
```

The mesh keyform position (0.065, 0.354) means:
"This vertex is at 6.5% from left, 35.4% from top of the warp deformer's local area."
The warp grid then maps this through its control points to the parent deformer's space.

## CWarpDeformer Class Structure

```
CWarpDeformerSource (persisted in .cmo3 XML)
  ├─ col: int (grid columns)
  ├─ row: int (grid rows)
  ├─ isQuadTransform: boolean
  └─ keyforms: CWarpDeformerForm[]
       └─ positions: float[] (grid control points, (col+1)*(row+1)*2 floats)

CWarpDeformer (runtime instance)
  ├─ interpolatedForm: CWarpDeformerForm (from parameter interpolation)
  ├─ deformedForm: CWarpDeformerForm (after parent deformer transform)
  ├─ affectedForm: CWarpDeformerForm (after affecter application)
  └─ Methods:
       ├─ transformLocalToCanvas(in[], out[], offset, stride, count)
       └─ transformCanvasToLocal(in[], out[], offset, stride, count)
```

## Key Methods

### transformLocalToCanvas
Delegates to `o.a(in, out, offset, stride, count, gridPositions, col, row, isQuad)`
This is the static grid interpolation function.

### transformCanvasToLocal (inverse)
1. Creates a `GRectF(0, 0, 1, 1)` or `Rect(0, 0, 1, 1)` as source rectangle
2. Creates a `SimpleGrid(col, row, positions)` from current form
3. Creates `GridTransform(srcRect, grid, col, row)`
4. Calls `gridTransform.inverseTransform()` to map canvas→local

## How to Generate Warp Deformers in SS Export

### Grid positions (CWarpDeformerForm > positions)
These must be in the PARENT deformer's coordinate space.
- If parent is ROOT: positions in... ROOT's space (need to determine what ROOT space is)
- If parent is another warp: positions in that warp's 0..1 space
- If parent is a rotation deformer: positions in rotation deformer's local space

### Mesh keyform positions (CArtMeshForm > positions)
These must be in the warp deformer's local space = **0..1 normalized**.

To convert from canvas pixels to warp local space:
```
// This is what transformCanvasToLocal does:
// GridTransform(Rect(0,0,1,1), grid, col, row).inverseTransform(canvas) → local
```

For a REST keyform (undeformed grid), the mapping is approximately:
```
localX = (canvasX - gridMinX) / gridWidth  (where grid covers gridMinX..gridMaxX)
localY = (canvasY - gridMinY) / gridHeight
```

But this is only exact for a regular (undeformed) grid. For deformed keyforms, the
inverse is more complex.

### CoordType
Both warp form and mesh keyform should use the SAME CoordType.
Hiyori uses a shared CoordType for both (xs.ref="#1186").
From the `transformDeformer_testImpl` bytecode: `CoordType.Companion.c()` is used
to set the CoordType on deformed forms, which suggests a specific enum value.

## ROOT Space — RESOLVED (Session 13)

**Answer: Canvas pixel space.** CoordType = "Canvas".

Determined by analyzing Hiyori's "Body Warp Z" (Warp1), which targets ROOT directly:
- 5×5 grid (6×6 = 36 control points)
- Grid positions: X range 394..2581, Y range -37..3028 (canvas is 2976×4175)
- CoordType: xs.ref="#3545" → `coordName = "Canvas"`
- Rest-pose grid is a perfectly regular rectangle in canvas pixel space

By contrast, child warps (e.g. "Collar Front Warp" under intermediate deformer):
- CoordType: xs.ref="#1186" → `coordName = "DeformerLocal"`
- Grid positions: 0..1 range (parent deformer's local space)

### Summary table

| Warp parent | Grid positions | CoordType | Mesh keyform positions |
|-------------|---------------|-----------|----------------------|
| ROOT        | Canvas pixels | "Canvas"  | 0..1 warp-local      |
| Deformer    | Parent's 0..1 | "DeformerLocal" | 0..1 warp-local |

Mesh keyform positions are ALWAYS 0..1 warp-local, regardless of the warp's parent.
Mesh keyform CoordType is ALWAYS "DeformerLocal".

### Precision trap

Mesh keyform positions in 0..1 range require high precision (6+ decimal places).
Using `toFixed(1)` rounds 0.354 → 0.4 (13% error), causing "chewed" texture distortion.
Hiyori uses ~8 significant digits for keyform positions.

### Confirmed working (Session 13)

Topwear warp deformer at ROOT, 3×3 grid, canvas pixel positions, mesh keyforms
in 0..1 with toFixed(6). Opens in Cubism Editor, texture correct, grid draggable.

## Structural Warp Chain — Hiyori Deep Dive (Session 15)

Hiyori uses THREE chained structural warps, NOT one combined 2D-parameter warp.
Each warp has a SINGLE parameter with 2-3 keyforms.

### Chain topology

```
ROOT (#3977)
├─ Body Warp Z (#4050) — ParamBodyAngleZ, Canvas coords, 5×5
│  └─ Body Warp Y (#4049) — ParamBodyAngleY, DeformerLocal, 5×5
│     └─ Breath Warp (#3536) — ParamBreath, DeformerLocal, 5×5
│        ├─ Skirt Warp, Butterfly Tie Warp, Collar Front/Back Warp
│        ├─ Body X Warp (#3560) — ParamBodyAngleX (per-part, NOT structural)
│        ├─ Neck Position (CRotationDeformerSource)
│        ├─ Shoulder R / Shoulder L (CRotationDeformerSource)
│        └─ ... (all face warps chain through Neck → Face Rotation)
├─ Leg L Position (CRotationDeformerSource) — at ROOT, NOT under Body Warp
├─ Leg R Position (CRotationDeformerSource) — at ROOT, NOT under Body Warp
└─ Glue warps (structural, at ROOT)
```

**Critical observations:**
1. ParamBodyAngleX is a per-part warp child of Breath, NOT on the structural chain
2. Legs are at ROOT — they don't follow body rotation/breathing
3. ALL per-part warps and rotation deformers target Breath (the innermost structural warp)
4. The structural chain applies Z → Y → Breath transforms automatically to everything below

### Deformers targeting each level

| Target | Deformers |
|--------|-----------|
| ROOT | Body Warp Z, Leg L, Leg R, Glue×2 |
| Body Warp Z | Body Warp Y (only) |
| Body Warp Y | Breath Warp (only) |
| Breath Warp | 8 deformers: Skirt, Tie, Body X, Collar×2, Neck, Shoulder L/R |

### Body Warp Z — exact values (canvas 2976×4175)

Parameter: ParamBodyAngleZ, keys: -10, 0, +10
Grid: 5×5 (36 points), CoordType "Canvas"

**REST grid (ParamBodyAngleZ=0):**
```
X: 394.98  832.19  1269.40  1706.60  2143.81  2581.02
Y: -37.89  575.47  1188.82  1802.18  2415.53  3028.89
```
Uniform rectangular grid. X range: 395–2581 (73% of canvas width).
Y range: -38–3029 (73% of canvas height). NOT full canvas.
X margin: ~13.3% each side. Y starts slightly above canvas top.

**Shift at ParamBodyAngleZ=-10 (lean left):**
Bottom row: ΔX=0, ΔY=0 (pinned).
Top-left corner: ΔX=-148, ΔY=+136 (leans left and down).
Gradient: linear from bottom (fixed) to top (max shift).

**Shift at ParamBodyAngleZ=+10 (lean right):**
Bottom row: ΔX=0, ΔY=0 (pinned).
Top-left corner: ΔX=+244, ΔY=-32 (leans right and slightly up).
Top-right corner: ΔX=+80, ΔY=+188.
NOT a mirror of -10 — this is 3D perspective rotation.

### Body Warp Y — exact values (DeformerLocal 0..1)

Parameter: ParamBodyAngleY, keys: -10, 0, +10
Grid: 5×5 (36 points), CoordType "DeformerLocal", targets Body Warp Z

**REST grid (ParamBodyAngleY=0):**
```
Values: 0.0652  0.2391  0.4130  0.5870  0.7609  0.9348
```
Uniform square grid. Spacing: ~0.174. Margin: ~6.5% each side.

**Shift at ParamBodyAngleY=-10:**
Edge points (row 0, col 0/5): pinned, no shift.
Interior points shift Y downward (positive ΔY). Max shift ~0.01 at bottom-center.
Bottom row shifts most: ΔY up to +0.003 at edges, +0.005 at center.

**Shift at ParamBodyAngleY=+10:**
Similar magnitude, opposite direction. Bottom row Y decreases.

### Breath Warp — exact values (DeformerLocal 0..1)

Parameter: ParamBreath, keys: 0, 1
Grid: 5×5 (36 points), CoordType "DeformerLocal", targets Body Warp Y

**REST grid (ParamBreath=0):**
```
Values: 0.0547  0.2328  0.4109  0.5891  0.7672  0.9453
```
Uniform square grid. Spacing: ~0.178. Margin: ~5.5% each side.

**Shift at ParamBreath=1 (exhale):**
- Row 0 (top): NO change — edge pinned
- Row 1 (Y≈0.233): interior points shift Y by ~-0.001 (upward compression)
- Row 2 (Y≈0.411): interior points shift Y by ~-0.002 (slightly more)
- Row 3 (Y≈0.589): interior points shift Y by ~-0.0001 (negligible)
- Row 4-5 (bottom): NO change
- X shifts: ±0.001 (center columns move inward slightly)
- **Effect is VERY subtle** — about 1-3 pixels on a 2976px canvas

### Grid margin pattern

Hiyori grids are NOT edge-to-edge. Each has padding:

| Warp | Space | Values | Margin |
|------|-------|--------|--------|
| Body Warp Z | Canvas | 395–2581 | ~13% each side |
| Body Warp Y | 0..1 | 0.065–0.935 | ~6.5% each side |
| Breath | 0..1 | 0.055–0.945 | ~5.5% each side |

### Implementation implications for Stretchy Studio

1. **Replace single 2D Body Warp with 3-chain**: Body Z (Canvas) → Body Y (DeformerLocal) → Breath (DeformerLocal)
2. **ParamBodyAngleX**: separate per-part warp targeting Breath, NOT on structural chain
3. **Legs stay at ROOT**: exclude leg rotation deformers from re-parenting
4. **All other deformers target Breath**: per-part warps and rotation deformers → Breath (innermost)
5. **Grid margins**: don't use 0-to-canvasW or 0-to-1; add ~6-13% padding
6. **Breath effect scale**: our 2% was ~80px, Hiyori uses ~1-3px. Scale down dramatically
