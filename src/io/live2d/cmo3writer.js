/**
 * .cmo3 (Cubism Editor project) generator.
 *
 * Port of scripts/cmo3_generate.py — generates a .cmo3 that opens
 * in Cubism Editor 5.0 WITHOUT "recovered" status.
 *
 * Supports N meshes with real texture data from Stretchy Studio.
 *
 * The texture pipeline replicates Cubism Editor 5.0's own format:
 *   CLayeredImage → CLayer → CModelImage (filter env) → CImageResource
 *   → CTextureInputExtension → CArtMeshSource (TextureState=MODEL_IMAGE)
 *
 * COORDINATE SPACE TRAPS (see ARCHITECTURE.md for full details):
 *   1. meshSrc>positions + GEditableMesh2>point = CANVAS space (texture mapping)
 *      keyform>CArtMeshForm>positions = DEFORMER-LOCAL space (rendering)
 *      Setting both to deformer-local → invisible textures (empty mesh fill).
 *   2. CRotationDeformerForm originX/Y = PARENT deformer's local space, not canvas.
 *   3. Canvas-space vertices + deformer parenting → scattered character.
 *      Must transform: vertex_local = vertex_canvas - deformer_world_origin.
 *
 * @module io/live2d/cmo3writer
 */

import { packCaff, COMPRESS_RAW, COMPRESS_FAST } from './caffPacker.js';
import { makeLocalMatrix, mat3Mul } from '../../renderer/transforms.js';
import { XmlBuilder, uuid } from './xmlbuilder.js';

// ---------- Processing instructions ----------

const VERSION_PIS = [
  ['CArtMeshSource', '4'],
  ['CRotationDeformerForm', '1'],
  ['KeyformGridSource', '1'],
  ['CParameterGroup', '4'],
  ['SerializeFormatVersion', '2'],
  ['CModelSource', '4'], // v4 avoids rootParameterGroup/modelOptions/gameMotionSet NPEs
  ['CFloatColor', '1'],
  ['CLabelColor', '0'],
  ['CModelImage', '3'],
];

const IMPORT_PIS = [
  'com.live2d.cubism.doc.model.ACForm',
  'com.live2d.cubism.doc.model.ACParameterControllableSource',
  'com.live2d.cubism.doc.model.CModelInfo',
  'com.live2d.cubism.doc.model.CModelSource',
  'com.live2d.cubism.doc.model.affecter.CAffecterSourceSet',
  'com.live2d.cubism.doc.model.deformer.ACDeformerForm',
  'com.live2d.cubism.doc.model.deformer.ACDeformerSource',
  'com.live2d.cubism.doc.model.deformer.CDeformerSourceSet',
  'com.live2d.cubism.doc.model.deformer.rotation.CRotationDeformerForm',
  'com.live2d.cubism.doc.model.deformer.rotation.CRotationDeformerSource',
  'com.live2d.cubism.doc.model.deformer.warp.CWarpDeformerForm',
  'com.live2d.cubism.doc.model.deformer.warp.CWarpDeformerSource',
  'com.live2d.cubism.doc.model.drawable.ACDrawableForm',
  'com.live2d.cubism.doc.model.drawable.ACDrawableSource',
  'com.live2d.cubism.doc.model.drawable.CDrawableSourceSet',
  'com.live2d.cubism.doc.model.drawable.ColorComposition',
  'com.live2d.cubism.doc.model.drawable.TextureState',
  'com.live2d.cubism.doc.model.drawable.artMesh.CArtMeshForm',
  'com.live2d.cubism.doc.model.drawable.artMesh.CArtMeshSource',
  'com.live2d.cubism.doc.model.extension.ACExtension',
  'com.live2d.cubism.doc.model.extension.editableMesh.CEditableMeshExtension',
  'com.live2d.cubism.doc.model.extension.meshGenerator.CMeshGeneratorExtension',
  'com.live2d.cubism.doc.model.extension.meshGenerator.MeshGenerateSetting',
  'com.live2d.cubism.doc.model.extension.textureInput.ACTextureInput',
  'com.live2d.cubism.doc.model.extension.textureInput.CTextureInputExtension',
  'com.live2d.cubism.doc.model.extension.textureInput.CTextureInput_ModelImage',
  'com.live2d.cubism.doc.model.extension.textureInput.inputFilter.CLayerInputData',
  'com.live2d.cubism.doc.model.extension.textureInput.inputFilter.CLayerSelectorMap',
  'com.live2d.cubism.doc.model.extension.textureInput.inputFilter.ModelImageFilterEnv',
  'com.live2d.cubism.doc.model.extension.textureInput.inputFilter.ModelImageFilterSet',
  'com.live2d.cubism.doc.model.id.CDeformerId',
  'com.live2d.cubism.doc.model.id.CDrawableId',
  'com.live2d.cubism.doc.model.id.CParameterId',
  'com.live2d.cubism.doc.model.id.CPartId',
  'com.live2d.cubism.doc.model.interpolator.InterpolationType',
  'com.live2d.cubism.doc.model.interpolator.KeyOnParameter',
  'com.live2d.cubism.doc.model.interpolator.KeyformBindingSource',
  'com.live2d.cubism.doc.model.interpolator.KeyformGridAccessKey',
  'com.live2d.cubism.doc.model.interpolator.KeyformGridSource',
  'com.live2d.cubism.doc.model.interpolator.KeyformOnGrid',
  'com.live2d.cubism.doc.model.interpolator.extendedInterpolation.ExtendedInterpolationType',
  'com.live2d.cubism.doc.model.morphTarget.KeyFormMorphTargetSet',
  'com.live2d.cubism.doc.model.morphTarget.MorphTargetBlendWeightConstraintSet',
  'com.live2d.cubism.doc.model.options.edition.EditorEdition',
  'com.live2d.cubism.doc.model.param.CParameterSource',
  'com.live2d.cubism.doc.model.param.CParameterSource$Type',
  'com.live2d.cubism.doc.model.param.CParameterSourceSet',
  'com.live2d.cubism.doc.model.param.group.CParameterGroup',
  'com.live2d.cubism.doc.model.param.group.CParameterGroupSet',
  'com.live2d.cubism.doc.model.parts.CPartForm',
  'com.live2d.cubism.doc.model.parts.CPartSource',
  'com.live2d.cubism.doc.model.parts.CPartSourceSet',
  'com.live2d.cubism.doc.model.texture.CTextureManager',
  'com.live2d.cubism.doc.model.texture.LayeredImageWrapper',
  'com.live2d.cubism.doc.model.texture.TextureImageGroup',
  'com.live2d.cubism.doc.model.texture.modelImage.CModelImage',
  'com.live2d.cubism.doc.model.texture.modelImage.CModelImageGroup',
  'com.live2d.cubism.doc.resources.ACImageLayer',
  'com.live2d.cubism.doc.resources.ACLayerEntry',
  'com.live2d.cubism.doc.resources.ACLayerGroup',
  'com.live2d.cubism.doc.resources.CLayer',
  'com.live2d.cubism.doc.resources.CLayerGroup',
  'com.live2d.cubism.doc.resources.CLayerIdentifier',
  'com.live2d.cubism.doc.resources.CLayeredImage',
  'com.live2d.cubism.doc.resources.LayerSet',
  'com.live2d.doc.CoordType',
  'com.live2d.graphics.CImageCanvas',
  'com.live2d.graphics.CImageResource',
  'com.live2d.graphics.CWritableImage',
  'com.live2d.graphics.cachedImage.CCachedImage',
  'com.live2d.graphics.cachedImage.CCachedImageManager',
  'com.live2d.graphics.cachedImage.CachedImageType',
  'com.live2d.graphics.filter.AValueConnector',
  'com.live2d.graphics.filter.FilterEnv',
  'com.live2d.graphics.filter.FilterEnv$EnvValueSet',
  'com.live2d.graphics.filter.FilterSet',
  'com.live2d.graphics.filter.FilterSet$EnvConnection',
  'com.live2d.graphics.filter.FilterValue',
  'com.live2d.graphics.filter.concreteConnector.EnvValueConnector',
  'com.live2d.graphics.filter.concreteConnector.FilterOutputValueConnector',
  'com.live2d.graphics.filter.filterInstance.FilterInstance',
  'com.live2d.graphics.filter.id.FilterInstanceId',
  'com.live2d.graphics.filter.id.FilterValueId',
  'com.live2d.graphics.psd.blend.ACBlend',
  'com.live2d.graphics.psd.blend.CBlend_Normal',
  'com.live2d.graphics3d.editableMesh.GEditableMesh2',
  'com.live2d.graphics3d.texture.Anisotropy',
  'com.live2d.graphics3d.texture.GTexture',
  'com.live2d.graphics3d.texture.GTexture$FilterMode',
  'com.live2d.graphics3d.texture.GTexture2D',
  'com.live2d.graphics3d.texture.MagFilter',
  'com.live2d.graphics3d.texture.MinFilter',
  'com.live2d.graphics3d.texture.WrapMode',
  'com.live2d.graphics3d.type.GVector2',
  'com.live2d.type.CAffine',
  'com.live2d.type.CColor',
  'com.live2d.type.CDeformerGuid',
  'com.live2d.type.CDrawableGuid',
  'com.live2d.type.CExtensionGuid',
  'com.live2d.type.CFloatColor',
  'com.live2d.type.CFormGuid',
  'com.live2d.type.CImageIcon',
  'com.live2d.type.CLayerGuid',
  'com.live2d.type.CLayeredImageGuid',
  'com.live2d.type.CModelGuid',
  'com.live2d.type.CModelImageGuid',
  'com.live2d.type.CParameterGroupGuid',
  'com.live2d.type.CParameterGuid',
  'com.live2d.type.CPartGuid',
  'com.live2d.type.CPoint',
  'com.live2d.type.CRect',
  'com.live2d.type.CSize',
  'com.live2d.type.GEditableMeshGuid',
  'com.live2d.type.GTextureGuid',
  'com.live2d.type.StaticFilterDefGuid',
];

// Well-known UUIDs for built-in filter types (from Cubism Editor 5.0 Java decompile)
const FILTER_DEF_LAYER_SELECTOR = '5e9fe1ea-0ec3-4d68-a5fa-018fc7abe301';
const FILTER_DEF_LAYER_FILTER = '4083cd1f-40ba-4eda-8400-379019d55ed8';
// CDeformerGuid.ROOT — hardcoded in Editor, compared by UUID equality
const DEFORMER_ROOT_UUID = '71fae776-e218-4aee-873e-78e8ac0cb48a';

// XmlBuilder + uuid imported from ./xmlbuilder.js

// ---------- Texture PNG helpers ----------

/**
 * Convert an HTMLImageElement or OffscreenCanvas to a PNG Uint8Array.
 * @param {HTMLImageElement} img
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Uint8Array>}
 */
async function imageToPng(img, w, h) {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  let blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Create a minimal white PNG (fallback).
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
function makeMinimalPng(w, h) {
  // Use canvas API for simplicity
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // Synchronous fallback: build a very small PNG manually
  // Actually we can't do sync blob. Build raw PNG.
  return buildRawPng(w, h);
}

/** Build a raw white RGBA PNG from scratch (no canvas needed). */
function buildRawPng(w, h) {
  // PNG = signature + IHDR + IDAT + IEND
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = data.length;
    const buf = new Uint8Array(4 + type.length + data.length + 4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, len, false);
    buf.set(type, 4);
    buf.set(data, 4 + type.length);
    // CRC over type+data
    const crcData = buf.subarray(4, 4 + type.length + data.length);
    const crc = crc32Buf(crcData);
    dv.setUint32(4 + type.length + data.length, crc, false);
    return buf;
  }

  // IHDR
  const ihdrData = new Uint8Array(13);
  const ihdrDv = new DataView(ihdrData.buffer);
  ihdrDv.setUint32(0, w, false);
  ihdrDv.setUint32(4, h, false);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk(new Uint8Array([73, 72, 68, 82]), ihdrData);

  // IDAT — white opaque pixels, filter byte 0 per row
  const rawRow = new Uint8Array(1 + w * 4);
  rawRow[0] = 0; // filter none
  for (let x = 0; x < w; x++) {
    rawRow[1 + x * 4 + 0] = 255;
    rawRow[1 + x * 4 + 1] = 255;
    rawRow[1 + x * 4 + 2] = 255;
    rawRow[1 + x * 4 + 3] = 255;
  }
  const rawData = new Uint8Array(rawRow.length * h);
  for (let y = 0; y < h; y++) rawData.set(rawRow, y * rawRow.length);

  // Deflate using CompressionStream is async — use uncompressed deflate blocks instead
  const deflated = deflateUncompressed(rawData);
  const idat = makeChunk(new Uint8Array([73, 68, 65, 84]), deflated);

  const iend = makeChunk(new Uint8Array([73, 69, 78, 68]), new Uint8Array(0));

  const total = signature.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(total);
  let off = 0;
  png.set(signature, off); off += signature.length;
  png.set(ihdr, off); off += ihdr.length;
  png.set(idat, off); off += idat.length;
  png.set(iend, off);
  return png;
}

/** Wrap raw data in uncompressed deflate blocks (zlib stream). */
function deflateUncompressed(data) {
  // zlib header: CMF=0x78, FLG=0x01
  const maxBlock = 65535;
  const numBlocks = Math.ceil(data.length / maxBlock) || 1;
  const outSize = 2 + numBlocks * 5 + data.length + 4; // header + blocks + adler32
  const out = new Uint8Array(outSize);
  let pos = 0;
  out[pos++] = 0x78; // CMF
  out[pos++] = 0x01; // FLG
  let remaining = data.length;
  let srcOff = 0;
  while (remaining > 0 || srcOff === 0) {
    const blockLen = Math.min(remaining, maxBlock);
    const isLast = remaining <= maxBlock;
    out[pos++] = isLast ? 1 : 0; // BFINAL
    out[pos++] = blockLen & 0xFF;
    out[pos++] = (blockLen >> 8) & 0xFF;
    out[pos++] = (~blockLen) & 0xFF;
    out[pos++] = ((~blockLen) >> 8) & 0xFF;
    out.set(data.subarray(srcOff, srcOff + blockLen), pos);
    pos += blockLen;
    srcOff += blockLen;
    remaining -= blockLen;
    if (blockLen === 0) break;
  }
  // Adler-32
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out[pos++] = (adler >> 24) & 0xFF;
  out[pos++] = (adler >> 16) & 0xFF;
  out[pos++] = (adler >> 8) & 0xFF;
  out[pos++] = adler & 0xFF;
  return out.subarray(0, pos);
}

const CRC_TABLE_PNG = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Buf(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE_PNG[(crc ^ data[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------- Main generator ----------

/**
 * @typedef {Object} MeshInfo
 * @property {string} name - Mesh name (e.g. "ArtMesh0")
 * @property {string} [partId] - Original part node ID (for group mapping)
 * @property {string|null} [parentGroupId] - Parent group node ID
 * @property {number[]} vertices - Flat array [x0,y0, x1,y1, ...] in pixel coords
 * @property {number[]} triangles - Flat triangle indices [i0,i1,i2, ...]
 * @property {number[]} uvs - UV coords [u0,v0, u1,v1, ...] in 0..1
 * @property {Uint8Array} pngData - PNG texture data for this mesh
 * @property {number} texWidth - Texture width in pixels
 * @property {number} texHeight - Texture height in pixels
 */

/**
 * @typedef {Object} GroupInfo
 * @property {string} id - Group node ID
 * @property {string} name - Group display name
 * @property {string|null} parent - Parent group ID (null = root)
 */

/**
 * @typedef {Object} ParamInfo
 * @property {string} id - Parameter ID (e.g. "ParamAngleX")
 * @property {string} [name] - Display name
 * @property {number} [min] - Minimum value (default 0)
 * @property {number} [max] - Maximum value (default 1)
 * @property {number} [default] - Default value (default 0)
 */

/**
 * @typedef {Object} Cmo3Input
 * @property {number} canvasW - Canvas width
 * @property {number} canvasH - Canvas height
 * @property {MeshInfo[]} meshes - Array of mesh data
 * @property {GroupInfo[]} [groups=[]] - Group nodes (become CPartSource)
 * @property {ParamInfo[]} [parameters=[]] - Parameters
 * @property {string} [modelName='StretchyStudio Export']
 * @property {boolean} [generateRig=false] - Add standard Live2D parameter IDs
 */

/**
 * Generate a .cmo3 file (CAFF archive containing main.xml + PNG textures).
 *
 * @param {Cmo3Input} input
 * @returns {Promise<{cmo3: Uint8Array, deformerParamMap: Map<string, {paramId: string, min: number, max: number}>}>}
 */
export async function generateCmo3(input) {
  const {
    canvasW, canvasH, meshes,
    groups = [], parameters = [],
    animations = [],
    modelName = 'StretchyStudio Export',
    generateRig = false,
  } = input;
  const x = new XmlBuilder();

  // ==================================================================
  // 1. GLOBAL SHARED OBJECTS (used by all meshes)
  // ==================================================================

  const [, pidParamGroupGuid] = x.shared('CParameterGroupGuid', { uuid: uuid(), note: 'root_group' });
  const [, pidModelGuid] = x.shared('CModelGuid', { uuid: uuid(), note: 'model' });

  // Build parameter GUIDs — always include ParamOpacity, plus all project parameters
  const paramDefs = [];
  // ParamOpacity is always required (keyform bindings reference it)
  const [, pidParamOpacity] = x.shared('CParameterGuid', { uuid: uuid(), note: 'ParamOpacity' });
  paramDefs.push({
    pid: pidParamOpacity, id: 'ParamOpacity', name: 'Opacity',
    min: 0, max: 1, defaultVal: 1, decimalPlaces: 1,
  });
  for (const p of parameters) {
    const paramId = p.id ?? `Param${paramDefs.length}`;
    const [, pid] = x.shared('CParameterGuid', { uuid: uuid(), note: paramId });
    paramDefs.push({
      pid, id: paramId, name: p.name ?? paramId,
      min: p.min ?? 0, max: p.max ?? 1, defaultVal: p.default ?? 0,
      decimalPlaces: 3,
    });
  }

  // Standard Live2D parameters (when generateRig is enabled).
  // These use SDK-standard IDs so face tracking apps (VTube Studio) recognize them.
  if (generateRig) {
    const standardParams = [
      { id: 'ParamAngleX',     name: 'Angle X',      min: -30, max: 30,  def: 0 },
      { id: 'ParamAngleY',     name: 'Angle Y',      min: -30, max: 30,  def: 0 },
      { id: 'ParamAngleZ',     name: 'Angle Z',      min: -30, max: 30,  def: 0 },
      { id: 'ParamBodyAngleX', name: 'Body Angle X',  min: -10, max: 10, def: 0 },
      { id: 'ParamBodyAngleY', name: 'Body Angle Y',  min: -10, max: 10, def: 0 },
      { id: 'ParamBodyAngleZ', name: 'Body Angle Z',  min: -10, max: 10, def: 0 },
      { id: 'ParamBreath',     name: 'Breath',        min: 0,   max: 1,  def: 0 },
      { id: 'ParamEyeLOpen',   name: 'Eye L Open',    min: 0,   max: 1,  def: 1 },
      { id: 'ParamEyeROpen',   name: 'Eye R Open',    min: 0,   max: 1,  def: 1 },
      { id: 'ParamEyeBallX',   name: 'Eyeball X',     min: -1,  max: 1,  def: 0 },
      { id: 'ParamEyeBallY',   name: 'Eyeball Y',     min: -1,  max: 1,  def: 0 },
      { id: 'ParamBrowLY',     name: 'Brow L Y',      min: -1,  max: 1,  def: 0 },
      { id: 'ParamBrowRY',     name: 'Brow R Y',      min: -1,  max: 1,  def: 0 },
      { id: 'ParamMouthForm',  name: 'Mouth Form',    min: -1,  max: 1,  def: 0 },
      { id: 'ParamMouthOpenY', name: 'Mouth Open',    min: 0,   max: 1,  def: 0 },
      { id: 'ParamHairFront',  name: 'Hair Front',    min: -1,  max: 1,  def: 0 },
      { id: 'ParamHairSide',   name: 'Hair Side',     min: -1,  max: 1,  def: 0 },
      { id: 'ParamHairBack',   name: 'Hair Back',     min: -1,  max: 1,  def: 0 },
    ];
    for (const sp of standardParams) {
      if (paramDefs.find(p => p.id === sp.id)) continue;
      const [, pid] = x.shared('CParameterGuid', { uuid: uuid(), note: sp.id });
      paramDefs.push({
        pid, id: sp.id, name: sp.name,
        min: sp.min, max: sp.max, defaultVal: sp.def, decimalPlaces: 1,
      });
    }
  }

  // Pre-create rotation parameters for bone nodes (needed by baked keyform meshes).
  // These are groups referenced as jointBoneId by meshes with boneWeights.
  // Created here (before per-mesh loop) so KeyformBindingSource can reference them.
  const BAKED_ANGLE_MIN = -90;
  const BAKED_ANGLE_MAX = 90;
  const boneParamGuids = new Map(); // jointBoneId → { pidParam, paramId }
  for (const m of meshes) {
    if (m.jointBoneId && m.boneWeights && !boneParamGuids.has(m.jointBoneId)) {
      const boneGroup = groups.find(g => g.id === m.jointBoneId);
      const boneName = (boneGroup?.name || m.jointBoneId).replace(/[^a-zA-Z0-9_]/g, '_');
      const paramId = `ParamRotation_${boneName}`;
      const [, pidParam] = x.shared('CParameterGuid', { uuid: uuid(), note: paramId });
      boneParamGuids.set(m.jointBoneId, { pidParam, paramId });
      paramDefs.push({
        pid: pidParam, id: paramId, name: `Rotation ${boneGroup?.name || m.jointBoneId}`,
        min: BAKED_ANGLE_MIN, max: BAKED_ANGLE_MAX, defaultVal: 0, decimalPlaces: 1,
      });
    }
  }

  // Root part GUID
  const [, pidPartGuid] = x.shared('CPartGuid', { uuid: uuid(), note: '__RootPart__' });

  // Group → CPartGuid mapping
  const groupPartGuids = new Map(); // groupId → pidPartGuid
  for (const g of groups) {
    const [, gpid] = x.shared('CPartGuid', { uuid: uuid(), note: g.name || g.id });
    groupPartGuids.set(g.id, gpid);
  }

  // CBlend_Normal (shared blend mode)
  const [blendNormal, pidBlend] = x.shared('CBlend_Normal');
  const abl = x.sub(blendNormal, 'ACBlend', { 'xs.n': 'super' });
  x.sub(abl, 's', { 'xs.n': 'displayName' }).text = '\u901A\u5E38'; // 通常 (Normal)

  // CDeformerGuid ROOT — MUST be this exact UUID
  const [, pidDeformerRoot] = x.shared('CDeformerGuid', {
    uuid: DEFORMER_ROOT_UUID, note: 'ROOT',
  });

  // CDeformerGuid "NOT INITIALIZED" — used for parts' targetDeformerGuid (Hiyori pattern)
  // Parts don't belong to any deformer, so they get a null-like GUID
  const [, pidDeformerNull] = x.shared('CDeformerGuid', {
    uuid: '00000000-0000-0000-0000-000000000000', note: 'NOT INITIALIZED',
  });

  // CoordType
  const [coordType, pidCoord] = x.shared('CoordType');
  x.sub(coordType, 's', { 'xs.n': 'coordName' }).text = 'DeformerLocal';

  // StaticFilterDefGuids
  const [, pidFdefSel] = x.shared('StaticFilterDefGuid', {
    uuid: FILTER_DEF_LAYER_SELECTOR, note: 'CLayerSelector',
  });
  const [, pidFdefFlt] = x.shared('StaticFilterDefGuid', {
    uuid: FILTER_DEF_LAYER_FILTER, note: 'CLayerFilter',
  });

  // FilterValueIds (shared across all filter graphs)
  const [, pidFvidIlfOutput] = x.shared('FilterValueId', { idstr: 'ilf_outputLayerData' });
  const [, pidFvidMiLayer] = x.shared('FilterValueId', { idstr: 'mi_input_layerInputData' });
  const [, pidFvidIlfInput] = x.shared('FilterValueId', { idstr: 'ilf_inputLayerData' });
  const [, pidFvidMiGuid] = x.shared('FilterValueId', { idstr: 'mi_currentImageGuid' });
  const [, pidFvidIlfGuid] = x.shared('FilterValueId', { idstr: 'ilf_currentImageGuid' });
  const [, pidFvidMiOutImg] = x.shared('FilterValueId', { idstr: 'mi_output_image' });
  const [, pidFvidMiOutXfm] = x.shared('FilterValueId', { idstr: 'mi_output_transform' });
  const [, pidFvidIlfInLayer] = x.shared('FilterValueId', { idstr: 'ilf_inputLayer' });

  // FilterValues (definitions — metadata for filter ports)
  const [fvSelLayer, pidFvSel] = x.shared('FilterValue');
  x.sub(fvSelLayer, 's', { 'xs.n': 'name' }).text = 'Select Layer';
  x.subRef(fvSelLayer, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'id' });
  x.sub(fvSelLayer, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvImpLayer, pidFvImp] = x.shared('FilterValue');
  x.sub(fvImpLayer, 's', { 'xs.n': 'name' }).text = 'Import Layer';
  x.subRef(fvImpLayer, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'id' });
  x.sub(fvImpLayer, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvImpSel, pidFvImpSel] = x.shared('FilterValue');
  x.sub(fvImpSel, 's', { 'xs.n': 'name' }).text = 'Import Layer selection';
  x.subRef(fvImpSel, 'FilterValueId', pidFvidIlfInput, { 'xs.n': 'id' });
  x.sub(fvImpSel, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvCurGuid, pidFvCurGuid] = x.shared('FilterValue');
  x.sub(fvCurGuid, 's', { 'xs.n': 'name' }).text = 'Current GUID';
  x.subRef(fvCurGuid, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'id' });
  x.sub(fvCurGuid, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvSelGuid, pidFvSelGuid] = x.shared('FilterValue');
  x.sub(fvSelGuid, 's', { 'xs.n': 'name' }).text = 'GUID of Selected Source Image';
  x.subRef(fvSelGuid, 'FilterValueId', pidFvidIlfGuid, { 'xs.n': 'id' });
  x.sub(fvSelGuid, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvOutImg, pidFvOutImg] = x.shared('FilterValue');
  x.sub(fvOutImg, 's', { 'xs.n': 'name' }).text = 'Output image';
  x.subRef(fvOutImg, 'FilterValueId', pidFvidMiOutImg, { 'xs.n': 'id' });
  x.sub(fvOutImg, 'null', { 'xs.n': 'defaultValueInitializer' });

  // These two have INLINE FilterValueIds (not shared refs)
  const [fvOutImgRes, pidFvOutImgRes] = x.shared('FilterValue');
  x.sub(fvOutImgRes, 's', { 'xs.n': 'name' }).text = 'Output Image (Resource Format)';
  x.sub(fvOutImgRes, 'FilterValueId', { 'xs.n': 'id', idstr: 'ilf_outputImageRes' });
  x.sub(fvOutImgRes, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvOutXfm, pidFvOutXfm] = x.shared('FilterValue');
  x.sub(fvOutXfm, 's', { 'xs.n': 'name' }).text = 'LayerToCanvas\u5909\u63DB'; // 変換
  x.subRef(fvOutXfm, 'FilterValueId', pidFvidMiOutXfm, { 'xs.n': 'id' });
  x.sub(fvOutXfm, 'null', { 'xs.n': 'defaultValueInitializer' });

  const [fvOutXfm2, pidFvOutXfm2] = x.shared('FilterValue');
  x.sub(fvOutXfm2, 's', { 'xs.n': 'name' }).text = 'LayerToCanvas\u5909\u63DB';
  x.sub(fvOutXfm2, 'FilterValueId', { 'xs.n': 'id', idstr: 'ilf_outputTransform' });
  x.sub(fvOutXfm2, 'null', { 'xs.n': 'defaultValueInitializer' });

  // ==================================================================
  // 2. SHARED PSD (one CLayeredImage with N layers)
  // ==================================================================
  // Session 4 finding: Editor requires ONE CLayeredImage ("PSD") with N CLayers.
  // N separate CLayeredImages = geometry renders but NO textures.

  const [, pidLiGuid] = x.shared('CLayeredImageGuid', { uuid: uuid(), note: 'fakepsd' });
  const [layeredImg, pidLi] = x.shared('CLayeredImage');
  const [layerGroup, pidLg] = x.shared('CLayerGroup');

  const perMesh = [];
  const layerRefs = []; // [{pidLayer, pidImg}] for building CLayerGroup/CLayeredImage after loop

  // ── Eyelash closure band (Session 17, per-vertex CArtMeshForm approach) ──
  // For each eyelash-l/eyelash-r mesh: extract lower contour (bin-max-Y), offset upward
  // by 15% of mesh height → "band upper Y". Vertices above this line collapse to it at
  // closed; at/below stay at rest. Evaluated per-vertex (not grid) so fine contour holds.
  const pidParamEyeLOpenEarly = paramDefs.find(p => p.id === 'ParamEyeLOpen')?.pid;
  const pidParamEyeROpenEarly = paramDefs.find(p => p.id === 'ParamEyeROpen')?.pid;
  const EYELASH_BAND_FRAC = 0.05;
  const EYELASH_CLOSED_SHIFT_FRAC = 0.10; // shift closed state up by this fraction of mesh height
  const eyelashBandCanvas = new Map(); // side ('l'/'r') → [[x, bandUpperY], ...] canvas space
  const eyelashShiftCanvas = new Map(); // side → pixel shift to apply at closed state (positive = up)
  for (const mesh of meshes) {
    if (mesh.tag !== 'eyelash-l' && mesh.tag !== 'eyelash-r') continue;
    const verts = mesh.vertices;
    const nv = verts.length / 2;
    if (nv < 3) continue;
    const pairs = new Array(nv);
    for (let i = 0; i < nv; i++) pairs[i] = [verts[i * 2], verts[i * 2 + 1]];
    pairs.sort((a, b) => a[0] - b[0]);
    const pLo = Math.floor(nv * 0.20);
    const pHi = Math.max(pLo + 1, Math.ceil(nv * 0.80));
    const central = pairs.slice(pLo, pHi);
    if (central.length < 4) continue;
    const N_BINS = Math.min(8, Math.max(3, Math.floor(central.length / 3)));
    const bottomPts = [];
    for (let b = 0; b < N_BINS; b++) {
      const binStart = Math.floor(central.length * b / N_BINS);
      const binEnd = Math.floor(central.length * (b + 1) / N_BINS);
      if (binEnd <= binStart) continue;
      let maxY = -Infinity, sumX = 0;
      for (let i = binStart; i < binEnd; i++) {
        if (central[i][1] > maxY) maxY = central[i][1];
        sumX += central[i][0];
      }
      bottomPts.push([sumX / (binEnd - binStart), maxY]);
    }
    if (bottomPts.length < 2) continue;
    let meshMinY = Infinity, meshMaxY = -Infinity;
    for (const p of pairs) {
      if (p[1] < meshMinY) meshMinY = p[1];
      if (p[1] > meshMaxY) meshMaxY = p[1];
    }
    const bandThickness = (meshMaxY - meshMinY) * EYELASH_BAND_FRAC;
    const bandCurve = bottomPts.map(([x, y]) => [x, y - bandThickness]);
    const side = mesh.tag.endsWith('-l') ? 'l' : 'r';
    eyelashBandCanvas.set(side, bandCurve);
    eyelashShiftCanvas.set(side, (meshMaxY - meshMinY) * EYELASH_CLOSED_SHIFT_FRAC);
  }
  const evalBandY = (bandCurve, px) => {
    if (!bandCurve || bandCurve.length < 2) return null;
    if (px <= bandCurve[0][0]) return bandCurve[0][1];
    const last = bandCurve.length - 1;
    if (px >= bandCurve[last][0]) return bandCurve[last][1];
    for (let j = 0; j < last; j++) {
      if (px >= bandCurve[j][0] && px <= bandCurve[j + 1][0]) {
        const t = (px - bandCurve[j][0]) / (bandCurve[j + 1][0] - bandCurve[j][0]);
        return bandCurve[j][1] + t * (bandCurve[j + 1][1] - bandCurve[j][1]);
      }
    }
    return bandCurve[last][1];
  };

  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi];
    const meshName = m.name;
    const meshId = `ArtMesh${mi}`;

    // Per-mesh GUIDs
    const [, pidDrawable] = x.shared('CDrawableGuid', { uuid: uuid(), note: meshName });
    const [, pidFormMesh] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_form` });
    const [, pidMiGuid] = x.shared('CModelImageGuid', { uuid: uuid(), note: `modelimg${mi}` });
    const [, pidTexGuid] = x.shared('GTextureGuid', { uuid: uuid(), note: `tex${mi}` });
    const [, pidExtMesh] = x.shared('CExtensionGuid', { uuid: uuid(), note: `mesh_ext${mi}` });
    const [, pidExtTex] = x.shared('CExtensionGuid', { uuid: uuid(), note: `tex_ext${mi}` });
    const [, pidEmesh] = x.shared('GEditableMeshGuid', { uuid: uuid(), note: `editmesh${mi}` });

    const pngPath = `imageFileBuf_${mi}.png`;

    // CImageResource (canvas-sized — matches CLayeredImage dimensions)
    const [imgRes, pidImg] = x.shared('CImageResource', {
      width: String(canvasW), height: String(canvasH), type: 'INT_ARGB',
      imageFileBuf_size: String(m.pngData.length),
      previewFileBuf_size: '0',
    });
    x.sub(imgRes, 'file', { 'xs.n': 'imageFileBuf', path: pngPath });

    // CLayer (per-mesh, inside shared CLayerGroup)
    const [layer, pidLayer] = x.shared('CLayer');
    layerRefs.push({ pidLayer, pidImg });

    const acil = x.sub(layer, 'ACImageLayer', { 'xs.n': 'super' });
    const ale = x.sub(acil, 'ACLayerEntry', { 'xs.n': 'super' });
    x.sub(ale, 's', { 'xs.n': 'name' }).text = meshName;
    x.sub(ale, 's', { 'xs.n': 'memo' }).text = '';
    x.sub(ale, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(ale, 'b', { 'xs.n': 'isClipping' }).text = 'false';
    x.subRef(ale, 'CBlend_Normal', pidBlend, { 'xs.n': 'blend' });
    x.sub(ale, 'CLayerGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
    x.subRef(ale, 'CLayerGroup', pidLg, { 'xs.n': 'group' });
    x.sub(ale, 'i', { 'xs.n': 'opacity255' }).text = '255';
    x.sub(ale, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });
    x.subRef(ale, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
    x.subRef(layer, 'CImageResource', pidImg, { 'xs.n': 'imageResource' });
    const bounds = x.sub(layer, 'CRect', { 'xs.n': 'boundsOnImageDoc' });
    x.sub(bounds, 'i', { 'xs.n': 'x' }).text = '0';
    x.sub(bounds, 'i', { 'xs.n': 'y' }).text = '0';
    x.sub(bounds, 'i', { 'xs.n': 'width' }).text = String(canvasW);
    x.sub(bounds, 'i', { 'xs.n': 'height' }).text = String(canvasH);
    const lid = x.sub(layer, 'CLayerIdentifier', { 'xs.n': 'layerIdentifier' });
    x.sub(lid, 's', { 'xs.n': 'layerName' }).text = meshName;
    x.sub(lid, 's', { 'xs.n': 'layerId' }).text = `00-00-00-${String(mi + 1).padStart(2, '0')}`;
    x.sub(lid, 'i', { 'xs.n': 'layerIdValue_testImpl' }).text = String(mi + 1);
    x.sub(layer, 'null', { 'xs.n': 'icon16' });
    x.sub(layer, 'null', { 'xs.n': 'icon64' });
    x.sub(layer, 'linked_map', { 'xs.n': 'layerInfo', count: '0', keyType: 'string' });
    x.sub(layer, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });

    // FILTER GRAPH (per-mesh)
    const [filterSet, pidFset] = x.shared('ModelImageFilterSet');
    const [, pidFiid0] = x.shared('FilterInstanceId', { idstr: `filter0_${mi}` });
    const [fiSelector, pidFiSel] = x.shared('FilterInstance', { filterName: 'CLayerSelector' });
    const [foutConn, pidFout] = x.shared('FilterOutputValueConnector');
    const [, pidFiid1] = x.shared('FilterInstanceId', { idstr: `filter1_${mi}` });
    const [fiFilter, pidFiFlt] = x.shared('FilterInstance', { filterName: 'CLayerFilter' });

    // FilterOutputValueConnector
    x.sub(foutConn, 'AValueConnector', { 'xs.n': 'super' });
    x.subRef(foutConn, 'FilterInstance', pidFiSel, { 'xs.n': 'instance' });
    x.subRef(foutConn, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'id' });
    x.subRef(foutConn, 'FilterValue', pidFvSel, { 'xs.n': 'valueDef' });

    // FilterInstance: CLayerSelector
    x.subRef(fiSelector, 'StaticFilterDefGuid', pidFdefSel, { 'xs.n': 'filterDefGuid' });
    x.sub(fiSelector, 'null', { 'xs.n': 'filterDef' });
    x.subRef(fiSelector, 'FilterInstanceId', pidFiid0, { 'xs.n': 'filterId' });
    const icSel = x.sub(fiSelector, 'hash_map', { 'xs.n': 'inputConnectors', count: '2' });
    const e1 = x.sub(icSel, 'entry');
    x.subRef(e1, 'FilterValueId', pidFvidIlfInput, { 'xs.n': 'key' });
    const evc1 = x.sub(e1, 'EnvValueConnector', { 'xs.n': 'value' });
    x.sub(evc1, 'AValueConnector', { 'xs.n': 'super' });
    x.subRef(evc1, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'envValueId' });
    const e2 = x.sub(icSel, 'entry');
    x.subRef(e2, 'FilterValueId', pidFvidIlfGuid, { 'xs.n': 'key' });
    const evc2 = x.sub(e2, 'EnvValueConnector', { 'xs.n': 'value' });
    x.sub(evc2, 'AValueConnector', { 'xs.n': 'super' });
    x.subRef(evc2, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'envValueId' });
    const ocSel = x.sub(fiSelector, 'hash_map', { 'xs.n': 'outputConnectors', count: '1' });
    const e3 = x.sub(ocSel, 'entry');
    x.subRef(e3, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'key' });
    x.subRef(e3, 'FilterOutputValueConnector', pidFout, { 'xs.n': 'value' });
    x.subRef(fiSelector, 'ModelImageFilterSet', pidFset, { 'xs.n': 'ownerFilterSet' });

    // FilterInstance: CLayerFilter
    x.subRef(fiFilter, 'StaticFilterDefGuid', pidFdefFlt, { 'xs.n': 'filterDefGuid' });
    x.sub(fiFilter, 'null', { 'xs.n': 'filterDef' });
    x.subRef(fiFilter, 'FilterInstanceId', pidFiid1, { 'xs.n': 'filterId' });
    const icFlt = x.sub(fiFilter, 'hash_map', { 'xs.n': 'inputConnectors', count: '1' });
    const e4 = x.sub(icFlt, 'entry');
    x.subRef(e4, 'FilterValueId', pidFvidIlfInLayer, { 'xs.n': 'key' });
    x.subRef(e4, 'FilterOutputValueConnector', pidFout, { 'xs.n': 'value' });
    x.sub(fiFilter, 'hash_map', { 'xs.n': 'outputConnectors', count: '0', keyType: 'string' });
    x.subRef(fiFilter, 'ModelImageFilterSet', pidFset, { 'xs.n': 'ownerFilterSet' });

    // Fill ModelImageFilterSet
    const fsSuper = x.sub(filterSet, 'FilterSet', { 'xs.n': 'super' });
    const fm = x.sub(fsSuper, 'linked_map', { 'xs.n': 'filterMap', count: '2' });
    const fmE1 = x.sub(fm, 'entry');
    x.subRef(fmE1, 'FilterInstanceId', pidFiid0, { 'xs.n': 'key' });
    x.subRef(fmE1, 'FilterInstance', pidFiSel, { 'xs.n': 'value' });
    const fmE2 = x.sub(fm, 'entry');
    x.subRef(fmE2, 'FilterInstanceId', pidFiid1, { 'xs.n': 'key' });
    x.subRef(fmE2, 'FilterInstance', pidFiFlt, { 'xs.n': 'value' });
    // _externalInputs
    const ei = x.sub(fsSuper, 'linked_map', { 'xs.n': '_externalInputs', count: '2' });
    const eiE1 = x.sub(ei, 'entry');
    x.subRef(eiE1, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'key' });
    const ec1 = x.sub(eiE1, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec1, 'FilterValue', pidFvImp, { 'xs.n': '_envValueDef' });
    x.subRef(ec1, 'FilterInstance', pidFiSel, { 'xs.n': 'filter' });
    x.subRef(ec1, 'FilterValue', pidFvImpSel, { 'xs.n': 'filterValueDef' });
    const eiE2 = x.sub(ei, 'entry');
    x.subRef(eiE2, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'key' });
    const ec2 = x.sub(eiE2, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec2, 'FilterValue', pidFvCurGuid, { 'xs.n': '_envValueDef' });
    x.subRef(ec2, 'FilterInstance', pidFiSel, { 'xs.n': 'filter' });
    x.subRef(ec2, 'FilterValue', pidFvSelGuid, { 'xs.n': 'filterValueDef' });
    // _externalOutputs
    const eo = x.sub(fsSuper, 'linked_map', { 'xs.n': '_externalOutputs', count: '2' });
    const eoE1 = x.sub(eo, 'entry');
    x.subRef(eoE1, 'FilterValueId', pidFvidMiOutImg, { 'xs.n': 'key' });
    const ec3 = x.sub(eoE1, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec3, 'FilterValue', pidFvOutImg, { 'xs.n': '_envValueDef' });
    x.subRef(ec3, 'FilterInstance', pidFiFlt, { 'xs.n': 'filter' });
    x.subRef(ec3, 'FilterValue', pidFvOutImgRes, { 'xs.n': 'filterValueDef' });
    const eoE2 = x.sub(eo, 'entry');
    x.subRef(eoE2, 'FilterValueId', pidFvidMiOutXfm, { 'xs.n': 'key' });
    const ec4 = x.sub(eoE2, 'EnvConnection', { 'xs.n': 'value' });
    x.subRef(ec4, 'FilterValue', pidFvOutXfm, { 'xs.n': '_envValueDef' });
    x.subRef(ec4, 'FilterInstance', pidFiFlt, { 'xs.n': 'filter' });
    x.subRef(ec4, 'FilterValue', pidFvOutXfm2, { 'xs.n': 'filterValueDef' });

    // GTexture2D
    const [tex2d, pidTex2d] = x.shared('GTexture2D');
    const gtex = x.sub(tex2d, 'GTexture', { 'xs.n': 'super' });
    x.sub(gtex, 's', { 'xs.n': 'name' }).text = meshName;
    x.sub(gtex, 'WrapMode', { 'xs.n': 'wrapMode', v: 'CLAMP_TO_BORDER' });
    const fmTex = x.sub(gtex, 'FilterMode', { 'xs.n': 'filterMode' });
    x.subRef(fmTex, 'GTexture2D', pidTex2d, { 'xs.n': 'owner' });
    x.sub(fmTex, 'MinFilter', { 'xs.n': 'minFilter', v: 'LINEAR_MIPMAP_LINEAR' });
    x.sub(fmTex, 'MagFilter', { 'xs.n': 'magFilter', v: 'LINEAR' });
    x.subRef(gtex, 'GTextureGuid', pidTexGuid, { 'xs.n': 'guid' });
    x.sub(gtex, 'Anisotropy', { 'xs.n': 'anisotropy', v: 'ON' });
    x.subRef(tex2d, 'CImageResource', pidImg, { 'xs.n': 'srcImageResource' });
    x.sub(tex2d, 'CAffine', {
      'xs.n': 'transformImageResource01toLogical01',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.sub(tex2d, 'i', { 'xs.n': 'mipmapLevel' }).text = '1';
    x.sub(tex2d, 'b', { 'xs.n': 'isPremultiplied' }).text = 'true';

    // CTextureInputExtension + CTextureInput_ModelImage
    const [texInputExt, pidTie] = x.shared('CTextureInputExtension');
    const [texInputMi, pidTimi] = x.shared('CTextureInput_ModelImage');

    const ati = x.sub(texInputMi, 'ACTextureInput', { 'xs.n': 'super' });
    x.sub(ati, 'CAffine', {
      'xs.n': 'optionalTransformOnCanvas',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.subRef(ati, 'CTextureInputExtension', pidTie, { 'xs.n': '_owner' });
    x.subRef(texInputMi, 'CModelImageGuid', pidMiGuid, { 'xs.n': '_modelImageGuid' });

    const tieSup = x.sub(texInputExt, 'ACExtension', { 'xs.n': 'super' });
    x.subRef(tieSup, 'CExtensionGuid', pidExtTex, { 'xs.n': 'guid' });
    // _owner placeholder — will be set when mesh is created
    const tieInputs = x.sub(texInputExt, 'carray_list', { 'xs.n': '_textureInputs', count: '1' });
    x.subRef(tieInputs, 'CTextureInput_ModelImage', pidTimi);
    x.subRef(texInputExt, 'CTextureInput_ModelImage', pidTimi, { 'xs.n': 'currentTextureInputData' });

    // Keyform system — baked bone-weight keyforms for meshes with boneWeights,
    // eyelash-l uses per-vertex closure keyforms (Session 17),
    // otherwise single keyform bound to ParamOpacity (existing behavior)
    const hasBakedKeyforms = !!(m.boneWeights && m.jointBoneId && boneParamGuids.has(m.jointBoneId));
    // Session 17: per-eye closure via per-vertex CArtMeshForm keyforms.
    // Eyelash/eyewhite/irides (both sides) all collapse to their side's eyelash band.
    // Bypasses warp-grid coarseness — bottom contour truly stays static.
    const EYE_CLOSURE_TAGS = new Set([
      'eyelash-l', 'eyewhite-l', 'irides-l',
      'eyelash-r', 'eyewhite-r', 'irides-r',
    ]);
    const closureSide = EYE_CLOSURE_TAGS.has(m.tag)
      ? (m.tag.endsWith('-l') ? 'l' : 'r') : null;
    const closureParamPid = closureSide === 'l' ? pidParamEyeLOpenEarly
      : closureSide === 'r' ? pidParamEyeROpenEarly : null;
    const hasEyelidClosure = !hasBakedKeyforms && closureSide !== null
      && !!closureParamPid && eyelashBandCanvas.has(closureSide);
    const [kfBinding, pidKfb] = x.shared('KeyformBindingSource');
    const [kfGridMesh, pidKfgMesh] = x.shared('KeyformGridSource');

    // Extra form GUIDs for baked keyforms (min/max angles) or closure (closed keyform)
    let pidFormMin = null, pidFormMax = null, pidFormClosed = null;

    if (hasBakedKeyforms) {
      // 3 keyforms: angle at min, rest (0), angle at max — matching Hiyori art mesh pattern
      const [, _pidFormMin] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_baked_min` });
      const [, _pidFormMax] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_baked_max` });
      pidFormMin = _pidFormMin;
      pidFormMax = _pidFormMax;

      const boneParam = boneParamGuids.get(m.jointBoneId);

      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '3' });

      // KeyformOnGrid[0] — angle at min
      const kog0 = x.sub(kfog, 'KeyformOnGrid');
      const ak0 = x.sub(kog0, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop0 = x.sub(ak0, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon0 = x.sub(kop0, 'KeyOnParameter');
      x.subRef(kon0, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon0, 'i', { 'xs.n': 'keyIndex' }).text = '0';
      x.subRef(kog0, 'CFormGuid', pidFormMin, { 'xs.n': 'keyformGuid' });

      // KeyformOnGrid[1] — rest (angle=0)
      const kog1 = x.sub(kfog, 'KeyformOnGrid');
      const ak1 = x.sub(kog1, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop1 = x.sub(ak1, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon1 = x.sub(kop1, 'KeyOnParameter');
      x.subRef(kon1, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon1, 'i', { 'xs.n': 'keyIndex' }).text = '1';
      x.subRef(kog1, 'CFormGuid', pidFormMesh, { 'xs.n': 'keyformGuid' });

      // KeyformOnGrid[2] — angle at max
      const kog2 = x.sub(kfog, 'KeyformOnGrid');
      const ak2 = x.sub(kog2, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop2 = x.sub(ak2, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon2 = x.sub(kop2, 'KeyOnParameter');
      x.subRef(kon2, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon2, 'i', { 'xs.n': 'keyIndex' }).text = '2';
      x.subRef(kog2, 'CFormGuid', pidFormMax, { 'xs.n': 'keyformGuid' });

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', boneParam.pidParam, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '3' });
      x.sub(keys, 'f').text = String(BAKED_ANGLE_MIN) + '.0';
      x.sub(keys, 'f').text = '0.0';
      x.sub(keys, 'f').text = String(BAKED_ANGLE_MAX) + '.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = boneParam.paramId;
    } else if (hasEyelidClosure) {
      // 2 keyforms: closed (k=0), open (k=1, rest). Bound to ParamEye{L,R}Open by side.
      const [, _pidFormClosed] = x.shared('CFormGuid', { uuid: uuid(), note: `${meshName}_closed` });
      pidFormClosed = _pidFormClosed;
      const closureParamId = closureSide === 'l' ? 'ParamEyeLOpen' : 'ParamEyeROpen';

      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '2' });
      // keyIndex 0 → closed
      const kog0 = x.sub(kfog, 'KeyformOnGrid');
      const ak0 = x.sub(kog0, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop0 = x.sub(ak0, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon0 = x.sub(kop0, 'KeyOnParameter');
      x.subRef(kon0, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon0, 'i', { 'xs.n': 'keyIndex' }).text = '0';
      x.subRef(kog0, 'CFormGuid', pidFormClosed, { 'xs.n': 'keyformGuid' });
      // keyIndex 1 → open (rest)
      const kog1 = x.sub(kfog, 'KeyformOnGrid');
      const ak1 = x.sub(kog1, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop1 = x.sub(ak1, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon1 = x.sub(kop1, 'KeyOnParameter');
      x.subRef(kon1, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon1, 'i', { 'xs.n': 'keyIndex' }).text = '1';
      x.subRef(kog1, 'CFormGuid', pidFormMesh, { 'xs.n': 'keyformGuid' });

      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', closureParamPid, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '2' });
      x.sub(keys, 'f').text = '0.0';
      x.sub(keys, 'f').text = '1.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = closureParamId;
    } else {
      // Standard single keyform bound to ParamOpacity
      const kfog = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
      const kog = x.sub(kfog, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kopList = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kop = x.sub(kopList, 'KeyOnParameter');
      x.subRef(kop, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kop, 'i', { 'xs.n': 'keyIndex' }).text = '0';
      x.subRef(kog, 'CFormGuid', pidFormMesh, { 'xs.n': 'keyformGuid' });
      const kb = x.sub(kfGridMesh, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
      x.subRef(kb, 'KeyformBindingSource', pidKfb);

      x.subRef(kfBinding, 'KeyformGridSource', pidKfgMesh, { 'xs.n': '_gridSource' });
      x.subRef(kfBinding, 'CParameterGuid', pidParamOpacity, { 'xs.n': 'parameterGuid' });
      const keys = x.sub(kfBinding, 'array_list', { 'xs.n': 'keys', count: '1' });
      x.sub(keys, 'f').text = '1.0';
      x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
      x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
      x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
      x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = 'ParamOpacity';
    }

    perMesh.push({
      mi, meshName, meshId, pngPath, drawOrder: m.drawOrder ?? (500 + mi),
      pidDrawable, pidFormMesh, pidFormMin, pidFormMax, pidFormClosed,
      pidMiGuid, pidTexGuid, pidExtMesh, pidExtTex, pidEmesh,
      pidImg, pidLayer,
      pidFset, pidTex2d, pidTie, pidTimi,
      pidKfb, pidKfgMesh,
      tieSup, hasBakedKeyforms, hasEyelidClosure, closureSide,
      vertices: m.vertices,
      triangles: m.triangles,
      uvs: m.uvs,
      boneWeights: m.boneWeights,
      jointPivotX: m.jointPivotX,
      jointPivotY: m.jointPivotY,
    });
  }

  // ==================================================================
  // 2b. FILL SHARED CLayerGroup + CLayeredImage (after all layers created)
  // ==================================================================

  const nLayers = layerRefs.length;

  // CLayerGroup (root containing all layers)
  const alg = x.sub(layerGroup, 'ACLayerGroup', { 'xs.n': 'super' });
  const ale2 = x.sub(alg, 'ACLayerEntry', { 'xs.n': 'super' });
  x.sub(ale2, 's', { 'xs.n': 'name' }).text = 'root';
  x.sub(ale2, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(ale2, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(ale2, 'b', { 'xs.n': 'isClipping' }).text = 'false';
  x.subRef(ale2, 'CBlend_Normal', pidBlend, { 'xs.n': 'blend' });
  x.sub(ale2, 'CLayerGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
  x.sub(ale2, 'null', { 'xs.n': 'group' });
  x.sub(ale2, 'i', { 'xs.n': 'opacity255' }).text = '255';
  x.sub(ale2, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });
  x.subRef(ale2, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
  const childrenLg = x.sub(alg, 'carray_list', { 'xs.n': '_children', count: String(nLayers) });
  for (const lr of layerRefs) x.subRef(childrenLg, 'CLayer', lr.pidLayer);
  x.sub(layerGroup, 'null', { 'xs.n': 'layerIdentifier' });

  // CLayeredImage (single "PSD")
  x.sub(layeredImg, 's', { 'xs.n': 'name' }).text = 'fake_psd.psd';
  x.sub(layeredImg, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(layeredImg, 'i', { 'xs.n': 'width' }).text = String(canvasW);
  x.sub(layeredImg, 'i', { 'xs.n': 'height' }).text = String(canvasH);
  x.sub(layeredImg, 'file', { 'xs.n': 'psdFile' }).text = 'fake_psd.psd';
  x.sub(layeredImg, 's', { 'xs.n': 'description' }).text = '';
  x.subRef(layeredImg, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'guid' });
  x.sub(layeredImg, 'null', { 'xs.n': 'psdBytes' });
  x.sub(layeredImg, 'l', { 'xs.n': 'psdFileLastModified' }).text = '0';
  x.subRef(layeredImg, 'CLayerGroup', pidLg, { 'xs.n': '_rootLayer' });
  const layerSet = x.sub(layeredImg, 'LayerSet', { 'xs.n': 'layerSet' });
  x.subRef(layerSet, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
  const lsList = x.sub(layerSet, 'carray_list', { 'xs.n': '_layerEntryList', count: String(nLayers + 1) });
  x.subRef(lsList, 'CLayerGroup', pidLg);
  for (const lr of layerRefs) x.subRef(lsList, 'CLayer', lr.pidLayer);
  x.sub(layeredImg, 'null', { 'xs.n': 'icon16' });
  x.sub(layeredImg, 'null', { 'xs.n': 'icon64' });

  // ==================================================================
  // 3. PART SOURCES (hierarchical: Root → Groups → Drawables)
  // ==================================================================
  // Hiyori pattern: Root Part._childGuids → CPartGuid refs (child groups)
  // Each group._childGuids → CDrawableGuid refs (meshes in that group)
  // Meshes without a group parent go directly under Root Part.

  /**
   * Helper: create a CPartSource node with standard boilerplate.
   * Returns [partSourceNode, pidPartSource].
   */
  function makePartSource(partName, partIdStr, partGuidPid, parentGuidPid) {
    const [, pidForm] = x.shared('CFormGuid', { uuid: uuid(), note: `${partIdStr}_form` });

    const [kfg, pidKfg] = x.shared('KeyformGridSource');
    const kfogN = x.sub(kfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
    const kogN = x.sub(kfogN, 'KeyformOnGrid');
    const akN = x.sub(kogN, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    x.sub(akN, 'array_list', { 'xs.n': '_keyOnParameterList', count: '0' });
    x.subRef(kogN, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
    x.sub(kfg, 'array_list', { 'xs.n': 'keyformBindings', count: '0' });

    const [ps, pidPs] = x.shared('CPartSource');
    const ctrl = x.sub(ps, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(ctrl, 's', { 'xs.n': 'localName' }).text = partName;
    x.sub(ctrl, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(ctrl, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    if (parentGuidPid) {
      x.subRef(ctrl, 'CPartGuid', parentGuidPid, { 'xs.n': 'parentGuid' });
    } else {
      x.sub(ctrl, 'null', { 'xs.n': 'parentGuid' });
    }
    x.subRef(ctrl, 'KeyformGridSource', pidKfg, { 'xs.n': 'keyformGridSource' });
    const mft = x.sub(ctrl, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(mft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const bwc = x.sub(mft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(bwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(ctrl, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(ctrl, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.subRef(ps, 'CPartGuid', partGuidPid, { 'xs.n': 'guid' });
    x.sub(ps, 'CPartId', { 'xs.n': 'id', idstr: partIdStr });
    x.sub(ps, 'b', { 'xs.n': 'enableDrawOrderGroup' }).text = 'false';
    x.sub(ps, 'i', { 'xs.n': 'defaultOrder_forEditor' }).text = '500';
    x.sub(ps, 'b', { 'xs.n': 'isSketch' }).text = 'false';
    x.sub(ps, 'CColor', { 'xs.n': 'partsEditColor' });
    // _childGuids placeholder — caller fills this
    const cg = x.sub(ps, 'carray_list', { 'xs.n': '_childGuids', count: '0' });
    x.subRef(ps, 'CDeformerGuid', pidDeformerNull, { 'xs.n': 'targetDeformerGuid' });
    const kfl = x.sub(ps, 'carray_list', { 'xs.n': 'keyforms', count: '1' });
    const pf = x.sub(kfl, 'CPartForm');
    const acf = x.sub(pf, 'ACForm', { 'xs.n': 'super' });
    x.subRef(acf, 'CFormGuid', pidForm, { 'xs.n': 'guid' });
    x.sub(acf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
    x.sub(acf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
    x.subRef(acf, 'CPartSource', pidPs, { 'xs.n': '_source' }); // self-reference
    x.sub(acf, 'null', { 'xs.n': 'name' });
    x.sub(acf, 's', { 'xs.n': 'notes' }).text = '';
    x.sub(pf, 'i', { 'xs.n': 'drawOrder' }).text = '500';

    return { node: ps, pid: pidPs, childGuidsNode: cg };
  }

  // Build mesh→parentGroupId lookup and group→children lookup
  const meshParentMap = new Map(); // meshIndex → groupId
  for (let i = 0; i < perMesh.length; i++) {
    meshParentMap.set(i, meshes[i].parentGroupId ?? null);
  }

  // Create Root Part
  const rootPart = makePartSource('Root Part', '__RootPart__', pidPartGuid, null);
  const allPartSources = [rootPart]; // collect for PartSourceSet

  // Create group parts
  const groupParts = new Map(); // groupId → { pid, childGuidsNode, ... }
  for (const g of groups) {
    const gpid = groupPartGuids.get(g.id);
    // Determine parent: if group.parent exists and has a CPartGuid, use it; else use root
    const parentPid = g.parent && groupPartGuids.has(g.parent)
      ? groupPartGuids.get(g.parent) : pidPartGuid;
    const sanitizedId = `Part_${(g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const gp = makePartSource(g.name || g.id, sanitizedId, gpid, parentPid);
    groupParts.set(g.id, gp);
    allPartSources.push(gp);
  }

  // Fill _childGuids for each part
  // Root Part children = top-level groups (parent == null) + orphan meshes
  const rootChildren = [];
  for (const g of groups) {
    if (!g.parent || !groupPartGuids.has(g.parent)) {
      rootChildren.push({ type: 'CPartGuid', pid: groupPartGuids.get(g.id) });
    }
  }
  // Meshes: assign to their parent group, or root if no group
  for (let i = 0; i < perMesh.length; i++) {
    const parentId = meshParentMap.get(i);
    const target = parentId && groupParts.has(parentId)
      ? groupParts.get(parentId) : null;
    if (target) {
      // Add to group's _childGuids
      target.childGuidsNode.children.push(
        x.ref('CDrawableGuid', perMesh[i].pidDrawable)
      );
    } else {
      // Add to root
      rootChildren.push({ type: 'CDrawableGuid', pid: perMesh[i].pidDrawable });
    }
  }

  // Sub-groups: groups whose parent is another group (not root)
  for (const g of groups) {
    if (g.parent && groupParts.has(g.parent)) {
      const parentGp = groupParts.get(g.parent);
      parentGp.childGuidsNode.children.push(
        x.ref('CPartGuid', groupPartGuids.get(g.id))
      );
    }
  }

  // Write root children
  for (const c of rootChildren) {
    rootPart.childGuidsNode.children.push(x.ref(c.type, c.pid));
  }

  // Update count attrs on all _childGuids nodes
  for (const ps of allPartSources) {
    ps.childGuidsNode.attrs.count = String(ps.childGuidsNode.children.length);
  }

  // ==================================================================
  // 3b. ROTATION DEFORMERS (one per group with transform data)
  // ==================================================================
  // Each group node → CRotationDeformerSource. Deformer chain follows group hierarchy.
  // Meshes are auto-parented to their group's deformer with vertex space conversion.

  // --- Compute world-space pivot positions for all groups ---
  // Used for: (a) deformer origins, (b) mesh vertex → deformer-local transform
  const groupMap = new Map(groups.map(g => [g.id, g]));
  const groupWorldMatrices = new Map();

  function resolveGroupWorld(groupId) {
    if (groupWorldMatrices.has(groupId)) return groupWorldMatrices.get(groupId);
    const g = groupMap.get(groupId);
    if (!g) return new Float32Array([1,0,0, 0,1,0, 0,0,1]);
    const local = makeLocalMatrix(g.transform);
    const world = (g.parent && groupMap.has(g.parent))
      ? mat3Mul(resolveGroupWorld(g.parent), local)
      : local;
    groupWorldMatrices.set(groupId, world);
    return world;
  }
  for (const g of groups) resolveGroupWorld(g.id);

  // Compute canvas-space (world) pivot position for each group's deformer origin
  const deformerWorldOrigins = new Map(); // groupId → { x, y }
  for (const g of groups) {
    const wm = groupWorldMatrices.get(g.id);
    const t = g.transform || {};
    const px = t.pivotX ?? 0, py = t.pivotY ?? 0;
    // Pivot in world space: worldMatrix × [pivotX, pivotY, 1]
    // For identity transform: pivot maps to (x + pivotX, y + pivotY) in parent space
    const worldPivotX = wm[0] * px + wm[3] * py + wm[6];
    const worldPivotY = wm[1] * px + wm[4] * py + wm[7];

    const hasPivot = px !== 0 || py !== 0;
    if (hasPivot) {
      deformerWorldOrigins.set(g.id, { x: worldPivotX, y: worldPivotY });
    } else {
      // Fallback: center of descendant meshes bounding box
      const descendantIds = new Set([g.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g2 of groups) {
          if (!descendantIds.has(g2.id) && g2.parent && descendantIds.has(g2.parent)) {
            descendantIds.add(g2.id);
            changed = true;
          }
        }
      }
      const descMeshes = meshes.filter(m => m.parentGroupId && descendantIds.has(m.parentGroupId));
      if (descMeshes.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const gm of descMeshes) {
          for (let vi = 0; vi < gm.vertices.length; vi += 2) {
            const vx = gm.vertices[vi], vy = gm.vertices[vi + 1];
            if (vx < minX) minX = vx; if (vy < minY) minY = vy;
            if (vx > maxX) maxX = vx; if (vy > maxY) maxY = vy;
          }
        }
        deformerWorldOrigins.set(g.id, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
      } else {
        deformerWorldOrigins.set(g.id, { x: canvasW / 2, y: canvasH / 2 });
      }
    }
  }

  const groupDeformerGuids = new Map(); // groupId → pidDeformerGuid
  const rotDeformerTargetNodes = new Map(); // groupId → XML node (for re-parenting to Body Warp)
  const rotDeformerOriginNodes = new Map(); // groupId → [{xNode, yNode, ox, oy}, ...] per keyform
  const allDeformerSources = []; // {pid, tag} for CDeformerSourceSet
  // Exported: groupId → parameter ID string (for animation export)
  const deformerParamMap = new Map(); // groupId → { paramId, min, max }

  // Default rotation range for generic parameter bindings (Approach B from Session 8 prompt)
  const DEFORMER_ANGLE_MIN = -30;
  const DEFORMER_ANGLE_MAX = 30;

  // Bone nodes get baked keyforms on their meshes instead of rotation deformers.
  // Their parameters were already created in the pre-creation step above.
  // Add them to deformerParamMap for animation export (can3writer needs them).
  for (const [boneId, bp] of boneParamGuids) {
    deformerParamMap.set(boneId, {
      paramId: bp.paramId, min: BAKED_ANGLE_MIN, max: BAKED_ANGLE_MAX,
    });
  }

  // Hiyori doesn't have rotation deformers for torso or eyes.
  // Torso body lean is done via Body X Warp (section 3d). Eyes via warp/parallax.
  // Skipping these makes neck/arms fall through to ROOT → re-parented to Breath.
  const SKIP_ROTATION_ROLES = new Set(['torso', 'eyes']);

  for (const g of groups) {
    // Skip bone nodes — they get baked mesh keyforms, not rotation deformers
    if (boneParamGuids.has(g.id)) continue;
    // Skip groups that Hiyori handles via warps, not rotation deformers
    if (SKIP_ROTATION_ROLES.has(g.boneRole)) continue;

    const t = g.transform || {};
    // Create a deformer for non-bone, non-skipped groups
    const [, pidDfGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `Rot_${g.name || g.id}` });
    groupDeformerGuids.set(g.id, pidDfGuid);

    // 3 keyforms: angle at min, angle at default (0), angle at max
    const [, pidDfFormMin] = x.shared('CFormGuid', { uuid: uuid(), note: `RotForm_${g.name}_min` });
    const [, pidDfFormDef] = x.shared('CFormGuid', { uuid: uuid(), note: `RotForm_${g.name}_def` });
    const [, pidDfFormMax] = x.shared('CFormGuid', { uuid: uuid(), note: `RotForm_${g.name}_max` });

    // Parameter for this deformer: ParamRotation_GroupName
    // Guard: bone params are pre-created above — skip if ID already exists
    const sanitizedName = (g.name || g.id).replace(/[^a-zA-Z0-9_]/g, '_');
    const rotParamId = `ParamRotation_${sanitizedName}`;
    const existingParam = paramDefs.find(p => p.id === rotParamId);
    const pidRotParam = existingParam
      ? existingParam.pid
      : (() => { const [, pid] = x.shared('CParameterGuid', { uuid: uuid(), note: rotParamId }); return pid; })();
    if (!existingParam) {
      paramDefs.push({
        pid: pidRotParam, id: rotParamId, name: `Rotation ${g.name || g.id}`,
        min: DEFORMER_ANGLE_MIN, max: DEFORMER_ANGLE_MAX, defaultVal: 0,
        decimalPlaces: 1,
      });
    }
    deformerParamMap.set(g.id, {
      paramId: rotParamId, min: DEFORMER_ANGLE_MIN, max: DEFORMER_ANGLE_MAX,
    });

    // CoordType for this deformer (Canvas coordinates)
    const [coordDf, pidCoordDf] = x.shared('CoordType');
    x.sub(coordDf, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // KeyformBindingSource — links this deformer to its rotation parameter
    const [kfBinding, pidKfBinding] = x.shared('KeyformBindingSource');

    // KeyformGridSource (3 keyforms, 1 parameter binding)
    const [kfgDf, pidKfgDf] = x.shared('KeyformGridSource');
    const kfogDf = x.sub(kfgDf, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '3' });

    // KeyformOnGrid[0] — angle at min
    const kog0 = x.sub(kfogDf, 'KeyformOnGrid');
    const ak0 = x.sub(kog0, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    const kop0 = x.sub(ak0, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
    const kon0 = x.sub(kop0, 'KeyOnParameter');
    x.subRef(kon0, 'KeyformBindingSource', pidKfBinding, { 'xs.n': 'binding' });
    x.sub(kon0, 'i', { 'xs.n': 'keyIndex' }).text = '0';
    x.subRef(kog0, 'CFormGuid', pidDfFormMin, { 'xs.n': 'keyformGuid' });

    // KeyformOnGrid[1] — angle at default (0)
    const kog1 = x.sub(kfogDf, 'KeyformOnGrid');
    const ak1 = x.sub(kog1, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    const kop1 = x.sub(ak1, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
    const kon1 = x.sub(kop1, 'KeyOnParameter');
    x.subRef(kon1, 'KeyformBindingSource', pidKfBinding, { 'xs.n': 'binding' });
    x.sub(kon1, 'i', { 'xs.n': 'keyIndex' }).text = '1';
    x.subRef(kog1, 'CFormGuid', pidDfFormDef, { 'xs.n': 'keyformGuid' });

    // KeyformOnGrid[2] — angle at max
    const kog2 = x.sub(kfogDf, 'KeyformOnGrid');
    const ak2 = x.sub(kog2, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    const kop2 = x.sub(ak2, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
    const kon2 = x.sub(kop2, 'KeyOnParameter');
    x.subRef(kon2, 'KeyformBindingSource', pidKfBinding, { 'xs.n': 'binding' });
    x.sub(kon2, 'i', { 'xs.n': 'keyIndex' }).text = '2';
    x.subRef(kog2, 'CFormGuid', pidDfFormMax, { 'xs.n': 'keyformGuid' });

    // keyformBindings list
    const kfbList = x.sub(kfgDf, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(kfbList, 'KeyformBindingSource', pidKfBinding);

    // Fill KeyformBindingSource (circular ref with KeyformGridSource — matches Hiyori)
    x.subRef(kfBinding, 'KeyformGridSource', pidKfgDf, { 'xs.n': '_gridSource' });
    x.subRef(kfBinding, 'CParameterGuid', pidRotParam, { 'xs.n': 'parameterGuid' });
    const keysArr = x.sub(kfBinding, 'array_list', {
      'xs.n': 'keys', count: '3',
    });
    x.sub(keysArr, 'f').text = String(DEFORMER_ANGLE_MIN) + '.0';
    x.sub(keysArr, 'f').text = '0.0';
    x.sub(keysArr, 'f').text = String(DEFORMER_ANGLE_MAX) + '.0';
    x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = rotParamId;

    // Determine parent deformer: parent group's deformer or ROOT
    const parentDfGuid = g.parent && groupDeformerGuids.has(g.parent)
      ? groupDeformerGuids.get(g.parent) : pidDeformerRoot;

    // Determine parent part for this deformer
    const parentPartGuid = groupPartGuids.has(g.id)
      ? groupPartGuids.get(g.id)
      : pidPartGuid; // fallback to root part

    // CRotationDeformerSource
    const [rotDf, pidRotDf] = x.shared('CRotationDeformerSource');
    allDeformerSources.push({ pid: pidRotDf, tag: 'CRotationDeformerSource' });

    const acdfs = x.sub(rotDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const acpcs = x.sub(acdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(acpcs, 's', { 'xs.n': 'localName' }).text = `${g.name || g.id}`;
    x.sub(acpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(acpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(acpcs, 'CPartGuid', parentPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(acpcs, 'KeyformGridSource', pidKfgDf, { 'xs.n': 'keyformGridSource' });
    const mftDf = x.sub(acpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(mftDf, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const bwcDf = x.sub(mftDf, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(bwcDf, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(acpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(acdfs, 'CDeformerGuid', pidDfGuid, { 'xs.n': 'guid' });
    const dfIdStr = `Rotation_${sanitizedName}`;
    x.sub(acdfs, 'CDeformerId', { 'xs.n': 'id', idstr: dfIdStr });
    const rotDfTargetNode = x.subRef(acdfs, 'CDeformerGuid', parentDfGuid, { 'xs.n': 'targetDeformerGuid' });
    rotDeformerTargetNodes.set(g.id, rotDfTargetNode); // stored for re-parenting in section 3c

    x.sub(rotDf, 'b', { 'xs.n': 'useBoneUi_testImpl' }).text = 'true';

    // TRAP: Deformer origins are in PARENT DEFORMER's local space, NOT canvas space.
    // Hiyori Rotation22: originX=-0.44, originY=-718.2 (relative to parent Rotation21).
    // If you use canvas-space origins, controllers will appear far from the character.
    const worldOrigin = deformerWorldOrigins.get(g.id);
    const parentWorldOrigin = g.parent && deformerWorldOrigins.has(g.parent)
      ? deformerWorldOrigins.get(g.parent)
      : { x: 0, y: 0 }; // ROOT = canvas origin (0,0)
    const originX = worldOrigin.x - parentWorldOrigin.x;
    const originY = worldOrigin.y - parentWorldOrigin.y;

    // 3 keyforms: min angle, default (0), max angle
    // All share the same origin (origin changes are rare — Hiyori does it for some deformers
    // but for generic export, keeping origin constant across keyforms is correct)
    const kfsDf = x.sub(rotDf, 'carray_list', { 'xs.n': 'keyforms', count: '3' });

    // Helper to emit one CRotationDeformerForm
    const rotFormNodes = []; // stored for origin re-patching in section 3d
    const emitRotForm = (formGuidPid, angle) => {
      const rdf = x.sub(kfsDf, 'CRotationDeformerForm', {
        angle: angle.toFixed(1),
        originX: originX.toFixed(1),
        originY: originY.toFixed(1),
        scale: '1.0',
        isReflectX: 'false',
        isReflectY: 'false',
      });
      rotFormNodes.push(rdf);
      const adfSuper = x.sub(rdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const acfDf = x.sub(adfSuper, 'ACForm', { 'xs.n': 'super' });
      x.subRef(acfDf, 'CFormGuid', formGuidPid, { 'xs.n': 'guid' });
      x.sub(acfDf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(acfDf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(acfDf, 'CRotationDeformerSource', pidRotDf, { 'xs.n': '_source' });
      x.sub(acfDf, 'null', { 'xs.n': 'name' });
      x.sub(acfDf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(adfSuper, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(adfSuper, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(adfSuper, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(adfSuper, 'CoordType', pidCoordDf, { 'xs.n': 'coordType' });
    };

    emitRotForm(pidDfFormMin, DEFORMER_ANGLE_MIN);
    emitRotForm(pidDfFormDef, 0);
    emitRotForm(pidDfFormMax, DEFORMER_ANGLE_MAX);
    rotDeformerOriginNodes.set(g.id, { forms: rotFormNodes, ox: originX, oy: originY, wx: worldOrigin.x, wy: worldOrigin.y, coordNode: coordDf });

    x.sub(rotDf, 'f', { 'xs.n': 'handleLengthOnCanvas' }).text = '200.0';
    x.sub(rotDf, 'f', { 'xs.n': 'circleRadiusOnCanvas' }).text = '100.0';
    x.sub(rotDf, 'f', { 'xs.n': 'baseAngle' }).text = '0.0';
  }

  // Add deformer GUIDs to their parent part's _childGuids
  for (const g of groups) {
    const dfGuid = groupDeformerGuids.get(g.id);
    if (!dfGuid) continue;
    // Find which part source owns this group
    const partSource = groupParts.has(g.id) ? groupParts.get(g.id) : rootPart;
    partSource.childGuidsNode.children.push(x.ref('CDeformerGuid', dfGuid));
    partSource.childGuidsNode.attrs.count = String(partSource.childGuidsNode.children.length);
  }

  // ==================================================================
  // 3b. CWarpDeformerSource (per mesh with mesh_verts animation)
  // ==================================================================

  // Extract mesh_verts tracks: partId → keyframes[{time, value:[{x,y},...]}]
  const meshVertsMap = new Map();
  for (const anim of animations) {
    for (const track of (anim.tracks ?? [])) {
      if (track.property === 'mesh_verts' && track.keyframes?.length >= 2) {
        // Use first animation that has mesh_verts for this part
        if (!meshVertsMap.has(track.nodeId)) {
          meshVertsMap.set(track.nodeId, track.keyframes);
        }
      }
    }
  }

  const WARP_COL = 3;
  const WARP_ROW = 3;
  const WARP_GRID_POINTS = (WARP_COL + 1) * (WARP_ROW + 1); // 16
  const meshWarpDeformerGuids = new Map(); // partId → pidWarpDfGuid

  for (const pm of perMesh) {
    const partId = meshes[pm.mi].partId;
    const keyframes = meshVertsMap.get(partId);
    if (!keyframes) continue;

    const meshParentGroup = meshes[pm.mi].parentGroupId;
    const sanitizedMeshName = (pm.meshName || partId).replace(/[^a-zA-Z0-9_]/g, '_');
    const numKf = keyframes.length;

    // Rest-pose vertices in deformer-local space (same as mesh keyform positions)
    const canvasVerts = pm.vertices; // canvas space
    const dfOrigin = meshParentGroup && deformerWorldOrigins.has(meshParentGroup)
      ? deformerWorldOrigins.get(meshParentGroup)
      : null;
    const restVerts = dfOrigin
      ? canvasVerts.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y))
      : [...canvasVerts];

    // Compute bounding box of rest vertices (deformer-local space)
    const numVerts = restVerts.length / 2;
    let bboxMinX = Infinity, bboxMinY = Infinity, bboxMaxX = -Infinity, bboxMaxY = -Infinity;
    for (let i = 0; i < numVerts; i++) {
      const vx = restVerts[i * 2], vy = restVerts[i * 2 + 1];
      if (vx < bboxMinX) bboxMinX = vx; if (vy < bboxMinY) bboxMinY = vy;
      if (vx > bboxMaxX) bboxMaxX = vx; if (vy > bboxMaxY) bboxMaxY = vy;
    }
    // Pad bbox by 10%
    const padX = (bboxMaxX - bboxMinX) * 0.1 || 10;
    const padY = (bboxMaxY - bboxMinY) * 0.1 || 10;
    bboxMinX -= padX; bboxMinY -= padY; bboxMaxX += padX; bboxMaxY += padY;
    const bboxW = bboxMaxX - bboxMinX;
    const bboxH = bboxMaxY - bboxMinY;

    // Build rest grid: regular (col+1)×(row+1) grid over padded bbox
    const gridW = WARP_COL + 1;
    const gridH = WARP_ROW + 1;
    const restGrid = new Float64Array(WARP_GRID_POINTS * 2);
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        const idx = (r * gridW + c) * 2;
        restGrid[idx] = bboxMinX + c * bboxW / WARP_COL;
        restGrid[idx + 1] = bboxMinY + r * bboxH / WARP_ROW;
      }
    }

    // Compute grid positions for each keyframe using IDW
    const gridKeyforms = []; // array of Float64Array(WARP_GRID_POINTS * 2)

    for (const kf of keyframes) {
      // Convert keyframe vertex positions to deformer-local space
      const kfLocalVerts = new Float64Array(numVerts * 2);
      for (let i = 0; i < numVerts; i++) {
        const v = kf.value[i];
        if (!v) { kfLocalVerts[i * 2] = restVerts[i * 2]; kfLocalVerts[i * 2 + 1] = restVerts[i * 2 + 1]; continue; }
        kfLocalVerts[i * 2] = v.x - (dfOrigin ? dfOrigin.x : 0);
        kfLocalVerts[i * 2 + 1] = v.y - (dfOrigin ? dfOrigin.y : 0);
      }

      // Vertex deltas from rest
      const deltas = new Float64Array(numVerts * 2);
      for (let i = 0; i < numVerts * 2; i++) {
        deltas[i] = kfLocalVerts[i] - restVerts[i];
      }

      // IDW: propagate vertex deltas to grid control points
      const gridPositions = new Float64Array(WARP_GRID_POINTS * 2);
      const epsilon = 1e-6;

      for (let gi = 0; gi < WARP_GRID_POINTS; gi++) {
        const gx = restGrid[gi * 2];
        const gy = restGrid[gi * 2 + 1];
        let sumWx = 0, sumWy = 0, sumW = 0;
        for (let vi = 0; vi < numVerts; vi++) {
          const dx = gx - restVerts[vi * 2];
          const dy = gy - restVerts[vi * 2 + 1];
          const distSq = dx * dx + dy * dy + epsilon;
          const w = 1 / distSq;
          sumWx += w * deltas[vi * 2];
          sumWy += w * deltas[vi * 2 + 1];
          sumW += w;
        }
        gridPositions[gi * 2] = gx + sumWx / sumW;
        gridPositions[gi * 2 + 1] = gy + sumWy / sumW;
      }

      gridKeyforms.push(gridPositions);
    }

    // --- Create CWarpDeformerSource XML ---

    // Warp deformer GUID
    const [, pidWarpDfGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `Warp_${sanitizedMeshName}` });
    meshWarpDeformerGuids.set(partId, pidWarpDfGuid);

    // Form GUIDs (one per keyframe)
    const warpFormGuids = [];
    for (let ki = 0; ki < numKf; ki++) {
      const [, pidWarpForm] = x.shared('CFormGuid', { uuid: uuid(), note: `WarpForm_${sanitizedMeshName}_${ki}` });
      warpFormGuids.push(pidWarpForm);
    }

    // Parameter: ParamDeform_MeshName, range [0, numKf-1]
    const warpParamId = `ParamDeform_${sanitizedMeshName}`;
    const [, pidWarpParam] = x.shared('CParameterGuid', { uuid: uuid(), note: warpParamId });
    paramDefs.push({
      pid: pidWarpParam, id: warpParamId, name: `Deform ${pm.meshName}`,
      min: 0, max: numKf - 1, defaultVal: 0,
      decimalPlaces: 1,
    });
    deformerParamMap.set(partId, {
      paramId: warpParamId, type: 'warp', min: 0, max: numKf - 1,
      keyframeTimes: keyframes.map(kf => kf.time),
    });

    // CoordType for this warp deformer
    const [coordWarp, pidCoordWarp] = x.shared('CoordType');
    x.sub(coordWarp, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // KeyformBindingSource — links warp to its parameter
    const [warpKfBinding, pidWarpKfBinding] = x.shared('KeyformBindingSource');

    // KeyformGridSource (numKf keyforms, 1 parameter binding)
    const [warpKfg, pidWarpKfg] = x.shared('KeyformGridSource');
    const warpKfogList = x.sub(warpKfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: String(numKf) });

    for (let ki = 0; ki < numKf; ki++) {
      const kog = x.sub(warpKfogList, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon = x.sub(kop, 'KeyOnParameter');
      x.subRef(kon, 'KeyformBindingSource', pidWarpKfBinding, { 'xs.n': 'binding' });
      x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(ki);
      x.subRef(kog, 'CFormGuid', warpFormGuids[ki], { 'xs.n': 'keyformGuid' });
    }

    const warpKfbList = x.sub(warpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(warpKfbList, 'KeyformBindingSource', pidWarpKfBinding);

    // Fill KeyformBindingSource
    x.subRef(warpKfBinding, 'KeyformGridSource', pidWarpKfg, { 'xs.n': '_gridSource' });
    x.subRef(warpKfBinding, 'CParameterGuid', pidWarpParam, { 'xs.n': 'parameterGuid' });
    const warpKeysArr = x.sub(warpKfBinding, 'array_list', { 'xs.n': 'keys', count: String(numKf) });
    for (let ki = 0; ki < numKf; ki++) {
      x.sub(warpKeysArr, 'f').text = ki.toFixed(1);
    }
    x.sub(warpKfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(warpKfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(warpKfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(warpKfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(warpKfBinding, 's', { 'xs.n': 'description' }).text = warpParamId;

    // Parent deformer: group's rotation deformer or ROOT
    const warpParentDfGuid = meshParentGroup && groupDeformerGuids.has(meshParentGroup)
      ? groupDeformerGuids.get(meshParentGroup) : pidDeformerRoot;

    // Parent part: same as the mesh's parent part
    const warpParentPartGuid = meshParentGroup && groupPartGuids.has(meshParentGroup)
      ? groupPartGuids.get(meshParentGroup) : pidPartGuid;

    // CWarpDeformerSource
    const [warpDf, pidWarpDf] = x.shared('CWarpDeformerSource');
    allDeformerSources.push({ pid: pidWarpDf, tag: 'CWarpDeformerSource' });

    const warpAcdfs = x.sub(warpDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const warpAcpcs = x.sub(warpAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(warpAcpcs, 's', { 'xs.n': 'localName' }).text = `${pm.meshName} Warp`;
    x.sub(warpAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(warpAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(warpAcpcs, 'CPartGuid', warpParentPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(warpAcpcs, 'KeyformGridSource', pidWarpKfg, { 'xs.n': 'keyformGridSource' });
    const warpMft = x.sub(warpAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(warpMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const warpBwc = x.sub(warpMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(warpBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(warpAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(warpAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(warpAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(warpAcdfs, 'CDeformerGuid', pidWarpDfGuid, { 'xs.n': 'guid' });
    x.sub(warpAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: `Warp_${sanitizedMeshName}` });
    x.subRef(warpAcdfs, 'CDeformerGuid', warpParentDfGuid, { 'xs.n': 'targetDeformerGuid' });

    // Warp-specific fields
    x.sub(warpDf, 'i', { 'xs.n': 'col' }).text = String(WARP_COL);
    x.sub(warpDf, 'i', { 'xs.n': 'row' }).text = String(WARP_ROW);
    x.sub(warpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

    // Keyforms: one CWarpDeformerForm per animation keyframe
    const warpKfsList = x.sub(warpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });

    for (let ki = 0; ki < numKf; ki++) {
      const wdf = x.sub(warpKfsList, 'CWarpDeformerForm');
      const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
      x.subRef(wdfAcf, 'CFormGuid', warpFormGuids[ki], { 'xs.n': 'guid' });
      x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(wdfAcf, 'CWarpDeformerSource', pidWarpDf, { 'xs.n': '_source' });
      x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
      x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(wdfAdf, 'CoordType', pidCoordWarp, { 'xs.n': 'coordType' });

      // Grid positions for this keyframe
      const posArr = gridKeyforms[ki];
      x.sub(wdf, 'float-array', {
        'xs.n': 'positions', count: String(WARP_GRID_POINTS * 2),
      }).text = Array.from(posArr).map(v => v.toFixed(1)).join(' ');
    }

    // Add warp deformer guid to parent part's _childGuids
    const warpPartSource = groupParts.has(meshParentGroup) ? groupParts.get(meshParentGroup) : rootPart;
    warpPartSource.childGuidsNode.children.push(x.ref('CDeformerGuid', pidWarpDfGuid));
    warpPartSource.childGuidsNode.attrs.count = String(warpPartSource.childGuidsNode.children.length);
  }

  // ==================================================================
  // 3c. Standard-rig warp deformers (generateRig)
  // ==================================================================
  // When generateRig is enabled, create a ROOT-level warp deformer for each mesh
  // that matches a supported tag.  The warp grid covers the mesh's canvas-space
  // bounding box (with 10 % padding) and the mesh's keyform positions are converted
  // to 0..1 warp-local space.
  //
  // Coordinate system (reverse-engineered from Hiyori, confirmed Session 13):
  //   ROOT-level warp grid → canvas pixel space, CoordType "Canvas"
  //   Mesh keyforms under warp → 0..1 normalized, CoordType "DeformerLocal"

  // Per-tag warp grid sizes (col × row) from TEMPLATES.md Bezier Division Spec.
  // Body/limb parts: 3×3 default. Face parts: per-part sizes for better control.
  const RIG_WARP_TAGS = new Map([
    // Body / limbs
    ['topwear',     { col: 3, row: 3 }],
    ['bottomwear',  { col: 3, row: 3 }],
    ['handwear',    { col: 3, row: 3 }],
    ['handwear-l',  { col: 3, row: 3 }],
    ['handwear-r',  { col: 3, row: 3 }],
    ['legwear',     { col: 3, row: 3 }],
    ['legwear-l',   { col: 3, row: 3 }],
    ['legwear-r',   { col: 3, row: 3 }],
    ['footwear',    { col: 3, row: 3 }],
    ['footwear-l',  { col: 3, row: 3 }],
    ['footwear-r',  { col: 3, row: 3 }],
    ['neck',        { col: 3, row: 3 }],
    ['neckwear',    { col: 3, row: 3 }],
    // Head / face
    ['face',        { col: 2, row: 3 }],  // vertically long
    ['front hair',  { col: 2, row: 2 }],  // short parts
    ['back hair',   { col: 2, row: 3 }],  // vertically long
    ['headwear',    { col: 2, row: 2 }],
    ['eyebrow',     { col: 2, row: 2 }],
    ['eyebrow-l',   { col: 2, row: 2 }],
    ['eyebrow-r',   { col: 2, row: 2 }],
    ['eyewhite',    { col: 3, row: 3 }],  // needs fine control
    ['eyewhite-l',  { col: 3, row: 3 }],
    ['eyewhite-r',  { col: 3, row: 3 }],
    ['eyelash',     { col: 3, row: 3 }],
    ['eyelash-l',   { col: 3, row: 3 }],
    ['eyelash-r',   { col: 3, row: 3 }],
    ['irides',      { col: 3, row: 3 }],
    ['irides-l',    { col: 3, row: 3 }],
    ['irides-r',    { col: 3, row: 3 }],
    ['nose',        { col: 2, row: 2 }],  // small square
    ['mouth',       { col: 3, row: 2 }],  // horizontally long
    ['ears',        { col: 2, row: 2 }],
    ['ears-l',      { col: 2, row: 2 }],
    ['ears-r',      { col: 2, row: 2 }],
    ['earwear',     { col: 2, row: 2 }],
    ['eyewear',     { col: 3, row: 3 }],
    ['tail',        { col: 2, row: 3 }],  // vertically long
    ['wings',       { col: 3, row: 3 }],
  ]);

  // ── Face parallax (Session 19, Option B v2) ──
  // SINGLE warp covers the entire face. All face-tagged meshes become children of this
  // one warp (via their rig warps). The warp's grid deforms once under AngleX/Y, and
  // every mesh inherits the deformation via bilinear interpolation. No boundaries, no
  // independent per-part movement — the face rotates as one coherent surface.
  //
  // Semantically this matches the user's "Blender proportional-edit with smooth falloff"
  // mental model: one deformation field applied continuously across the whole face.
  const FACE_PARALLAX_TAGS = new Set([
    'face', 'nose',
    'eyebrow', 'eyebrow-l', 'eyebrow-r',
    'front hair', 'back hair',
    'eyewhite-l', 'irides-l', 'eyelash-l',
    'eyewhite-r', 'irides-r', 'eyelash-r',
    'mouth',
    'ears-l', 'ears-r',
  ]);
  // Single depth for the unified face warp. Represents the face's overall protrusion
  // from the rotation axis. Larger = bigger 3D-rotation effect. Spatial depth variation
  // (per-region) can be added later for finer parallax between parts.
  const FACE_PARALLAX_DEPTH = 0.5;

  // Session 20: Neck warp tags — meshes that follow the head tilt with a Y-gradient
  // (top row shifts, bottom row pinned at shoulders). Matches Hiyori's Neck Warp
  // pattern. See section 3d.1 for the emission.
  const NECK_WARP_TAGS = new Set(['neck', 'neckwear']);

  // partId → { gridMinX, gridMinY, gridW, gridH } for 0..1 conversion in section 4
  const rigWarpBbox = new Map();

  // Look up standard parameter PIDs (created by generateRig standardParams above)
  const pidParamBreath = paramDefs.find(p => p.id === 'ParamBreath')?.pid;
  const pidParamBodyAngleX = paramDefs.find(p => p.id === 'ParamBodyAngleX')?.pid;
  const pidParamBodyAngleY = paramDefs.find(p => p.id === 'ParamBodyAngleY')?.pid;
  const pidParamBodyAngleZ = paramDefs.find(p => p.id === 'ParamBodyAngleZ')?.pid;
  const pidParamEyeBallX   = paramDefs.find(p => p.id === 'ParamEyeBallX')?.pid;
  const pidParamEyeBallY   = paramDefs.find(p => p.id === 'ParamEyeBallY')?.pid;
  const pidParamBrowLY     = paramDefs.find(p => p.id === 'ParamBrowLY')?.pid;
  const pidParamBrowRY     = paramDefs.find(p => p.id === 'ParamBrowRY')?.pid;
  const pidParamMouthOpenY = paramDefs.find(p => p.id === 'ParamMouthOpenY')?.pid;
  const pidParamEyeLOpen   = paramDefs.find(p => p.id === 'ParamEyeLOpen')?.pid;
  const pidParamEyeROpen   = paramDefs.find(p => p.id === 'ParamEyeROpen')?.pid;
  const pidParamHairFront  = paramDefs.find(p => p.id === 'ParamHairFront')?.pid;
  const pidParamHairBack   = paramDefs.find(p => p.id === 'ParamHairBack')?.pid;
  // Face parallax (Session 19) — drive Face Rotation (AngleZ) + 7 face parallax warps (AngleX × AngleY).
  const pidParamAngleX     = paramDefs.find(p => p.id === 'ParamAngleX')?.pid;
  const pidParamAngleY     = paramDefs.find(p => p.id === 'ParamAngleY')?.pid;
  const pidParamAngleZ     = paramDefs.find(p => p.id === 'ParamAngleZ')?.pid;

  // ── Per-part warp parameter bindings (Session 16) ──
  // Each entry: bindings (param specs) + shiftFn (procedural grid generation).
  // shiftFn(restGrid, gW, gH, keyVals[], gxSpan, gySpan) → shifted Float64Array.
  // Patterns reverse-engineered from Hiyori — see SESSION16_FINDINGS.md.
  const TAG_PARAM_BINDINGS = new Map([
    // ── Hair: tips-swing (Hiyori: Move Hair Front/Back Warp, 1D, 3kf) ──
    // Top row (roots) pinned, bottom row (tips) sways X, slight Y curl.
    ['front hair', {
      bindings: [{ pid: pidParamHairFront, keys: [-1, 0, 1], desc: 'ParamHairFront' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let r = 0; r < gH; r++) {
          const frac = r / (gH - 1); // 0=roots(top), 1=tips(bottom)
          for (let c = 0; c < gW; c++) {
            const idx = (r * gW + c) * 2;
            pos[idx]     += k * 0.10 * gxS * frac;            // X sway
            pos[idx + 1] += k * 0.02 * gyS * frac * frac;     // Y curl (quadratic)
          }
        }
        return pos;
      },
    }],
    ['back hair', {
      bindings: [{ pid: pidParamHairBack, keys: [-1, 0, 1], desc: 'ParamHairBack' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let r = 0; r < gH; r++) {
          const frac = r / (gH - 1);
          for (let c = 0; c < gW; c++) {
            const idx = (r * gW + c) * 2;
            pos[idx]     += k * 0.08 * gxS * frac;
            pos[idx + 1] += k * 0.015 * gyS * frac * frac;
          }
        }
        return pos;
      },
    }],
    // ── Brows: uniform Y translate (Hiyori: Brow L/R Position, ~0.085/unit) ──
    // BrowY +1 = raise = negative Y shift (up in canvas space).
    ['eyebrow', {
      bindings: [{ pid: pidParamBrowLY, keys: [-1, 0, 1], desc: 'ParamBrowLY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let i = 1; i < pos.length; i += 2) pos[i] += -k * 0.15 * gyS;
        return pos;
      },
    }],
    ['eyebrow-l', {
      bindings: [{ pid: pidParamBrowLY, keys: [-1, 0, 1], desc: 'ParamBrowLY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let i = 1; i < pos.length; i += 2) pos[i] += -k * 0.15 * gyS;
        return pos;
      },
    }],
    ['eyebrow-r', {
      bindings: [{ pid: pidParamBrowRY, keys: [-1, 0, 1], desc: 'ParamBrowRY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        for (let i = 1; i < pos.length; i += 2) pos[i] += -k * 0.15 * gyS;
        return pos;
      },
    }],
    // ── Eye open/close — SS-adapted approach (Session 16) ──
    // SS mesh structure differs from Hiyori: eyelash is thin (not wide eyelid),
    // so curtain-drop doesn't work. Instead: ALL three eye parts (eyelash, eyewhite,
    // iris) collapse together to the SAME "closed eye line" at the lower eyelid position.
    //
    // Strategy: compress all three toward Y at 80% of their respective grid heights.
    // All parts flatten to thin lines at the same relative position → reads as closed eye.
    // EyeBallX/Y on iris deferred — requires nested warp layer (iris now uses EyeOpen).
    ['irides', {
      bindings: [{ pid: pidParamEyeLOpen, keys: [0, 1], desc: 'ParamEyeLOpen' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 1) return pos;
        const convergY = grid[1] + gyS * 0.80; // lower eyelid line
        const factor = k; // iris flattens near-zero
        for (let i = 1; i < pos.length; i += 2) {
          pos[i] = convergY + (grid[i] - convergY) * factor;
        }
        return pos;
      },
    }],
    // ── Iris gaze (Session 18): ParamEyeBallX × ParamEyeBallY uniform translation ──
    // Closure lives at mesh level (CArtMeshForm, Session 17). Gaze lives here on the
    // warp — 9 keyforms, pure uniform shift of the whole grid. When iris is closed,
    // translation is hidden behind the lash; when open, iris follows look direction.
    // Magnitudes from Hiyori reference: ~9% X, ~7.5% Y of grid span.
    ['irides-l', {
      bindings: [
        { pid: pidParamEyeBallX, keys: [-1, 0, 1], desc: 'ParamEyeBallX' },
        { pid: pidParamEyeBallY, keys: [-1, 0, 1], desc: 'ParamEyeBallY' },
      ],
      shiftFn: (grid, gW, gH, [kX, kY], gxS, gyS) => {
        const pos = new Float64Array(grid);
        const dx = kX * gxS * 0.09;
        const dy = -kY * gyS * 0.075;
        for (let i = 0; i < pos.length; i += 2) {
          pos[i]     += dx;
          pos[i + 1] += dy;
        }
        return pos;
      },
    }],
    ['irides-r', {
      bindings: [
        { pid: pidParamEyeBallX, keys: [-1, 0, 1], desc: 'ParamEyeBallX' },
        { pid: pidParamEyeBallY, keys: [-1, 0, 1], desc: 'ParamEyeBallY' },
      ],
      shiftFn: (grid, gW, gH, [kX, kY], gxS, gyS) => {
        const pos = new Float64Array(grid);
        const dx = kX * gxS * 0.09;
        const dy = -kY * gyS * 0.075;
        for (let i = 0; i < pos.length; i += 2) {
          pos[i]     += dx;
          pos[i + 1] += dy;
        }
        return pos;
      },
    }],
    ['eyewhite', {
      bindings: [{ pid: pidParamEyeLOpen, keys: [0, 1], desc: 'ParamEyeLOpen' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 1) return pos;
        const convergY = grid[1] + gyS * 0.80;
        const factor = k;
        for (let i = 1; i < pos.length; i += 2) {
          pos[i] = convergY + (grid[i] - convergY) * factor;
        }
        return pos;
      },
    }],
    // eyewhite-l, eyewhite-r: handled via per-vertex CArtMeshForm keyforms (Session 17)
    ['eyelash', {
      bindings: [{ pid: pidParamEyeLOpen, keys: [0, 1], desc: 'ParamEyeLOpen' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 1) return pos;
        const convergY = grid[1] + gyS * 0.80;
        const factor = k; // eyelash slightly thicker line than iris
        for (let i = 1; i < pos.length; i += 2) {
          pos[i] = convergY + (grid[i] - convergY) * factor;
        }
        return pos;
      },
    }],
    // eyelash-l, eyelash-r: handled via per-vertex CArtMeshForm keyforms (Session 17)
    // RigWarps for these tags are passthroughs — meshes deform themselves via ParamEye{L,R}Open.
    // ── Mouth open: Y-stretch from top pivot (Session 17) ──
    // Closed = rest. Open = top row pinned, rows below stretch down quadratically
    // (natural jaw-drop acceleration). Hiyori uses per-vertex CArtMeshForm keyforms
    // per mouth sub-mesh; SS has one `mouth` tag → one warp, so we approximate via
    // procedural grid deformation.
    ['mouth', {
      bindings: [{ pid: pidParamMouthOpenY, keys: [0, 1], desc: 'ParamMouthOpenY' }],
      shiftFn: (grid, gW, gH, [k], gxS, gyS) => {
        const pos = new Float64Array(grid);
        if (k === 0) return pos;
        const maxStretch = gyS * 0.35;
        for (let r = 0; r < gH; r++) {
          const rFrac = r / (gH - 1);
          const dy = k * maxStretch * rFrac * rFrac;
          for (let c = 0; c < gW; c++) {
            pos[(r * gW + c) * 2 + 1] += dy;
          }
        }
        return pos;
      },
    }],
  ]);

  // Collect per-part warp target nodes for re-parenting in section 3d.
  // Each entry: { node, faceGroupKey or null } — face-parallax tags route to their
  // FaceParallax warp; others route to Body X.
  const rigWarpTargetNodesToReparent = [];

  // Helper: emit one KeyformBindingSource with LINEAR interpolation
  const emitKfBinding = (kfbNode, pidKfg, pidParam, keys, description) => {
    x.subRef(kfbNode, 'KeyformGridSource', pidKfg, { 'xs.n': '_gridSource' });
    x.subRef(kfbNode, 'CParameterGuid', pidParam, { 'xs.n': 'parameterGuid' });
    const keysArr = x.sub(kfbNode, 'array_list', { 'xs.n': 'keys', count: String(keys.length) });
    for (const k of keys) x.sub(keysArr, 'f').text = String(k);
    x.sub(kfbNode, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(kfbNode, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(kfbNode, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(kfbNode, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(kfbNode, 's', { 'xs.n': 'description' }).text = description;
  };

  // Structural warp chain parameters (used in both 3c and 3d).
  // Body Warp Z must encompass ALL character parts. Compute from mesh bounding box
  // with ~10% padding (Hiyori uses ~13% margin, but character may fill different area).
  let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
  for (const pm of perMesh) {
    const v = pm.vertices;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i] < allMinX) allMinX = v[i]; if (v[i] > allMaxX) allMaxX = v[i];
      if (v[i + 1] < allMinY) allMinY = v[i + 1]; if (v[i + 1] > allMaxY) allMaxY = v[i + 1];
    }
  }
  const charW = allMaxX - allMinX || canvasW;
  const charH = allMaxY - allMinY || canvasH;
  const padFrac = 0.10; // 10% padding around character
  const BZ_MIN_X = allMinX - charW * padFrac;
  const BZ_MAX_X = allMaxX + charW * padFrac;
  const BZ_MIN_Y = allMinY - charH * padFrac;
  const BZ_MAX_Y = allMaxY + charH * padFrac;
  const BZ_W = BZ_MAX_X - BZ_MIN_X, BZ_H = BZ_MAX_Y - BZ_MIN_Y;
  const BY_MARGIN = 0.065, BY_MIN = BY_MARGIN, BY_MAX = 1 - BY_MARGIN;
  const BR_MARGIN = 0.055, BR_MIN = BR_MARGIN, BR_MAX = 1 - BR_MARGIN;
  // Body X Warp is 4th layer: Body Z → Body Y → Breath → Body X → children
  // Grid range in Breath space (Hiyori: X 0.13-0.87, Y 0.18-0.97)
  const BX_MIN = 0.10, BX_MAX = 0.90;

  // Convert canvas pixel position to Body X Warp's 0..1 space (through 4-chain)
  const canvasToBodyXX = (cx) => {
    const bzL = (cx - BZ_MIN_X) / BZ_W;
    const byL = (bzL - BY_MIN) / (BY_MAX - BY_MIN);
    const brL = (byL - BR_MIN) / (BR_MAX - BR_MIN);
    return (brL - BX_MIN) / (BX_MAX - BX_MIN);
  };
  const canvasToBodyXY = (cy) => {
    const bzL = (cy - BZ_MIN_Y) / BZ_H;
    const byL = (bzL - BY_MIN) / (BY_MAX - BY_MIN);
    const brL = (byL - BR_MIN) / (BR_MAX - BR_MIN);
    return (brL - BX_MIN) / (BX_MAX - BX_MIN);
  };

  // ── Face parallax pre-pass (Session 19, single-warp Body-X-style) ──
  // Compute the union canvas bbox of ALL face-tagged meshes. This bbox defines the single
  // FaceParallax warp. All face rig warps rebase into this bbox's 0..1 local.
  let fpUnionMinX = Infinity, fpUnionMinY = Infinity;
  let fpUnionMaxX = -Infinity, fpUnionMaxY = -Infinity;
  let fpAnyFaceMesh = false;
  for (const pm of perMesh) {
    const tag = meshes[pm.mi].tag;
    if (!FACE_PARALLAX_TAGS.has(tag)) continue;
    const v = pm.vertices;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i]     < fpUnionMinX) fpUnionMinX = v[i];
      if (v[i]     > fpUnionMaxX) fpUnionMaxX = v[i];
      if (v[i + 1] < fpUnionMinY) fpUnionMinY = v[i + 1];
      if (v[i + 1] > fpUnionMaxY) fpUnionMaxY = v[i + 1];
      fpAnyFaceMesh = true;
    }
  }
  let faceUnionBbox = null;
  if (fpAnyFaceMesh) {
    const w = fpUnionMaxX - fpUnionMinX;
    const h = fpUnionMaxY - fpUnionMinY;
    const padX = w * 0.10 || 10;
    const padY = h * 0.10 || 10;
    faceUnionBbox = {
      minX: fpUnionMinX - padX, maxX: fpUnionMaxX + padX,
      minY: fpUnionMinY - padY, maxY: fpUnionMaxY + padY,
      W:   (fpUnionMaxX + padX) - (fpUnionMinX - padX),
      H:   (fpUnionMaxY + padY) - (fpUnionMinY - padY),
    };
  }
  // canvas → FaceParallax 0..1 local (used for rig warp grid rebasing, section 3c)
  const canvasToFaceUnionX = (cx) => faceUnionBbox
    ? (cx - faceUnionBbox.minX) / faceUnionBbox.W : 0;
  const canvasToFaceUnionY = (cy) => faceUnionBbox
    ? (cy - faceUnionBbox.minY) / faceUnionBbox.H : 0;
  // Face Rotation pivot (canvas space): bottom-center of face union (chin area).
  const facePivotCx = faceUnionBbox ? (faceUnionBbox.minX + faceUnionBbox.maxX) / 2 : null;
  const facePivotCy = faceUnionBbox ? faceUnionBbox.maxY : null;

  // ── Neck warp pre-pass (Session 20) ─────────────────────────────────────
  // Union canvas bbox of all neck-tagged meshes. A dedicated NeckWarp covers
  // this bbox and applies a Y-gradient deformation driven by ParamAngleZ so
  // the upper neck follows the head tilt while the shoulders stay anchored.
  let nwUnionMinX = Infinity, nwUnionMinY = Infinity;
  let nwUnionMaxX = -Infinity, nwUnionMaxY = -Infinity;
  let nwAnyMesh = false;
  for (const pm of perMesh) {
    const tag = meshes[pm.mi].tag;
    if (!NECK_WARP_TAGS.has(tag)) continue;
    const v = pm.vertices;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i]     < nwUnionMinX) nwUnionMinX = v[i];
      if (v[i]     > nwUnionMaxX) nwUnionMaxX = v[i];
      if (v[i + 1] < nwUnionMinY) nwUnionMinY = v[i + 1];
      if (v[i + 1] > nwUnionMaxY) nwUnionMaxY = v[i + 1];
      nwAnyMesh = true;
    }
  }
  let neckUnionBbox = null;
  if (nwAnyMesh) {
    const w = nwUnionMaxX - nwUnionMinX;
    const h = nwUnionMaxY - nwUnionMinY;
    const padX = w * 0.10 || 10;
    const padY = h * 0.10 || 10;
    neckUnionBbox = {
      minX: nwUnionMinX - padX, maxX: nwUnionMaxX + padX,
      minY: nwUnionMinY - padY, maxY: nwUnionMaxY + padY,
      W:   (nwUnionMaxX + padX) - (nwUnionMinX - padX),
      H:   (nwUnionMaxY + padY) - (nwUnionMinY - padY),
    };
  }
  const canvasToNeckWarpX = (cx) => neckUnionBbox
    ? (cx - neckUnionBbox.minX) / neckUnionBbox.W : 0;
  const canvasToNeckWarpY = (cy) => neckUnionBbox
    ? (cy - neckUnionBbox.minY) / neckUnionBbox.H : 0;

  // ── Pre-pass: compute eye closure contexts from eyewhite meshes (Session 16) ──
  // Eyewhite's lower edge = lower eyelid line = natural closed-eye position.
  // All eye parts (eyelash, eyewhite, irides) for the same eye use this shared curve.
  // Fallback to eyelash if eyewhite not available.
  const EYEWHITE_TAGS = new Set(['eyewhite', 'eyewhite-l', 'eyewhite-r']);
  const EYELASH_TAGS = new Set(['eyelash', 'eyelash-l', 'eyelash-r']);
  const EYE_SOURCE_TAGS = new Set([...EYEWHITE_TAGS, ...EYELASH_TAGS]);
  const EYE_PART_TAGS = new Set([
    'eyelash', 'eyelash-l', 'eyelash-r',
    'eyewhite', 'eyewhite-l', 'eyewhite-r',
    'irides', 'irides-l', 'irides-r',
  ]);
  const eyeContexts = []; // { tag, isEyewhite, curvePoints, bboxCenterX, bboxCenterY }
  if (generateRig) {
    for (const pm of perMesh) {
      const m = meshes[pm.mi];
      if (!EYE_SOURCE_TAGS.has(m.tag)) continue;
      if (pm.hasBakedKeyforms) continue;
      const verts = pm.vertices;
      const nv = verts.length / 2;
      if (nv < 3) continue;
      // ── Extract true bottom contour via X-bin max-Y ──
      // Sort vertices by X, split into X-bins, take MAX Y vertex per bin.
      // This captures the actual bottom boundary (not mixed with interior
      // triangulation vertices that filtering by Y > median would include).
      const pairs = new Array(nv);
      for (let i = 0; i < nv; i++) pairs[i] = [verts[i * 2], verts[i * 2 + 1]];
      pairs.sort((a, b) => a[0] - b[0]);
      // For eyewhite: use all vertices (clean mesh, no wings).
      // For eyelash fallback: take central 60% to exclude decorative wings.
      const isEyewhiteSrc = EYEWHITE_TAGS.has(m.tag);
      const pLo = isEyewhiteSrc ? 0 : Math.floor(nv * 0.20);
      const pHi = isEyewhiteSrc ? nv : Math.max(pLo + 1, Math.ceil(nv * 0.80));
      const central = pairs.slice(pLo, pHi);
      if (central.length < 4) continue;
      // Bin-max extraction of bottom contour
      const N_BINS = Math.min(8, Math.max(3, Math.floor(central.length / 3)));
      const lowerHalf = []; // actually "bottom contour points" now
      for (let b = 0; b < N_BINS; b++) {
        const binStart = Math.floor(central.length * b / N_BINS);
        const binEnd = Math.floor(central.length * (b + 1) / N_BINS);
        if (binEnd <= binStart) continue;
        let maxY = -Infinity, sumX = 0;
        for (let i = binStart; i < binEnd; i++) {
          if (central[i][1] > maxY) maxY = central[i][1];
          sumX += central[i][0];
        }
        lowerHalf.push([sumX / (binEnd - binStart), maxY]);
      }
      if (lowerHalf.length < 3) continue;
      // Compute Y-range of mesh to offset the curve up to natural closed-eye position.
      // Raw bin-max-Y sits at the lower eyelid; natural closed eye is slightly above.
      let meshMinY = Infinity, meshMaxY = -Infinity;
      for (const p of pairs) {
        if (p[1] < meshMinY) meshMinY = p[1];
        if (p[1] > meshMaxY) meshMaxY = p[1];
      }
      const yOffset = -0.15 * (meshMaxY - meshMinY); // negative = upward on canvas
      // Fit parabola y = ax² + bx + c via least-squares (normalize X for numerical stability)
      const fullMinX = pairs[0][0], fullMaxX = pairs[pairs.length - 1][0];
      const xMid = (fullMinX + fullMaxX) / 2;
      const xScale = (fullMaxX - fullMinX) / 2 || 1;
      let sX = 0, sY = 0, sX2 = 0, sX3 = 0, sX4 = 0, sXY = 0, sX2Y = 0;
      for (const [x, y] of lowerHalf) {
        const xn = (x - xMid) / xScale; // normalized X ∈ roughly [-1, 1]
        const xn2 = xn * xn;
        sX += xn; sY += y;
        sX2 += xn2; sX3 += xn2 * xn; sX4 += xn2 * xn2;
        sXY += xn * y; sX2Y += xn2 * y;
      }
      const nPts = lowerHalf.length;
      // Solve 3x3 linear system: M * [c, b, a]^T = [sY, sXY, sX2Y]^T
      //   [nPts sX  sX2] [c]   [sY]
      //   [sX   sX2 sX3] [b] = [sXY]
      //   [sX2  sX3 sX4] [a]   [sX2Y]
      // Using Cramer's rule (3x3 determinants)
      const det3 = (a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
        a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
      const detM  = det3(nPts, sX, sX2, sX, sX2, sX3, sX2, sX3, sX4);
      if (Math.abs(detM) < 1e-12) continue;
      const detC  = det3(sY, sX, sX2, sXY, sX2, sX3, sX2Y, sX3, sX4);
      const detB  = det3(nPts, sY, sX2, sX, sXY, sX3, sX2, sX2Y, sX4);
      const detA  = det3(nPts, sX, sY, sX, sX2, sXY, sX2, sX3, sX2Y);
      const c = detC / detM, b = detB / detM, a = detA / detM;
      // Sample parabola within fit data X range (avoid extrapolation drift)
      const fitMinX = lowerHalf.reduce((m, p) => Math.min(m, p[0]), Infinity);
      const fitMaxX = lowerHalf.reduce((m, p) => Math.max(m, p[0]), -Infinity);
      const N_SAMPLES = 7;
      const rawSamples = [];
      for (let i = 0; i < N_SAMPLES; i++) {
        const t = i / (N_SAMPLES - 1);
        const xCanvas = fitMinX + t * (fitMaxX - fitMinX);
        const xn = (xCanvas - xMid) / xScale;
        const yCanvas = a * xn * xn + b * xn + c;
        rawSamples.push([xCanvas, yCanvas]);
      }
      // Eyewhite lower edge = lower eyelid (smile shape directly, no flip needed).
      // Eyelash lower edge = upper eye opening (frown shape); flip to get smile shape.
      // Apply yOffset to raise curve from raw lower-edge to natural closed-eye position.
      const isEyewhite = EYEWHITE_TAGS.has(m.tag);
      let curvePoints;
      if (isEyewhite) {
        curvePoints = rawSamples.map(([x, y]) =>
          [canvasToBodyXX(x), canvasToBodyXY(y + yOffset)]);
      } else {
        // Flip around line through endpoints (preserve tilt, invert curvature)
        const [x0, y0s] = rawSamples[0];
        const [xN, yNs] = rawSamples[rawSamples.length - 1];
        const slope = (yNs - y0s) / Math.max(1e-6, xN - x0);
        curvePoints = rawSamples.map(([x, y]) => {
          const yLine = y0s + slope * (x - x0);
          return [canvasToBodyXX(x), canvasToBodyXY(2 * yLine - y + yOffset)];
        });
      }
      // Bbox center for proximity matching with eyewhite/irides (use full pairs range)
      const [lX, lY] = pairs[0];
      const [rX, rY] = pairs[pairs.length - 1];
      const bboxCenterX = canvasToBodyXX((lX + rX) / 2);
      const bboxCenterY = canvasToBodyXY((lY + rY) / 2);
      eyeContexts.push({
        tag: m.tag, isEyewhite, curvePoints, bboxCenterX, bboxCenterY,
      });
    }
  }

  // Find matching eye ctx: prefer eyewhite source (more accurate), same side, proximity
  const findEyeCtx = (tag, bboxCx, bboxCy) => {
    if (eyeContexts.length === 0) return null;
    const side = tag.endsWith('-l') ? 'l' : tag.endsWith('-r') ? 'r' : '';
    // First try: eyewhite with matching side
    let pool = eyeContexts.filter(c => c.isEyewhite &&
      ((side === 'l' && c.tag.endsWith('-l')) ||
       (side === 'r' && c.tag.endsWith('-r')) ||
       (!side)));
    // Second try: any eyewhite
    if (!pool.length) pool = eyeContexts.filter(c => c.isEyewhite);
    // Third try: eyelash with matching side
    if (!pool.length) pool = eyeContexts.filter(c =>
      (side === 'l' && c.tag.endsWith('-l')) ||
      (side === 'r' && c.tag.endsWith('-r')));
    // Last resort: any context
    if (!pool.length) pool = eyeContexts;
    let best = null, bestD2 = Infinity;
    for (const c of pool) {
      const dx = bboxCx - c.bboxCenterX, dy = bboxCy - c.bboxCenterY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = c; }
    }
    return best;
  };

  if (generateRig) {
    for (const pm of perMesh) {
      const m = meshes[pm.mi];
      const warpSpec = RIG_WARP_TAGS.get(m.tag);
      if (!warpSpec) continue;
      if (meshWarpDeformerGuids.has(m.partId)) continue;
      if (pm.hasBakedKeyforms) continue; // arms/legs: move via rotation deformer → Breath chain

      const { col: warpCol, row: warpRow } = warpSpec;
      const warpGridPts = (warpCol + 1) * (warpRow + 1);

      const partId = m.partId;
      const canvasVerts = pm.vertices;
      const numVerts = canvasVerts.length / 2;
      const sanitizedName = (pm.meshName || partId).replace(/[^a-zA-Z0-9_]/g, '_');

      // Bounding box in canvas space — use FULL extent so every mesh vertex stays
      // inside the warp grid (0..1 space). Percentile-filtered bbox caused outlier
      // vertices to have <0 or >1 warp-local coords, producing bad extrapolation
      // (vertices "sticking out" at closed keyforms).
      let bxMin = Infinity, byMin = Infinity, bxMax = -Infinity, byMax = -Infinity;
      for (let i = 0; i < numVerts; i++) {
        const vx = canvasVerts[i * 2], vy = canvasVerts[i * 2 + 1];
        if (vx < bxMin) bxMin = vx; if (vy < byMin) byMin = vy;
        if (vx > bxMax) bxMax = vx; if (vy > byMax) byMax = vy;
      }
      const padX = (bxMax - bxMin) * 0.1 || 10;
      const padY = (byMax - byMin) * 0.1 || 10;
      bxMin -= padX; byMin -= padY; bxMax += padX; byMax += padY;
      const bW = bxMax - bxMin;
      const bH = byMax - byMin;

      // rigWarpBbox stays in canvas space (used for mesh 0..1 conversion in section 4)
      rigWarpBbox.set(partId, { gridMinX: bxMin, gridMinY: byMin, gridW: bW, gridH: bH });

      // Grid positions: in parent warp's 0..1 local space.
      // Face-parallax tags → grid in single FaceParallax 0..1 (rebased via faceUnionBbox).
      // Neck-warp tags    → grid in single NeckWarp 0..1 (rebased via neckUnionBbox).
      // Everything else   → grid in Body X 0..1 (via canvasToBodyXX/Y).
      const isFaceTag = FACE_PARALLAX_TAGS.has(m.tag) && faceUnionBbox;
      const isNeckTag = !isFaceTag && NECK_WARP_TAGS.has(m.tag) && neckUnionBbox;
      const gW = warpCol + 1;
      const gH = warpRow + 1;
      const restGrid = new Float64Array(warpGridPts * 2);
      for (let r = 0; r < gH; r++) {
        for (let c = 0; c < gW; c++) {
          const idx = (r * gW + c) * 2;
          const cx = bxMin + c * bW / warpCol;
          const cy = byMin + r * bH / warpRow;
          if (isFaceTag) {
            restGrid[idx]     = canvasToFaceUnionX(cx);
            restGrid[idx + 1] = canvasToFaceUnionY(cy);
          } else if (isNeckTag) {
            restGrid[idx]     = canvasToNeckWarpX(cx);
            restGrid[idx + 1] = canvasToNeckWarpY(cy);
          } else {
            restGrid[idx]     = canvasToBodyXX(cx);
            restGrid[idx + 1] = canvasToBodyXY(cy);
          }
        }
      }

      const [, pidRigWarpGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `RigWarp_${sanitizedName}` });
      meshWarpDeformerGuids.set(partId, pidRigWarpGuid);

      // ── Mesh orientation context (Session 16: unified eye closure) ──
      // For eye parts (eyelash/eyewhite/irides): use shared eyeContext (computed
      // from eyelash) so all three compress to the SAME convergence line.
      // For other face tags: no ctx (shiftFn uses local grid behavior).
      let meshCtx = null;
      if (EYE_PART_TAGS.has(m.tag)) {
        // Compute this mesh's bbox center in Body X space for proximity matching
        const bCx = canvasToBodyXX((bxMin + bxMax) / 2);
        const bCy = canvasToBodyXY((byMin + byMax) / 2);
        const ctx = findEyeCtx(m.tag, bCx, bCy);
        if (ctx) meshCtx = { curvePoints: ctx.curvePoints };
      }

      // ── Per-part warp binding: standard param or no-op ParamOpacity (Session 16) ──
      const tagBinding = TAG_PARAM_BINDINGS.get(m.tag);
      const hasBinding = !!(tagBinding && tagBinding.bindings.every(b => b.pid));
      let pidRigWarpKfg, rigWarpFormGuids, rigWarpKeyValues;

      if (hasBinding) {
        const { bindings } = tagBinding;
        const numBindings = bindings.length;
        // Generate all key index/value combinations (binding 0 = inner/fast, 1 = outer/slow)
        const keyCombos = []; // [[idx0, idx1], ...] for KeyOnParameter keyIndex
        rigWarpKeyValues = []; // [[val0, val1], ...] for shiftFn
        if (numBindings === 1) {
          for (let i = 0; i < bindings[0].keys.length; i++) {
            keyCombos.push([i]);
            rigWarpKeyValues.push([bindings[0].keys[i]]);
          }
        } else {
          for (let j = 0; j < bindings[1].keys.length; j++) {
            for (let i = 0; i < bindings[0].keys.length; i++) {
              keyCombos.push([i, j]);
              rigWarpKeyValues.push([bindings[0].keys[i], bindings[1].keys[j]]);
            }
          }
        }
        const totalKf = keyCombos.length;
        rigWarpFormGuids = [];

        // KeyformBindingSources — one per param
        const kfbs = bindings.map(b => {
          const [kfb, pidKfb] = x.shared('KeyformBindingSource');
          return { kfb, pidKfb, ...b };
        });

        // KeyformGridSource with totalKf keyforms
        const [kfg, pidKfg] = x.shared('KeyformGridSource');
        pidRigWarpKfg = pidKfg;
        const kfogList = x.sub(kfg, 'array_list', {
          'xs.n': 'keyformsOnGrid', count: String(totalKf),
        });
        for (let ki = 0; ki < totalKf; ki++) {
          const [, pidForm] = x.shared('CFormGuid', {
            uuid: uuid(), note: `RigWarpForm_${sanitizedName}_${keyCombos[ki].join('_')}`,
          });
          rigWarpFormGuids.push(pidForm);
          const kog = x.sub(kfogList, 'KeyformOnGrid');
          const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
          const kop = x.sub(ak, 'array_list', {
            'xs.n': '_keyOnParameterList', count: String(numBindings),
          });
          for (let bi = 0; bi < numBindings; bi++) {
            const kon = x.sub(kop, 'KeyOnParameter');
            x.subRef(kon, 'KeyformBindingSource', kfbs[bi].pidKfb, { 'xs.n': 'binding' });
            x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(keyCombos[ki][bi]);
          }
          x.subRef(kog, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
        }
        // Binding list + emit each binding
        const kfbList = x.sub(kfg, 'array_list', {
          'xs.n': 'keyformBindings', count: String(numBindings),
        });
        for (const kfb of kfbs) {
          x.subRef(kfbList, 'KeyformBindingSource', kfb.pidKfb);
          emitKfBinding(kfb.kfb, pidKfg, kfb.pid, kfb.keys.map(k => k + '.0'), kfb.desc);
        }
      } else {
        // No standard binding — single rest keyform, no-op ParamOpacity
        const [, pidRigWarpForm] = x.shared('CFormGuid', { uuid: uuid(), note: `RigWarpForm_${sanitizedName}` });
        rigWarpFormGuids = [pidRigWarpForm];
        rigWarpKeyValues = null;
        const [rigWarpKfb, pidRigWarpKfb] = x.shared('KeyformBindingSource');
        const [rigWarpKfg, pidKfg] = x.shared('KeyformGridSource');
        pidRigWarpKfg = pidKfg;
        const kfogList = x.sub(rigWarpKfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: '1' });
        const kog = x.sub(kfogList, 'KeyformOnGrid');
        const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
        const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
        const kon = x.sub(kop, 'KeyOnParameter');
        x.subRef(kon, 'KeyformBindingSource', pidRigWarpKfb, { 'xs.n': 'binding' });
        x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = '0';
        x.subRef(kog, 'CFormGuid', pidRigWarpForm, { 'xs.n': 'keyformGuid' });
        const kfbList = x.sub(rigWarpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
        x.subRef(kfbList, 'KeyformBindingSource', pidRigWarpKfb);
        emitKfBinding(rigWarpKfb, pidRigWarpKfg, pidParamOpacity, ['1.0'], 'ParamOpacity');
      }

      // Parent part
      const meshParentGroup = m.parentGroupId;
      const rigWarpPartGuid = meshParentGroup && groupPartGuids.has(meshParentGroup)
        ? groupPartGuids.get(meshParentGroup) : pidPartGuid;

      // All per-part warps target ROOT, re-parented to Breath in section 3d.
      // TODO: route face warps through head rotation deformer (Hiyori pattern)
      // once coordinate space issue with warps-under-rotation-deformers is resolved.

      // CWarpDeformerSource — grid in Breath 0..1 space
      const [rigWarpDf, pidRigWarpDf] = x.shared('CWarpDeformerSource');
      allDeformerSources.push({ pid: pidRigWarpDf, tag: 'CWarpDeformerSource' });

      const rwAcdfs = x.sub(rigWarpDf, 'ACDeformerSource', { 'xs.n': 'super' });
      const rwAcpcs = x.sub(rwAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
      x.sub(rwAcpcs, 's', { 'xs.n': 'localName' }).text = `${pm.meshName} Warp`;
      x.sub(rwAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
      x.sub(rwAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
      x.subRef(rwAcpcs, 'CPartGuid', rigWarpPartGuid, { 'xs.n': 'parentGuid' });
      x.subRef(rwAcpcs, 'KeyformGridSource', pidRigWarpKfg, { 'xs.n': 'keyformGridSource' });
      const rwMft = x.sub(rwAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
      x.sub(rwMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
      const rwBwc = x.sub(rwMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
      x.sub(rwBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
      x.sub(rwAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
      x.sub(rwAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
      x.sub(rwAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
      x.subRef(rwAcdfs, 'CDeformerGuid', pidRigWarpGuid, { 'xs.n': 'guid' });
      x.sub(rwAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: `RigWarp_${sanitizedName}` });
      // targetDeformerGuid: ROOT, patched to Breath in section 3d
      const rigWarpTargetNode = x.subRef(rwAcdfs, 'CDeformerGuid', pidDeformerRoot, { 'xs.n': 'targetDeformerGuid' });

      x.sub(rigWarpDf, 'i', { 'xs.n': 'col' }).text = String(warpCol);
      x.sub(rigWarpDf, 'i', { 'xs.n': 'row' }).text = String(warpRow);
      x.sub(rigWarpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

      // ── Keyforms: N procedurally-shifted grids, or 1 rest keyform ──
      const numKf = rigWarpFormGuids.length;
      const rigKfsList = x.sub(rigWarpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });
      const gxSpan = restGrid[warpCol * 2] - restGrid[0];
      const gySpan = restGrid[(warpRow * gW) * 2 + 1] - restGrid[1];

      for (let ki = 0; ki < numKf; ki++) {
        // Generate grid positions: use shiftFn for bound params, rest for no-op
        const pos = (hasBinding && rigWarpKeyValues)
          ? tagBinding.shiftFn(restGrid, gW, gH, rigWarpKeyValues[ki], gxSpan, gySpan, meshCtx)
          : new Float64Array(restGrid);

        const wdf = x.sub(rigKfsList, 'CWarpDeformerForm');
        const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
        const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
        x.subRef(wdfAcf, 'CFormGuid', rigWarpFormGuids[ki], { 'xs.n': 'guid' });
        x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
        x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
        x.subRef(wdfAcf, 'CWarpDeformerSource', pidRigWarpDf, { 'xs.n': '_source' });
        x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
        x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
        x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
        x.sub(wdfAdf, 'CFloatColor', {
          'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
        });
        x.sub(wdfAdf, 'CFloatColor', {
          'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
        });
        x.subRef(wdfAdf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
        x.sub(wdf, 'float-array', {
          'xs.n': 'positions', count: String(warpGridPts * 2),
        }).text = Array.from(pos).map(v => v.toFixed(6)).join(' ');
      }

      // Register in parent part's _childGuids
      const rigWarpPartSrc = groupParts.has(meshParentGroup) ? groupParts.get(meshParentGroup) : rootPart;
      rigWarpPartSrc.childGuidsNode.children.push(x.ref('CDeformerGuid', pidRigWarpGuid));
      rigWarpPartSrc.childGuidsNode.attrs.count = String(rigWarpPartSrc.childGuidsNode.children.length);

      // Store for re-parenting in section 3d. Face-parallax tags route to the single
      // FaceParallax warp; other tags route to Body X.
      rigWarpTargetNodesToReparent.push({ node: rigWarpTargetNode, isFaceTag, isNeckTag });
    }
  }

  // ==================================================================
  // 3d. Structural Body Warp Chain (Hiyori pattern: 3 chained warps)
  // ==================================================================
  // Hiyori uses THREE chained structural warps, each with a single parameter:
  //   Body Warp Z (ParamBodyAngleZ, Canvas coords) → targets ROOT
  //   Body Warp Y (ParamBodyAngleY, DeformerLocal) → targets Body Warp Z
  //   Breath Warp (ParamBreath, DeformerLocal)      → targets Body Warp Y
  // All per-part warps and rotation deformers target Breath (the innermost).
  // Legs stay at ROOT — independent of body rotation.
  //
  // See WARP_DEFORMERS.md "Structural Warp Chain" for exact Hiyori values.

  const LEG_ROLES = new Set(['leftLeg', 'rightLeg', 'bothLegs', 'leftKnee', 'rightKnee']);

  // Helper: emit a complete CWarpDeformerSource with keyforms
  const emitStructuralWarp = (name, idstr, col, row, pidWarpGuid, pidTargetGuid,
    pidKfg, pidWarpCoordType, formGuids, gridPositions) => {
    const [warpDf, pidWarpDf] = x.shared('CWarpDeformerSource');
    allDeformerSources.push({ pid: pidWarpDf, tag: 'CWarpDeformerSource' });

    const acdfs = x.sub(warpDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const acpcs = x.sub(acdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(acpcs, 's', { 'xs.n': 'localName' }).text = name;
    x.sub(acpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(acpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(acpcs, 'CPartGuid', pidPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(acpcs, 'KeyformGridSource', pidKfg, { 'xs.n': 'keyformGridSource' });
    const mft = x.sub(acpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(mft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const bwc = x.sub(mft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(bwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(acpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(acdfs, 'CDeformerGuid', pidWarpGuid, { 'xs.n': 'guid' });
    x.sub(acdfs, 'CDeformerId', { 'xs.n': 'id', idstr });
    x.subRef(acdfs, 'CDeformerGuid', pidTargetGuid, { 'xs.n': 'targetDeformerGuid' });

    x.sub(warpDf, 'i', { 'xs.n': 'col' }).text = String(col);
    x.sub(warpDf, 'i', { 'xs.n': 'row' }).text = String(row);
    x.sub(warpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

    const numKf = formGuids.length;
    const gridPts = (col + 1) * (row + 1);
    const kfsList = x.sub(warpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });
    for (let i = 0; i < numKf; i++) {
      const wdf = x.sub(kfsList, 'CWarpDeformerForm');
      const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
      x.subRef(wdfAcf, 'CFormGuid', formGuids[i], { 'xs.n': 'guid' });
      x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(wdfAcf, 'CWarpDeformerSource', pidWarpDf, { 'xs.n': '_source' });
      x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
      x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(wdfAdf, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(wdfAdf, 'CoordType', pidWarpCoordType, { 'xs.n': 'coordType' });
      x.sub(wdf, 'float-array', {
        'xs.n': 'positions', count: String(gridPts * 2),
      }).text = Array.from(gridPositions[i]).map(v => v.toFixed(6)).join(' ');
    }

    // Register in root part's _childGuids
    rootPart.childGuidsNode.children.push(x.ref('CDeformerGuid', pidWarpGuid));
    rootPart.childGuidsNode.attrs.count = String(rootPart.childGuidsNode.children.length);

    return pidWarpDf;
  };

  // Helper: emit single-param keyform binding + grid (3 keyforms for -10/0/+10, or 2 for 0/1)
  const emitSingleParamKfGrid = (pidParam, keys, description) => {
    const [kfb, pidKfb] = x.shared('KeyformBindingSource');
    const [kfg, pidKfg] = x.shared('KeyformGridSource');
    const formGuids = [];

    const kfogList = x.sub(kfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: String(keys.length) });
    for (let i = 0; i < keys.length; i++) {
      const [, pidForm] = x.shared('CFormGuid', { uuid: uuid(), note: `${description}_k${keys[i]}` });
      formGuids.push(pidForm);
      const kog = x.sub(kfogList, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon = x.sub(kop, 'KeyOnParameter');
      x.subRef(kon, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
      x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(i);
      x.subRef(kog, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
    }
    const kfbList = x.sub(kfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(kfbList, 'KeyformBindingSource', pidKfb);
    emitKfBinding(kfb, pidKfg, pidParam, keys.map(k => k + '.0'), description);

    return { pidKfg, formGuids };
  };

  // Helper: generate uniform grid in given range with margin
  const makeUniformGrid = (col, row, minVal, maxVal) => {
    const gW = col + 1, gH = row + 1;
    const grid = new Float64Array(gW * gH * 2);
    for (let r = 0; r < gH; r++) {
      for (let c = 0; c < gW; c++) {
        grid[(r * gW + c) * 2]     = minVal + c * (maxVal - minVal) / col;
        grid[(r * gW + c) * 2 + 1] = minVal + r * (maxVal - minVal) / row;
      }
    }
    return grid;
  };

  if (generateRig && pidParamBodyAngleZ && pidParamBodyAngleY && pidParamBreath) {
    const SC = 5; // structural warp grid size (5×5 like Hiyori)
    const scGW = SC + 1, scGH = SC + 1;
    const scGridPts = scGW * scGH; // 36

    // ── Body Warp Z — Canvas coords, targets ROOT ──
    // Hiyori: X 395–2581 (13%–87%), Y -38–3029 (-1%–73%) on 2976×4175
    // Grid bounds from BZ_MIN_X/Y, BZ_W/H constants defined above section 3c.

    const bzRestGrid = new Float64Array(scGridPts * 2);
    for (let r = 0; r < scGH; r++) {
      for (let c = 0; c < scGW; c++) {
        bzRestGrid[(r * scGW + c) * 2]     = BZ_MIN_X + c * BZ_W / SC;
        bzRestGrid[(r * scGW + c) * 2 + 1] = BZ_MIN_Y + r * BZ_H / SC;
      }
    }

    const [, pidBodyZGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'BodyWarpZ' });
    const [coordBWZ, pidCoordBWZ] = x.shared('CoordType');
    x.sub(coordBWZ, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // Keyforms: -10, 0, +10 on ParamBodyAngleZ
    // Hiyori: bottom row pinned, top rows shift with perspective (non-uniform columns).
    // At -10: top-left ΔX=-148, top-right ΔX=-252 (shear). ΔY: left +136, right -60.
    // At +10: top-left ΔX=+244, top-right ΔX=+80. ΔY: left -32, right +188.
    // This creates a 3D rotation effect — columns further from lean direction shift more.
    const bzKeys = [-10, 0, 10];
    const { pidKfg: pidBzKfg, formGuids: bzFormGuids } =
      emitSingleParamKfGrid(pidParamBodyAngleZ, bzKeys, 'ParamBodyAngleZ');

    // Body Z: rotation around the HIP pivot point.
    // - Hip is at ~60% from top (row 3 on 6-row grid)
    // - Upper body arcs left/right proportional to distance from hip
    // - Head LAGS slightly behind shoulders (trails the lean)
    // - Legs below hip: barely move, feet completely static
    // - Y shifts create 3D depth (lean side drops, far side rises)
    const HIP_FRAC = 0.45; // belly pivot at 45% from top

    // Leg fade: below hip, movement fades to zero.
    // Last row always 0 (feet pinned). Upper legs move slightly.
    const FEET_FRAC = 0.75; // below this = completely static (lower legs + feet)
    const bodyMoveFactor = (rf) => {
      if (rf <= HIP_FRAC) return 1.0;
      if (rf >= FEET_FRAC) return 0.0; // lower legs + feet: completely static
      // Upper legs: linear fade from hip to FEET_FRAC
      const legT = (rf - HIP_FRAC) / (FEET_FRAC - HIP_FRAC); // 0 at hip, 1 at knee
      return (1 - legT) * 0.3; // upper legs move at most 30% of hip
    };

    const bzGridPositions = [];
    for (const k of bzKeys) {
      const pos = new Float64Array(bzRestGrid);
      if (k !== 0) {
        const sign = k / 10; // -1 or +1
        for (let r = 0; r < scGH; r++) {
          for (let c = 0; c < scGW; c++) {
            const idx = (r * scGW + c) * 2;
            const rf = r / (scGH - 1); // 0=top, 1=bottom
            const cf = c / (scGW - 1); // 0=left, 1=right

            // Progressive curve from hip: spine bends, not rigid rotation.
            // Uses sine curve so the lean accelerates smoothly from hip to head.
            const distAboveHip = Math.max(0, HIP_FRAC - rf) / HIP_FRAC; // 0 at hip, 1 at top
            const legFade = bodyMoveFactor(rf);
            // Spine curve: sine gives natural S-bend (slow start at hip, fast at shoulders)
            const spineCurve = Math.sin(distAboveHip * Math.PI / 2); // 0 at hip, 1 at head
            let t = rf <= HIP_FRAC ? 0.08 + spineCurve * 0.92 : legFade * 0.25;

            // Body bowing: center columns shift WITH lean, edges shift opposite
            // (same principle as Body X — creates 3D curvature illusion)
            const bowFactor = 1.5 * Math.sin(Math.PI * cf) - 0.5; // +1 center, -0.5 edges
            pos[idx] += sign * 0.05 * t * bowFactor * BZ_W;

            // Plus a uniform lean component (whole body shifts, not just bows)
            const perspCf = sign < 0 ? cf : (1 - cf);
            pos[idx] += sign * (0.02 + 0.015 * perspCf) * t * BZ_W;

            // Y: lean side drops, far side rises — 3D depth
            const yShift = -sign * 0.025 * (0.5 - cf) * t;
            pos[idx + 1] += yShift * BZ_H;
          }
        }
      }
      bzGridPositions.push(pos);
    }

    emitStructuralWarp('Body Warp Z', 'BodyWarpZ', SC, SC, pidBodyZGuid, pidDeformerRoot,
      pidBzKfg, pidCoordBWZ, bzFormGuids, bzGridPositions);

    // ── Body Warp Y — DeformerLocal 0..1, targets Body Warp Z ──
    // Hiyori: uniform grid 0.065–0.935 (6.5% margin), very subtle Y shifts (~0.005–0.01)
    const [, pidBodyYGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'BodyWarpY' });

    const byRestGrid = makeUniformGrid(SC, SC, BY_MIN, BY_MAX);
    const byKeys = [-10, 0, 10];
    const { pidKfg: pidByKfg, formGuids: byFormGuids } =
      emitSingleParamKfGrid(pidParamBodyAngleY, byKeys, 'ParamBodyAngleY');

    // Hiyori Body Y pattern: vertical compression/stretch with 3D curvature.
    // - Top row and edge columns PINNED
    // - Center columns shift most (bell curve) — body bows forward/back
    // - Torso+head moves, legs fade to static (same bodyMoveFactor as Z)
    // - At -10: body compresses down (Y increases), max ~0.013 at center
    // - At +10: body stretches up (Y decreases), max ~0.008 at center
    const byGridPositions = [];
    for (const k of byKeys) {
      const pos = new Float64Array(byRestGrid);
      if (k !== 0) {
        const sign = k / 10;
        for (let r = 0; r < scGH; r++) {
          for (let c = 0; c < scGW; c++) {
            const idx = (r * scGW + c) * 2;
            if (c === 0 || c === scGW - 1) continue; // edge cols pinned
            if (r === 0) continue; // top row pinned
            const cf = c / (scGW - 1);
            const rf = r / (scGH - 1);
            // Column bell: center columns shift most (body curvature)
            const colBell = Math.sin(Math.PI * cf);
            // Row factor: torso peaks, legs fade to static
            const rowPeak = Math.sin(Math.PI * rf * 0.7); // peaks at torso
            const legFade = bodyMoveFactor(rf); // fades legs
            const rowFactor = rowPeak * legFade;
            // Y shift: compress at -10, stretch at +10
            const yMag = sign < 0 ? 0.013 : 0.008;
            pos[idx + 1] += -sign * yMag * colBell * rowFactor;
            // X shift: tiny horizontal bow
            pos[idx] += sign * 0.003 * colBell * rowFactor;
          }
        }
      }
      byGridPositions.push(pos);
    }

    emitStructuralWarp('Body Warp Y', 'BodyWarpY', SC, SC, pidBodyYGuid, pidBodyZGuid,
      pidByKfg, pidCoord, byFormGuids, byGridPositions);

    // ── Breath Warp — DeformerLocal 0..1, targets Body Warp Y ──
    // Hiyori: uniform grid 0.055–0.945 (5.5% margin), VERY subtle shifts (~0.001–0.002)
    const [, pidBreathGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'BreathWarp' });

    const brRestGrid = makeUniformGrid(SC, SC, BR_MIN, BR_MAX);
    const brKeys = [0, 1];
    const { pidKfg: pidBrKfg, formGuids: brFormGuids } =
      emitSingleParamKfGrid(pidParamBreath, brKeys, 'ParamBreath');

    const brGridPositions = [];
    for (const k of brKeys) {
      const pos = new Float64Array(brRestGrid);
      if (k === 1) {
        // Breath exhale: rows 1-2 compress inward (Y shifts up), row 3 minimal, rest pinned
        for (let r = 0; r < scGH; r++) {
          for (let c = 0; c < scGW; c++) {
            const idx = (r * scGW + c) * 2;
            // Edge columns stay pinned
            if (c === 0 || c === scGW - 1) continue;
            // Row 0 (top edge) and rows 4-5 (bottom): no change
            if (r === 0 || r >= scGH - 2) continue;
            // Chest compression: rows 1-3 shift Y upward.
            // Hiyori values (0.001–0.002) are for a 4175px canvas — scale up for visibility.
            let dy = 0;
            if (r === 1) dy = -0.012;
            else if (r === 2) dy = -0.015;
            else if (r === 3) dy = -0.005;
            // X: center columns move inward slightly
            const cx = (c - scGW / 2 + 0.5) / (scGW / 2); // -1 to +1
            const dx = -cx * 0.008;
            pos[idx]     += dx;
            pos[idx + 1] += dy;
          }
        }
      }
      brGridPositions.push(pos);
    }

    emitStructuralWarp('Breath', 'BreathWarp', SC, SC, pidBreathGuid, pidBodyYGuid,
      pidBrKfg, pidCoord, brFormGuids, brGridPositions);

    // ── Body X Warp — 4th structural layer, child of Breath ──
    // Hiyori: Body X Warp (#3560), 5×5 grid, targets Breath, ParamBodyAngleX (-10..+10)
    // All per-part warps and rotation deformers target Body X (not Breath).
    let pidBodyXGuid = null;
    if (pidParamBodyAngleX) {
      const bxCol = 5, bxRow = 5;
      const bxGW = bxCol + 1, bxGH = bxRow + 1;
      [, pidBodyXGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'BodyXWarp' });

      // Grid in Breath's 0..1 space, covering roughly the body area
      // Hiyori Body X grid: ~0.14..0.90 X, ~0.18..0.82 Y (body area within Breath)
      const bxMinV = 0.10, bxMaxV = 0.90;
      const bxRestGrid = makeUniformGrid(bxCol, bxRow, bxMinV, bxMaxV);

      const bxKeys = [-10, 0, 10];
      const { pidKfg: pidBxKfg, formGuids: bxFormGuids } =
        emitSingleParamKfGrid(pidParamBodyAngleX, bxKeys, 'ParamBodyAngleX');

      // Hiyori Body X pattern: body BOWING effect, not uniform lean.
      // Center columns shift WITH lean direction, edge columns shift OPPOSITE.
      // Lower legs static, upper legs barely move (same hip pivot as Body Z).
      const bxGridPositions = [];
      for (const k of bxKeys) {
        const pos = new Float64Array(bxRestGrid);
        if (k !== 0) {
          const sign = k / 10;
          for (let r = 0; r < bxGH; r++) {
            for (let c = 0; c < bxGW; c++) {
              const idx = (r * bxGW + c) * 2;
              const cf = c / (bxGW - 1); // column fraction 0..1
              const rf = r / (bxGH - 1); // row fraction 0..1
              // Bow factor: +1 at center, -0.5 at edges (body bends)
              const bowFactor = 1.5 * Math.sin(Math.PI * cf) - 0.5;
              // Row amplitude: peaks at torso, legs fade to zero
              const torsoPeak = Math.sin(Math.PI * rf * 0.7); // peaks at upper-mid body
              const legFade = bodyMoveFactor(rf); // legs static
              const rowAmp = (0.02 + 0.03 * torsoPeak) * legFade;
              pos[idx] += sign * rowAmp * bowFactor;
            }
          }
        }
        bxGridPositions.push(pos);
      }

      emitStructuralWarp('Body X Warp', 'BodyXWarp', bxCol, bxRow,
        pidBodyXGuid, pidBreathGuid, pidBxKfg, pidCoord, bxFormGuids, bxGridPositions);
    }

    // ==================================================================
    // 3d.1 Neck Warp (Session 20: neck follows head tilt)
    // ==================================================================
    // Hiyori has a dedicated "Neck Warp" (CWarpDeformerSource, 6×6 grid, 3 keyforms)
    // that applies a Y-gradient to the neck area — bottom row pinned at shoulders,
    // top row shifts to follow whatever parameter drives the head pose. In Hiyori
    // the binding is PARAM_BODY_ANGLE_X (body lean); we bind to ParamAngleZ so the
    // neck bends in sync with Face Rotation's head tilt.
    //
    // Chain: Body X → NeckWarp → neck/neckwear rig warps → neck meshes
    // Grid scale: Body X 0..1 (DeformerLocal; parent is a warp).
    let pidNeckWarpGuid = null;
    if (pidParamAngleZ && neckUnionBbox && pidBodyXGuid) {
      const nwCol = 5, nwRow = 5;               // 6×6 control points
      const nwGW = nwCol + 1, nwGH = nwRow + 1;
      const nwGridPts = nwGW * nwGH;

      // Rest grid in Body X 0..1.
      const nwRestBodyX = new Float64Array(nwGridPts * 2);
      for (let r = 0; r < nwGH; r++) {
        for (let c = 0; c < nwGW; c++) {
          const idx = (r * nwGW + c) * 2;
          const cx = neckUnionBbox.minX + c * neckUnionBbox.W / nwCol;
          const cy = neckUnionBbox.minY + r * neckUnionBbox.H / nwRow;
          nwRestBodyX[idx]     = canvasToBodyXX(cx);
          nwRestBodyX[idx + 1] = canvasToBodyXY(cy);
        }
      }
      const nwSpanX_bx = nwRestBodyX[(nwGW - 1) * 2] - nwRestBodyX[0];

      // 3 keyforms on ParamAngleZ: -30, 0, +30.
      // At ±30, top row shifts in X by NECK_TILT_FRAC * nwSpanX_bx.
      // Row gradient: sin(π·(1 - rf) / 2) — 1 at top row, 0 at bottom row.
      const NECK_TILT_FRAC = 0.08;
      const nwKeys = [-30, 0, 30];
      const nwGridPositions = [];
      for (const k of nwKeys) {
        const pos = new Float64Array(nwRestBodyX);
        if (k !== 0) {
          const sign = k / 30;
          for (let r = 0; r < nwGH; r++) {
            const rf = r / (nwGH - 1);
            const gradient = Math.sin(Math.PI * (1 - rf) / 2);
            if (gradient === 0) continue;
            for (let c = 0; c < nwGW; c++) {
              const idx = (r * nwGW + c) * 2;
              pos[idx] += sign * NECK_TILT_FRAC * gradient * nwSpanX_bx;
            }
          }
        }
        nwGridPositions.push(pos);
      }

      const [, pidNwGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'NeckWarp' });
      pidNeckWarpGuid = pidNwGuid;
      const { pidKfg: pidNwKfg, formGuids: nwFormGuids } =
        emitSingleParamKfGrid(pidParamAngleZ, nwKeys, 'ParamAngleZ_Neck');
      emitStructuralWarp('Neck Warp', 'NeckWarp', nwCol, nwRow,
        pidNwGuid, pidBodyXGuid, pidNwKfg, pidCoord, nwFormGuids, nwGridPositions);
    }

    // ==================================================================
    // 3d.2 Face Rotation + Face Parallax Warp (Sessions 19–20)
    // ==================================================================
    // Chain:  Body X → Face Rotation (ParamAngleZ, 3kf, pivot=chin)
    //                    └─ FaceParallax (single warp, 6×6 grid, 9kf on AngleX×AngleY)
    //                             └─ RigWarp_<part>  (rebased into FaceParallax 0..1)
    //
    // Session 19 shipped the single FaceParallax warp but left Face Rotation orphaned.
    // Session 20 diagnosed the coord-space: a rotation-deformer parent exposes a local
    // frame of canvas-pixel offsets from its own pivot (NOT 0..1), so FaceParallax grid
    // values must be `(canvas_pos - facePivotCx/Cy)`, not `canvasToBodyXX/Y(...)`.
    // Face Rotation's pivot stays in Body X 0..1 because its own parent is a warp.
    // See SESSION20_FINDINGS.md + WARP_DEFORMERS.md "Rotation Deformer Local Frame".
    //
    // FaceParallax deformation = Session 15 Body-X-pattern layered effects:
    //   1. Base bow (sine profile, center > edges).
    //   2. Asymmetric perspective (far side of rotation shifts more).
    //   3. Cross-axis Y-on-AngleX + X-on-AngleY (tilt-while-turning cue).
    //   4. Row/col fade (top/bottom/edge columns move less than middle).
    const faceParallaxGuids = new Map(); // groupKey → pidCDeformerGuid
    if (pidParamAngleZ && facePivotCx !== null && faceUnionBbox && pidBodyXGuid) {
      // ── Face Rotation (CRotationDeformerSource) ──
      // ParamAngleZ range is standard ±30; Hiyori caps actual rotation at ±10° even
      // when param is pushed to its limits. 3 keyforms: param -30/0/+30 → angle -10/0/+10.
      const [, pidFaceRotGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'FaceRotation' });
      const faceRotParamKeys = [-30, 0, 30];    // ParamAngleZ keyform values
      const faceRotAngles    = [-10, 0, 10];    // corresponding rotation angles (Hiyori)
      const { pidKfg: pidFaceRotKfg, formGuids: faceRotFormGuids } =
        emitSingleParamKfGrid(pidParamAngleZ, faceRotParamKeys, 'ParamAngleZ');

      const pivotBxX = canvasToBodyXX(facePivotCx);
      const pivotBxY = canvasToBodyXY(facePivotCy);

      const [faceRotDf, pidFaceRotDf] = x.shared('CRotationDeformerSource');
      allDeformerSources.push({ pid: pidFaceRotDf, tag: 'CRotationDeformerSource' });
      const frAcdfs = x.sub(faceRotDf, 'ACDeformerSource', { 'xs.n': 'super' });
      const frAcpcs = x.sub(frAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
      x.sub(frAcpcs, 's', { 'xs.n': 'localName' }).text = 'Face Rotation';
      x.sub(frAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
      x.sub(frAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
      x.subRef(frAcpcs, 'CPartGuid', pidPartGuid, { 'xs.n': 'parentGuid' });
      x.subRef(frAcpcs, 'KeyformGridSource', pidFaceRotKfg, { 'xs.n': 'keyformGridSource' });
      const frMft = x.sub(frAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
      x.sub(frMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
      const frBwc = x.sub(frMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
      x.sub(frBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
      x.sub(frAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
      x.sub(frAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
      x.sub(frAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
      x.subRef(frAcdfs, 'CDeformerGuid', pidFaceRotGuid, { 'xs.n': 'guid' });
      x.sub(frAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: 'FaceRotation' });
      x.subRef(frAcdfs, 'CDeformerGuid', pidBodyXGuid, { 'xs.n': 'targetDeformerGuid' });
      x.sub(faceRotDf, 'b', { 'xs.n': 'useBoneUi_testImpl' }).text = 'true';

      const frKfsList = x.sub(faceRotDf, 'carray_list', {
        'xs.n': 'keyforms', count: String(faceRotParamKeys.length),
      });
      for (let i = 0; i < faceRotParamKeys.length; i++) {
        const rdf = x.sub(frKfsList, 'CRotationDeformerForm', {
          angle: faceRotAngles[i].toFixed(1),
          originX: pivotBxX.toFixed(6),
          originY: pivotBxY.toFixed(6),
          scale: '1.0',
          isReflectX: 'false',
          isReflectY: 'false',
        });
        const rdfAdf = x.sub(rdf, 'ACDeformerForm', { 'xs.n': 'super' });
        const rdfAcf = x.sub(rdfAdf, 'ACForm', { 'xs.n': 'super' });
        x.subRef(rdfAcf, 'CFormGuid', faceRotFormGuids[i], { 'xs.n': 'guid' });
        x.sub(rdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
        x.sub(rdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
        x.subRef(rdfAcf, 'CRotationDeformerSource', pidFaceRotDf, { 'xs.n': '_source' });
        x.sub(rdfAcf, 'null', { 'xs.n': 'name' });
        x.sub(rdfAcf, 's', { 'xs.n': 'notes' }).text = '';
        x.sub(rdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
        x.sub(rdfAdf, 'CFloatColor', {
          'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
        });
        x.sub(rdfAdf, 'CFloatColor', {
          'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
        });
        x.subRef(rdfAdf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
      }
      // Match existing rotation-deformer field order (UI metadata).
      x.sub(faceRotDf, 'f', { 'xs.n': 'handleLengthOnCanvas' }).text = '200.0';
      x.sub(faceRotDf, 'f', { 'xs.n': 'circleRadiusOnCanvas' }).text = '100.0';
      x.sub(faceRotDf, 'f', { 'xs.n': 'baseAngle' }).text = '0.0';
      rootPart.childGuidsNode.children.push(x.ref('CDeformerGuid', pidFaceRotGuid));
      rootPart.childGuidsNode.attrs.count = String(rootPart.childGuidsNode.children.length);

      // ── FaceParallax warps (7 groups, 6×6 grid, 9kf on AngleX × AngleY) ──
      const fpCol = 5, fpRow = 5; // 6×6 control points (matches Hiyori)
      const fpGW = fpCol + 1, fpGH = fpRow + 1;
      const fpGridPts = fpGW * fpGH;
      // Hiyori keyform order: Y-fast (AngleY inner, AngleX outer).
      // Binding array order: AngleY first, AngleX second.
      const fpAngleKeys = [-30, 0, 30];
      const fpKeyCombos = []; // [angleX, angleY] in storage order
      for (let xi = 0; xi < 3; xi++) {
        for (let yi = 0; yi < 3; yi++) {
          fpKeyCombos.push([fpAngleKeys[xi], fpAngleKeys[yi]]);
        }
      }

      if (pidParamAngleX && pidParamAngleY) {
        // SINGLE FaceParallax warp over the whole face union bbox.
        // Follows Session 15 Body X pattern: uniform rest grid in parent's 0..1 space,
        // keyforms apply a parametric BOW deformation that varies with (cf, rf) grid
        // position. All face meshes are children of this one warp via their rig warps.

        // Rest grid in "Face Rotation's local frame" = canvas-pixel OFFSETS from the
        // face rotation pivot.  Evidence (Hiyori 50+ rotation deformers):
        //   - Rotation deformer children see parent's local frame as canvas-pixel
        //     offsets from parent's own pivot, NOT 0..1 of any warp domain.
        //   - CoordType "DeformerLocal" means "parent's local frame" (whatever it is),
        //     not literally 0..1.
        //   - Hiyori FaceParallax grids are pixel-offset values like (-60..292, -435..-45)
        //     relative to Face Rotation's canvas pivot, not 0..1.
        // Using Body X 0..1 values here (Session 19 attempts) collapsed the face to
        // canvas ~(0,0) because Cubism interpreted 0..1 values as pixel offsets of < 1 px.
        const fpRestLocal = new Float64Array(fpGridPts * 2);
        for (let r = 0; r < fpGH; r++) {
          for (let c = 0; c < fpGW; c++) {
            const idx = (r * fpGW + c) * 2;
            fpRestLocal[idx]     = (faceUnionBbox.minX + c * faceUnionBbox.W / fpCol) - facePivotCx;
            fpRestLocal[idx + 1] = (faceUnionBbox.minY + r * faceUnionBbox.H / fpRow) - facePivotCy;
          }
        }
        // Span for scaling bow magnitudes — canvas-pixel width/height of face bbox.
        const fpSpanX_bx = faceUnionBbox.W;
        const fpSpanY_bx = faceUnionBbox.H;

        // 9 keyforms — layered deformation following Session 15 Body Z pattern:
        //   1. Base bow: center columns/rows bow most (1.5·sin·π·f − 0.5 profile, Hiyori).
        //   2. Asymmetric perspective: far side of rotation shifts more than near side
        //      (sign-dependent, like Body Z's perspCf). Gives the "turning away" feel.
        //   3. Cross-axis Y-on-AngleX: face tilts slightly as it turns horizontally —
        //      columns on the turning-away side drop, near side rises (3D depth cue).
        //   4. Row-fade: top and bottom of face move less (hair/chin edges), middle rows
        //      (eye/nose zone) move most. Same sin·π·rf falloff as Body Y's torsoPeak.
        const FP_BOW_X_FRAC   = 0.04;  // per-column bow on X shift at ±30°
        const FP_PERSP_X_FRAC = 0.02;  // asymmetric perspective add-on (X)
        const FP_CROSS_Y_FRAC = 0.020; // cross-axis Y shift per column on AngleX
        const FP_BOW_Y_FRAC   = 0.03;  // per-row bow on Y shift at ±30°
        const FP_PERSP_Y_FRAC = 0.015; // asymmetric perspective add-on (Y)
        const FP_CROSS_X_FRAC = 0.015; // cross-axis X shift per row on AngleY
        const fpGridPositions = [];
        const fpFormGuids = [];
        for (const [ax, ay] of fpKeyCombos) {
          const signX = ax / 30;
          const signY = ay / 30;
          const pos = new Float64Array(fpRestLocal);
          if (signX !== 0 || signY !== 0) {
            for (let r = 0; r < fpGH; r++) {
              for (let c = 0; c < fpGW; c++) {
                const idx = (r * fpGW + c) * 2;
                const cf = c / (fpGW - 1);
                const rf = r / (fpGH - 1);
                const bowC = 1.5 * Math.sin(Math.PI * cf) - 0.5;
                const bowR = 1.5 * Math.sin(Math.PI * rf) - 0.5;
                // Asymmetric perspective: at +sign, FAR side (cf=0) gets more shift;
                // at -sign, far side (cf=1) gets more. Mirrors Body Z's perspCf.
                const perspCf = signX < 0 ? cf : (1 - cf);
                const perspRf = signY < 0 ? rf : (1 - rf);
                // Row fade: edges move less (sin·π·rf peaks at 0.5). Same for columns.
                const rowFade = Math.sin(Math.PI * rf);
                const colFade = Math.sin(Math.PI * cf);

                // ── X shift (driven by AngleX) ──
                // Base bow + asymmetric perspective, faded by row so top/bottom edges
                // don't shift as hard as eye/mouth zone.
                pos[idx] += signX * (
                  FP_BOW_X_FRAC   * bowC +
                  FP_PERSP_X_FRAC * perspCf
                ) * rowFade * fpSpanX_bx;
                // Cross-axis: AngleX also produces a small Y shift per column —
                // turning-away side drops, near side rises. This is the "tilt while
                // turning" cue that sells the 3D feel.
                pos[idx + 1] += signX * FP_CROSS_Y_FRAC * (cf - 0.5) * rowFade * fpSpanY_bx;

                // ── Y shift (driven by AngleY) ──
                pos[idx + 1] += -signY * (
                  FP_BOW_Y_FRAC   * bowR +
                  FP_PERSP_Y_FRAC * perspRf
                ) * colFade * fpSpanY_bx;
                // Cross-axis: AngleY adds a small X shift per row.
                pos[idx] += -signY * FP_CROSS_X_FRAC * (rf - 0.5) * colFade * fpSpanX_bx;
              }
            }
          }
          fpGridPositions.push(pos);
          const [, pidForm] = x.shared('CFormGuid', {
            uuid: uuid(), note: `FaceParallax_ax${ax}_ay${ay}`,
          });
          fpFormGuids.push(pidForm);
        }

        // Emit the single FaceParallax deformer (CWarpDeformerSource) targeting Body X.
        const [, pidFpGuid] = x.shared('CDeformerGuid', {
          uuid: uuid(), note: 'FaceParallax',
        });
        faceParallaxGuids.set('__all__', pidFpGuid);

        // KeyformBindings — AngleY first, AngleX second (Hiyori convention).
        const [fpKfbY, pidFpKfbY] = x.shared('KeyformBindingSource');
        const [fpKfbX, pidFpKfbX] = x.shared('KeyformBindingSource');
        const [fpKfg, pidFpKfg]   = x.shared('KeyformGridSource');
        const fpKfogList = x.sub(fpKfg, 'array_list', {
          'xs.n': 'keyformsOnGrid', count: String(fpKeyCombos.length),
        });
        for (let ki = 0; ki < fpKeyCombos.length; ki++) {
          const ax = fpKeyCombos[ki][0], ay = fpKeyCombos[ki][1];
          const xi = fpAngleKeys.indexOf(ax);
          const yi = fpAngleKeys.indexOf(ay);
          const kog = x.sub(fpKfogList, 'KeyformOnGrid');
          const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
          const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '2' });
          const konY = x.sub(kop, 'KeyOnParameter');
          x.subRef(konY, 'KeyformBindingSource', pidFpKfbY, { 'xs.n': 'binding' });
          x.sub(konY, 'i', { 'xs.n': 'keyIndex' }).text = String(yi);
          const konX = x.sub(kop, 'KeyOnParameter');
          x.subRef(konX, 'KeyformBindingSource', pidFpKfbX, { 'xs.n': 'binding' });
          x.sub(konX, 'i', { 'xs.n': 'keyIndex' }).text = String(xi);
          x.subRef(kog, 'CFormGuid', fpFormGuids[ki], { 'xs.n': 'keyformGuid' });
        }
        const fpKfbList = x.sub(fpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '2' });
        x.subRef(fpKfbList, 'KeyformBindingSource', pidFpKfbY);
        x.subRef(fpKfbList, 'KeyformBindingSource', pidFpKfbX);
        emitKfBinding(fpKfbY, pidFpKfg, pidParamAngleY,
          fpAngleKeys.map(k => k + '.0'), 'ParamAngleY');
        emitKfBinding(fpKfbX, pidFpKfg, pidParamAngleX,
          fpAngleKeys.map(k => k + '.0'), 'ParamAngleX');

        // Emit the CWarpDeformerSource
        const [fpDf, pidFpDf] = x.shared('CWarpDeformerSource');
        allDeformerSources.push({ pid: pidFpDf, tag: 'CWarpDeformerSource' });
        const fpAcdfs = x.sub(fpDf, 'ACDeformerSource', { 'xs.n': 'super' });
        const fpAcpcs = x.sub(fpAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
        x.sub(fpAcpcs, 's', { 'xs.n': 'localName' }).text = 'FaceParallax';
        x.sub(fpAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
        x.sub(fpAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
        x.subRef(fpAcpcs, 'CPartGuid', pidPartGuid, { 'xs.n': 'parentGuid' });
        x.subRef(fpAcpcs, 'KeyformGridSource', pidFpKfg, { 'xs.n': 'keyformGridSource' });
        const fpMft = x.sub(fpAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
        x.sub(fpMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
        const fpBwc = x.sub(fpMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
        x.sub(fpBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
        x.sub(fpAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
        x.sub(fpAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
        x.sub(fpAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
        x.subRef(fpAcdfs, 'CDeformerGuid', pidFpGuid, { 'xs.n': 'guid' });
        x.sub(fpAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: 'FaceParallax' });
        // FaceParallax targets Face Rotation → Body X.  Coord scales:
        //   - Face Rotation pivot:  in Body X 0..1  (its parent is a warp)
        //   - FaceParallax grid:    in canvas-pixel OFFSETS from Face Rotation's pivot
        //                           (its parent is a rotation deformer — see WARP_DEFORMERS.md
        //                           "Rotation Deformer Local Frame" for the evidence).
        // At rest (ParamAngleZ=0) Face Rotation is identity, so the chain is transparent.
        // At ±30 (mapped to ±10° rotation) Face Rotation rotates FaceParallax's grid
        // around the face pivot, producing head tilt for all face rig warp descendants.
        x.subRef(fpAcdfs, 'CDeformerGuid', pidFaceRotGuid, { 'xs.n': 'targetDeformerGuid' });
        x.sub(fpDf, 'i', { 'xs.n': 'col' }).text = String(fpCol);
        x.sub(fpDf, 'i', { 'xs.n': 'row' }).text = String(fpRow);
        x.sub(fpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';
        const fpKfsList = x.sub(fpDf, 'carray_list', {
          'xs.n': 'keyforms', count: String(fpKeyCombos.length),
        });
        for (let ki = 0; ki < fpKeyCombos.length; ki++) {
          const wdf = x.sub(fpKfsList, 'CWarpDeformerForm');
          const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
          const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
          x.subRef(wdfAcf, 'CFormGuid', fpFormGuids[ki], { 'xs.n': 'guid' });
          x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
          x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
          x.subRef(wdfAcf, 'CWarpDeformerSource', pidFpDf, { 'xs.n': '_source' });
          x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
          x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
          x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
          x.sub(wdfAdf, 'CFloatColor', {
            'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
          });
          x.sub(wdfAdf, 'CFloatColor', {
            'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
          });
          x.subRef(wdfAdf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
          x.sub(wdf, 'float-array', {
            'xs.n': 'positions', count: String(fpGridPts * 2),
          }).text = Array.from(fpGridPositions[ki]).map(v => v.toFixed(6)).join(' ');
        }
        rootPart.childGuidsNode.children.push(x.ref('CDeformerGuid', pidFpGuid));
        rootPart.childGuidsNode.attrs.count = String(rootPart.childGuidsNode.children.length);
      }
    }

    // ── Re-parent: rotation deformers targeting ROOT → Body X Warp ──
    // Body X is the innermost structural warp (4th layer). Everything targets it.
    // Skip legs (they stay at ROOT).
    // Convert ALL non-leg rotation deformer origins to Body X space using world positions.
    // canvasToBodyXX/Y defined before section 3c.
    const pidReparentTarget = pidBodyXGuid || pidBreathGuid; // fallback if no Body X

    for (const [gid, targetNode] of rotDeformerTargetNodes) {
      const group = groupMap.get(gid);
      if (group && LEG_ROLES.has(group.boneRole)) continue;

      // Re-parent ROOT-targeting deformers to Body X (or Breath)
      if (targetNode.attrs['xs.ref'] === pidDeformerRoot) {
        targetNode.attrs['xs.ref'] = pidReparentTarget;
      }

      // Convert origin for ALL non-leg deformers using world position → Body X space
      const originData = rotDeformerOriginNodes.get(gid);
      if (originData) {
        const newOx = canvasToBodyXX(originData.wx).toFixed(6);
        const newOy = canvasToBodyXY(originData.wy).toFixed(6);
        for (const rdf of originData.forms) {
          rdf.attrs.originX = newOx;
          rdf.attrs.originY = newOy;
        }
        // Patch shared CoordType: Canvas → DeformerLocal (origins in 0..1, not pixels)
        const coordTextNode = originData.coordNode.children.find(c => c.attrs?.['xs.n'] === 'coordName');
        if (coordTextNode) coordTextNode.text = 'DeformerLocal';
      }
    }

    // ── Re-parent: per-part rig warps → FaceParallax (face tag), NeckWarp (neck tag),
    // or Body X (default).  Grids were rebased to the appropriate 0..1 domain in section 3c.
    const pidFpUnified = faceParallaxGuids.get('__all__');
    for (const entry of rigWarpTargetNodesToReparent) {
      const { node, isFaceTag, isNeckTag } = entry;
      if (isFaceTag && pidFpUnified) {
        node.attrs['xs.ref'] = pidFpUnified;
      } else if (isNeckTag && pidNeckWarpGuid) {
        node.attrs['xs.ref'] = pidNeckWarpGuid;
      } else {
        node.attrs['xs.ref'] = pidReparentTarget;
      }
    }
  }

  // ==================================================================
  // 4. CArtMeshSource (per mesh)
  // ==================================================================

  const meshSrcIds = []; // pidMesh for each mesh

  for (const pm of perMesh) {
    const [meshSrc, pidMesh] = x.shared('CArtMeshSource');
    meshSrcIds.push(pidMesh);

    // Set _owner on CTextureInputExtension
    x.subRef(pm.tieSup, 'CArtMeshSource', pidMesh, { 'xs.n': '_owner' });

    const canvasVerts = pm.vertices; // original canvas-space positions
    const tris = pm.triangles;
    const uvs = pm.uvs;
    const numVerts = canvasVerts.length / 2;

    // TRAP: .cmo3 has TWO position arrays per mesh in different coordinate spaces!
    //   - meshSrc > positions + GEditableMesh2 > point → CANVAS pixel space (texture mapping)
    //   - keyform > CArtMeshForm > positions → DEFORMER-LOCAL space (rendering)
    // Setting both to the same space breaks either textures (empty fill) or deformation (scatter).
    // See ARCHITECTURE.md "Dual-Position System" for details.
    const meshParentGroup = meshes[pm.mi].parentGroupId;
    const jointBoneId = meshes[pm.mi].jointBoneId;

    // For baked keyform meshes: parent to ARM deformer (bone's parent group), not bone deformer.
    // The ARM deformer handles shoulder rotation; baked keyforms handle elbow bending.
    let dfOwner;
    if (pm.hasBakedKeyforms) {
      // Find the ARM group (parent of the bone node) — mesh is parented here, not to bone deformer.
      // Fallback chain: bone's parent → mesh's parent → null (ungrouped, canvas space)
      const boneGroup = groupMap.get(jointBoneId);
      dfOwner = boneGroup?.parent || meshParentGroup;
    } else {
      dfOwner = jointBoneId && deformerWorldOrigins.has(jointBoneId)
        ? jointBoneId : meshParentGroup;
    }
    // If dfOwner exists but has no deformer origin (e.g. bone node with no deformer),
    // walk up the group hierarchy until we find one with a deformer origin.
    while (dfOwner && !deformerWorldOrigins.has(dfOwner)) {
      const parentGroup = groupMap.get(dfOwner);
      dfOwner = parentGroup?.parent || null;
    }
    const dfOrigin = dfOwner && deformerWorldOrigins.has(dfOwner)
      ? deformerWorldOrigins.get(dfOwner)
      : null;

    // When mesh is under a rig warp deformer, keyform positions must be 0..1 warp-local.
    // Otherwise, standard deformer-local (canvas minus deformer world origin).
    const partId = meshes[pm.mi].partId;
    const rwBox = rigWarpBbox.get(partId);
    let verts;
    if (rwBox) {
      // 0..1 warp-local: (canvasPos - gridMin) / gridSize
      verts = canvasVerts.map((v, i) =>
        i % 2 === 0
          ? (v - rwBox.gridMinX) / rwBox.gridW
          : (v - rwBox.gridMinY) / rwBox.gridH
      );
    } else if (dfOrigin) {
      verts = canvasVerts.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y));
    } else {
      verts = canvasVerts;
    }

    const ds = x.sub(meshSrc, 'ACDrawableSource', { 'xs.n': 'super' });
    const pc = x.sub(ds, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(pc, 's', { 'xs.n': 'localName' }).text = pm.meshName;
    x.sub(pc, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(pc, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    // parentGuid: the group this mesh belongs to, or root if ungrouped
    const meshParentPid = meshParentGroup && groupPartGuids.has(meshParentGroup)
      ? groupPartGuids.get(meshParentGroup) : pidPartGuid;
    x.subRef(pc, 'CPartGuid', meshParentPid, { 'xs.n': 'parentGuid' });
    x.subRef(pc, 'KeyformGridSource', pm.pidKfgMesh, { 'xs.n': 'keyformGridSource' });
    const morph = x.sub(pc, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(morph, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const mbw = x.sub(morph, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(mbw, 'carray_list', { 'xs.n': '_constraints', count: '0' });

    // Extensions: editable mesh + texture input + mesh generator
    const extList = x.sub(pc, 'carray_list', { 'xs.n': '_extensions', count: '3' });

    // CEditableMeshExtension
    const eme = x.sub(extList, 'CEditableMeshExtension');
    const emeSup = x.sub(eme, 'ACExtension', { 'xs.n': 'super' });
    x.subRef(emeSup, 'CExtensionGuid', pm.pidExtMesh, { 'xs.n': 'guid' });
    x.subRef(emeSup, 'CArtMeshSource', pidMesh, { 'xs.n': '_owner' });

    // Build edge list from triangles
    const edgeSet = new Set();
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b_ = tris[t + 1], c = tris[t + 2];
      const addEdge = (u, v) => {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        edgeSet.add(key);
      };
      addEdge(a, b_);
      addEdge(b_, c);
      addEdge(c, a);
    }
    const edges = [];
    for (const e of edgeSet) {
      const [a, b_] = e.split(',').map(Number);
      edges.push(a, b_);
    }

    const em = x.sub(eme, 'GEditableMesh2', {
      'xs.n': 'editableMesh',
      nextPointUid: String(numVerts),
      useDelaunayTriangulation: 'true',
    });
    // Editable mesh points in canvas space (for texture baking)
    x.sub(em, 'float-array', { 'xs.n': 'point', count: String(canvasVerts.length) }).text =
      canvasVerts.map(v => v.toFixed(1)).join(' ');
    x.sub(em, 'byte-array', { 'xs.n': 'pointPriority', count: String(numVerts) }).text =
      Array(numVerts).fill('20').join(' ');
    x.sub(em, 'short-array', { 'xs.n': 'edge', count: String(edges.length) }).text =
      edges.join(' ');
    x.sub(em, 'byte-array', { 'xs.n': 'edgePriority', count: String(edges.length / 2) }).text =
      Array(edges.length / 2).fill('30').join(' ');
    x.sub(em, 'int-array', { 'xs.n': 'pointUid', count: String(numVerts) }).text =
      Array.from({ length: numVerts }, (_, i) => i).join(' ');
    x.subRef(em, 'GEditableMeshGuid', pm.pidEmesh, { 'xs.n': 'meshGuid' });
    x.subRef(em, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
    x.sub(eme, 'b', { 'xs.n': 'isLocked' }).text = 'false';

    // Texture input extension ref
    x.subRef(extList, 'CTextureInputExtension', pm.pidTie);

    // CMeshGeneratorExtension
    const mge = x.sub(extList, 'CMeshGeneratorExtension');
    const mgeSup = x.sub(mge, 'ACExtension', { 'xs.n': 'super' });
    x.sub(mgeSup, 'CExtensionGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
    x.subRef(mgeSup, 'CArtMeshSource', pidMesh, { 'xs.n': '_owner' });
    const mgs = x.sub(mge, 'MeshGenerateSetting', { 'xs.n': 'meshGenerateSetting' });
    x.sub(mgs, 'i', { 'xs.n': 'polygonOuterDensity' }).text = '100';
    x.sub(mgs, 'i', { 'xs.n': 'polygonInnerDensity' }).text = '100';
    x.sub(mgs, 'i', { 'xs.n': 'polygonMargin' }).text = '20';
    x.sub(mgs, 'i', { 'xs.n': 'polygonInnerMargin' }).text = '20';
    x.sub(mgs, 'i', { 'xs.n': 'polygonMinMargin' }).text = '5';
    x.sub(mgs, 'i', { 'xs.n': 'polygonMinBoundsPt' }).text = '5';
    x.sub(mgs, 'i', { 'xs.n': 'thresholdAlpha' }).text = '0';

    x.sub(pc, 'null', { 'xs.n': 'internalColor_direct_argb' });

    x.sub(ds, 'CDrawableId', { 'xs.n': 'id', idstr: pm.meshId });
    x.subRef(ds, 'CDrawableGuid', pm.pidDrawable, { 'xs.n': 'guid' });
    // targetDeformerGuid: warp > deformer > ROOT
    // For baked keyform meshes: parent to ARM deformer (bone's parent), not bone deformer.
    // For non-baked: jointBone's deformer > parent group's deformer > ROOT.
    const meshJointBoneId = meshes[pm.mi].jointBoneId;
    let meshDfGuid;
    if (meshWarpDeformerGuids.has(partId)) {
      meshDfGuid = meshWarpDeformerGuids.get(partId);
    } else if (pm.hasBakedKeyforms) {
      // ARM deformer (bone's parent group) — mesh bending handled by baked keyforms
      const boneGroup = groupMap.get(meshJointBoneId);
      const armGroupId = boneGroup?.parent || meshParentGroup;
      meshDfGuid = (armGroupId && groupDeformerGuids.has(armGroupId))
        ? groupDeformerGuids.get(armGroupId) : pidDeformerRoot;
    } else if (meshJointBoneId && groupDeformerGuids.has(meshJointBoneId)) {
      meshDfGuid = groupDeformerGuids.get(meshJointBoneId);
    } else if (meshParentGroup && groupDeformerGuids.has(meshParentGroup)) {
      meshDfGuid = groupDeformerGuids.get(meshParentGroup);
    } else {
      meshDfGuid = pidDeformerRoot;
    }
    x.subRef(ds, 'CDeformerGuid', meshDfGuid, { 'xs.n': 'targetDeformerGuid' });
    x.sub(ds, 'carray_list', { 'xs.n': 'clipGuidList', count: '0' });
    x.sub(ds, 'b', { 'xs.n': 'invertClippingMask' }).text = 'false';

    // Triangle indices
    x.sub(meshSrc, 'int-array', { 'xs.n': 'indices', count: String(tris.length) }).text =
      tris.join(' ');

    // Keyforms — baked bone-weight keyforms or single rest-pose keyform
    // Helper to emit one CArtMeshForm
    const emitArtMeshForm = (kfList, formGuidPid, positions) => {
      const artForm = x.sub(kfList, 'CArtMeshForm');
      const adf = x.sub(artForm, 'ACDrawableForm', { 'xs.n': 'super' });
      const acf = x.sub(adf, 'ACForm', { 'xs.n': 'super' });
      x.subRef(acf, 'CFormGuid', formGuidPid, { 'xs.n': 'guid' });
      x.sub(acf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(acf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(acf, 'CArtMeshSource', pidMesh, { 'xs.n': '_source' });
      x.sub(acf, 'null', { 'xs.n': 'name' });
      x.sub(acf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(adf, 'i', { 'xs.n': 'drawOrder' }).text = String(pm.drawOrder);
      x.sub(adf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(adf, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(adf, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(adf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
      // Warp-local positions are 0..1 and need high precision (Hiyori uses ~8 digits).
      // Deformer-local positions are pixels where 1dp suffices, but extra precision is harmless.
      const posPrecision = rwBox ? 6 : 1;
      x.sub(artForm, 'float-array', { 'xs.n': 'positions', count: String(positions.length) }).text =
        positions.map(v => v.toFixed(posPrecision)).join(' ');
    };

    if (pm.hasBakedKeyforms) {
      // 3 keyforms: min angle, rest (0), max angle
      // Compute baked vertex positions by rotating each vertex around the elbow pivot
      // by angle × boneWeight. All positions in ARM deformer-local space.
      const weights = pm.boneWeights;
      const pivotCanvasX = pm.jointPivotX ?? 0;
      const pivotCanvasY = pm.jointPivotY ?? 0;
      // Elbow pivot in deformer-local space
      const pivotLocalX = dfOrigin ? (pivotCanvasX - dfOrigin.x) : pivotCanvasX;
      const pivotLocalY = dfOrigin ? (pivotCanvasY - dfOrigin.y) : pivotCanvasY;

      const computeBakedPositions = (angleDeg) => {
        const positions = new Array(verts.length);
        for (let i = 0; i < numVerts; i++) {
          const localX = verts[i * 2];
          const localY = verts[i * 2 + 1];
          const w = weights[i] ?? 0;
          const rad = angleDeg * w * Math.PI / 180;
          const dx = localX - pivotLocalX;
          const dy = localY - pivotLocalY;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          positions[i * 2] = pivotLocalX + dx * cos - dy * sin;
          positions[i * 2 + 1] = pivotLocalY + dx * sin + dy * cos;
        }
        return positions;
      };

      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '3' });
      emitArtMeshForm(kfList, pm.pidFormMin, computeBakedPositions(BAKED_ANGLE_MIN));
      emitArtMeshForm(kfList, pm.pidFormMesh, verts); // rest (angle=0, no rotation)
      emitArtMeshForm(kfList, pm.pidFormMax, computeBakedPositions(BAKED_ANGLE_MAX));
    } else if (pm.hasEyelidClosure) {
      // 2 keyforms: closed (k=0, band-collapsed) and open (k=1, rest).
      // Band upper Y comes from eyelash-l's lower contour.
      // - eyelash-l: above-band vertices clamp to bandY; at/below stay (preserves visible lash).
      // - eyewhite-l / irides-l: ALL vertices snap to bandY so they hide behind the lash line.
      const bandCanvas = eyelashBandCanvas.get(pm.closureSide);
      const shiftPx = eyelashShiftCanvas.get(pm.closureSide) ?? 0;
      const isEyelash = meshes[pm.mi].tag === 'eyelash-l' || meshes[pm.mi].tag === 'eyelash-r';
      const closedCanvas = new Array(canvasVerts.length);
      for (let i = 0; i < numVerts; i++) {
        const vx = canvasVerts[i * 2];
        const vy = canvasVerts[i * 2 + 1];
        const bandY = evalBandY(bandCanvas, vx);
        closedCanvas[i * 2] = vx;
        let closedY;
        if (bandY === null) closedY = vy;
        else if (isEyelash) closedY = vy < bandY ? bandY : vy; // keep lash band
        else closedY = bandY; // eyewhite / iris: fully collapse
        closedCanvas[i * 2 + 1] = closedY - shiftPx; // shift entire closed state up
      }
      // Convert to same coord space as `verts` (warp-local 0..1 if rwBox, else deformer-local)
      let closedVerts;
      if (rwBox) {
        closedVerts = closedCanvas.map((v, i) =>
          i % 2 === 0
            ? (v - rwBox.gridMinX) / rwBox.gridW
            : (v - rwBox.gridMinY) / rwBox.gridH
        );
      } else if (dfOrigin) {
        closedVerts = closedCanvas.map((v, i) => v - (i % 2 === 0 ? dfOrigin.x : dfOrigin.y));
      } else {
        closedVerts = closedCanvas;
      }
      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '2' });
      emitArtMeshForm(kfList, pm.pidFormClosed, closedVerts); // keyIndex 0: closed
      emitArtMeshForm(kfList, pm.pidFormMesh, verts);         // keyIndex 1: open/rest
    } else {
      // Single keyform at rest position
      const kfList = x.sub(meshSrc, 'carray_list', { 'xs.n': 'keyforms', count: '1' });
      emitArtMeshForm(kfList, pm.pidFormMesh, verts);
    }

    // Base pixel-space positions — in CANVAS space (used for texture mapping)
    x.sub(meshSrc, 'float-array', { 'xs.n': 'positions', count: String(canvasVerts.length) }).text =
      canvasVerts.map(v => v.toFixed(1)).join(' ');

    // UVs
    x.sub(meshSrc, 'float-array', { 'xs.n': 'uvs', count: String(uvs.length) }).text =
      uvs.map(v => v.toFixed(6)).join(' ');
    x.subRef(meshSrc, 'GTexture2D', pm.pidTex2d, { 'xs.n': 'texture' });
    x.sub(meshSrc, 'ColorComposition', { 'xs.n': 'colorComposition', v: 'NORMAL' });
    x.sub(meshSrc, 'b', { 'xs.n': 'culling' }).text = 'false';
    x.sub(meshSrc, 'TextureState', { 'xs.n': 'textureState', v: 'MODEL_IMAGE' });
    x.sub(meshSrc, 's', { 'xs.n': 'userData' }).text = '';
  }

  // ==================================================================
  // 5. CModelImageGroup (contains inline CModelImage per mesh)
  // ==================================================================

  const [imgGroup, pidImgGrp] = x.shared('CModelImageGroup');
  x.sub(imgGroup, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(imgGroup, 's', { 'xs.n': 'groupName' }).text = 'stretchy_export';
  const liGuids = x.sub(imgGroup, 'carray_list', {
    'xs.n': '_linkedRawImageGuids', count: '1',
  });
  x.subRef(liGuids, 'CLayeredImageGuid', pidLiGuid);

  const miList = x.sub(imgGroup, 'carray_list', {
    'xs.n': '_modelImages', count: String(meshes.length),
  });

  for (const pm of perMesh) {
    const mi = x.sub(miList, 'CModelImage', { modelImageVersion: '0' });
    x.subRef(mi, 'CModelImageGuid', pm.pidMiGuid, { 'xs.n': 'guid' });
    x.sub(mi, 's', { 'xs.n': 'name' }).text = pm.meshName;
    x.subRef(mi, 'ModelImageFilterSet', pm.pidFset, { 'xs.n': 'inputFilter' });

    // inputFilterEnv
    const mife = x.sub(mi, 'ModelImageFilterEnv', { 'xs.n': 'inputFilterEnv' });
    const fe = x.sub(mife, 'FilterEnv', { 'xs.n': 'super' });
    x.sub(fe, 'null', { 'xs.n': 'parentEnv' });
    const envMap = x.sub(fe, 'hash_map', { 'xs.n': 'envValues', count: '2' });
    // mi_currentImageGuid → CLayeredImageGuid
    const envE1 = x.sub(envMap, 'entry');
    x.subRef(envE1, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'key' });
    const evs1 = x.sub(envE1, 'EnvValueSet', { 'xs.n': 'value' });
    x.subRef(evs1, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'id' });
    x.subRef(evs1, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'value' });
    x.sub(evs1, 'l', { 'xs.n': 'updateTimeMs' }).text = '0';
    // mi_input_layerInputData → CLayerSelectorMap
    const envE2 = x.sub(envMap, 'entry');
    x.subRef(envE2, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'key' });
    const evs2 = x.sub(envE2, 'EnvValueSet', { 'xs.n': 'value' });
    x.subRef(evs2, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'id' });
    const lsm = x.sub(evs2, 'CLayerSelectorMap', { 'xs.n': 'value' });
    const itli = x.sub(lsm, 'linked_map', { 'xs.n': '_imageToLayerInput', count: '1' });
    const itliE = x.sub(itli, 'entry');
    x.subRef(itliE, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'key' });
    const itliV = x.sub(itliE, 'array_list', { 'xs.n': 'value', count: '1' });
    const lidData = x.sub(itliV, 'CLayerInputData');
    x.subRef(lidData, 'CLayer', pm.pidLayer, { 'xs.n': 'layer' });
    x.sub(lidData, 'CAffine', {
      'xs.n': 'affine',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.sub(lidData, 'null', { 'xs.n': 'clippingOnTexturePx' });
    x.sub(evs2, 'l', { 'xs.n': 'updateTimeMs' }).text = '0';

    // _filteredImage
    x.subRef(mi, 'CImageResource', pm.pidImg, { 'xs.n': '_filteredImage' });
    x.sub(mi, 'null', { 'xs.n': 'icon16' });
    x.sub(mi, 'CAffine', {
      'xs.n': '_materialLocalToCanvasTransform',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.subRef(mi, 'CModelImageGroup', pidImgGrp, { 'xs.n': '_group' });
    const miLrig = x.sub(mi, 'carray_list', { 'xs.n': 'linkedRawImageGuids', count: '1' });
    x.subRef(miLrig, 'CLayeredImageGuid', pidLiGuid);

    // CCachedImageManager
    const cim = x.sub(mi, 'CCachedImageManager', { 'xs.n': 'cachedImageManager' });
    x.sub(cim, 'CachedImageType', { 'xs.n': 'defaultCacheType', v: 'SCALE_1' });
    x.subRef(cim, 'CImageResource', pm.pidImg, { 'xs.n': 'rawImage' });
    const ciList = x.sub(cim, 'array_list', { 'xs.n': 'cachedImages', count: '1' });
    const ci = x.sub(ciList, 'CCachedImage');
    x.subRef(ci, 'CImageResource', pm.pidImg, { 'xs.n': '_cachedImageResource' });
    x.sub(ci, 'b', { 'xs.n': 'isSharedImage' }).text = 'true';
    x.sub(ci, 'CSize', { 'xs.n': 'rawImageSize', width: String(canvasW), height: String(canvasH) });
    x.sub(ci, 'i', { 'xs.n': 'reductionRatio' }).text = '1';
    x.sub(ci, 'i', { 'xs.n': 'mipmapLevel' }).text = '1';
    x.sub(ci, 'b', { 'xs.n': 'hasMargin' }).text = 'false';
    x.sub(ci, 'b', { 'xs.n': 'isCleaned' }).text = 'false';
    x.sub(ci, 'CAffine', {
      'xs.n': 'transformRawImageToCachedImage',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.sub(cim, 'i', { 'xs.n': 'requiredMipmapLevel' }).text = '1';

    x.sub(mi, 's', { 'xs.n': 'memo' }).text = '';
  }

  // ==================================================================
  // 6. BUILD main.xml
  // ==================================================================

  const root = x.el('root', { fileFormatVersion: '402030000' });

  // Shared section
  const sharedElem = x.sub(root, 'shared');
  for (const obj of x._shared) {
    sharedElem.children.push(obj);
  }

  // Main section
  const mainElem = x.sub(root, 'main');
  const model = x.sub(mainElem, 'CModelSource', { isDefaultKeyformLocked: 'true' });
  x.subRef(model, 'CModelGuid', pidModelGuid, { 'xs.n': 'guid' });
  x.sub(model, 's', { 'xs.n': 'name' }).text = modelName;
  const edition = x.sub(model, 'EditorEdition', { 'xs.n': 'editorEdition' });
  x.sub(edition, 'i', { 'xs.n': 'edition' }).text = '15';

  // Canvas
  const canvas = x.sub(model, 'CImageCanvas', { 'xs.n': 'canvas' });
  x.sub(canvas, 'i', { 'xs.n': 'pixelWidth' }).text = String(canvasW);
  x.sub(canvas, 'i', { 'xs.n': 'pixelHeight' }).text = String(canvasH);
  x.sub(canvas, 'CColor', { 'xs.n': 'background' });

  // Parameters — emit all from paramDefs (ParamOpacity + project parameters)
  const paramSet = x.sub(model, 'CParameterSourceSet', { 'xs.n': 'parameterSourceSet' });
  const paramSources = x.sub(paramSet, 'carray_list', {
    'xs.n': '_sources', count: String(paramDefs.length),
  });
  for (const pd of paramDefs) {
    const ps = x.sub(paramSources, 'CParameterSource');
    x.sub(ps, 'i', { 'xs.n': 'decimalPlaces' }).text = String(pd.decimalPlaces);
    x.subRef(ps, 'CParameterGuid', pd.pid, { 'xs.n': 'guid' });
    x.sub(ps, 'f', { 'xs.n': 'snapEpsilon' }).text = '0.001';
    x.sub(ps, 'f', { 'xs.n': 'minValue' }).text = String(pd.min);
    x.sub(ps, 'f', { 'xs.n': 'maxValue' }).text = String(pd.max);
    x.sub(ps, 'f', { 'xs.n': 'defaultValue' }).text = String(pd.defaultVal);
    x.sub(ps, 'b', { 'xs.n': 'isRepeat' }).text = 'false';
    x.sub(ps, 'CParameterId', { 'xs.n': 'id', idstr: pd.id });
    x.sub(ps, 'Type', { 'xs.n': 'paramType', v: 'NORMAL' });
    x.sub(ps, 's', { 'xs.n': 'name' }).text = pd.name;
    x.sub(ps, 's', { 'xs.n': 'description' }).text = '';
    x.sub(ps, 'b', { 'xs.n': 'combined' }).text = 'false';
    x.subRef(ps, 'CParameterGroupGuid', pidParamGroupGuid, { 'xs.n': 'parentGroupGuid' });
  }

  // Texture manager
  const texMgr = x.sub(model, 'CTextureManager', { 'xs.n': 'textureManager' });
  const texList = x.sub(texMgr, 'TextureImageGroup', { 'xs.n': 'textureList' });
  x.sub(texList, 'carray_list', { 'xs.n': 'children', count: '0' });
  // _rawImages: ONE LayeredImageWrapper wrapping the shared CLayeredImage
  const ri = x.sub(texMgr, 'carray_list', { 'xs.n': '_rawImages', count: '1' });
  const liw = x.sub(ri, 'LayeredImageWrapper');
  x.subRef(liw, 'CLayeredImage', pidLi, { 'xs.n': 'image' });
  x.sub(liw, 'l', { 'xs.n': 'importedTimeMSec' }).text = '0';
  x.sub(liw, 'l', { 'xs.n': 'lastModifiedTimeMSec' }).text = '0';
  x.sub(liw, 'b', { 'xs.n': 'isReplaced' }).text = 'false';
  // _modelImageGroups
  const mig = x.sub(texMgr, 'carray_list', { 'xs.n': '_modelImageGroups', count: '1' });
  x.subRef(mig, 'CModelImageGroup', pidImgGrp);
  x.sub(texMgr, 'carray_list', { 'xs.n': '_textureAtlases', count: '0' });
  x.sub(texMgr, 'b', { 'xs.n': 'isTextureInputModelImageMode' }).text = 'true';
  x.sub(texMgr, 'i', { 'xs.n': 'previewReductionRatio' }).text = '1';
  x.sub(texMgr, 'carray_list', { 'xs.n': 'artPathBrushUsingLayeredImageIds', count: '0' });

  // Drawable source set
  x.sub(model, 'b', { 'xs.n': 'useLegacyDrawOrder__testImpl' }).text = 'false';
  const drawSet = x.sub(model, 'CDrawableSourceSet', { 'xs.n': 'drawableSourceSet' });
  const drawSources = x.sub(drawSet, 'carray_list', {
    'xs.n': '_sources', count: String(meshes.length),
  });
  for (const pid of meshSrcIds) {
    x.subRef(drawSources, 'CArtMeshSource', pid);
  }

  // Deformer source set
  const deformerSet = x.sub(model, 'CDeformerSourceSet', { 'xs.n': 'deformerSourceSet' });
  const deformerSources = x.sub(deformerSet, 'carray_list', {
    'xs.n': '_sources', count: String(allDeformerSources.length),
  });
  for (const ds of allDeformerSources) {
    x.subRef(deformerSources, ds.tag, ds.pid);
  }

  // Affecter source set (empty — required)
  const affecterSet = x.sub(model, 'CAffecterSourceSet', { 'xs.n': 'affecterSourceSet' });
  x.sub(affecterSet, 'carray_list', { 'xs.n': '_sources', count: '0' });

  // Part source set — root + all group parts
  const partSet = x.sub(model, 'CPartSourceSet', { 'xs.n': 'partSourceSet' });
  const partSources = x.sub(partSet, 'carray_list', {
    'xs.n': '_sources', count: String(allPartSources.length),
  });
  for (const ps of allPartSources) {
    x.subRef(partSources, 'CPartSource', ps.pid);
  }

  // Root part ref
  x.subRef(model, 'CPartSource', rootPart.pid, { 'xs.n': 'rootPart' });

  // Parameter group set
  const pgSet = x.sub(model, 'CParameterGroupSet', { 'xs.n': 'parameterGroupSet' });
  x.sub(pgSet, 'carray_list', { 'xs.n': '_groups', count: '0' });

  // Model info
  const miInfo = x.sub(model, 'CModelInfo', { 'xs.n': 'modelInfo' });
  x.sub(miInfo, 'f', { 'xs.n': 'pixelsPerUnit' }).text = '1.0';
  const origin = x.sub(miInfo, 'CPoint', { 'xs.n': 'originInPixels' });
  x.sub(origin, 'i', { 'xs.n': 'x' }).text = '0';
  x.sub(origin, 'i', { 'xs.n': 'y' }).text = '0';

  x.sub(model, 'i', { 'xs.n': 'targetVersionNo' }).text = '3000';
  x.sub(model, 'i', { 'xs.n': 'latestVersionOfLastModelerNo' }).text = '5000000';

  // ==================================================================
  // 7. SERIALIZE + PACK INTO CAFF
  // ==================================================================

  const xmlStr = x.serialize(root, VERSION_PIS, IMPORT_PIS);
  const xmlBytes = new TextEncoder().encode(xmlStr);

  // Build CAFF file list: PNG textures + main.xml
  const caffFiles = [];
  for (const pm of perMesh) {
    caffFiles.push({
      path: pm.pngPath,
      content: pm.mi < meshes.length ? meshes[pm.mi].pngData : buildRawPng(canvasW, canvasH),
      tag: '',
      obfuscated: true,
      compress: COMPRESS_RAW,
    });
  }
  caffFiles.push({
    path: 'main.xml',
    content: xmlBytes,
    tag: 'main_xml',
    obfuscated: true,
    compress: COMPRESS_FAST,
  });

  const cmo3 = await packCaff(caffFiles, 42);
  return { cmo3, deformerParamMap };
}
