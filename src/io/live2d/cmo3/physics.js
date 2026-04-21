/**
 * Physics emitter for .cmo3 export.
 *
 * Writes a `CPhysicsSettingsSourceSet` under the CModelSource root — the same
 * block Cubism Editor uses to store pendulum simulations. Each setting maps
 * a chain of input parameters (head/body angles) through a 2-vertex pendulum
 * onto one output parameter, producing lagged/damped motion.
 *
 * The runtime derives `.physics3.json` from this block when the user exports
 * for the SDK. The cmo3 authoring format is the source of truth.
 *
 * Rule → wire correspondence: physics only causes VISIBLE motion when the
 * output parameter already has a warp / rotation deformer keyformed on it.
 * We ship rules only for outputs with existing warp bindings in cmo3writer:
 *   - ParamHairFront (warped by the 'front hair' tag entry in TAG_PARAM_BINDINGS)
 *   - ParamHairBack  ('back hair')
 *   - ParamSkirt     (new — matching warp binding added in cmo3writer's
 *                     TAG_PARAM_BINDINGS for the 'bottomwear' tag)
 *
 * Extra rules can be appended to PHYSICS_RULES; each is automatically skipped
 * if its output parameter isn't present in the project (paramDefs) or if no
 * mesh carries its `requireTag`.
 *
 * Reverse-engineered from reference/live2d-sample/Hiyori/cmo3_extracted/main.xml
 * lines 128753–130446. Parameter guids and types match Hiyori's numbers so the
 * default feel is close to Cubism's sample-model tuning.
 *
 * @module io/live2d/cmo3/physics
 */

import { uuid } from '../xmlbuilder.js';

/**
 * Format a float so integers get a trailing `.0`, matching Hiyori's XML
 * where `<f>` values are always written with at least one decimal. Java
 * accepts both forms, but matching the reference keeps diffs readable.
 */
function f(n) {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/**
 * @typedef {Object} PhysicsInputSpec
 * @property {string} paramId - Source parameter ID (must exist in paramDefs)
 * @property {'SRC_TO_X'|'SRC_TO_Y'|'SRC_TO_G_ANGLE'} type
 * @property {number} weight - 0..100
 * @property {boolean} [isReverse=false]
 */

/**
 * @typedef {Object} PhysicsVertexSpec
 * @property {number} x
 * @property {number} y
 * @property {number} mobility - 0..1, how much this vertex swings vs stays put
 * @property {number} delay    - 0..1, phase lag
 * @property {number} acceleration - typically 1.0..2.0
 * @property {number} radius
 */

/**
 * @typedef {Object} PhysicsRule
 * @property {string} id        - Editor ID (e.g. "PhysicsSetting1")
 * @property {string} name      - Human-readable name
 * @property {string} outputParamId - Destination parameter ID
 * @property {number} outputScale   - Max angle (degrees) produced at full swing
 * @property {string|null} requireTag - Skip rule if no mesh has this tag (null = always emit)
 * @property {PhysicsInputSpec[]} inputs
 * @property {PhysicsVertexSpec[]} vertices - typically 2 (root + tip)
 * @property {{posMin:number,posMax:number,posDef:number,angleMin:number,angleMax:number,angleDef:number}} normalization
 */

/** @type {PhysicsRule[]} */
export const PHYSICS_RULES = [
  // ── Hair Front: short strand, follows head yaw/tilt + slight body lean ──
  // Warp binding: cmo3writer TAG_PARAM_BINDINGS['front hair'] sways tips on
  // ±1. Pendulum length=3 (Hiyori default for front strands).
  {
    id: 'PhysicsSetting1',
    name: 'Hair Front',
    outputParamId: 'ParamHairFront',
    outputScale: 1.522,
    requireTag: 'front hair',
    inputs: [
      { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60 },
      { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60 },
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0,  delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 3,  mobility: 0.95, delay: 0.9, acceleration: 1.5, radius: 3 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },

  // ── Hair Back: longer strand, dominant body-angle driver ──
  // Warp binding: TAG_PARAM_BINDINGS['back hair']. Pendulum length=15 — long
  // back hair has much longer lag than front strands.
  {
    id: 'PhysicsSetting2',
    name: 'Hair Back',
    outputParamId: 'ParamHairBack',
    outputScale: 2.061,
    requireTag: 'back hair',
    inputs: [
      { paramId: 'ParamAngleX',     type: 'SRC_TO_X',       weight: 60 },
      { paramId: 'ParamAngleZ',     type: 'SRC_TO_G_ANGLE', weight: 60 },
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 40 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 40 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0,  delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 15, mobility: 0.95, delay: 0.8, acceleration: 1.5, radius: 15 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -30, angleDef: 0, angleMax: 30,
    },
  },

  // ── Skirt sway: hem swings with body lean ──
  // Warp binding: TAG_PARAM_BINDINGS['bottomwear'] — bottom (hem) row sways
  // ±1 while waist row stays pinned. Body-only drivers (hair doesn't drive
  // skirt; skirt is attached to body, not head).
  {
    id: 'PhysicsSetting3',
    name: 'Skirt',
    outputParamId: 'ParamSkirt',
    outputScale: 1.434,
    requireTag: 'bottomwear',
    inputs: [
      { paramId: 'ParamBodyAngleX', type: 'SRC_TO_X',       weight: 100 },
      { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 },
    ],
    vertices: [
      { x: 0, y: 0,  mobility: 1.0, delay: 1.0, acceleration: 1.0, radius: 0 },
      { x: 0, y: 10, mobility: 0.9, delay: 0.6, acceleration: 1.5, radius: 10 },
    ],
    normalization: {
      posMin: -10, posDef: 0, posMax: 10,
      angleMin: -10, angleDef: 0, angleMax: 10,
    },
  },
];

/**
 * Emit a `CPhysicsSettingsSourceSet` into `parent`.
 *
 * @param {import('../xmlbuilder.js').XmlBuilder} x
 * @param {Object} ctx
 * @param {Object} ctx.parent          - XML node to append the set to (usually `model`)
 * @param {Array<{pid:string,id:string}>} ctx.paramDefs - From generateCmo3
 * @param {Iterable<{tag:string|null}>} ctx.meshes      - For requireTag gating
 * @param {Object|null} [ctx.rigDebugLog]               - Optional diagnostic sink
 * @returns {{emittedCount:number, skipped:Array<{id:string,reason:string}>}}
 */
export function emitPhysicsSettings(x, { parent, paramDefs, meshes, rigDebugLog = null }) {
  const pidByParamId = new Map();
  for (const p of paramDefs) pidByParamId.set(p.id, p.pid);

  const tagsPresent = new Set();
  for (const m of meshes || []) {
    if (m && m.tag) tagsPresent.add(m.tag);
  }

  const rulesToEmit = [];
  const skipped = [];
  for (const rule of PHYSICS_RULES) {
    const outputPid = pidByParamId.get(rule.outputParamId);
    if (!outputPid) {
      skipped.push({ id: rule.id, reason: `missing output param ${rule.outputParamId}` });
      continue;
    }
    // All input parameters must exist — skip rules with dangling refs.
    const missingInput = rule.inputs.find(inp => !pidByParamId.has(inp.paramId));
    if (missingInput) {
      skipped.push({ id: rule.id, reason: `missing input param ${missingInput.paramId}` });
      continue;
    }
    if (rule.requireTag && !tagsPresent.has(rule.requireTag)) {
      skipped.push({ id: rule.id, reason: `no mesh with tag '${rule.requireTag}'` });
      continue;
    }
    rulesToEmit.push({ rule, outputPid });
  }

  const set = x.sub(parent, 'CPhysicsSettingsSourceSet', { 'xs.n': 'physicsSettingsSourceSet' });
  const list = x.sub(set, 'carray_list', {
    'xs.n': '_sourceCubismPhysics', count: String(rulesToEmit.length),
  });

  for (const { rule, outputPid } of rulesToEmit) {
    emitOneSetting(x, list, rule, outputPid, pidByParamId);
  }

  // `selectedCubismPhysics` is the Editor's "current selection" state; Hiyori
  // emits a fresh uuid that doesn't match any setting guid. Safe to mint a
  // random one — the field isn't referenced elsewhere in the model tree.
  x.sub(set, 'CPhysicsSettingsGuid', {
    'xs.n': 'selectedCubismPhysics',
    uuid: uuid(),
    note: 'physics-selection',
  });
  x.sub(set, 'null', { 'xs.n': 'settingFPS' });

  if (rigDebugLog) {
    rigDebugLog.physics = {
      emittedCount: rulesToEmit.length,
      emittedIds: rulesToEmit.map(r => r.rule.id),
      skipped,
    };
  }

  return { emittedCount: rulesToEmit.length, skipped };
}

/** Emit a single CPhysicsSettingsSource node into `list`. */
function emitOneSetting(x, list, rule, outputPid, pidByParamId) {
  const src = x.sub(list, 'CPhysicsSettingsSource');
  x.sub(src, 's', { 'xs.n': 'name' }).text = rule.name;
  x.sub(src, 'CPhysicsSettingsGuid', {
    'xs.n': 'guid', uuid: uuid(), note: rule.name,
  });
  x.sub(src, 'CPhysicsSettingId', { 'xs.n': 'id', idstr: rule.id });

  // ── Inputs ──
  const inputsNode = x.sub(src, 'carray_list', {
    'xs.n': 'inputs', count: String(rule.inputs.length),
  });
  for (const inp of rule.inputs) {
    const inpNode = x.sub(inputsNode, 'CPhysicsInput');
    x.sub(inpNode, 'CPhysicsDataGuid', {
      'xs.n': 'guid', uuid: uuid(), note: `in_${rule.id}_${inp.paramId}`,
    });
    x.subRef(inpNode, 'CParameterGuid', pidByParamId.get(inp.paramId), { 'xs.n': 'source' });
    x.sub(inpNode, 'f', { 'xs.n': 'angleScale' }).text = '0.0';
    const ts = x.sub(inpNode, 'GVector2', { 'xs.n': 'translationScale' });
    x.sub(ts, 'f', { 'xs.n': 'x' }).text = '0.0';
    x.sub(ts, 'f', { 'xs.n': 'y' }).text = '0.0';
    x.sub(inpNode, 'f', { 'xs.n': 'weight' }).text = f(inp.weight);
    x.sub(inpNode, 'CPhysicsSourceType', { 'xs.n': 'type', v: inp.type });
    x.sub(inpNode, 'b', { 'xs.n': 'isReverse' }).text = inp.isReverse ? 'true' : 'false';
  }

  // ── Outputs ── (always exactly one per Hiyori rule; format supports more)
  const outputsNode = x.sub(src, 'carray_list', { 'xs.n': 'outputs', count: '1' });
  const outNode = x.sub(outputsNode, 'CPhysicsOutput');
  x.sub(outNode, 'CPhysicsDataGuid', {
    'xs.n': 'guid', uuid: uuid(), note: `out_${rule.id}`,
  });
  x.subRef(outNode, 'CParameterGuid', outputPid, { 'xs.n': 'destination' });
  // vertexIndex: which vertex in the pendulum chain drives the output. For a
  // 2-vertex pendulum (root + tip), the tip (index 1) drives — the root is a
  // fixed anchor. 3+ vertex chains would expose an intermediate vertex here.
  x.sub(outNode, 'i', { 'xs.n': 'vertexIndex' }).text = String(rule.vertices.length - 1);
  const outTs = x.sub(outNode, 'GVector2', { 'xs.n': 'translationScale' });
  x.sub(outTs, 'f', { 'xs.n': 'x' }).text = '0.0';
  x.sub(outTs, 'f', { 'xs.n': 'y' }).text = '0.0';
  x.sub(outNode, 'f', { 'xs.n': 'angleScale' }).text = f(rule.outputScale);
  x.sub(outNode, 'f', { 'xs.n': 'weight' }).text = '100.0';
  x.sub(outNode, 'CPhysicsSourceType', { 'xs.n': 'type', v: 'SRC_TO_G_ANGLE' });
  x.sub(outNode, 'b', { 'xs.n': 'isReverse' }).text = 'false';

  // ── Vertices (pendulum chain) ──
  const vxNode = x.sub(src, 'carray_list', {
    'xs.n': 'vertices', count: String(rule.vertices.length),
  });
  for (let i = 0; i < rule.vertices.length; i++) {
    const vs = rule.vertices[i];
    const v = x.sub(vxNode, 'CPhysicsVertex');
    x.sub(v, 'CPhysicsDataGuid', {
      'xs.n': 'guid', uuid: uuid(), note: `v${i}_${rule.id}`,
    });
    const pos = x.sub(v, 'GVector2', { 'xs.n': 'position' });
    x.sub(pos, 'f', { 'xs.n': 'x' }).text = f(vs.x);
    x.sub(pos, 'f', { 'xs.n': 'y' }).text = f(vs.y);
    x.sub(v, 'f', { 'xs.n': 'mobility' }).text = f(vs.mobility);
    x.sub(v, 'f', { 'xs.n': 'delay' }).text = f(vs.delay);
    x.sub(v, 'f', { 'xs.n': 'acceleration' }).text = f(vs.acceleration);
    x.sub(v, 'f', { 'xs.n': 'radius' }).text = f(vs.radius);
  }

  // ── Normalization (editor's per-setting scalar ranges) ──
  const n = rule.normalization;
  x.sub(src, 'f', { 'xs.n': 'normalizedPositionValueMax' }).text = f(n.posMax);
  x.sub(src, 'f', { 'xs.n': 'normalizedPositionValueMin' }).text = f(n.posMin);
  x.sub(src, 'f', { 'xs.n': 'normalizedPositionDefaultValue' }).text = f(n.posDef);
  x.sub(src, 'f', { 'xs.n': 'normalizedAngleValueMax' }).text = f(n.angleMax);
  x.sub(src, 'f', { 'xs.n': 'normalizedAngleValueMin' }).text = f(n.angleMin);
  x.sub(src, 'f', { 'xs.n': 'normalizedAngleDefaultValue' }).text = f(n.angleDef);
}
