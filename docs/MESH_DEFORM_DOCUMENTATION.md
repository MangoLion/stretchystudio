# Mesh Deformation System - Technical Documentation

## Overview

This document describes a complete mesh deformation system that allows users to:
1. Load a transparent image
2. Automatically detect edges using alpha channel analysis
3. Generate a mesh using Delaunay triangulation with both edge and interior vertices
4. Interactively deform the mesh while preserving texture mapping

The system consists of five major components: **Edge Detection**, **Point Sampling**, **Delaunay Triangulation**, **Texture Mapping**, and **Interaction**.

---

## 1. Edge Detection & Contour Tracing

### Purpose
Extract the outline of the transparent image by detecting the boundary between transparent and opaque pixels.

### Algorithm: Moore-Neighbor Contour Tracing

**Input Parameters:**
- `thresh` (1-254): Alpha channel threshold. Pixels with alpha ≥ thresh are considered "inside"
- Image pixel data with RGBA values

**Process:**

1. **Find Starting Point**: Scan the image left-to-right, top-to-bottom for the first pixel where:
   - The pixel itself is "inside" (alpha ≥ thresh)
   - The pixel to its left is "outside" (alpha < thresh)

2. **Trace Boundary**: Use 8-directional Moore neighbor algorithm:
   - Start from the initial edge pixel
   - At each step, check 8 neighbors (N, NE, E, SE, S, SW, W, NW)
   - Always move to the next inside pixel
   - Use directional bias to maintain consistent tracing

3. **Termination**: Stop when returning to the starting point

**Code:**
```javascript
function traceContour(thresh) {
  // Find first edge pixel (inside-outside boundary)
  let sx = -1, sy = -1;
  outer: for (let y = 1; y < imgH - 1; y++) {
    for (let x = 1; x < imgW - 1; x++) {
      if (inside(x, y, thresh) && !inside(x - 1, y, thresh)) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }
  if (sx < 0) return []; // No contour found

  // 8-directional neighbors: E, NE, N, NW, W, SW, S, SE
  const dirs8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [[sx, sy]];
  let cx = sx, cy = sy, prevDir = 6; // Start looking from W direction
  const limit = imgW * imgH * 2;
  let steps = 0;

  while (steps++ < limit) {
    let found = false;
    // Check 8 neighbors, starting from direction after previous
    for (let i = 0; i < 8; i++) {
      const d = (prevDir + 6 + i) % 8; // Bias: look counter-clockwise from last direction
      const nx = cx + dirs8[d][0];
      const ny = cy + dirs8[d][1];
      if (nx < 0 || nx >= imgW || ny < 0 || ny >= imgH) continue;
      if (inside(nx, ny, thresh)) {
        prevDir = d;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy) break; // Returned to start
    contour.push([cx, cy]);
  }
  return contour;
}

// Helper: Check if pixel at (x,y) is inside (alpha >= threshold)
function inside(x, y, thresh) {
  x = Math.max(0, Math.min(imgW - 1, Math.round(x)));
  y = Math.max(0, Math.min(imgH - 1, Math.round(y)));
  return pixelData[(y * imgW + x) * 4 + 3] >= thresh;
}
```

### Output
Array of points `[[x1, y1], [x2, y2], ...]` forming the image boundary in image-space coordinates.

---

## 2. Contour Smoothing & Resampling

### Purpose
Reduce noise in the traced contour and normalize point distribution for mesh generation.

### Algorithm: Contour Resampling

**Input:**
- `contour`: Raw contour points (may have irregular spacing)
- `n`: Target number of points

**Process:**

1. **Arc Length Calculation**: 
   - Calculate cumulative distance along the contour
   - Used for uniform resampling

2. **Uniform Resampling**:
   - Divide total arc length into n equal segments
   - Interpolate points along the contour at each segment boundary
   - Uses linear interpolation between adjacent contour points

**Code:**
```javascript
function resampleContour(contour, n) {
  if (contour.length < 2) return contour;
  
  // Build arc length lookup table
  const lens = [0];
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i][0] - contour[i - 1][0];
    const dy = contour[i][1] - contour[i - 1][1];
    lens.push(lens[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  
  // Add closing segment length (from last point back to first)
  const dx0 = contour[0][0] - contour[contour.length - 1][0];
  const dy0 = contour[0][1] - contour[contour.length - 1][1];
  const total = lens[lens.length - 1] + Math.sqrt(dx0 * dx0 + dy0 * dy0);
  
  // Interpolate n points uniformly along arc length
  const result = [];
  const step = total / n;
  let j = 0;
  
  for (let i = 0; i < n; i++) {
    const target = i * step;
    // Find segment containing target arc length
    while (j < lens.length - 1 && lens[j + 1] < target) j++;
    // Interpolation parameter (0 to 1)
    const t2 = (j < lens.length - 1)
      ? Math.min(1, (target - lens[j]) / (lens[j + 1] - lens[j]))
      : 0;
    const a = contour[j];
    const b = contour[(j + 1) % contour.length];
    result.push([
      a[0] + (b[0] - a[0]) * t2,
      a[1] + (b[1] - a[1]) * t2
    ]);
  }
  return result;
}
```

### Algorithm: Laplacian Smoothing

**Input:**
- `pts`: Points to smooth
- `passes`: Number of smoothing iterations

**Process:**
Each iteration replaces each point with the average of itself and its neighbors, reducing high-frequency noise.

**Code:**
```javascript
function smoothContour(pts, passes) {
  let p = pts.slice();
  for (let k = 0; k < passes; k++) {
    p = p.map((pt, i) => {
      const prev = p[(i - 1 + p.length) % p.length];
      const next = p[(i + 1) % p.length];
      return [
        (prev[0] + pt[0] * 2 + next[0]) / 4,
        (prev[1] + pt[1] * 2 + next[1]) / 4
      ];
    });
  }
  return p;
}
```

### Output
Smoothed, uniformly-spaced edge points.

---

## 3. Interior Point Sampling

### Purpose
Generate points inside the shape for denser mesh coverage away from edges.

### Algorithm: Stratified Jittered Sampling

**Input:**
- `thresh`: Alpha threshold (for inside/outside test)
- `spacing`: Grid spacing (controls point density)

**Process:**

1. **Grid Generation**: Place a regular grid with `spacing` distance apart
2. **Jittering**: Add random offset (±40% of spacing) to each grid point
3. **Validity Test**: Keep only points that are inside the shape (alpha ≥ thresh)
4. **Edge Padding**: Optionally filter out points too close to edge

**Code:**
```javascript
function sampleInterior(thresh, spacing) {
  const pts = [];
  const jitter = spacing * 0.4; // Max jitter: 40% of spacing
  
  for (let y = spacing; y < imgH - spacing / 2; y += spacing) {
    for (let x = spacing; x < imgW - spacing / 2; x += spacing) {
      // Add random offset in both directions
      const jx = x + (Math.random() - 0.5) * jitter * 2;
      const jy = y + (Math.random() - 0.5) * jitter * 2;
      
      if (inside(jx, jy, thresh)) {
        pts.push([jx, jy]);
      }
    }
  }
  return pts;
}

// Optional: Filter interior points to maintain distance from edges
function filterByEdgePadding(interiorPts, edgePts, padding) {
  const pad2 = padding * padding;
  return interiorPts.filter(p => {
    for (const ep of edgePts) {
      const dx = p[0] - ep[0];
      const dy = p[1] - ep[1];
      if (dx * dx + dy * dy < pad2) return false;
    }
    return true;
  });
}
```

### Output
Array of interior points as `[[x, y], ...]`.

---

## 4. Delaunay Triangulation

### Purpose
Generate a mesh of triangles from point set, optimizing for well-shaped triangles (no points inside circumcircles).

### Algorithm: Bowyer-Watson Incremental Delaunay

**Input:**
- `points`: Array of `[x, y]` coordinates

**Process:**

1. **Super Triangle**: Create an initial large triangle containing all points
2. **Incremental Insertion**: For each point:
   - Find all triangles whose circumcircle contains the point (bad triangles)
   - Remove bad triangles
   - Find boundary edges of the cavity
   - Create new triangles connecting the point to boundary edges
3. **Cleanup**: Remove triangles using super-triangle vertices

**Code:**
```javascript
function delaunay(points) {
  if (points.length < 3) return [];
  
  // Find bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  
  // Create super triangle: large triangle far outside bounding box
  const dx = maxX - minX;
  const dy = maxY - minY;
  const d = Math.max(dx, dy) * 10;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const n = points.length;
  
  const all = [
    ...points,
    [mx - d * 2, my - d],      // Super triangle vertex 1
    [mx, my + d * 2],          // Super triangle vertex 2
    [mx + d * 2, my - d]       // Super triangle vertex 3
  ];

  // Circumcircle calculation: returns center and radius² of circle through 3 points
  function circumcircle(a, b, c) {
    const [ax, ay] = all[a];
    const [bx, by] = all[b];
    const [cx, cy] = all[c];
    
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null; // Degenerate triangle
    
    const ax2 = ax * ax + ay * ay;
    const bx2 = bx * bx + by * by;
    const cx2 = cx * cx + cy * cy;
    
    const ux = (ax2 * (by - cy) + bx2 * (cy - ay) + cx2 * (ay - by)) / D;
    const uy = (ax2 * (cx - bx) + bx2 * (ax - cx) + cx2 * (bx - ax)) / D;
    
    return {
      x: ux,
      y: uy,
      r2: (ux - ax) * (ux - ax) + (uy - ay) * (uy - ay)
    };
  }

  // Start with super triangle
  let T = [{
    v: [n, n + 1, n + 2],
    cc: circumcircle(n, n + 1, n + 2)
  }];

  // Insert each point
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i];
    
    // Find triangles whose circumcircle contains this point
    const bad = T.filter(t => {
      if (!t.cc) return true;
      const dx = px - t.cc.x;
      const dy = py - t.cc.y;
      return dx * dx + dy * dy <= t.cc.r2 + 1e-10;
    });

    // Find boundary edges of bad triangles (edges appearing once)
    const emap = {};
    for (const t of bad) {
      for (const [a, b] of [
        [t.v[0], t.v[1]],
        [t.v[1], t.v[2]],
        [t.v[2], t.v[0]]
      ]) {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        emap[k] = (emap[k] || 0) + 1;
      }
    }

    // Remove bad triangles
    T = T.filter(t => !bad.includes(t));

    // Add new triangles connecting point to boundary edges
    for (const [k, cnt] of Object.entries(emap)) {
      if (cnt === 1) { // Boundary edge (appears once)
        const [a, b] = k.split('_').map(Number);
        const v = [a, b, i];
        T.push({
          v,
          cc: circumcircle(...v)
        });
      }
    }
  }

  // Remove super triangle (keep only triangles using original points)
  return T.filter(t => t.v.every(v => v < n)).map(t => t.v);
}
```

### Output
Array of triangles: `[[v0, v1, v2], ...]` where each value is a vertex index.

---

## 5. Texture Mapping & Rendering

### Purpose
Map and render the original image texture onto the deformed mesh, maintaining visual continuity.

### Algorithm: Per-Triangle Affine Texture Mapping

**Key Concept:**
- Each triangle has an original position (source) and deformed position (destination)
- We compute an affine transformation that maps source → destination
- For each triangle, we clip to the destination triangle and apply the transform

**Code:**
```javascript
function drawTexturedMesh(srcImage, vertices, triangles, scale) {
  const ctx = canvas.getContext('2d');
  
  for (const [ai, bi, ci] of triangles) {
    const va = vertices[ai];
    const vb = vertices[bi];
    const vc = vertices[ci];
    if (!va || !vb || !vc) continue;

    // Source triangle coordinates (original image positions)
    const ax = va.ox, ay = va.oy;
    const bx = vb.ox, by = vb.oy;
    const cx = vc.ox, cy = vc.oy;

    // Destination triangle coordinates (deformed positions)
    const dax = va.x, day = va.y;
    const dbx = vb.x, dby = vb.y;
    const dcx = vc.x, dcy = vc.y;

    // Compute affine transform: src -> dst
    // We need matrix M such that: M * [A_src, B_src, C_src] = [A_dst, B_dst, C_dst]
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 0.5) continue; // Degenerate source triangle

    const id = 1 / det;

    // Destination offsets from A
    const u0 = dbx - dax, u1 = dby - day; // B_dst - A_dst
    const v0 = dcx - dax, v1 = dcy - day; // C_dst - A_dst

    // Source offsets from A
    const s0 = bx - ax, s1 = by - ay;     // B_src - A_src
    const t0 = cx - ax, t1 = cy - ay;     // C_src - A_src

    // Compute M = [u v] * inv([s t])
    // where inv([s0 t0; s1 t1]) = 1/det * [t1 -t0; -s1 s0]
    const m00 = (u0 * t1 - v0 * s1) * id;
    const m01 = (v0 * s0 - u0 * t0) * id;
    const m10 = (u1 * t1 - v1 * s1) * id;
    const m11 = (v1 * s0 - u1 * t0) * id;
    const m02 = dax - m00 * ax - m01 * ay;
    const m12 = day - m10 * ax - m11 * ay;

    // Draw: clip to destination triangle, apply transform, draw source image
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dax, day);
    ctx.lineTo(dbx, dby);
    ctx.lineTo(dcx, dcy);
    ctx.closePath();
    ctx.clip();

    ctx.transform(m00, m10, m01, m11, m02, m12);
    ctx.drawImage(srcImage, 0, 0);
    ctx.restore();
  }
}
```

**Mathematical Explanation:**

Given source triangle with vertices A, B, C and deformed triangle with vertices A', B', C':

1. We model the transformation as: `[x', y'] = M * [x, y] + offset`
2. The 2x2 matrix M maps source directions to destination directions:
   - `M * (B - A) = (B' - A')`
   - `M * (C - A) = (C' - A')`
3. This gives us: `M = [B'-A', C'-A'] * inv([B-A, C-A])`

---

## 6. Vertex Deformation & Interaction

### Purpose
Allow users to interactively drag mesh vertices and recompute the deformed geometry.

### Key Data Structure

```javascript
let vertices = [
  { x: 100, y: 150, ox: 100, oy: 150 },  // ox, oy = original position
  { x: 102, y: 155, ox: 100, oy: 150 },  // x, y = current deformed position
  // ...
];
let tris = [[0, 1, 2], [1, 2, 3], ...];   // Triangle indices
```

### Interaction Modes

**1. Deform Mode:**
- Drag near a vertex to move it
- Mesh deforms, texture warps naturally

**2. Add Mode:**
- Click to add new vertices
- Mesh is retriangulated automatically

**Code:**
```javascript
function nearestVertex(x, y, radius) {
  let best = -1;
  let bestD = radius * radius;
  vertices.forEach((v, i) => {
    const d = (v.x - x) * (v.x - x) + (v.y - y) * (v.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// Mouse interaction
let dragging = null;
let dragDX = 0, dragDY = 0;

canvas.addEventListener('mousedown', (e) => {
  const [cx, cy] = canvasXY(e); // Convert screen coords to image coords
  const idx = nearestVertex(cx, cy, 14 / scale);
  if (idx >= 0) {
    dragging = idx;
    dragDX = cx - vertices[idx].x;
    dragDY = cy - vertices[idx].y;
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (dragging === null) return;
  const [cx, cy] = canvasXY(e);
  vertices[dragging].x = cx - dragDX;
  vertices[dragging].y = cy - dragDY;
  draw(); // Redraw with new deformation
});

canvas.addEventListener('mouseup', () => {
  dragging = null;
});
```

---

## 7. Complete Integration Example

```javascript
class MeshDeformer {
  constructor(canvasElement, imageElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.sourceImage = imageElement;
    
    this.vertices = [];
    this.triangles = [];
    this.edgeVertexIndices = new Set();
    this.scale = 1;
    
    this.dragging = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    
    this.setupInput();
  }
  
  setupInput() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onMouseUp());
  }
  
  generateMesh(alphaThreshold, smoothPasses, interiorSpacing, edgePadding, numEdgePoints) {
    // Get pixel data from offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = this.sourceImage.width;
    offscreen.height = this.sourceImage.height;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(this.sourceImage, 0, 0);
    
    // Extract edges
    const contour = traceContour(offCtx, alphaThreshold);
    let edgePts = resampleContour(contour, numEdgePoints);
    edgePts = smoothContour(edgePts, smoothPasses);
    
    // Sample interior
    let interiorPts = sampleInterior(offCtx, alphaThreshold, interiorSpacing);
    if (edgePadding > 0) {
      interiorPts = filterByEdgePadding(interiorPts, edgePts, edgePadding);
    }
    
    // Combine and triangulate
    const allPts = [...edgePts, ...interiorPts];
    this.edgeVertexIndices = new Set(edgePts.map((_, i) => i));
    
    // Deduplicate nearby points
    const deduped = [];
    const minDistance2 = 4;
    for (const p of allPts) {
      let keep = true;
      for (const q of deduped) {
        const dx = p[0] - q[0], dy = p[1] - q[1];
        if (dx * dx + dy * dy < minDistance2) {
          keep = false;
          break;
        }
      }
      if (keep) deduped.push(p);
    }
    
    this.triangles = delaunay(deduped);
    this.vertices = deduped.map(([x, y]) => ({ x, y, ox: x, oy: y }));
  }
  
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.sourceImage) return;
    
    this.ctx.save();
    this.ctx.scale(this.scale, this.scale);
    
    // Draw textured mesh
    if (this.triangles.length > 0) {
      drawTexturedMesh(this.sourceImage, this.vertices, this.triangles, this.scale);
    } else {
      this.ctx.drawImage(this.sourceImage, 0, 0);
    }
    
    this.ctx.restore();
  }
  
  onMouseDown(e) {
    const [x, y] = this.canvasToImageCoords(e);
    const idx = this.nearestVertex(x, y, 14 / this.scale);
    if (idx >= 0) {
      this.dragging = idx;
      this.dragOffsetX = x - this.vertices[idx].x;
      this.dragOffsetY = y - this.vertices[idx].y;
      this.canvas.style.cursor = 'grabbing';
    }
  }
  
  onMouseMove(e) {
    if (this.dragging === null) return;
    const [x, y] = this.canvasToImageCoords(e);
    this.vertices[this.dragging].x = x - this.dragOffsetX;
    this.vertices[this.dragging].y = y - this.dragOffsetY;
    this.draw();
  }
  
  onMouseUp() {
    this.dragging = null;
    this.canvas.style.cursor = 'crosshair';
  }
  
  canvasToImageCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) / this.scale,
      (e.clientY - rect.top) / this.scale
    ];
  }
  
  nearestVertex(x, y, radius) {
    let best = -1, bestDist2 = radius * radius;
    this.vertices.forEach((v, i) => {
      const dx = v.x - x, dy = v.y - y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < bestDist2) {
        bestDist2 = dist2;
        best = i;
      }
    });
    return best;
  }
  
  reset() {
    this.vertices.forEach(v => { v.x = v.ox; v.y = v.oy; });
    this.draw();
  }
}
```

---

## Performance Considerations

1. **Delaunay Triangulation**: O(n log n) average case. For typical meshes (100-1000 vertices), this is fast enough for interactive use.

2. **Texture Mapping**: For each frame, we iterate over all triangles. With proper clipping, only visible fragments are drawn.

3. **Interaction**: Per-frame cost is dominated by drawing, not mesh updates. Dragging is smooth even with thousands of triangles.

4. **Point Deduplication**: Prevents accidental duplicate vertices that would degenerate the mesh. Uses O(n²) comparison but necessary for robustness.

---

## Parameters & Tuning

| Parameter | Range | Effect |
|-----------|-------|--------|
| **Alpha Threshold** | 1-254 | Lower = include more semi-transparent pixels |
| **Contour Smoothing** | 0-8 | Higher = smoother edges, fewer details |
| **Interior Spacing** | 8-80 | Lower = more interior vertices, denser mesh |
| **Edge Padding** | 0-40 | Spacing between interior points and edge |
| **Edge Points** | 30-300 | Number of points to sample on edge contour |

---

## Known Limitations & Future Improvements

1. **Self-intersecting Meshes**: If deformed too aggressively, triangles can flip. No prevention implemented.
2. **Multi-Shape Contours**: Only traces first contour found. Doesn't handle images with holes.
3. **Performance**: Canvas rendering scales linearly with triangle count. Very large meshes (>5000 triangles) may be slow.
4. **Memory**: Stores original and current positions for all vertices. Could be optimized.

