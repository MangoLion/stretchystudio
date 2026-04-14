/**
 * Live2D Cubism export — main entry point.
 *
 * Converts a Stretchy Studio project into a set of Live2D Cubism files:
 *   - *.model3.json  (manifest)
 *   - *.moc3          (binary model)
 *   - *.cdi3.json     (display info — human-readable names)
 *   - *.motion3.json  (animation curves)
 *   - texture atlas PNGs
 *
 * @module io/live2d
 */

export { generateModel3Json } from './model3json.js';
export { generateCdi3Json } from './cdi3json.js';
export { generateMotion3Json } from './motion3json.js';
export { generateMoc3 } from './moc3writer.js';
export { packTextureAtlas } from './textureAtlas.js';
export { exportLive2D } from './exporter.js';
