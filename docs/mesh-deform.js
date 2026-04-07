/**
 * Mesh Deformation Library
 *
 * A complete system for generating and interactively deforming meshes from transparent images.
 *
 * Core Components:
 * - Edge detection via alpha channel analysis
 * - Mesh generation using Delaunay triangulation
 * - Interactive vertex manipulation with texture warping
 * - Per-triangle affine texture mapping
 */

// ============================================================================
// UTILITY: Pixel Data & Alpha Access
// ============================================================================

class PixelBuffer {
  constructor(imageData) {
    this.data = imageData.data;
    this.width = imageData.width;
    this.height = imageData.height;
  }

  /**
   * Get alpha value at image coordinates
   * @param {number} x - X coordinate (clamped to bounds)
   * @param {number} y - Y coordinate (clamped to bounds)
   * @returns {number} Alpha value (0-255)
   */
  getAlpha(x, y) {
    x = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    return this.data[(y * this.width + x) * 4 + 3];
  }

  /**
   * Check if pixel is "inside" based on alpha threshold
   */
  isInside(x, y, threshold) {
    return this.getAlpha(x, y) >= threshold;
  }
}

// ============================================================================
// EDGE DETECTION: Moore-Neighbor Contour Tracing
// ============================================================================

/**
 * Trace the boundary contour of an image using alpha channel
 *
 * Algorithm: Moore-neighbor contour following
 * - Finds the leftmost edge pixel where inside meets outside
 * - Traces boundary by following 8-connected neighbors
 *
 * @param {PixelBuffer} pixelBuffer - Pixel data with alpha channel
 * @param {number} alphaThreshold - Minimum alpha to consider "inside"
 * @returns {Array<[number, number]>} Points forming closed contour
 */
function traceContour(pixelBuffer, alphaThreshold) {
  const { width: w, height: h } = pixelBuffer;

  // Find first edge pixel: inside pixel with outside neighbor to the left
  let startX = -1, startY = -1;
  outerLoop: for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (pixelBuffer.isInside(x, y, alphaThreshold) &&
          !pixelBuffer.isInside(x - 1, y, alphaThreshold)) {
        startX = x;
        startY = y;
        break outerLoop;
      }
    }
  }
  if (startX < 0) return []; // No contour found

  // 8-directional neighbors: E, NE, N, NW, W, SW, S, SE
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  const contour = [[startX, startY]];
  let curX = startX, curY = startY;
  let prevDir = 6; // Start looking from W (index 6)

  const maxSteps = w * h * 2;
  let steps = 0;

  while (steps++ < maxSteps) {
    let found = false;

    // Check 8 neighbors, starting counter-clockwise from previous direction
    for (let i = 0; i < 8; i++) {
      const dir = (prevDir + 6 + i) % 8;
      const [dx, dy] = dirs[dir];
      const nx = curX + dx;
      const ny = curY + dy;

      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

      if (pixelBuffer.isInside(nx, ny, alphaThreshold)) {
        prevDir = dir;
        curX = nx;
        curY = ny;
        found = true;
        break;
      }
    }

    if (!found) break;
    if (curX === startX && curY === startY) break; // Closed loop
    contour.push([curX, curY]);
  }

  return contour;
}

// ============================================================================
// CONTOUR PROCESSING: Resampling & Smoothing
// ============================================================================

/**
 * Resample contour to have uniform spacing
 *
 * Uses arc-length parameterization to place n points evenly along the contour.
 *
 * @param {Array<[number, number]>} contour - Original contour points
 * @param {number} numPoints - Target number of output points
 * @returns {Array<[number, number]>} Resampled points
 */
function resampleContour(contour, numPoints) {
  if (contour.length < 2) return contour;

  // Build arc-length lookup table
  const arcLengths = [0];
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i][0] - contour[i - 1][0];
    const dy = contour[i][1] - contour[i - 1][1];
    arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  // Add closing segment
  const lastIdx = contour.length - 1;
  const dx0 = contour[0][0] - contour[lastIdx][0];
  const dy0 = contour[0][1] - contour[lastIdx][1];
  const totalLength = arcLengths[lastIdx] + Math.sqrt(dx0 * dx0 + dy0 * dy0);

  // Interpolate points uniformly along arc length
  const result = [];
  const step = totalLength / numPoints;
  let segmentIdx = 0;

  for (let i = 0; i < numPoints; i++) {
    const targetLength = i * step;

    // Find segment containing this arc length
    while (segmentIdx < arcLengths.length - 1 && arcLengths[segmentIdx + 1] < targetLength) {
      segmentIdx++;
    }

    // Linear interpolation parameter
    const t = (segmentIdx < arcLengths.length - 1)
      ? Math.min(1, (targetLength - arcLengths[segmentIdx]) / (arcLengths[segmentIdx + 1] - arcLengths[segmentIdx]))
      : 0;

    const p0 = contour[segmentIdx];
    const p1 = contour[(segmentIdx + 1) % contour.length];

    result.push([
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t
    ]);
  }

  return result;
}

/**
 * Smooth contour using Laplacian (neighbor averaging) filter
 *
 * Each iteration replaces each point with weighted average of itself and neighbors.
 * Reduces high-frequency noise while preserving overall shape.
 *
 * @param {Array<[number, number]>} points - Points to smooth
 * @param {number} numPasses - Number of smoothing iterations
 * @returns {Array<[number, number]>} Smoothed points
 */
function smoothContour(points, numPasses) {
  let result = points.slice();

  for (let pass = 0; pass < numPasses; pass++) {
    result = result.map((pt, i) => {
      const prev = result[(i - 1 + result.length) % result.length];
      const next = result[(i + 1) % result.length];

      return [
        (prev[0] + pt[0] * 2 + next[0]) / 4,
        (prev[1] + pt[1] * 2 + next[1]) / 4
      ];
    });
  }

  return result;
}

// ============================================================================
// POINT SAMPLING: Interior Grid with Jitter
// ============================================================================

/**
 * Sample interior points using stratified random sampling
 *
 * Creates a regular grid of points and adds random jitter, keeping only
 * points that are inside the shape (based on alpha threshold).
 *
 * @param {PixelBuffer} pixelBuffer - Pixel data with alpha channel
 * @param {number} alphaThreshold - Minimum alpha to consider "inside"
 * @param {number} gridSpacing - Distance between grid points
 * @returns {Array<[number, number]>} Interior sample points
 */
function sampleInterior(pixelBuffer, alphaThreshold, gridSpacing) {
  const points = [];
  const jitterAmount = gridSpacing * 0.4; // Jitter: ±40% of spacing

  for (let y = gridSpacing; y < pixelBuffer.height - gridSpacing / 2; y += gridSpacing) {
    for (let x = gridSpacing; x < pixelBuffer.width - gridSpacing / 2; x += gridSpacing) {
      // Add random offset
      const jx = x + (Math.random() - 0.5) * jitterAmount * 2;
      const jy = y + (Math.random() - 0.5) * jitterAmount * 2;

      if (pixelBuffer.isInside(jx, jy, alphaThreshold)) {
        points.push([jx, jy]);
      }
    }
  }

  return points;
}

/**
 * Filter interior points to maintain distance from edge
 *
 * Removes interior points that are too close to edge vertices,
 * useful for creating a "buffer zone" around the boundary.
 *
 * @param {Array<[number, number]>} interiorPts - Interior points to filter
 * @param {Array<[number, number]>} edgePts - Edge boundary points
 * @param {number} minDistance - Minimum distance to maintain
 * @returns {Array<[number, number]>} Filtered points
 */
function filterByEdgePadding(interiorPts, edgePts, minDistance) {
  const minDist2 = minDistance * minDistance;

  return interiorPts.filter(pt => {
    for (const edgePt of edgePts) {
      const dx = pt[0] - edgePt[0];
      const dy = pt[1] - edgePt[1];
      if (dx * dx + dy * dy < minDist2) return false;
    }
    return true;
  });
}

// ============================================================================
// TRIANGULATION: Bowyer-Watson Delaunay Algorithm
// ============================================================================

/**
 * Generate Delaunay triangulation for point set
 *
 * Creates high-quality triangle mesh using incremental Bowyer-Watson algorithm.
 * Guarantees that no point lies inside any triangle's circumcircle.
 *
 * @param {Array<[number, number]>} points - Points to triangulate
 * @returns {Array<[number, number, number]>} Triangles as vertex index triplets
 */
function delaunay(points) {
  if (points.length < 3) return [];

  // Find bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // Create super-triangle: large triangle far outside bounding box
  const dx = maxX - minX;
  const dy = maxY - minY;
  const d = Math.max(dx, dy) * 10;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const numPoints = points.length;

  const allPoints = [
    ...points,
    [mx - d * 2, my - d],      // Super vertex 1
    [mx, my + d * 2],          // Super vertex 2
    [mx + d * 2, my - d]       // Super vertex 3
  ];

  /**
   * Compute circumcircle of triangle defined by 3 point indices
   * Returns {x, y, r2} where r2 is radius²
   */
  function getCircumcircle(i, j, k) {
    const [ax, ay] = allPoints[i];
    const [bx, by] = allPoints[j];
    const [cx, cy] = allPoints[k];

    const det = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(det) < 1e-10) return null; // Degenerate

    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;

    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / det;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / det;

    return {
      x: ux,
      y: uy,
      r2: (ux - ax) * (ux - ax) + (uy - ay) * (uy - ay)
    };
  }

  // Start with super-triangle
  let triangles = [{
    vertices: [numPoints, numPoints + 1, numPoints + 2],
    circumcircle: getCircumcircle(numPoints, numPoints + 1, numPoints + 2)
  }];

  // Insert each point incrementally
  for (let i = 0; i < numPoints; i++) {
    const [px, py] = allPoints[i];

    // Find triangles whose circumcircle contains this point
    const badTriangles = triangles.filter(t => {
      if (!t.circumcircle) return true;
      const dx = px - t.circumcircle.x;
      const dy = py - t.circumcircle.y;
      return dx * dx + dy * dy <= t.circumcircle.r2 + 1e-10;
    });

    // Find edges on boundary of "bad" region (edges shared by only 1 bad triangle)
    const edgeMap = {};
    for (const t of badTriangles) {
      const [a, b, c] = t.vertices;
      const edges = [[a, b], [b, c], [c, a]];

      for (const [u, v] of edges) {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        edgeMap[key] = (edgeMap[key] || 0) + 1;
      }
    }

    // Remove bad triangles from mesh
    triangles = triangles.filter(t => !badTriangles.includes(t));

    // Add new triangles connecting point to boundary edges
    for (const [key, count] of Object.entries(edgeMap)) {
      if (count === 1) { // Boundary edge
        const [a, b] = key.split('_').map(Number);
        const newTri = [a, b, i];
        triangles.push({
          vertices: newTri,
          circumcircle: getCircumcircle(...newTri)
        });
      }
    }
  }

  // Filter out triangles using super-triangle vertices
  return triangles
    .filter(t => t.vertices.every(v => v < numPoints))
    .map(t => t.vertices);
}

// ============================================================================
// RENDERING: Affine Texture Mapping
// ============================================================================

/**
 * Draw textured mesh with per-triangle affine transformation
 *
 * Each triangle has original position (in source image) and deformed position (on canvas).
 * We compute the affine transform that maps source → deformed and apply it to the image.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {HTMLImageElement} sourceImage - Source image to texture
 * @param {Array<Object>} vertices - Vertex array with {x, y, ox, oy} (current and original position)
 * @param {Array<[number, number, number]>} triangles - Triangle indices
 */
function drawTexturedMesh(ctx, sourceImage, vertices, triangles) {
  for (const [aIdx, bIdx, cIdx] of triangles) {
    const va = vertices[aIdx];
    const vb = vertices[bIdx];
    const vc = vertices[cIdx];

    if (!va || !vb || !vc) continue;

    // Source triangle (original image coordinates)
    const ax = va.ox, ay = va.oy;
    const bx = vb.ox, by = vb.oy;
    const cx = vc.ox, cy = vc.oy;

    // Destination triangle (deformed mesh positions)
    const dax = va.x, day = va.y;
    const dbx = vb.x, dby = vb.y;
    const dcx = vc.x, dcy = vc.y;

    // Compute affine transform: src → dst
    // We need matrix M such that: M[A_src, B_src, C_src] = [A_dst, B_dst, C_dst]
    const srcDet = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(srcDet) < 0.5) continue; // Skip degenerate source triangle

    const srcDetInv = 1 / srcDet;

    // Destination offsets from A
    const dBx = dbx - dax, dBy = dby - day; // B_dst - A_dst
    const dCx = dcx - dax, dCy = dcy - day; // C_dst - A_dst

    // Source offsets from A
    const sBx = bx - ax, sBy = by - ay;     // B_src - A_src
    const sCx = cx - ax, sCy = cy - ay;     // C_src - A_src

    // M = [dB, dC] * inv([sB, sC])
    // inv([sBx, sCx; sBy, sCy]) = 1/det * [sCy, -sCx; -sBy, sBx]
    const m00 = (dBx * sCy - dCx * sBy) * srcDetInv;
    const m01 = (dCx * sBx - dBx * sCx) * srcDetInv;
    const m10 = (dBy * sCy - dCy * sBy) * srcDetInv;
    const m11 = (dCy * sBx - dBy * sCx) * srcDetInv;
    const m02 = dax - m00 * ax - m01 * ay;
    const m12 = day - m10 * ax - m11 * ay;

    // Draw triangle with texture mapping
    ctx.save();

    // Clip to destination triangle
    ctx.beginPath();
    ctx.moveTo(dax, day);
    ctx.lineTo(dbx, dby);
    ctx.lineTo(dcx, dcy);
    ctx.closePath();
    ctx.clip();

    // Apply affine transform and draw source image
    ctx.transform(m00, m10, m01, m11, m02, m12);
    ctx.drawImage(sourceImage, 0, 0);

    ctx.restore();
  }
}

// ============================================================================
// DATA STRUCTURES & MAIN CLASS
// ============================================================================

/**
 * Vertex object: stores current and original position
 */
class Vertex {
  constructor(x, y) {
    this.x = x;        // Current deformed position
    this.y = y;
    this.ox = x;       // Original position (for reset)
    this.oy = y;
  }
}

/**
 * Main mesh deformation system
 *
 * Usage:
 *   const deformer = new MeshDeformer(canvasElement);
 *   deformer.loadImage(imageElement);
 *   deformer.generateMesh({alphaThreshold: 20, ...});
 *   deformer.startInteraction();
 */
class MeshDeformer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // State
    this.sourceImage = null;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;

    this.vertices = [];
    this.triangles = [];
    this.edgeVertexIndices = new Set();

    this.scale = 1;
    this.dragging = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;

    // Callbacks
    this.onMeshGenerated = null;
    this.onVertexDragged = null;
  }

  /**
   * Load image for mesh generation
   */
  loadImage(imageElement) {
    this.sourceImage = imageElement;

    // Create offscreen canvas for pixel data access
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = imageElement.width;
    this.offscreenCanvas.height = imageElement.height;

    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    this.offscreenCtx.drawImage(imageElement, 0, 0);

    // Fit canvas to image
    this.fitCanvasToImage();
  }

  /**
   * Scale canvas to fit image while respecting max dimensions
   */
  fitCanvasToImage(maxWidth = Infinity, maxHeight = Infinity) {
    if (!this.sourceImage) return;

    const maxW = Math.min(maxWidth, this.canvas.parentElement?.clientWidth || Infinity) - 16;
    const maxH = Math.min(maxHeight, this.canvas.parentElement?.clientHeight || Infinity) - 16;

    this.scale = Math.min(
      maxW / this.sourceImage.width,
      maxH / this.sourceImage.height,
      1.5
    );

    this.canvas.width = Math.round(this.sourceImage.width * this.scale);
    this.canvas.height = Math.round(this.sourceImage.height * this.scale);
  }

  /**
   * Generate mesh from current image
   *
   * @param {Object} options - Configuration
   * @param {number} options.alphaThreshold - Alpha threshold for edge detection (1-254)
   * @param {number} options.smoothPasses - Contour smoothing iterations (0-8)
   * @param {number} options.gridSpacing - Interior point spacing (8-80)
   * @param {number} options.edgePadding - Distance from edge to interior points (0-40)
   * @param {number} options.numEdgePoints - Number of edge vertices (30-300)
   */
  generateMesh(options = {}) {
    const {
      alphaThreshold = 20,
      smoothPasses = 3,
      gridSpacing = 30,
      edgePadding = 8,
      numEdgePoints = 80
    } = options;

    if (!this.sourceImage || !this.offscreenCtx) return;

    // Extract edges
    const imageData = this.offscreenCtx.getImageData(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
    const pixelBuffer = new PixelBuffer(imageData);

    const rawContour = traceContour(pixelBuffer, alphaThreshold);
    let edgePts = resampleContour(rawContour, Math.min(numEdgePoints, Math.max(3, rawContour.length)));
    edgePts = smoothContour(edgePts, smoothPasses);

    // Sample interior
    let interiorPts = sampleInterior(pixelBuffer, alphaThreshold, Math.max(6, gridSpacing));

    if (edgePadding > 0) {
      interiorPts = filterByEdgePadding(interiorPts, edgePts, edgePadding);
    }

    // Combine points
    const allPts = [...edgePts, ...interiorPts];
    this.edgeVertexIndices = new Set(edgePts.map((_, i) => i));

    // Deduplicate nearby points
    const deduped = [];
    const minDist2 = 4;
    const newEdgeSet = new Set();

    for (let i = 0; i < allPts.length; i++) {
      const pt = allPts[i];
      let isDuplicate = false;

      for (const dedupPt of deduped) {
        const dx = pt[0] - dedupPt[0];
        const dy = pt[1] - dedupPt[1];
        if (dx * dx + dy * dy < minDist2) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        if (this.edgeVertexIndices.has(i)) {
          newEdgeSet.add(deduped.length);
        }
        deduped.push(pt);
      }
    }

    this.edgeVertexIndices = newEdgeSet;

    // Triangulate
    this.triangles = delaunay(deduped);
    this.vertices = deduped.map(([x, y]) => new Vertex(x, y));

    if (this.onMeshGenerated) {
      this.onMeshGenerated({
        vertexCount: this.vertices.length,
        triangleCount: this.triangles.length,
        edgeVertexCount: this.edgeVertexIndices.size
      });
    }

    this.draw();
  }

  /**
   * Start listening to mouse/touch input
   */
  startInteraction() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', () => this.onTouchEnd());
  }

  /**
   * Convert canvas screen coordinates to image coordinates
   */
  screenToImageCoords(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      (screenX - rect.left) / this.scale,
      (screenY - rect.top) / this.scale
    ];
  }

  /**
   * Find closest vertex to given position
   */
  findNearestVertex(x, y, radius) {
    let nearest = -1;
    let nearestDist2 = radius * radius;

    this.vertices.forEach((v, i) => {
      const dx = v.x - x;
      const dy = v.y - y;
      const dist2 = dx * dx + dy * dy;

      if (dist2 < nearestDist2) {
        nearestDist2 = dist2;
        nearest = i;
      }
    });

    return nearest;
  }

  // ---- Input Handlers ----

  onMouseDown(e) {
    const [x, y] = this.screenToImageCoords(e.clientX, e.clientY);
    const idx = this.findNearestVertex(x, y, 14 / this.scale);

    if (idx >= 0) {
      this.dragging = idx;
      this.dragOffsetX = x - this.vertices[idx].x;
      this.dragOffsetY = y - this.vertices[idx].y;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  onMouseMove(e) {
    if (this.dragging === null) return;

    const [x, y] = this.screenToImageCoords(e.clientX, e.clientY);
    this.vertices[this.dragging].x = x - this.dragOffsetX;
    this.vertices[this.dragging].y = y - this.dragOffsetY;

    if (this.onVertexDragged) {
      this.onVertexDragged(this.dragging);
    }

    this.draw();
  }

  onMouseUp() {
    this.dragging = null;
    this.canvas.style.cursor = 'crosshair';
  }

  onTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const [x, y] = this.screenToImageCoords(touch.clientX, touch.clientY);
    const idx = this.findNearestVertex(x, y, 20 / this.scale);

    if (idx >= 0) {
      this.dragging = idx;
      this.dragOffsetX = x - this.vertices[idx].x;
      this.dragOffsetY = y - this.vertices[idx].y;
    }
  }

  onTouchMove(e) {
    e.preventDefault();
    if (this.dragging === null) return;

    const touch = e.touches[0];
    const [x, y] = this.screenToImageCoords(touch.clientX, touch.clientY);
    this.vertices[this.dragging].x = x - this.dragOffsetX;
    this.vertices[this.dragging].y = y - this.dragOffsetY;

    this.draw();
  }

  onTouchEnd() {
    this.dragging = null;
  }

  // ---- Mesh Operations ----

  /**
   * Reset mesh to original undeformed state
   */
  reset() {
    this.vertices.forEach(v => {
      v.x = v.ox;
      v.y = v.oy;
    });
    this.draw();
  }

  /**
   * Clear mesh and image
   */
  clear() {
    this.vertices = [];
    this.triangles = [];
    this.edgeVertexIndices.clear();
    this.sourceImage = null;
    this.draw();
  }

  /**
   * Main render loop
   */
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.sourceImage) return;

    this.ctx.save();
    this.ctx.scale(this.scale, this.scale);

    // Draw textured mesh if triangles exist
    if (this.triangles.length > 0) {
      drawTexturedMesh(this.ctx, this.sourceImage, this.vertices, this.triangles);
    } else {
      // Draw raw image if no mesh
      this.ctx.drawImage(this.sourceImage, 0, 0);
    }

    this.ctx.restore();
  }

  /**
   * Get mesh state as JSON (for export/save)
   */
  toJSON() {
    return {
      vertices: this.vertices.map(v => ({ x: v.x, y: v.y, ox: v.ox, oy: v.oy })),
      triangles: this.triangles,
      edgeVertices: Array.from(this.edgeVertexIndices)
    };
  }

  /**
   * Restore mesh from JSON state
   */
  fromJSON(data) {
    this.vertices = data.vertices.map(v => new Vertex(v.x, v.y));
    this.vertices.forEach((v, i) => {
      v.ox = data.vertices[i].ox;
      v.oy = data.vertices[i].oy;
    });
    this.triangles = data.triangles;
    this.edgeVertexIndices = new Set(data.edgeVertices);
    this.draw();
  }
}

// ============================================================================
// Export for use in main project
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MeshDeformer,
    Vertex,
    // Algorithms (for advanced use)
    traceContour,
    resampleContour,
    smoothContour,
    sampleInterior,
    filterByEdgePadding,
    delaunay,
    drawTexturedMesh,
    PixelBuffer
  };
}
