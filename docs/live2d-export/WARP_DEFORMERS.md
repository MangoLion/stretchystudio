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

## TODO: Determine ROOT Space

Need to verify: when a warp deformer's parent is ROOT, what coordinate space
are the grid positions in? Options:
1. Canvas pixel space (positions like 200..700)
2. Normalized canvas space (0..1)
3. Some other convention

Check by: creating a model in Cubism Editor with a warp deformer at ROOT level
and inspecting the exported .cmo3 XML.
