# Mesh Generation Logic

This document distills the technical logic used in `stretchystudio` to generate a 2D mesh from a transparent image (RGBA data). The primary goal is to create a deformable mesh that closely tracks the opaque regions of an image while avoiding artifacts during deformation.

## Core Pipeline

The generation process is orchestrated in `src/mesh/generate.js` and follows these steps:

### 1. Alpha Mask Dilation
**Logic:** `dilateAlphaMask` in `src/mesh/contour.js`
- **Binary Mask:** First, a binary mask is created: `1` if alpha >= threshold (typically 20), `0` otherwise.
- **Morphological Dilation:** The mask is dilated by a small radius (default 2px). 
- **Purpose:** Dilation expands the "opaque" zone outward. This ensures that the boundary vertices lie slightly outside the visual edges of the image. When the mesh is later deformed, this prevents "chord-shortcuts" (where a straight edge between mesh vertices might otherwise cut into the curved boundary of the image content). The image's original alpha channel handles the final transparency clipping during rendering.

### 2. Multi-Region Contour Tracing
**Logic:** `traceAllContours` in `src/mesh/contour.js`
- **Island Detection:** The algorithm scans the mask for "start" pixels (opaque pixels with a transparent neighbor to the left).
- **Tracer:** For each island, it traces the boundary using a standard 8-connectivity Moore Neighborhood algorithm, keeping track of visited pixels to avoid re-tracing.
- **Result:** A list of closed loops (contours) representing every separate opaque region in the image.

### 3. Edge Point Optimization
**Logic:** `resampleContour` and `smoothContour` in `src/mesh/contour.js`
- **Proportional Distribution:** A target number of edge points (e.g., 80) is distributed across all contours based on their relative perimeters. Larger regions get more boundary vertices.
- **Arc-Length Resampling:** Raw pixel-traced borders are resampled so that vertices are spaced uniformly according to Euclidean distance.
- **Smoothing:** Laplacian smoothing (neighbor-averaging) is applied to the boundary coordinates to reduce jitter and simplify the geometry.

### 4. Interior Sampling
**Logic:** `sampleInterior` and `filterByEdgePadding` in `src/mesh/sample.js`
- **Jittered Grid:** Points are sampled inside the *original* alpha mask (not the dilated one) using a grid with a specified spacing (e.g., 30px). A random "jitter" is added to each point to avoid rigid grid-aligned artifacts.
- **Edge Padding:** To prevent the formation of extremely thin/sliver triangles, any interior point within a certain distance (the `edgePadding`) of an edge point is discarded.

### 5. Deduplication and Triangulation
**Logic:** `triangulate` in `src/mesh/delaunay.js`
- **Proximity Filter:** Points within a tiny radius (4.0 distance squared) of each other are merged.
- **Delaunay Triangulation:** The final collection of points is passed to `delaunator`. This creates a robust triangulation that maximizes the minimum angle of the triangles, providing a stable structure for deformation.

### 6. UV and Data Mapping
**Logic:** `src/mesh/generate.js`
- **UV Generation:** Vertex coordinates are normalized by image dimensions to create UVs `[0, 1]`.
- **Mesh Schema:** The final output is returned as:
  - `vertices`: Array of `{x, y, restX, restY}` objects.
  - `uvs`: Flat `Float32Array` of `[u0, v0, u1, v1...]`.
  - `triangles`: Array of vertex index triplets `[i, j, k]`.
  - `edgeIndices`: A `Set` of indices indicating which vertices belong to the boundary (used for specific physics/pinning logic).

## Key Parameters
- `alphaThreshold`: Sensitivity to transparency.
- `gridSpacing`: Density of interior mesh points.
- `numEdgePoints`: Density of boundary mesh points.
- `edgePadding`: Buffer between border and interior.
- `dilationRadius`: "Over-coverage" of the mesh relative to the image.
