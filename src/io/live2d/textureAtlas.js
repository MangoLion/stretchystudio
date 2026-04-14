/**
 * Texture atlas packer for Live2D export.
 *
 * Replicates Cubism Editor behavior: parts are cropped to their opaque bounds,
 * then uniformly upscaled to fill the atlas as tightly as possible.
 *
 * Algorithm: MaxRects BSSF (Jukka Jylänki, 2010) + binary search for max scale.
 *
 * METHODOLOGY NOTE: this module was rewritten after studying the Hiyori reference
 * atlas (reference/live2d-sample/). Initial naive implementations (shelf packing,
 * MaxRects without upscaling) wasted 70%+ space. The reference atlas is tightly
 * packed with upscaled parts — always study reference output before implementing.
 * See docs/live2d-export/DECISIONS.md#007, #008.
 *
 * @module io/live2d/textureAtlas
 */

const DEFAULT_ATLAS_SIZE = 2048;

/**
 * @typedef {Object} PackedRegion
 * @property {number} atlasIndex
 * @property {number} x          - Left edge in atlas pixels
 * @property {number} y          - Top edge in atlas pixels
 * @property {number} width      - Scaled region width in atlas
 * @property {number} height     - Scaled region height in atlas
 * @property {number} srcX       - Crop origin X in source image
 * @property {number} srcY       - Crop origin Y in source image
 * @property {number} srcWidth   - Full source image width
 * @property {number} srcHeight  - Full source image height
 */

/**
 * Pack part textures into atlas sheets with automatic upscaling.
 *
 * @param {object} project
 * @param {Map<string, HTMLImageElement>} images
 * @param {object} [opts]
 * @param {number} [opts.atlasSize=2048]
 * @param {number} [opts.padding=2]
 * @returns {Promise<{atlases: {blob: Blob, width: number, height: number}[], regions: Map<string, PackedRegion>}>}
 */
export async function packTextureAtlas(project, images, opts = {}) {
  const atlasSize = opts.atlasSize ?? DEFAULT_ATLAS_SIZE;
  const padding = opts.padding ?? 2;

  // Collect parts, compute cropped sizes
  const items = [];
  for (const part of project.nodes) {
    if (part.type !== 'part' || part.visible === false) continue;
    const img = findImageForPart(part, project.textures, images);
    if (!img) continue;

    const fullW = img.naturalWidth || img.width;
    const fullH = img.naturalHeight || img.height;
    if (fullW === 0 || fullH === 0) continue;

    const bounds = part.imageBounds;
    let cropX, cropY, cropW, cropH;
    if (bounds && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) {
      cropX = Math.max(0, Math.floor(bounds.minX) - 1);
      cropY = Math.max(0, Math.floor(bounds.minY) - 1);
      cropW = Math.min(fullW - cropX, Math.ceil(bounds.maxX - bounds.minX) + 2);
      cropH = Math.min(fullH - cropY, Math.ceil(bounds.maxY - bounds.minY) + 2);
    } else {
      cropX = 0; cropY = 0; cropW = fullW; cropH = fullH;
    }

    items.push({ part, img, fullW, fullH, cropX, cropY, cropW, cropH });
  }

  // Find max scale factor via binary search
  const scale = findMaxScale(items, atlasSize, padding);

  // Sort by max scaled side descending
  items.sort((a, b) =>
    Math.max(b.cropW, b.cropH) - Math.max(a.cropW, a.cropH)
  );

  // Pack with the optimal scale
  const atlases = [];
  const regions = new Map();
  let packer = new MaxRectsPacker(atlasSize, atlasSize);
  let currentAtlas = createAtlasCanvas(atlasSize);
  let atlasIndex = 0;

  for (const item of items) {
    const { part, img, fullW, fullH, cropX, cropY, cropW, cropH } = item;
    const sw = Math.round(cropW * scale);
    const sh = Math.round(cropH * scale);
    const pw = sw + padding;
    const ph = sh + padding;

    let pos = packer.insert(pw, ph);

    if (!pos) {
      atlases.push(await finalizeAtlas(currentAtlas, atlasSize));
      packer = new MaxRectsPacker(atlasSize, atlasSize);
      currentAtlas = createAtlasCanvas(atlasSize);
      atlasIndex++;
      pos = packer.insert(pw, ph);
      if (!pos) {
        console.warn(`[Atlas] Part "${part.name}" too large, skipping`);
        continue;
      }
    }

    // Draw scaled into atlas (browser handles interpolation)
    currentAtlas.ctx.drawImage(
      img,
      cropX, cropY, cropW, cropH,
      pos.x, pos.y, sw, sh
    );

    regions.set(part.id, {
      atlasIndex,
      x: pos.x, y: pos.y,
      width: sw, height: sh,
      srcX: cropX, srcY: cropY,
      srcWidth: fullW, srcHeight: fullH,
      cropW, cropH,  // original crop size before scaling
    });
  }

  atlases.push(await finalizeAtlas(currentAtlas, atlasSize));
  return { atlases, regions };
}

/**
 * Binary search for the maximum uniform scale (>=1.0) where all items
 * fit into a single atlas of the given size.
 */
function findMaxScale(items, atlasSize, padding) {
  let lo = 1.0;
  let hi = 8.0;

  // Quick check: does scale=1 even fit?
  if (!tryPack(items, atlasSize, padding, 1.0)) return 1.0;

  // Find upper bound
  while (tryPack(items, atlasSize, padding, hi)) {
    hi *= 2;
    if (hi > 64) break;
  }

  // Binary search
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (tryPack(items, atlasSize, padding, mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

/**
 * Test whether all items fit in one atlas at the given scale.
 */
function tryPack(items, atlasSize, padding, scale) {
  const sorted = [...items].sort((a, b) =>
    Math.max(b.cropW, b.cropH) - Math.max(a.cropW, a.cropH)
  );

  const packer = new MaxRectsPacker(atlasSize, atlasSize);
  for (const item of sorted) {
    const pw = Math.round(item.cropW * scale) + padding;
    const ph = Math.round(item.cropH * scale) + padding;
    if (pw > atlasSize || ph > atlasSize) return false;
    if (!packer.insert(pw, ph)) return false;
  }
  return true;
}

/**
 * Remap UVs from source image space to scaled+cropped atlas space.
 */
export function remapUVsToAtlas(uvs, region, atlasSize) {
  const result = new Float32Array(uvs.length);
  // Scale factor from source crop to atlas region
  const scaleX = region.width / ((region.srcWidth > 0 ? region.srcWidth : 1));
  const scaleY = region.height / ((region.srcHeight > 0 ? region.srcHeight : 1));

  for (let i = 0; i < uvs.length; i += 2) {
    const srcPxX = uvs[i] * region.srcWidth;
    const srcPxY = uvs[i + 1] * region.srcHeight;
    // Map source pixel to atlas: offset from crop origin, apply scale, add atlas pos
    result[i]     = (region.x + (srcPxX - region.srcX) * scaleX) / atlasSize;
    result[i + 1] = (region.y + (srcPxY - region.srcY) * scaleY) / atlasSize;
  }
  return result;
}


// ---------------------------------------------------------------------------
// MaxRects bin packing (Best Short Side Fit)
// Reference: Jukka Jylänki, "A Thousand Ways to Pack the Bin" (2010)
// ---------------------------------------------------------------------------

class MaxRectsPacker {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.freeRects = [{ x: 0, y: 0, width: w, height: h }];
  }

  insert(w, h) {
    let bestIdx = -1;
    let bestShort = Infinity;
    let bestLong = Infinity;

    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i];
      if (r.width >= w && r.height >= h) {
        const shortSide = Math.min(r.width - w, r.height - h);
        const longSide = Math.max(r.width - w, r.height - h);
        if (shortSide < bestShort || (shortSide === bestShort && longSide < bestLong)) {
          bestIdx = i;
          bestShort = shortSide;
          bestLong = longSide;
        }
      }
    }

    if (bestIdx === -1) return null;

    const r = this.freeRects[bestIdx];
    const placed = { x: r.x, y: r.y };

    this._splitFreeRect(r, placed.x, placed.y, w, h);
    this.freeRects.splice(bestIdx, 1);
    this._pruneOverlaps(placed.x, placed.y, w, h);

    return placed;
  }

  _splitFreeRect(free, px, py, pw, ph) {
    if (px + pw < free.x + free.width) {
      this.freeRects.push({
        x: px + pw, y: free.y,
        width: free.x + free.width - (px + pw), height: free.height,
      });
    }
    if (py + ph < free.y + free.height) {
      this.freeRects.push({
        x: free.x, y: py + ph,
        width: free.width, height: free.y + free.height - (py + ph),
      });
    }
  }

  _pruneOverlaps(px, py, pw, ph) {
    for (let i = this.freeRects.length - 1; i >= 0; i--) {
      const r = this.freeRects[i];
      if (px < r.x + r.width && px + pw > r.x &&
          py < r.y + r.height && py + ph > r.y) {
        const clipped = [];
        if (r.x < px)
          clipped.push({ x: r.x, y: r.y, width: px - r.x, height: r.height });
        if (r.x + r.width > px + pw)
          clipped.push({ x: px + pw, y: r.y, width: (r.x + r.width) - (px + pw), height: r.height });
        if (r.y < py)
          clipped.push({ x: r.x, y: r.y, width: r.width, height: py - r.y });
        if (r.y + r.height > py + ph)
          clipped.push({ x: r.x, y: py + ph, width: r.width, height: (r.y + r.height) - (py + ph) });

        this.freeRects.splice(i, 1);
        for (const c of clipped) {
          if (c.width > 0 && c.height > 0) this.freeRects.push(c);
        }
      }
    }

    for (let i = this.freeRects.length - 1; i >= 0; i--) {
      for (let j = this.freeRects.length - 1; j >= 0; j--) {
        if (i === j) continue;
        const a = this.freeRects[i];
        const b = this.freeRects[j];
        if (a.x >= b.x && a.y >= b.y &&
            a.x + a.width <= b.x + b.width &&
            a.y + a.height <= b.y + b.height) {
          this.freeRects.splice(i, 1);
          break;
        }
      }
    }
  }
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findImageForPart(part, textures, images) {
  const texId = part.textureId ?? part.id;
  return images.get(texId) ?? images.get(part.id) ?? null;
}

function createAtlasCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size, size);
    return { canvas, ctx: canvas.getContext('2d') };
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

async function finalizeAtlas(atlas, size) {
  let blob;
  if (atlas.canvas instanceof OffscreenCanvas) {
    blob = await atlas.canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise(resolve => atlas.canvas.toBlob(resolve, 'image/png'));
  }
  return { blob, width: size, height: size };
}
