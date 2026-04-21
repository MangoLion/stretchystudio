// Smoke test for Session 29 physics emission.
//
// Two checks:
//   1. Direct XML emission: build a CModelSource with emitPhysicsSettings and
//      verify the generated XML fragment matches Hiyori's reference structure.
//   2. Full generateCmo3 run with tagged meshes, to catch any integration
//      issues (param resolution, rigDebugLog wiring, option plumbing).
//
// Run: node scripts/verify_physics.mjs

import { XmlBuilder } from '../src/io/live2d/xmlbuilder.js';
import { emitPhysicsSettings, PHYSICS_RULES } from '../src/io/live2d/cmo3/physics.js';
import { generateCmo3 } from '../src/io/live2d/cmo3writer.js';
import { IMPORT_PIS, VERSION_PIS } from '../src/io/live2d/cmo3/constants.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failed++; }
}

// ────────────────────────── TEST 1: direct XML emission ──────────────────────────
console.log('[test1] Direct XML emission via emitPhysicsSettings()');

const x1 = new XmlBuilder();
const [root] = x1.shared('CModelSource');
const paramDefs = [
  { pid: 'pid-hair-front', id: 'ParamHairFront' },
  { pid: 'pid-hair-back',  id: 'ParamHairBack' },
  { pid: 'pid-skirt',      id: 'ParamSkirt' },
  { pid: 'pid-angle-x',    id: 'ParamAngleX' },
  { pid: 'pid-angle-z',    id: 'ParamAngleZ' },
  { pid: 'pid-body-x',     id: 'ParamBodyAngleX' },
  { pid: 'pid-body-z',     id: 'ParamBodyAngleZ' },
];
const meshes = [
  { tag: 'front hair' }, { tag: 'back hair' }, { tag: 'bottomwear' },
];
const rigDebugLog = {};
const res = emitPhysicsSettings(x1, {
  parent: root, paramDefs, meshes, rigDebugLog,
});

assert(res.emittedCount === 3, 'emitted 3 rules (hair front, hair back, skirt)');
assert(res.skipped.length === 0, 'no skipped rules when all tags + params present');
assert(rigDebugLog.physics !== undefined, 'rigDebugLog.physics populated');

const xml1 = x1.serialize(root);
assert(xml1.includes('<CPhysicsSettingsSourceSet'), 'root has CPhysicsSettingsSourceSet');
assert(xml1.includes('count="3"'), 'carray_list count="3"');
for (const r of PHYSICS_RULES) {
  assert(xml1.includes(`idstr="${r.id}"`), `${r.id} (${r.name}) emitted`);
  assert(xml1.includes(`<s xs.n="name">${r.name}</s>`), `name "${r.name}" emitted`);
}

// selectedCubismPhysics + settingFPS tails
assert(xml1.includes('xs.n="selectedCubismPhysics"'), 'selectedCubismPhysics emitted');
assert(xml1.includes('<null xs.n="settingFPS"'), 'settingFPS null placeholder');

// Hiyori shape: each setting has inputs > outputs > vertices > normalization
// Split on the leaf tag (with trailing `>`), NOT the container "SourceSet"
const settingBlocks = xml1.split('<CPhysicsSettingsSource>').slice(1);
assert(settingBlocks.length === 3, `exactly 3 CPhysicsSettingsSource blocks (got ${settingBlocks.length})`);
for (const b of settingBlocks) {
  assert(b.includes('xs.n="inputs"'), 'has inputs array');
  assert(b.includes('xs.n="outputs" count="1"'), 'has outputs count=1');
  assert(b.includes('xs.n="vertices"'), 'has vertices array');
  assert(b.includes('normalizedPositionValueMax'), 'has position normalization');
  assert(b.includes('normalizedAngleValueMax'), 'has angle normalization');
}

// Output vertex index 1 (tip of 2-vertex pendulum)
const vertexIdxMatches = xml1.match(/<i xs\.n="vertexIndex">(\d+)<\/i>/g) || [];
assert(vertexIdxMatches.length === 3 && vertexIdxMatches.every(m => m.includes('>1<')),
  '3 outputs all target vertex index 1 (tip)');

// CPhysicsVertex count: 2 per rule × 3 rules = 6
const vxDecl = xml1.match(/<CPhysicsVertex>/g) || [];
assert(vxDecl.length === 6, `6 CPhysicsVertex declarations (got ${vxDecl.length})`);

// ────────────────── TEST 2: skipping when output param absent ──────────────────
console.log('\n[test2] Rules skip when output param is missing');
const x2 = new XmlBuilder();
const [root2] = x2.shared('CModelSource');
const res2 = emitPhysicsSettings(x2, {
  parent: root2,
  paramDefs: [
    { pid: 'p-x',  id: 'ParamAngleX' },
    { pid: 'p-z',  id: 'ParamAngleZ' },
    { pid: 'p-bx', id: 'ParamBodyAngleX' },
    { pid: 'p-bz', id: 'ParamBodyAngleZ' },
    // NO ParamHairFront / ParamHairBack / ParamSkirt
  ],
  meshes: [{ tag: 'front hair' }, { tag: 'back hair' }, { tag: 'bottomwear' }],
});
assert(res2.emittedCount === 0, 'no rules emitted without output params');
assert(res2.skipped.length === 3, 'all 3 rules skipped');
assert(res2.skipped.every(s => s.reason.startsWith('missing output param')),
  'skip reasons are "missing output param …"');

// ────────────────── TEST 3: skipping when mesh tag absent ──────────────────
console.log('\n[test3] Rules skip when required mesh tag is absent');
const x3 = new XmlBuilder();
const [root3] = x3.shared('CModelSource');
const res3 = emitPhysicsSettings(x3, {
  parent: root3, paramDefs, meshes: [{ tag: 'face' }, { tag: 'neck' }],
});
assert(res3.emittedCount === 0, 'no rules when no required tags present');
assert(res3.skipped.every(s => s.reason.startsWith('no mesh with tag')),
  'skip reasons are "no mesh with tag …"');

// ────────────────── TEST 4: full generateCmo3 integration ──────────────────
console.log('\n[test4] Full generateCmo3 smoke: physics path runs end-to-end');

const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 252, 255, 255, 63, 0, 5,
  254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174,
  66, 96, 130,
]);

function mkMesh(name, tag, cx, cy, w, h) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  return {
    name, tag, partId: name,
    vertices: new Float32Array([x0, y0, x1, y0, x0, y1, x1, y1]),
    triangles: [0, 1, 2, 2, 1, 3],
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    pngData: TINY_PNG,
    pngPath: `${name}.png`,
    origin: { x: cx, y: cy },
  };
}

const fullMeshes = [
  mkMesh('Face',       'face',       500, 300, 200, 280),
  mkMesh('FrontHair',  'front hair', 500, 220, 260, 200),
  mkMesh('BackHair',   'back hair',  500, 350, 300, 400),
  mkMesh('Neck',       'neck',       500, 600, 100, 100),
  mkMesh('Topwear',    'topwear',    500, 800, 400, 300),
  mkMesh('Bottomwear', 'bottomwear', 500, 1050, 350, 250),
];

const out = await generateCmo3({
  canvasW: 1000, canvasH: 1500, meshes: fullMeshes, groups: [],
  modelName: 'PhysicsTest', generateRig: true,
});
assert(out.cmo3 instanceof Uint8Array && out.cmo3.byteLength > 1000,
  `generateCmo3 returned a sensible .cmo3 (${out.cmo3.byteLength} bytes)`);
assert(out.rigDebugLog?.physics?.emittedCount === 3,
  `rigDebugLog.physics.emittedCount = 3 (got ${out.rigDebugLog?.physics?.emittedCount})`);
assert(Array.isArray(out.rigDebugLog?.physics?.emittedIds)
  && out.rigDebugLog.physics.emittedIds.includes('PhysicsSetting1')
  && out.rigDebugLog.physics.emittedIds.includes('PhysicsSetting2')
  && out.rigDebugLog.physics.emittedIds.includes('PhysicsSetting3'),
  'all 3 setting IDs present in rigDebugLog');

// ────────────────── TEST 5: generatePhysics=false gates off ──────────────────
console.log('\n[test5] generatePhysics=false suppresses physics set');
const out2 = await generateCmo3({
  canvasW: 1000, canvasH: 1500, meshes: fullMeshes, groups: [],
  modelName: 'NoPhysics', generateRig: true, generatePhysics: false,
});
assert(out2.rigDebugLog?.physics === undefined,
  'rigDebugLog.physics absent when generatePhysics=false');

// ────────────────── TEST 6: import PIs include all physics classes ──────────────
console.log('\n[test6] IMPORT_PIS registers all 9 physics classes');
const needed = [
  'com.live2d.cubism.doc.gameData.physics.CPhysicsController$CPhysicsSourceType',
  'com.live2d.cubism.doc.gameData.physics.CPhysicsInput',
  'com.live2d.cubism.doc.gameData.physics.CPhysicsOutput',
  'com.live2d.cubism.doc.gameData.physics.CPhysicsSettingsSource',
  'com.live2d.cubism.doc.gameData.physics.CPhysicsSettingsSourceSet',
  'com.live2d.cubism.doc.gameData.physics.CPhysicsVertex',
  'com.live2d.cubism.doc.model.id.CPhysicsSettingId',
  'com.live2d.type.CPhysicsDataGuid',
  'com.live2d.type.CPhysicsSettingsGuid',
];
for (const imp of needed) {
  assert(IMPORT_PIS.includes(imp), `IMPORT_PIS has ${imp}`);
}

// VERSION_PIS unchanged
assert(Array.isArray(VERSION_PIS) && VERSION_PIS.length === 9,
  `VERSION_PIS unchanged (${VERSION_PIS.length} entries)`);

console.log('\n──────────────────────────────────────────────');
console.log(failed === 0 ? '[verify] ALL CHECKS PASSED ✓' : `[verify] ${failed} CHECKS FAILED ✗`);
process.exit(failed === 0 ? 0 : 1);
