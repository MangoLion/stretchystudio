# Mesh Generation Parameters

This document describes all parameters available for customizing mesh generation in Mesh Deformer.

## Edge Detection

### Alpha Threshold
- **Range:** 1–254
- **Default:** 20
- **Description:** Determines which pixels are considered part of the shape based on alpha transparency. Only pixels with alpha values greater than or equal to this threshold are included in the edge detection. Lower values include more semi-transparent pixels; higher values require pixels to be nearly opaque.

### Contour Smooth
- **Range:** 0–8
- **Default:** 3
- **Description:** The number of smoothing passes applied to the detected contour. Each pass applies a simple averaging filter to reduce jaggedness and create a smoother outline. Higher values produce smoother edges but may lose fine detail.

## Mesh Density

### Interior Spacing
- **Range:** 8–80 pixels
- **Default:** 30
- **Description:** The approximate grid spacing for sampling interior vertices. Controls how densely packed the mesh is inside the shape. Smaller values create finer, denser meshes with more vertices; larger values create coarser meshes.

### Edge Padding
- **Range:** 0–40 pixels
- **Default:** 8
- **Description:** Creates an exclusion buffer zone around edge vertices. Interior points within this distance from the edge are removed, preventing interior vertices from being placed too close to the boundary. Use higher values for cleaner edge definition.

### Edge Points
- **Range:** 30–300 vertices
- **Default:** 80
- **Description:** The number of vertices sampled along the edge contour. Determines how finely the shape boundary is represented. More points create a more accurate boundary representation but increase overall mesh complexity.

## View Options

### Image
- **Type:** Toggle
- **Default:** ON
- **Description:** Display the original image (textured with deformations applied).

### Mesh Wireframe
- **Type:** Toggle
- **Default:** ON
- **Description:** Display the triangle wireframe overlay.

### Vertices
- **Type:** Toggle
- **Default:** ON
- **Description:** Show individual vertices. Edge vertices appear in teal; interior vertices appear in purple.

### Edge Outline
- **Type:** Toggle
- **Default:** OFF
- **Description:** Highlight the edge contour with a bright outline.

## Interaction Mode

### Deform
- **Description:** Drag vertices to deform the mesh and image.

### Add pt
- **Description:** Click to add new vertices to the mesh (automatically retriangulates).
