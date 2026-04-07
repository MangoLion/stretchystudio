# Integration Guide - Mesh Deformer

Quick reference for integrating the mesh deformation system into your main project.

## Files Generated

1. **mesh-deform.js** - Complete, standalone library (no HTML/CSS dependencies)
2. **MESH_DEFORM_DOCUMENTATION.md** - Full technical documentation with algorithm explanations
3. **INTEGRATION_GUIDE.md** - This file

## Basic Usage

### 1. Import the Library

```html
<script src="path/to/mesh-deform.js"></script>
```

Or in a module context:
```javascript
const { MeshDeformer } = require('./mesh-deform.js');
```

### 2. Initialize

```javascript
const canvas = document.getElementById('myCanvas');
const deformer = new MeshDeformer(canvas);
```

### 3. Load Image and Generate Mesh

```javascript
// Load image
const img = new Image();
img.src = 'path/to/transparent-image.png';
img.onload = () => {
  deformer.loadImage(img);
  
  // Generate mesh with parameters
  deformer.generateMesh({
    alphaThreshold: 20,      // 1-254: edge detection threshold
    smoothPasses: 3,         // 0-8: contour smoothing iterations
    gridSpacing: 30,         // 8-80: interior point density
    edgePadding: 8,          // 0-40: distance from edge to interior
    numEdgePoints: 80        // 30-300: edge vertex count
  });
};
```

### 4. Enable Interaction

```javascript
deformer.startInteraction();

// Optional: Listen to events
deformer.onMeshGenerated = (stats) => {
  console.log(`Mesh: ${stats.vertexCount} vertices, ${stats.triangleCount} triangles`);
};

deformer.onVertexDragged = (vertexIndex) => {
  // Called while dragging vertices (useful for real-time feedback)
};
```

### 5. Mesh Operations

```javascript
// Reset to original deformation
deformer.reset();

// Clear mesh and image
deformer.clear();

// Save state
const state = deformer.toJSON();
localStorage.setItem('meshState', JSON.stringify(state));

// Load state
const saved = JSON.parse(localStorage.getItem('meshState'));
deformer.fromJSON(saved);

// Manual redraw
deformer.draw();
```

## API Reference

### MeshDeformer Class

#### Constructor
```javascript
new MeshDeformer(canvasElement)
```

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `loadImage` | `(imageElement)` | Load source image |
| `fitCanvasToImage` | `(maxWidth?, maxHeight?)` | Resize canvas to fit image |
| `generateMesh` | `(options)` | Generate triangulated mesh |
| `startInteraction` | `()` | Enable mouse/touch input |
| `reset` | `()` | Reset deformation to original |
| `clear` | `()` | Clear mesh and image |
| `draw` | `()` | Render current state |
| `screenToImageCoords` | `(screenX, screenY)` | Convert screen to image coords |
| `findNearestVertex` | `(x, y, radius)` | Find vertex near position |
| `toJSON` | `()` | Export mesh state |
| `fromJSON` | `(data)` | Import mesh state |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `vertices` | `Vertex[]` | Mesh vertices |
| `triangles` | `[number,number,number][]` | Triangle connectivity |
| `edgeVertexIndices` | `Set<number>` | Indices of edge vertices |
| `scale` | `number` | Canvas scale factor |

#### Events

```javascript
deformer.onMeshGenerated = (stats) => {
  // Called after generateMesh() completes
  // stats: {vertexCount, triangleCount, edgeVertexCount}
};

deformer.onVertexDragged = (vertexIndex) => {
  // Called while user drags a vertex
};
```

## Advanced: Using Individual Algorithms

If you need just specific algorithms:

```javascript
const { traceContour, resampleContour, delaunay, PixelBuffer } = require('./mesh-deform.js');

// 1. Get pixel data
const canvas = document.createElement('canvas');
canvas.width = image.width;
canvas.height = image.height;
const ctx = canvas.getContext('2d');
ctx.drawImage(image, 0, 0);
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const pixels = new PixelBuffer(imageData);

// 2. Trace edges
const contour = traceContour(pixels, 20); // threshold: 20

// 3. Process contour
const resampled = resampleContour(contour, 100);
const smoothed = smoothContour(resampled, 3);

// 4. Triangulate
const triangles = delaunay(smoothed);
```

## Performance Tips

1. **Reduce Vertices**: Lower `gridSpacing` = more vertices = slower interaction. Start with 30-40.

2. **Smaller Images**: Large images (>2048px) slow down edge detection. Resize if needed.

3. **Fewer Edge Points**: Don't need 300 edge points for simple shapes. 80 is usually plenty.

4. **Disable Rendering**: During mesh generation, consider hiding the canvas:
   ```javascript
   canvas.style.display = 'none';
   deformer.generateMesh(options);
   canvas.style.display = 'block';
   ```

## Common Patterns

### Pattern 1: Simple One-Shot Usage

```javascript
const deformer = new MeshDeformer(canvas);
deformer.loadImage(img);
deformer.generateMesh();
deformer.startInteraction();
```

### Pattern 2: Multiple Images

```javascript
const deformer = new MeshDeformer(canvas);

function switchImage(imgUrl) {
  deformer.clear();
  const img = new Image();
  img.onload = () => {
    deformer.loadImage(img);
    deformer.generateMesh();
  };
  img.src = imgUrl;
}
```

### Pattern 3: Batch Processing (No Interaction)

```javascript
const deformer = new MeshDeformer(offscreenCanvas);
images.forEach(img => {
  deformer.loadImage(img);
  deformer.generateMesh({gridSpacing: 50}); // Coarse mesh for speed
  processDeformedImage(deformer.canvas);
});
```

### Pattern 4: Preset Deformations

```javascript
const state = deformer.toJSON();

// User deforms mesh...

// Revert to original
deformer.fromJSON(state);

// Or apply saved deformation
const saved = JSON.parse(someJSON);
deformer.fromJSON(saved);
```

## Troubleshooting

**Issue: Mesh doesn't generate**
- Check that image has proper transparency (PNG with alpha channel)
- Verify `alphaThreshold` isn't too high (try 10-30)
- Ensure image dimensions are reasonable (>50px)

**Issue: Slow mesh generation**
- Reduce `gridSpacing` (start with 40)
- Reduce `numEdgePoints` (start with 60)
- Use smaller image

**Issue: Texture mapping looks wrong**
- Ensure image is loaded before calling `generateMesh()`
- Check that image CORS headers allow canvas access
- Verify triangles aren't self-intersecting (use `reset()` to fix)

**Issue: Vertex dragging is laggy**
- Reduce vertex count (increase `gridSpacing`)
- Reduce frame rendering overhead elsewhere
- Check browser dev tools for performance bottlenecks

## Integration Examples

### React Component

```javascript
import { useRef, useEffect } from 'react';
import { MeshDeformer } from './mesh-deform.js';

export function MeshDeformerComponent() {
  const canvasRef = useRef(null);
  const deformerRef = useRef(null);

  useEffect(() => {
    deformerRef.current = new MeshDeformer(canvasRef.current);
  }, []);

  const handleLoadImage = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        deformerRef.current.loadImage(img);
        deformerRef.current.generateMesh();
        deformerRef.current.startInteraction();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <input type="file" onChange={(e) => handleLoadImage(e.target.files[0])} />
      <canvas ref={canvasRef} style={{ border: '1px solid #ccc' }} />
    </>
  );
}
```

### Vue Component

```vue
<template>
  <div>
    <input type="file" @change="loadImage" />
    <canvas ref="canvas" />
  </div>
</template>

<script>
import { MeshDeformer } from './mesh-deform.js';

export default {
  data() {
    return {
      deformer: null
    };
  },
  mounted() {
    this.deformer = new MeshDeformer(this.$refs.canvas);
  },
  methods: {
    loadImage(e) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          this.deformer.loadImage(img);
          this.deformer.generateMesh();
          this.deformer.startInteraction();
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    }
  }
};
</script>
```

## Parameter Tuning Guide

Choose parameters based on your use case:

### For Fine Detail (Character/Face)
```javascript
{
  alphaThreshold: 15,      // More sensitive edge detection
  smoothPasses: 5,         // Smoother boundary
  gridSpacing: 15,         // Dense mesh
  edgePadding: 5,          // Small buffer
  numEdgePoints: 150       // Many edge points
}
```

### For Smooth Shapes (Balloons, Circles)
```javascript
{
  alphaThreshold: 25,
  smoothPasses: 6,
  gridSpacing: 40,
  edgePadding: 10,
  numEdgePoints: 100
}
```

### For Performance (Real-time)
```javascript
{
  alphaThreshold: 20,
  smoothPasses: 2,
  gridSpacing: 50,         // Coarse mesh
  edgePadding: 15,
  numEdgePoints: 60        // Few edge points
}
```

### For Symmetry/Precision
```javascript
{
  alphaThreshold: 18,
  smoothPasses: 4,
  gridSpacing: 25,
  edgePadding: 8,
  numEdgePoints: 120
}
```
