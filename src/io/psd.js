/**
 * PSD import — wraps ag-psd to produce a flat list of layers.
 *
 * Returns only rasterized layers (those with pixel data). Group/folder nodes
 * are walked but not emitted as parts (M3 will add hierarchy).
 */
import { readPsd } from 'ag-psd';

/**
 * @typedef {Object} PsdLayer
 * @property {string}    name
 * @property {number}    x         - left offset in PSD canvas space
 * @property {number}    y         - top offset in PSD canvas space
 * @property {number}    width
 * @property {number}    height
 * @property {ImageData} imageData - full-canvas-size imageData (pre-composited into PSD space)
 * @property {string}    blendMode
 * @property {number}    opacity   - 0-1
 * @property {boolean}   visible
 */

/**
 * Parse an ArrayBuffer containing a PSD file.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ width: number, height: number, layers: PsdLayer[] }}
 */
export function importPsd(buffer) {
  const psd = readPsd(buffer, { skipLayerImageData: false, useImageData: true });

  const layers = [];

  function walk(children) {
    if (!children) return;
    for (const layer of children) {
      if (layer.children) {
        // group — recurse, skip as a part for now
        walk(layer.children);
        continue;
      }
      // Only emit layers that have pixel content
      if (!layer.canvas && !layer.imageData) continue;

      const left   = layer.left   ?? 0;
      const top    = layer.top    ?? 0;
      const right  = layer.right  ?? psd.width;
      const bottom = layer.bottom ?? psd.height;
      const w = right  - left;
      const h = bottom - top;
      if (w <= 0 || h <= 0) continue;

      // Get imageData from the layer's canvas (ag-psd provides this)
      let imageData;
      if (layer.canvas) {
        const ctx = layer.canvas.getContext('2d');
        imageData = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
      } else {
        imageData = layer.imageData;
      }

      layers.push({
        name:      layer.name || `Layer ${layers.length + 1}`,
        x:         left,
        y:         top,
        width:     w,
        height:    h,
        imageData,
        blendMode: layer.blendMode ?? 'normal',
        opacity:   layer.opacity !== undefined ? layer.opacity : 1,
        visible:   !layer.hidden,
      });
    }
  }

  walk(psd.children);

  // Reverse so bottom PSD layer → lowest draw_order (drawn first)
  layers.reverse();

  return { width: psd.width, height: psd.height, layers };
}
