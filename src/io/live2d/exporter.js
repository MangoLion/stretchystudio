/**
 * Main Live2D export orchestrator.
 *
 * Coordinates all generators (model3.json, cdi3.json, motion3.json, moc3,
 * texture atlas) and packages the result as a downloadable ZIP file.
 *
 * @module io/live2d/exporter
 */

import JSZip from 'jszip';
import { generateModel3Json } from './model3json.js';
import { generateCdi3Json } from './cdi3json.js';
import { generateMotion3Json } from './motion3json.js';
import { generateMoc3 } from './moc3writer.js';
import { packTextureAtlas } from './textureAtlas.js';

/**
 * @typedef {Object} ExportOptions
 * @property {string}  modelName   - Base name (e.g. "character")
 * @property {number}  [atlasSize=2048] - Texture atlas size
 * @property {boolean} [exportMotions=true] - Whether to include .motion3.json files
 * @property {function} [onProgress] - Progress callback (message: string)
 */

/**
 * Export a Stretchy Studio project as a Live2D Cubism model in a ZIP file.
 *
 * @param {object} project - projectStore.project snapshot
 * @param {Map<string, HTMLImageElement>} images - Loaded texture images
 * @param {ExportOptions} opts
 * @returns {Promise<Blob>} ZIP blob ready for download
 */
export async function exportLive2D(project, images, opts = {}) {
  const {
    modelName = 'model',
    atlasSize = 2048,
    exportMotions = true,
    onProgress = () => {},
  } = opts;

  const zip = new JSZip();

  // --- Step 1: Pack textures ---
  onProgress('Packing texture atlas...');
  const { atlases, regions } = await packTextureAtlas(project, images, { atlasSize });

  // Write atlas PNGs
  const textureDir = `${modelName}.${atlasSize}`;
  const textureFiles = [];
  const textureFolder = zip.folder(textureDir);

  for (let i = 0; i < atlases.length; i++) {
    const filename = `texture_${String(i).padStart(2, '0')}.png`;
    textureFolder.file(filename, atlases[i].blob);
    textureFiles.push(`${textureDir}/${filename}`);
  }

  // --- Step 2: Generate .moc3 ---
  onProgress('Generating .moc3 binary...');
  const moc3Buffer = generateMoc3({
    project,
    regions,
    atlasSize,
    numAtlases: atlases.length,
  });
  zip.file(`${modelName}.moc3`, moc3Buffer);

  // --- Step 3: Generate .motion3.json files ---
  const motionFiles = [];
  if (exportMotions && project.animations?.length > 0) {
    onProgress('Generating motion files...');
    const motionFolder = zip.folder('motion');

    for (const anim of project.animations) {
      const sanitized = sanitizeName(anim.name);
      const filename = `${sanitized}.motion3.json`;
      const motion = generateMotion3Json(anim);
      motionFolder.file(filename, JSON.stringify(motion, null, '\t'));
      motionFiles.push(`motion/${filename}`);
    }
  }

  // --- Step 4: Generate .cdi3.json ---
  onProgress('Generating display info...');
  const groups = project.nodes.filter(n => n.type === 'group');
  const meshParts = project.nodes.filter(n =>
    n.type === 'part' && n.mesh && n.visible !== false && regions.has(n.id)
  );

  const cdi3 = generateCdi3Json({
    parameters: (project.parameters ?? []).map(p => ({
      id: p.id,
      name: p.name ?? p.id,
      groupId: p.groupId,
    })),
    parts: groups.map(g => ({
      id: g.id,
      name: g.name ?? g.id,
    })),
  });

  const cdi3File = `${modelName}.cdi3.json`;
  zip.file(cdi3File, JSON.stringify(cdi3, null, '\t'));

  // --- Step 5: Generate .model3.json ---
  onProgress('Generating model manifest...');
  const model3 = generateModel3Json({
    modelName,
    textureFiles,
    motionFiles,
    displayInfoFile: cdi3File,
  });

  zip.file(`${modelName}.model3.json`, JSON.stringify(model3, null, '\t'));

  // --- Step 6: Package ZIP ---
  onProgress('Creating ZIP...');
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Sanitize a name for use as a filename.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  return (name ?? 'animation')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
