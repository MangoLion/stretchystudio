/**
 * Main Live2D export orchestrator.
 *
 * Coordinates all generators (model3.json, cdi3.json, motion3.json, moc3,
 * texture atlas) and packages the result as a downloadable ZIP file.
 *
 * @module io/live2d/exporter
 */

import { generateModel3Json } from './model3json.js';
import { generateCdi3Json } from './cdi3json.js';
import { generateMotion3Json } from './motion3json.js';
import { generateMoc3 } from './moc3writer.js';
import { packTextureAtlas } from './textureAtlas.js';
import { generateCmo3 } from './cmo3writer.js';
import { generateCan3 } from './can3writer.js';
import { matchTag } from '../armatureOrganizer.js';

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

  const { default: JSZip } = await import('jszip');
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
  // Build parameterMap: maps SS track keys to Live2D parameter IDs.
  // groupId.rotation → ParamRotation_GroupName (rotation deformers)
  // partId.mesh_verts → ParamDeform_MeshName (warp deformers)
  const parameterMap = new Map();
  const allGroups = project.nodes.filter(n => n.type === 'group');
  for (const g of allGroups) {
    const sanitized = (g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_');
    parameterMap.set(`${g.id}.rotation`, `ParamRotation_${sanitized}`);
  }
  // Warp deformer parameters for mesh_verts tracks
  const meshPartsWithMesh = project.nodes.filter(n => n.type === 'part' && n.mesh);
  for (const p of meshPartsWithMesh) {
    const sanitized = (p.name || p.id).replace(/[^a-zA-Z0-9_]/g, '_');
    parameterMap.set(`${p.id}.mesh_verts`, `ParamDeform_${sanitized}`);
  }

  const motionFiles = [];
  if (exportMotions && project.animations?.length > 0) {
    onProgress('Generating motion files...');
    const motionFolder = zip.folder('motion');

    for (const anim of project.animations) {
      const sanitized = sanitizeName(anim.name);
      const filename = `${sanitized}.motion3.json`;
      const motion = generateMotion3Json(anim, { parameterMap });
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
 * Export a Stretchy Studio project as a .cmo3 (Cubism Editor project file).
 *
 * Unlike the runtime export (.moc3 + atlas), the project export gives each
 * mesh its own texture PNG inside a CAFF archive, so the model can be further
 * edited in Cubism Editor 5.0.
 *
 * @param {object} project - projectStore.project snapshot
 * @param {Map<string, HTMLImageElement>} images - Loaded texture images
 * @param {object} opts
 * @param {string} [opts.modelName='model']
 * @param {boolean} [opts.generateRig=false] - Generate standard Live2D rig (warp deformers, standard params)
 * @param {function} [opts.onProgress]
 * @returns {Promise<Blob>} .cmo3 blob ready for download
 */
export async function exportLive2DProject(project, images, opts = {}) {
  const {
    modelName = 'model',
    generateRig = false,
    onProgress = () => {},
  } = opts;

  const canvasW = project.canvas?.width ?? 800;
  const canvasH = project.canvas?.height ?? 600;

  // Collect visible parts with meshes.
  // Sort by draw_order (descending) to maintain correct depth ordering (upstream fix).
  const meshParts = project.nodes
    .filter(n =>
      n.type === 'part' && n.mesh && n.visible !== false
    )
    .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

  onProgress(`Preparing ${meshParts.length} meshes...`);

  // Collect groups (for part hierarchy + deformers in .cmo3)
  const groups = project.nodes.filter(n => n.type === 'group').map(g => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));

  const meshes = [];
  for (let i = 0; i < meshParts.length; i++) {
    const part = meshParts[i];
    const mesh = part.mesh;
    const meshName = part.name || `ArtMesh${i}`;

    // Find image for this part
    const texId = part.textureId ?? part.id;
    const img = images.get(texId) ?? images.get(part.id);
    if (!img) continue;

    const fullW = img.naturalWidth || img.width;
    const fullH = img.naturalHeight || img.height;
    if (fullW === 0 || fullH === 0) continue;

    onProgress(`Encoding texture ${i + 1}/${meshParts.length}...`);

    // For .cmo3: render full canvas-sized PNG (CLayeredImage covers entire canvas)
    // Mesh vertices and textures are already in canvas space (PSD layers are canvas-sized)
    const pngData = await renderPartToCanvasPng(img, fullW, fullH, canvasW, canvasH);

    // Flatten vertices: Array<{x,y}> → [x0,y0, x1,y1, ...]
    // CRITICAL: Use restX/restY (original positions) not x/y (possibly deformed by bone rotation).
    // When a user rotates an elbow in SS before exporting, v.x/v.y are permanently committed
    // but UVs/textures are based on rest positions. Using rest positions ensures correct texture mapping.
    // Baked keyforms (below) handle posing via parameters.
    const vertices = [];
    for (const v of mesh.vertices) {
      vertices.push(v.restX ?? v.x, v.restY ?? v.y);
    }

    // Flatten triangles: Array<[i,j,k]> → [i0,j0,k0, ...]
    const triangles = [];
    for (const tri of mesh.triangles) {
      triangles.push(tri[0], tri[1], tri[2]);
    }

    // UVs — vertex positions normalized to canvas dimensions.
    // CRITICAL: Use restX/restY (same as vertices above) for UV computation.
    // cmo3writer.js transforms keyform positions to deformer-local space separately.
    const uvs = [];
    for (const v of mesh.vertices) {
      let u = Math.max(0, Math.min(1, (v.restX ?? v.x) / canvasW));
      let vv = Math.max(0, Math.min(1, (v.restY ?? v.y) / canvasH));
      uvs.push(u, vv);
    }

    // Bone weight data for baked keyforms
    const boneWeights = mesh.boneWeights ?? null;
    const jointBoneId = mesh.jointBoneId ?? null;
    // Find the elbow pivot in canvas space (jointBone's transform.pivotX/Y)
    let jointPivotX = null, jointPivotY = null;
    if (jointBoneId && boneWeights) {
      const jointBone = project.nodes.find(n => n.id === jointBoneId);
      if (jointBone?.transform) {
        jointPivotX = jointBone.transform.pivotX ?? 0;
        jointPivotY = jointBone.transform.pivotY ?? 0;
      }
    }

    meshes.push({
      name: meshName,
      tag: matchTag(meshName),
      partId: part.id,
      parentGroupId: part.parent ?? null,
      jointBoneId,
      boneWeights,
      jointPivotX,
      jointPivotY,
      drawOrder: part.draw_order ?? i,
      vertices,
      triangles,
      uvs,
      pngData,
      texWidth: canvasW,
      texHeight: canvasH,
    });
  }

  if (meshes.length === 0) {
    const partCount = meshParts.length;
    const texCount = images.size;
    throw new Error(
      partCount === 0
        ? 'No visible parts with meshes found. Generate meshes before exporting.'
        : `Found ${partCount} parts but no matching textures (${texCount} textures loaded). Check that parts have textureId matching a texture.`
    );
  }

  onProgress(`Generating .cmo3 (${meshes.length} meshes)...`);

  const { cmo3, deformerParamMap } = await generateCmo3({
    canvasW,
    canvasH,
    meshes,
    groups,
    parameters: project.parameters ?? [],
    animations: project.animations ?? [],
    modelName,
    generateRig,
  });

  // Generate .can3 animation file if there are animations with deformer parameters
  const animations = project.animations ?? [];
  const hasAnimations = animations.length > 0 && deformerParamMap.size > 0;

  if (hasAnimations) {
    onProgress('Generating .can3 animation...');
    const cmo3FileName = `${modelName}.cmo3`;
    const can3 = await generateCan3({
      animations,
      deformerParamMap,
      cmo3FileName,
      canvasW,
      canvasH,
      modelName,
    });

    // Return ZIP containing both .cmo3 and .can3
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file(cmo3FileName, cmo3);
    zip.file(`${modelName}.can3`, can3);
    return zip.generateAsync({ type: 'blob' });
  }

  return new Blob([cmo3], { type: 'application/octet-stream' });
}

/**
 * Render a part's full texture onto a canvas-sized PNG with world transform applied.
 * For .cmo3, each layer covers the full canvas (like a PSD layer).
 * The transform places the image in its correct world-space position.
 *
 * @param {HTMLImageElement} img
 * @param {number} srcW - Source image width
 * @param {number} srcH - Source image height
 * @param {number} canvasW - Canvas width
 * @param {number} canvasH - Canvas height
 * @param {number[]} wm - 3x3 column-major world matrix [m0,m1,0, m3,m4,0, m6,m7,1]
 */
async function renderPartToCanvasPngTransformed(img, srcW, srcH, canvasW, canvasH, wm) {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(canvasW, canvasH)
    : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = canvasW;
    canvas.height = canvasH;
  }
  const ctx = canvas.getContext('2d');
  // Apply world transform: canvas 2D setTransform(a, b, c, d, e, f)
  // maps from column-major [m0,m1,0, m3,m4,0, m6,m7,1]
  ctx.setTransform(wm[0], wm[1], wm[3], wm[4], wm[6], wm[7]);
  ctx.drawImage(img, 0, 0, srcW, srcH);
  ctx.resetTransform();

  let blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Render a part's full texture onto a canvas-sized PNG (no transform).
 * Legacy — kept for backward compatibility.
 */
async function renderPartToCanvasPng(img, srcW, srcH, canvasW, canvasH) {
  return renderPartToCanvasPngTransformed(img, srcW, srcH, canvasW, canvasH, [1,0,0, 0,1,0, 0,0,1]);
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
