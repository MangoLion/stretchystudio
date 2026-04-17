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
| Warp        | Parent's 0..1 input domain | "DeformerLocal" | 0..1 warp-local |
| Rotation deformer | **Canvas-pixel offsets from parent's pivot** | "DeformerLocal" | 0..1 warp-local |

Mesh keyform positions are ALWAYS 0..1 warp-local, regardless of the warp's parent.
Mesh keyform CoordType is ALWAYS "DeformerLocal".

### Rotation Deformer Local Frame — Session 20 finding

`DeformerLocal` is a CoordType *label*, not a unit.  It means *"in my parent's local
frame"*, and the parent's local frame depends on the parent's type:

- **Warp parent** → local frame is the warp's 0..1 input domain (so values ≈ 0..1).
- **Rotation-deformer parent** → local frame is **canvas-pixel offsets from the
  parent's own pivot**.  The rotation deformer's pivot is the origin of its
  output coord frame, and units are canvas pixels — not 0..1.

Evidence — Hiyori rotation-deformer pivots grouped by parent:

| Parent type | Deformer | Pivot (example) | Scale |
|---|---|---|---|
| ROOT | Leg L Position | (1659.99, 2199.51) | canvas pixels absolute |
| Warp (Breath) | Neck Position | (0.48671, 0.31439) | 0..1 of Breath's input |
| Warp (Breath) | Shoulder R / L | (0.35648, 0.37443) / (0.63737, 0.37291) | 0..1 of Breath's input |
| Rotation deformer (Neck Position) | Face Rotation | (1.17, -64.12) | canvas px offset from Neck's pivot — "1 px right, 64 px above Neck" |
| Rotation deformer (Face Rotation) | Hair Side Up R Rotation 0 | (-233.74, -528.07) | canvas px offset from Face Rotation's pivot |

The same rule applies to **warp children of rotation deformers**: grid positions
are in canvas-pixel offsets from the parent rotation deformer's pivot.  Hiyori's
FaceParallax warps (children of Face Rotation) have grid values like
`(-60..292, -435..-45)` — pixel offsets covering the face region relative to
Face Rotation's pivot.

### Consequence for SS export (Session 20)

When emitting a warp under a rotation deformer (e.g. FaceParallax under Face
Rotation), grid values MUST be canvas-pixel offsets from the rotation deformer's
canvas pivot:

```javascript
fpRestLocal[i*2]     = canvas_x - facePivotCx;
fpRestLocal[i*2 + 1] = canvas_y - facePivotCy;
```

**Not** the nested 0..1 scale the rest of the Body X chain uses.  Session 19
attempts that passed Body-X-0..1 values (~0.5) through Face Rotation collapsed
the face to canvas ~(0, 0) (chest area) because Cubism interpreted the 0..1
values as sub-pixel offsets.

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

---

## Per-Part Parameter Bindings — Session 16

Implementation details and reverse-engineered Hiyori patterns for standard
facial/head parameters. See SESSION16_FINDINGS.md for the full investigation
and design log.

### Generic Binding Framework (cmo3writer.js section 3c)

Per-part warp deformers are created for every tagged mesh. Bindings are declared
in `TAG_PARAM_BINDINGS` Map:

```javascript
const TAG_PARAM_BINDINGS = new Map([
  [tag, {
    bindings: [{ pid, keys, desc }, ...],   // 1 or 2 entries (1D or 2D)
    shiftFn: (grid, gW, gH, keyVals[], gxSpan, gySpan, meshCtx) => Float64Array,
  }],
]);
```

The dispatcher generates N keyforms, calling `shiftFn` with each key combination.
For 2D bindings, binding[0] is the inner/fast axis (matches Hiyori's keyform ordering).

### Bound Parameters (Session 16)

| Parameter | Tags | Approach | Formula Summary |
|-----------|------|----------|----------------|
| ParamHairFront | `front hair` | 1D tips-swing | `dx = k * 0.10 * gxS * rowFrac` |
| ParamHairBack | `back hair` | 1D tips-swing | `dx = k * 0.08 * gxS * rowFrac` |
| ParamBrowLY | `eyebrow`, `eyebrow-l` | 1D Y translate | `dy = -k * 0.15 * gyS` |
| ParamBrowRY | `eyebrow-r` | 1D Y translate | Same, R side |
| ParamEyeBallX×Y | `irides`, `-l`, `-r` | 2D uniform translate | `dx = kX * 0.09 * gxS`, `dy = -kY * 0.075 * gyS` |
| ParamEyeLOpen | `eyelash-l`, `eyewhite-l`, `irides-l`, + generics | Parabola curve | See "Eye Closure" below |
| ParamEyeROpen | `eyelash-r`, `eyewhite-r`, `irides-r` | Parabola curve | Same as L, R side |

All use `factor = k` (linear) so meshes collapse exactly at k=0/k=1 extremes.

### Eye Closure: Parabola-Fit Zipper Line

**Anatomical insight**: Closed eye line ≈ lower eyelid = eyewhite mesh's bottom
edge. NOT eyelash's lower edge (which is upper eye opening).

**Pre-pass algorithm** (runs before per-part warp loop):
1. For each eyewhite mesh (preferred) or eyelash mesh (fallback):
   - Sort vertices by X
   - Divide into 6–8 X-bins (scales with vertex count)
   - Per bin: take MAX Y vertex (actual bottom boundary)
   - Fit parabola `y = ax² + bx + c` via least-squares
   - Normalize X to `[-1, 1]` before fitting (avoids x⁴ overflow)
   - Solve 3×3 linear system via Cramer's rule
2. Sample parabola at 7 X positions within fit-data X range ONLY
   (extrapolation diverges quadratically)
3. Apply `yOffset = -0.15 * meshHeight` (raise from absolute bottom to closure line)
4. Convert to Body X space, store in `eyeContexts` array

**Lookup at binding time** (`findEyeCtx(tag, bboxCx, bboxCy)`):
1. Eyewhite with matching side (-l/-r) → preferred
2. Any eyewhite → fallback
3. Eyelash with matching side → fallback
4. Any context, nearest by bbox proximity → last resort

All three eye parts (eyelash, eyewhite, iris) for the same side use the SAME
curve → collapse to a single line at closed state.

**shiftFn logic** (identical across all eye parts):
```javascript
const lerpCurveY = (px) => {
  // Linear extrapolation beyond endpoints (slope of first/last segment)
  if (px <= lx0) return ly0 + slopeL * (px - lx0);
  if (px >= rxN) return ryN + slopeR * (px - rxN);
  // Linear interp within curve
};
for each vertex:
  const cY = lerpCurveY(grid[i]);
  pos[i + 1] = cY + (grid[i + 1] - cY) * factor;  // factor = k
```

**Why linear extrapolation for wings**: eyelash wings extend beyond eyewhite's
X range. Clamping to endpoint Y creates flat horizontal extension (ugly).
Collapsing to corner point narrows the eye (ugly). Linear extrapolation with
slope at endpoints follows the parabola's natural trajectory → wings curl up
toward eye corner naturally.

### Eyewhite vs Eyelash Curvature

For a typical eye shape:
- **Eyewhite lower half** (Y > median) → bin-max-Y gives: max Y at middle, smaller Y at corners → parabola with `a < 0` → **smile shape directly** (middle dips down)
- **Eyelash lower half** → opposite curvature → parabola with `a > 0` → **frown shape**

For eyewhite source: use parabola directly.
For eyelash fallback: flip around line-through-endpoints (`y_new = 2*yLine - y`) to preserve tilt while inverting curvature.

### Why NOT Percentile Bbox for Face Parts

Earlier attempt: 10-90 percentile X for warp bbox (tighter editor display, avoids outlier vertices from PSD transparent-pixel triangulation).

**Problem**: Mesh vertices outside the percentile bbox end up with `<0` or `>1`
warp-local coords → bilinear extrapolation goes wild at collapsed keyforms →
"peaks sticking out" visual glitch.

**Final**: Use FULL vertex extent for warp bbox. Slightly larger editor display
(cosmetic) but clean compression with no extrapolation artifacts.
