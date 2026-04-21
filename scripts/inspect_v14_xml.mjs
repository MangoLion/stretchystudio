// Extract main.xml from a just-built cmo3 and verify the v14 end-of-CModelSource
// block has all required fields in the right order.
//
// Run: node scripts/inspect_v14_xml.mjs

import { generateCmo3 } from '../src/io/live2d/cmo3writer.js';
import { strict as assert } from 'node:assert';

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

// Monkey-patch XmlBuilder.serialize to grab the XML string before packing
import { XmlBuilder } from '../src/io/live2d/xmlbuilder.js';
const origSerialize = XmlBuilder.prototype.serialize;
let capturedXml = null;
XmlBuilder.prototype.serialize = function (...args) {
  const result = origSerialize.apply(this, args);
  capturedXml = result;
  return result;
};

console.log('[inspect] Running generateCmo3 with hair + bottomwear meshes...');
await generateCmo3({
  canvasW: 1000, canvasH: 1500,
  meshes: [
    mkMesh('Face',       'face',       500, 300, 200, 280),
    mkMesh('FrontHair',  'front hair', 500, 220, 260, 200),
    mkMesh('BackHair',   'back hair',  500, 350, 300, 400),
    mkMesh('Bottomwear', 'bottomwear', 500, 1050, 350, 250),
  ],
  groups: [],
  modelName: 'V14Test',
  generateRig: true,
});

assert.ok(capturedXml, 'captured XML');
console.log('[inspect] XML length:', capturedXml.length);

let failed = 0;
function check(ok, msg) {
  if (ok) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failed++; }
}

// 1. CModelSource version bump
check(capturedXml.includes('<?version CModelSource:14?>'), 'CModelSource:14 version PI');

// 2. Physics block comes BEFORE rootPart ref
const physicsIdx = capturedXml.indexOf('<CPhysicsSettingsSourceSet');
const rootPartIdx = capturedXml.indexOf('<CPartSource xs.n="rootPart"');
check(physicsIdx > 0 && rootPartIdx > physicsIdx,
  'CPhysicsSettingsSourceSet placed before rootPart ref');

// 3. Physics contains our 2 or 3 settings (depending on tag coverage)
const physicsCount = (capturedXml.match(/<CPhysicsSettingsSource>/g) || []).length;
check(physicsCount === 3,
  `physics count = 3 (hair front + hair back + skirt; got ${physicsCount})`);

// 4. v14 required end-of-CModelSource fields — presence + order
const fieldsInOrder = [
  '<CParameterGroupSet xs.n="parameterGroupSet"',
  '<CParameterGroup xs.n="rootParameterGroup"',
  '<CModelInfo xs.n="modelInfo"',
  '<CEffectParameterGroups xs.n="_effectParameterGroups"',
  '<hash_map xs.n="modelOptions"',
  '<CImageIcon xs.n="_icon64"',
  '<CImageIcon xs.n="_icon32"',
  '<CImageIcon xs.n="_icon16"',
  '<CGameMotionSet xs.n="gameMotionSet"',
  '<ModelViewerSetting xs.n="modelViewerSetting"',
  '<CGuidesSetting xs.n="guides"',
  'xs.n="targetVersionNo"',
  'xs.n="latestVersionOfLastModelerNo"',
  '<CArtPathBrushSetting xs.n="artPathBrushesSetting"',
  '<CRandomPoseSettingManager xs.n="randomPoseSetting"',
];
let cursor = 0;
for (const field of fieldsInOrder) {
  const idx = capturedXml.indexOf(field, cursor);
  if (idx < 0) {
    check(false, `field present & after cursor: ${field} (NOT FOUND)`);
  } else {
    check(true, `${field} at index ${idx}`);
    cursor = idx;
  }
}

// 5. Root parameter group populated with children = paramDefs count
const childCountMatch = capturedXml.match(/<carray_list xs\.n="_childGuids" count="(\d+)">\s*<CParameterGuid/);
check(childCountMatch !== null,
  `root param group has populated _childGuids (${childCountMatch?.[1]} children)`);

// 6. Import PIs include all physics + v14 classes
const neededImports = [
  'com.live2d.cubism.doc.gameData.physics.CPhysicsSettingsSourceSet',
  'com.live2d.cubism.doc.gameData.motions.CGameMotionSet',
  'com.live2d.cubism.doc.model.CEffectParameterGroups',
  'com.live2d.cubism.doc.model.randomPose.CRandomPoseSettingManager',
  'com.live2d.cubism.doc.modeling.ui.guide.CGuidesSetting',
  'com.live2d.cubism.doc.modeling.ui.viewer.ModelViewerSetting',
  'com.live2d.cubism.doc.model.drawable.artPath.Line.CArtPathBrushSetting',
];
for (const imp of neededImports) {
  check(capturedXml.includes(`<?import ${imp}?>`), `import ${imp}`);
}

console.log('');
console.log(failed === 0 ? '[inspect] ALL CHECKS PASSED ✓' : `[inspect] ${failed} CHECKS FAILED ✗`);
process.exit(failed === 0 ? 0 : 1);
