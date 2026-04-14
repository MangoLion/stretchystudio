/**
 * Minimal .moc3 binary writer for Live2D Cubism export.
 *
 * Generates a valid .moc3 binary file from Stretchy Studio project data.
 * The binary layout follows the format documented by py-moc3 and moc3ingbird:
 *
 *   [0..64)      Header: "MOC3" magic + version + endian flag + padding
 *   [64..704)    Section Offset Table (SOT): 160 x uint32 (640 bytes)
 *   [704..832)   Count Info Table: 23 x uint32 + padding (128 bytes)
 *   [832..1984)  Reserved / padding
 *   [1984..)     Body: count info, canvas info, then typed-array sections
 *
 * Each body section is 64-byte aligned. The SOT stores absolute offsets
 * from file start. Byte order is little-endian.
 *
 * Reference: py-moc3 _core.py (Ludentes/py-moc3) — verified read+write
 *
 * @module io/live2d/moc3writer
 */

// Source: [ref][py-moc3] — format constants from reference file + py-moc3
const MAGIC = [0x4D, 0x4F, 0x43, 0x33]; // "MOC3"
const HEADER_SIZE = 64;
const SOT_COUNT = 160;
const SOT_SIZE = SOT_COUNT * 4; // 640 bytes
const COUNT_INFO_ENTRIES = 23;
const COUNT_INFO_SIZE = 128; // 23 * 4 = 92, padded to 128
const CANVAS_INFO_SIZE = 64;
const DEFAULT_OFFSET = 1984; // body starts here
const ALIGN = 64;
const RUNTIME_UNIT_SIZE = 8;
const STRING_FIELD_SIZE = 64; // MOC3Id is a 64-byte null-padded UTF-8 string

// Source: [py-moc3] — version enum
const MOC_VERSION = {
  V3_00: 1,
  V3_03: 2,
  V4_00: 3,
  V4_02: 4,
  V5_00: 5,
};

// Source: [py-moc3] — count info indices
const COUNT_IDX = {
  PARTS: 0,
  DEFORMERS: 1,
  WARP_DEFORMERS: 2,
  ROTATION_DEFORMERS: 3,
  ART_MESHES: 4,
  PARAMETERS: 5,
  PART_KEYFORMS: 6,
  WARP_DEFORMER_KEYFORMS: 7,
  ROTATION_DEFORMER_KEYFORMS: 8,
  ART_MESH_KEYFORMS: 9,
  KEYFORM_POSITIONS: 10,
  KEYFORM_BINDING_INDICES: 11,
  KEYFORM_BINDING_BANDS: 12,
  KEYFORM_BINDINGS: 13,
  KEYS: 14,
  UVS: 15,
  POSITION_INDICES: 16,
  DRAWABLE_MASKS: 17,
  DRAW_ORDER_GROUPS: 18,
  DRAW_ORDER_GROUP_OBJECTS: 19,
  GLUES: 20,
  GLUE_INFOS: 21,
  GLUE_KEYFORMS: 22,
};

// Source: [py-moc3] — element types and their byte sizes
const ELEM = {
  I32:     { size: 4, write: 'writeI32Array' },
  F32:     { size: 4, write: 'writeF32Array' },
  I16:     { size: 2, write: 'writeI16Array' },
  U8:      { size: 1, write: 'writeU8Array' },
  BOOL:    { size: 4, write: 'writeBoolArray' },  // stored as i32
  STR64:   { size: 64, write: 'writeStringArray' },
  RUNTIME: { size: RUNTIME_UNIT_SIZE, write: 'writeRuntime' },
};

/**
 * Section layout definition — order matches py-moc3's SECTION_LAYOUT exactly.
 * Each entry: [name, elemType, countIdx, alignment]
 *
 * Source: [py-moc3] _core.py lines 319–466
 */
const SECTION_LAYOUT = [
  // Parts (count_idx=0)
  ['part.runtime_space',                ELEM.RUNTIME, COUNT_IDX.PARTS, ALIGN],
  ['part.ids',                          ELEM.STR64,   COUNT_IDX.PARTS, 0],
  ['part.keyform_binding_band_indices', ELEM.I32,     COUNT_IDX.PARTS, ALIGN],
  ['part.keyform_begin_indices',        ELEM.I32,     COUNT_IDX.PARTS, ALIGN],
  ['part.keyform_counts',               ELEM.I32,     COUNT_IDX.PARTS, ALIGN],
  ['part.visibles',                     ELEM.BOOL,    COUNT_IDX.PARTS, ALIGN],
  ['part.enables',                      ELEM.BOOL,    COUNT_IDX.PARTS, ALIGN],
  ['part.parent_part_indices',          ELEM.I32,     COUNT_IDX.PARTS, ALIGN],

  // Deformers (count_idx=1)
  ['deformer.runtime_space',                   ELEM.RUNTIME, COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.ids',                             ELEM.STR64,   COUNT_IDX.DEFORMERS, 0],
  ['deformer.keyform_binding_band_indices',    ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.visibles',                        ELEM.BOOL,    COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.enables',                         ELEM.BOOL,    COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.parent_part_indices',             ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.parent_deformer_indices',         ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.types',                           ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.specific_indices',                ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],

  // Warp Deformers (count_idx=2)
  ['warp_deformer.keyform_binding_band_indices', ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.keyform_begin_indices',        ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.keyform_counts',               ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.vertex_counts',                ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.rows',                         ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.cols',                         ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],

  // Rotation Deformers (count_idx=3)
  ['rotation_deformer.keyform_binding_band_indices', ELEM.I32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],
  ['rotation_deformer.keyform_begin_indices',        ELEM.I32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],
  ['rotation_deformer.keyform_counts',               ELEM.I32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],
  ['rotation_deformer.base_angles',                  ELEM.F32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],

  // ArtMeshes (count_idx=4)
  ['art_mesh.runtime_space_0',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.runtime_space_1',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.runtime_space_2',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.runtime_space_3',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.ids',                            ELEM.STR64,   COUNT_IDX.ART_MESHES, 0],
  ['art_mesh.keyform_binding_band_indices',   ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.keyform_begin_indices',          ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.keyform_counts',                 ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.visibles',                       ELEM.BOOL,    COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.enables',                        ELEM.BOOL,    COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.parent_part_indices',            ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.parent_deformer_indices',        ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.texture_indices',                ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.drawable_flags',                 ELEM.U8,      COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.position_index_counts',          ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.uv_begin_indices',               ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.position_index_begin_indices',   ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.vertex_counts',                  ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.mask_begin_indices',             ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.mask_counts',                    ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],

  // Parameters (count_idx=5)
  ['parameter.runtime_space',                    ELEM.RUNTIME, COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.ids',                              ELEM.STR64,   COUNT_IDX.PARAMETERS, 0],
  ['parameter.max_values',                       ELEM.F32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.min_values',                       ELEM.F32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.default_values',                   ELEM.F32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.repeats',                          ELEM.BOOL,    COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.decimal_places',                   ELEM.I32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.keyform_binding_begin_indices',    ELEM.I32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.keyform_binding_counts',           ELEM.I32,     COUNT_IDX.PARAMETERS, ALIGN],

  // Part Keyforms (count_idx=6)
  ['part_keyform.draw_orders', ELEM.F32, COUNT_IDX.PART_KEYFORMS, ALIGN],

  // Warp Deformer Keyforms (count_idx=7)
  ['warp_deformer_keyform.opacities',                      ELEM.F32, COUNT_IDX.WARP_DEFORMER_KEYFORMS, ALIGN],
  ['warp_deformer_keyform.keyform_position_begin_indices',  ELEM.I32, COUNT_IDX.WARP_DEFORMER_KEYFORMS, ALIGN],

  // Rotation Deformer Keyforms (count_idx=8)
  ['rotation_deformer_keyform.opacities',   ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.angles',      ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.origin_xs',   ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.origin_ys',   ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.scales',      ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.reflect_xs',  ELEM.BOOL, COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.reflect_ys',  ELEM.BOOL, COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],

  // ArtMesh Keyforms (count_idx=9)
  ['art_mesh_keyform.opacities',                      ELEM.F32, COUNT_IDX.ART_MESH_KEYFORMS, ALIGN],
  ['art_mesh_keyform.draw_orders',                    ELEM.F32, COUNT_IDX.ART_MESH_KEYFORMS, ALIGN],
  ['art_mesh_keyform.keyform_position_begin_indices',  ELEM.I32, COUNT_IDX.ART_MESH_KEYFORMS, ALIGN],

  // Keyform Positions (count_idx=10) — vertex XY pairs
  ['keyform_position.xys', ELEM.F32, COUNT_IDX.KEYFORM_POSITIONS, ALIGN],

  // Keyform Binding Indices (count_idx=11)
  ['keyform_binding_index.indices', ELEM.I32, COUNT_IDX.KEYFORM_BINDING_INDICES, ALIGN],

  // Keyform Binding Bands (count_idx=12)
  ['keyform_binding_band.begin_indices', ELEM.I32, COUNT_IDX.KEYFORM_BINDING_BANDS, ALIGN],
  ['keyform_binding_band.counts',        ELEM.I32, COUNT_IDX.KEYFORM_BINDING_BANDS, ALIGN],

  // Keyform Bindings (count_idx=13)
  ['keyform_binding.keys_begin_indices', ELEM.I32, COUNT_IDX.KEYFORM_BINDINGS, ALIGN],
  ['keyform_binding.keys_counts',        ELEM.I32, COUNT_IDX.KEYFORM_BINDINGS, ALIGN],

  // Keys (count_idx=14) — parameter values at keyform stops
  ['keys.values', ELEM.F32, COUNT_IDX.KEYS, ALIGN],

  // UVs (count_idx=15) — texture coordinates (XY pairs)
  ['uv.xys', ELEM.F32, COUNT_IDX.UVS, ALIGN],

  // Position Indices (count_idx=16) — triangle indices
  ['position_index.indices', ELEM.I16, COUNT_IDX.POSITION_INDICES, ALIGN],

  // Drawable Masks (count_idx=17)
  ['drawable_mask.art_mesh_indices', ELEM.I32, COUNT_IDX.DRAWABLE_MASKS, ALIGN],

  // Draw Order Groups (count_idx=18)
  ['draw_order_group.object_begin_indices',  ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.object_counts',         ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.object_total_counts',   ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.min_draw_orders',       ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.max_draw_orders',       ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],

  // Draw Order Group Objects (count_idx=19)
  ['draw_order_group_object.types',         ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS, ALIGN],
  ['draw_order_group_object.indices',       ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS, ALIGN],
  ['draw_order_group_object.group_indices', ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS, ALIGN],

  // Glues (count_idx=20)
  ['glue.runtime_space',               ELEM.RUNTIME, COUNT_IDX.GLUES, ALIGN],
  ['glue.ids',                         ELEM.STR64,   COUNT_IDX.GLUES, 0],
  ['glue.keyform_binding_band_indices', ELEM.I32,    COUNT_IDX.GLUES, ALIGN],
  ['glue.keyform_begin_indices',       ELEM.I32,     COUNT_IDX.GLUES, ALIGN],
  ['glue.keyform_counts',             ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.art_mesh_index_as',          ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.art_mesh_index_bs',          ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.info_begin_indices',         ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.info_counts',                ELEM.I32,      COUNT_IDX.GLUES, ALIGN],

  // Glue Infos (count_idx=21)
  ['glue_info.weights',          ELEM.F32, COUNT_IDX.GLUE_INFOS, ALIGN],
  ['glue_info.position_indices', ELEM.I16, COUNT_IDX.GLUE_INFOS, ALIGN],

  // Glue Keyforms (count_idx=22)
  ['glue_keyform.intensities', ELEM.F32, COUNT_IDX.GLUE_KEYFORMS, ALIGN],
];


// ---------------------------------------------------------------------------
// Binary writer helper
// ---------------------------------------------------------------------------

class BinaryWriter {
  constructor() {
    /** @type {number[]} */
    this._buf = [];
  }

  get pos() { return this._buf.length; }

  writeU8(v)  { this._buf.push(v & 0xFF); }
  writeI16(v) { const b = new ArrayBuffer(2); new DataView(b).setInt16(0, v, true); this._pushBytes(b); }
  writeI32(v) { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true); this._pushBytes(b); }
  writeU32(v) { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v, true); this._pushBytes(b); }
  writeF32(v) { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true); this._pushBytes(b); }

  writeI32Array(vals)  { for (const v of vals) this.writeI32(v); }
  writeU32Array(vals)  { for (const v of vals) this.writeU32(v); }
  writeF32Array(vals)  { for (const v of vals) this.writeF32(v); }
  writeI16Array(vals)  { for (const v of vals) this.writeI16(v); }
  writeU8Array(vals)   { for (const v of vals) this.writeU8(v); }
  writeBoolArray(vals) { for (const v of vals) this.writeI32(v ? 1 : 0); }

  writeString(s, fieldSize = STRING_FIELD_SIZE) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(s);
    if (encoded.length >= fieldSize) {
      throw new Error(`String "${s}" too long for ${fieldSize}-byte field`);
    }
    for (const byte of encoded) this._buf.push(byte);
    // Null-pad to fieldSize
    for (let i = encoded.length; i < fieldSize; i++) this._buf.push(0);
  }

  writeStringArray(vals) { for (const s of vals) this.writeString(s); }

  writeRuntime(count) {
    // Runtime space: zeroed bytes
    this.fill(count * RUNTIME_UNIT_SIZE);
  }

  fill(count, value = 0) {
    for (let i = 0; i < count; i++) this._buf.push(value);
  }

  padTo(alignment) {
    const rem = this._buf.length % alignment;
    if (rem !== 0) this.fill(alignment - rem);
  }

  /** Patch a uint32 value at a previously known position. */
  patchU32(offset, value) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, value, true);
    const bytes = new Uint8Array(b);
    for (let i = 0; i < 4; i++) this._buf[offset + i] = bytes[i];
  }

  toArrayBuffer() {
    return new Uint8Array(this._buf).buffer;
  }

  _pushBytes(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    for (const b of bytes) this._buf.push(b);
  }
}


// ---------------------------------------------------------------------------
// Data preparation — convert project data to moc3 section arrays
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Moc3Input
 * @property {object}  project      - projectStore.project snapshot
 * @property {Map<string, import('./textureAtlas.js').PackedRegion>} regions - Atlas regions
 * @property {number}  atlasSize    - Atlas dimension
 * @property {number}  numAtlases   - Number of texture atlas sheets
 */

/**
 * Build all section data arrays from project data.
 *
 * @param {Moc3Input} input
 * @returns {{ sections: Map<string, any[]>, counts: number[], canvas: object }}
 */
function buildSectionData(input) {
  const { project, regions, atlasSize, numAtlases } = input;

  const canvasW = project.canvas?.width ?? 800;
  const canvasH = project.canvas?.height ?? 600;

  const sections = new Map();
  const counts = new Array(COUNT_INFO_ENTRIES).fill(0);

  // Collect parts (groups → Live2D Parts)
  const groups = project.nodes.filter(n => n.type === 'group');
  // Always have at least one root part
  const partNodes = groups.length > 0 ? groups : [{ id: 'PartRoot', name: 'Root', parent: null, opacity: 1, visible: true }];

  // Collect art meshes (parts with meshes → Live2D ArtMeshes)
  const meshParts = project.nodes.filter(n =>
    n.type === 'part' && n.mesh && n.visible !== false && regions.has(n.id)
  );

  // Collect parameters
  const params = project.parameters ?? [];

  // Build Part ID → index map
  const partIdMap = new Map();
  partNodes.forEach((p, i) => partIdMap.set(p.id, i));

  // --- Counts ---
  const numParts = partNodes.length;
  const numArtMeshes = meshParts.length;
  const numParams = params.length > 0 ? params.length : 1; // At least 1 parameter (ParamOpacity)
  const numArtMeshKeyforms = numArtMeshes; // 1 keyform per mesh (default pose)
  const numPartKeyforms = numParts;

  // Compute UV and vertex counts
  //
  // IMPORTANT: Field names in .moc3 are COUNTERINTUITIVE (confirmed via Hiyori RE):
  //   art_mesh.vertex_counts       = FLAT TRIANGLE INDEX COUNT (mesh.triangles.length * 3)
  //   art_mesh.position_index_counts = RENDERING VERTEX COUNT (mesh.vertices.length)
  //   art_mesh.uv_begin_indices    = cumulative(position_index_counts * 2)
  //   art_mesh.position_index_begin_indices = cumulative(vertex_counts)
  //   counts[15] (UVS)             = sum(position_index_counts * 2)
  //   counts[16] (POSITION_INDICES) = sum(vertex_counts) = total flat indices
  //
  // In Hiyori: sum(vertex_counts) == counts[16] (POSITION_INDICES),
  //            uv_begin = cumul(position_index_counts * 2).
  // csmGetDrawableVertexCounts returns position_index_counts values.

  let totalUVs = 0;
  let totalFlatIndices = 0;
  let totalKeyformPositions = 0;

  const meshInfos = meshParts.map(part => {
    const mesh = part.mesh;
    // vertices is Array<{x, y}> — the rendering vertex count
    const renderVertCount = mesh.vertices ? mesh.vertices.length : 0;
    // triangles is Array<[i, j, k]> — flat index count = triangles * 3
    const flatIndexCount = mesh.triangles ? mesh.triangles.length * 3 : 0;

    const info = {
      renderVertCount,                          // → position_index_counts
      flatIndexCount,                           // → vertex_counts
      uvBeginIndex: totalUVs,                   // cumul(renderVertCount * 2)
      positionIndexBeginIndex: totalFlatIndices, // cumul(flatIndexCount)
      keyformPositionBeginIndex: totalKeyformPositions,
    };

    totalUVs += renderVertCount * 2;
    totalFlatIndices += flatIndexCount;
    totalKeyformPositions += renderVertCount * 2;

    return info;
  });

  counts[COUNT_IDX.PARTS] = numParts;
  counts[COUNT_IDX.ART_MESHES] = numArtMeshes;
  counts[COUNT_IDX.PARAMETERS] = numParams;
  counts[COUNT_IDX.PART_KEYFORMS] = numPartKeyforms;
  counts[COUNT_IDX.ART_MESH_KEYFORMS] = numArtMeshKeyforms;
  counts[COUNT_IDX.KEYFORM_POSITIONS] = totalKeyformPositions;
  counts[COUNT_IDX.UVS] = totalUVs;
  counts[COUNT_IDX.POSITION_INDICES] = totalFlatIndices;

  // Keyform bindings: 1 binding per mesh, null bands for parts.
  // SDK validator requires begin < total even when count=0, so we need real bindings.
  const numBands = numArtMeshes + numParts;
  counts[COUNT_IDX.KEYFORM_BINDINGS] = numArtMeshes;
  counts[COUNT_IDX.KEYFORM_BINDING_BANDS] = numBands;
  counts[COUNT_IDX.KEYFORM_BINDING_INDICES] = numArtMeshes;
  counts[COUNT_IDX.KEYS] = numArtMeshes;

  // Drawable masks: 1 dummy entry (SDK requires begin < total, can't use -1 with total=0)
  counts[COUNT_IDX.DRAWABLE_MASKS] = 1;

  // Draw order groups: 1 root group
  counts[COUNT_IDX.DRAW_ORDER_GROUPS] = 1;
  counts[COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS] = numArtMeshes;

  // --- Part sections ---
  sections.set('part.ids', partNodes.map(p => p.id));
  // Parts use null bands (count=0) at indices after the mesh bands
  sections.set('part.keyform_binding_band_indices', partNodes.map((_, j) => numArtMeshes + j));
  sections.set('part.keyform_begin_indices', partNodes.map((_, i) => i));
  sections.set('part.keyform_counts', partNodes.map(() => 1));
  sections.set('part.visibles', partNodes.map(p => p.visible !== false));
  sections.set('part.enables', partNodes.map(() => true));
  sections.set('part.parent_part_indices', partNodes.map(p => {
    if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
    return -1;
  }));

  // --- ArtMesh sections ---
  sections.set('art_mesh.ids', meshParts.map((p, i) => `ArtMesh${i}`));
  // Each mesh gets its own binding band (band i → mesh i)
  sections.set('art_mesh.keyform_binding_band_indices', meshParts.map((_, i) => i));
  sections.set('art_mesh.keyform_begin_indices', meshParts.map((_, i) => i));
  sections.set('art_mesh.keyform_counts', meshParts.map(() => 1));
  sections.set('art_mesh.visibles', meshParts.map(p => p.visible !== false));
  sections.set('art_mesh.enables', meshParts.map(() => true));
  sections.set('art_mesh.parent_part_indices', meshParts.map(p => {
    if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
    return 0; // default to first part
  }));
  sections.set('art_mesh.parent_deformer_indices', meshParts.map(() => -1)); // no deformers for MVP
  sections.set('art_mesh.texture_indices', meshParts.map(p => regions.get(p.id)?.atlasIndex ?? 0));
  sections.set('art_mesh.drawable_flags', meshParts.map(() => 4)); // flag 4 like Hiyori
  // COUNTERINTUITIVE: position_index_counts = render vertex count, vertex_counts = flat index count
  sections.set('art_mesh.position_index_counts', meshInfos.map(m => m.renderVertCount));
  sections.set('art_mesh.uv_begin_indices', meshInfos.map(m => m.uvBeginIndex));
  sections.set('art_mesh.position_index_begin_indices', meshInfos.map(m => m.positionIndexBeginIndex));
  sections.set('art_mesh.vertex_counts', meshInfos.map(m => m.flatIndexCount));
  sections.set('art_mesh.mask_begin_indices', meshParts.map(() => 0)); // valid index (not -1)
  sections.set('art_mesh.mask_counts', meshParts.map(() => 0));

  // --- Parameter sections ---
  const paramList = params.length > 0
    ? params
    : [{ id: 'ParamOpacity', min: 0, max: 1, default: 1 }];

  sections.set('parameter.ids', paramList.map(p => p.id));
  sections.set('parameter.max_values', paramList.map(p => p.max ?? 1));
  sections.set('parameter.min_values', paramList.map(p => p.min ?? 0));
  sections.set('parameter.default_values', paramList.map(p => p.default ?? 0));
  sections.set('parameter.repeats', paramList.map(() => false));
  sections.set('parameter.decimal_places', paramList.map(() => 1));
  // First parameter owns all mesh bindings
  sections.set('parameter.keyform_binding_begin_indices', paramList.map((_, i) => i === 0 ? 0 : 0));
  sections.set('parameter.keyform_binding_counts', paramList.map((_, i) => i === 0 ? numArtMeshes : 0));

  // --- Part Keyform sections ---
  // Draw orders: all 500.0 (Hiyori pattern — actual order via draw_order_group_object)
  sections.set('part_keyform.draw_orders', partNodes.map(() => 500.0));

  // --- ArtMesh Keyform sections ---
  sections.set('art_mesh_keyform.opacities', meshParts.map(p => p.opacity ?? 1));
  sections.set('art_mesh_keyform.draw_orders', meshParts.map(() => 500.0));
  sections.set('art_mesh_keyform.keyform_position_begin_indices', meshInfos.map(m => m.keyformPositionBeginIndex));

  // --- Keyform positions (vertex coordinates in normalized model space) ---
  // Cubism SDK returns positions to Ren'Py which then multiplies by PPU in the shader:
  //   gl_Position = a_position.xy * u_live2d_ppu
  // So positions must be stored NORMALIZED: (pixelPos - origin) / PPU
  // This way position * PPU reconstructs pixel-space coordinates.
  // TRAPDOOR: canvasW/canvasH are declared at top of buildSectionData().
  // The `canvas` object is declared BELOW — never reference it here.
  // See docs/live2d-export/DECISIONS.md — this caused two identical crashes.
  const ppu = Math.max(canvasW, canvasH);
  const originX = canvasW / 2;
  const originY = canvasH / 2;
  const allKeyformPositions = [];
  for (const part of meshParts) {
    if (part.mesh?.vertices) {
      for (const vert of part.mesh.vertices) {
        allKeyformPositions.push((vert.x - originX) / ppu);
        allKeyformPositions.push((vert.y - originY) / ppu);
      }
    }
  }
  sections.set('keyform_position.xys', allKeyformPositions);

  // --- Keyform binding system ---
  // Each mesh gets 1 binding. Parts get null bands (count=0, begin=0).
  // SDK validator requires begin < total even when count=0.
  const bandBegins = [];
  const bandCounts = [];
  // Mesh bands: band i has count=1, begin=i
  for (let i = 0; i < numArtMeshes; i++) {
    bandBegins.push(i);
    bandCounts.push(1);
  }
  // Part bands: null bands (count=0, begin=0 so begin < total)
  for (let i = 0; i < numParts; i++) {
    bandBegins.push(0); // must be < numArtMeshes (total binding indices)
    bandCounts.push(0);
  }
  sections.set('keyform_binding_band.begin_indices', bandBegins);
  sections.set('keyform_binding_band.counts', bandCounts);

  // Binding indices: direct mapping (index i → binding i)
  sections.set('keyform_binding_index.indices',
    Array.from({ length: numArtMeshes }, (_, i) => i));

  // Bindings: each has 1 key at parameter default value
  sections.set('keyform_binding.keys_begin_indices',
    Array.from({ length: numArtMeshes }, (_, i) => i));
  sections.set('keyform_binding.keys_counts',
    Array.from({ length: numArtMeshes }, () => 1));

  // Keys: all at first parameter's default value
  const paramDefault = paramList[0]?.default ?? 0;
  sections.set('keys.values',
    Array.from({ length: numArtMeshes }, () => paramDefault));

  // --- Drawable masks (1 dummy entry) ---
  sections.set('drawable_mask.art_mesh_indices', [-1]);

  // --- UV data ---
  const allUVs = [];
  for (let mi = 0; mi < meshParts.length; mi++) {
    const part = meshParts[mi];
    const mesh = part.mesh;
    const region = regions.get(part.id);
    if (mesh.uvs && region) {
      // Remap UVs from full-PSD space to atlas space.
      // UV is normalized to full source image (0..1 over srcWidth × srcHeight).
      // 1. Convert UV to source pixel: srcPx = uv * srcSize
      // 2. Offset from crop origin: cropLocal = srcPx - cropOrigin
      // 3. Scale to atlas region: atlasLocal = cropLocal / cropSize * regionSize
      // 4. Add atlas position and normalize: finalUV = (regionPos + atlasLocal) / atlasSize
      for (let i = 0; i < mesh.uvs.length; i += 2) {
        const srcPxX = mesh.uvs[i] * region.srcWidth;
        const srcPxY = mesh.uvs[i + 1] * region.srcHeight;
        const localX = (srcPxX - region.srcX) / region.cropW * region.width;
        const localY = (srcPxY - region.srcY) / region.cropH * region.height;
        // Clamp to [0, 1] — mesh vertices can extend slightly outside crop
        // due to 2px dilation in mesh generation (contour.js)
        allUVs.push(Math.max(0, Math.min(1, (region.x + localX) / atlasSize)));
        allUVs.push(Math.max(0, Math.min(1, (region.y + localY) / atlasSize)));
      }
    }
  }
  sections.set('uv.xys', allUVs);

  // --- Position indices (triangle indices) ---
  const allIndices = [];
  for (const part of meshParts) {
    if (part.mesh?.triangles) {
      // triangles is Array<[i, j, k]> — flatten to flat index list
      for (const tri of part.mesh.triangles) {
        allIndices.push(tri[0], tri[1], tri[2]);
      }
    }
  }
  sections.set('position_index.indices', allIndices);

  // --- Draw order groups (Hiyori pattern) ---
  sections.set('draw_order_group.object_begin_indices', [0]);
  sections.set('draw_order_group.object_counts', [numArtMeshes]);
  sections.set('draw_order_group.object_total_counts', [numArtMeshes]);
  sections.set('draw_order_group.min_draw_orders', [1000]);
  sections.set('draw_order_group.max_draw_orders', [200]);

  // --- Draw order group objects ---
  // Render order: reverse of draw_order (highest draw_order = rendered first = behind)
  sections.set('draw_order_group_object.types', meshParts.map(() => 0)); // 0 = ArtMesh
  sections.set('draw_order_group_object.indices',
    meshParts.map((_, i) => numArtMeshes - 1 - i));
  sections.set('draw_order_group_object.group_indices', meshParts.map(() => -1)); // -1 like Hiyori

  // --- Canvas info ---
  // WARNING: `canvas` is declared late. All code above MUST use canvasW/canvasH
  // (declared at top of buildSectionData), NOT canvas.* — JS const is not hoisted.
  // This caused two identical "Cannot access before initialization" crashes.
  const canvas = {
    pixelsPerUnit: Math.max(canvasW, canvasH),
    originX: canvasW / 2,
    originY: canvasH / 2,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    canvasFlag: 0,
  };

  return { sections, counts, canvas };
}


// ---------------------------------------------------------------------------
// Main writer
// ---------------------------------------------------------------------------

/**
 * Generate a .moc3 binary ArrayBuffer from project data.
 *
 * @param {Moc3Input} input
 * @returns {ArrayBuffer}
 */
export function generateMoc3(input) {
  const { sections, counts, canvas } = buildSectionData(input);

  // V4.00 matches Hiyori reference — confirmed working with Ren'Py 8.5 Cubism SDK
  const version = MOC_VERSION.V4_00;

  // Phase 1: Write body sections, record offsets
  const body = new BinaryWriter();
  const sotEntries = [];

  // SOT[0] — Count Info
  sotEntries.push(DEFAULT_OFFSET + body.pos);
  for (const c of counts) body.writeI32(c);
  // Pad to COUNT_INFO_SIZE
  body.fill(COUNT_INFO_SIZE - counts.length * 4);

  // SOT[1] — Canvas Info
  sotEntries.push(DEFAULT_OFFSET + body.pos);
  body.writeF32(canvas.pixelsPerUnit);
  body.writeF32(canvas.originX);
  body.writeF32(canvas.originY);
  body.writeF32(canvas.canvasWidth);
  body.writeF32(canvas.canvasHeight);
  body.writeU8(canvas.canvasFlag);
  body.fill(CANVAS_INFO_SIZE - (5 * 4 + 1));

  // SOT[2..] — Body sections
  for (const [name, elemType, countIdx, alignment] of SECTION_LAYOUT) {
    // Align if needed
    if (alignment > 0) body.padTo(alignment);

    sotEntries.push(DEFAULT_OFFSET + body.pos);

    const data = sections.get(name) ?? [];
    const count = elemType === ELEM.RUNTIME
      ? (countIdx >= 0 ? counts[countIdx] : 0)
      : data.length;

    writeSection(body, elemType, data, count);
  }

  // V3.03+ additional section: quad_transforms (Bool32 per warp deformer).
  // For V4.00, this is section 100 → SOT[101]. Even with 0 warp deformers,
  // the SDK requires this SOT entry to be a valid (non-zero) offset.
  if (version >= MOC_VERSION.V3_03) {
    body.padTo(ALIGN);
    sotEntries.push(DEFAULT_OFFSET + body.pos);
    // quad_transforms: count = WARP_DEFORMERS (0 for our models), no data written
  }

  // Phase 2: Assemble header + SOT + padding + body
  const out = new BinaryWriter();

  // Header (64 bytes)
  out.writeU8(MAGIC[0]); out.writeU8(MAGIC[1]); out.writeU8(MAGIC[2]); out.writeU8(MAGIC[3]);
  out.writeU8(version);  // version
  out.writeU8(0);        // endian flag (0 = LE)
  out.fill(HEADER_SIZE - 6); // padding

  // SOT (160 x uint32) — fill remaining with the last valid offset (not 0!)
  // SDK validates that SOT entries for the current version are non-zero valid offsets.
  const lastValidOffset = sotEntries[sotEntries.length - 1] || DEFAULT_OFFSET;
  while (sotEntries.length < SOT_COUNT) sotEntries.push(lastValidOffset);
  out.writeU32Array(sotEntries.slice(0, SOT_COUNT));

  // Pad to DEFAULT_OFFSET
  out.fill(DEFAULT_OFFSET - out.pos);

  // Append body
  const bodyBuf = body.toArrayBuffer();
  const bodyBytes = new Uint8Array(bodyBuf);
  for (const b of bodyBytes) out.writeU8(b);

  // Final 64-byte alignment.
  // All SOT entries now point to valid offsets (filled with lastValidOffset above).
  // SDK requires SOT offsets <= file_size, so we pad to ensure the file extends
  // past the last referenced offset.
  out.padTo(ALIGN);

  return out.toArrayBuffer();
}

/**
 * Write a single section's data.
 *
 * @param {BinaryWriter} w
 * @param {object} elemType - One of the ELEM constants
 * @param {any[]} data
 * @param {number} count
 */
function writeSection(w, elemType, data, count) {
  if (elemType === ELEM.RUNTIME) {
    w.fill(count * RUNTIME_UNIT_SIZE);
  } else if (elemType === ELEM.I32) {
    w.writeI32Array(data);
  } else if (elemType === ELEM.F32) {
    w.writeF32Array(data);
  } else if (elemType === ELEM.I16) {
    w.writeI16Array(data);
  } else if (elemType === ELEM.U8) {
    w.writeU8Array(data);
  } else if (elemType === ELEM.BOOL) {
    w.writeBoolArray(data);
  } else if (elemType === ELEM.STR64) {
    w.writeStringArray(data);
  }
}
