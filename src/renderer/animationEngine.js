/**
 * Animation engine — keyframe interpolation utilities.
 *
 * Animation data model (stored in project.animations):
 *   { id, name, duration (ms), fps,
 *     tracks: [{ nodeId, property, keyframes: [{ time (ms), value, easing }] }] }
 *
 * Supported properties:
 *   'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity' | 'visible' | 'mesh_verts' | 'blendShape:{id}'
 */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function bezier1D(t, startTension, endTension) {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  return 3 * mt2 * t * startTension + 3 * mt * t2 * endTension + t3;
}

/**
 * 1D Cubic Bezier Solver (X -> Y)
 */
export function evaluateCubicBezier(x, cx1, cy1, cx2, cy2) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (cx1 === cy1 && cx2 === cy2) return x; // Linear shortcut

  // Binary search for t given x
  let lower = 0;
  let upper = 1;
  let t = x;
  
  for (let i = 0; i < 12; i++) {
    const currentX = bezier1D(t, cx1, cx2);
    if (Math.abs(currentX - x) < 0.0001) break;
    if (x > currentX) lower = t;
    else upper = t;
    t = (lower + upper) / 2;
  }
  
  return bezier1D(t, cy1, cy2);
}

/**
 * Evaluate a given easing shape
 */
export function evaluateEasing(t, easing) {
  if (easing === 'linear') return t;
  if (!easing || easing === 'ease' || easing === 'ease-both') {
    // defaults to standard smooth curve (Ease Both)
    return evaluateCubicBezier(t, 0.42, 0, 0.58, 1);
  }
  if (easing === 'ease-in') {
    return evaluateCubicBezier(t, 0.42, 0, 1, 1);
  }
  if (easing === 'ease-out') {
    return evaluateCubicBezier(t, 0, 0, 0.58, 1);
  }
  if (easing === 'stepped') return 0;
  if (Array.isArray(easing) && easing.length === 4) {
    return evaluateCubicBezier(t, easing[0], easing[1], easing[2], easing[3]);
  }
  return t;
}

/**
 * Interpolate a single track's keyframes at the given time (ms).
 * Returns undefined if no keyframes.
 */
export function interpolateTrack(keyframes, timeMs, loopKeyframes = false, endMs = 0) {
  if (!keyframes || keyframes.length === 0) return undefined;

  // Clamp to edge values
  if (timeMs <= keyframes[0].time) return keyframes[0].value;
  
  if (timeMs >= keyframes[keyframes.length - 1].time) {
    if (loopKeyframes && timeMs < endMs && keyframes.length > 0) {
      const kLast = keyframes[keyframes.length - 1];
      const kFirst = keyframes[0];
      const t = (timeMs - kLast.time) / (endMs - kLast.time);
      const te = evaluateEasing(t, kLast.easing);
      return lerp(kLast.value, kFirst.value, te);
    }
    return keyframes[keyframes.length - 1].value;
  }

  // Binary search for the surrounding pair
  let lo = 0;
  let hi = keyframes.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid + 1].time <= timeMs) lo = mid + 1;
    else hi = mid;
  }

  const kA = keyframes[lo];
  const kB = keyframes[lo + 1];
  const t  = (timeMs - kA.time) / (kB.time - kA.time);
  const te = evaluateEasing(t, kA.easing); // Easing from the *start* keyframe of the segment

  if (typeof kA.value === 'boolean') {
    // Discrete step interpolation for boolean properties like 'visible'
    return kA.value;
  }

  return lerp(kA.value, kB.value, te);
}

/**
 * Interpolate an array of {x,y} vertex positions between two keyframes.
 * Both keyframe values must have the same vertex count.
 */
function interpolateMeshVerts(keyframes, timeMs, loopKeyframes = false, endMs = 0) {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (timeMs <= keyframes[0].time) return keyframes[0].value;

  if (timeMs >= keyframes[keyframes.length - 1].time) {
    if (loopKeyframes && timeMs < endMs && keyframes.length > 0) {
      const kLast = keyframes[keyframes.length - 1];
      const kFirst = keyframes[0];
      const t = (timeMs - kLast.time) / (endMs - kLast.time);
      const te = evaluateEasing(t, kLast.easing);

      return kLast.value.map((vA, i) => {
        const vB = kFirst.value[i];
        if (!vB) return { x: vA.x, y: vA.y };
        return { x: vA.x + (vB.x - vA.x) * te, y: vA.y + (vB.y - vA.y) * te };
      });
    }
    return keyframes[keyframes.length - 1].value;
  }

  let lo = 0;
  let hi = keyframes.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid + 1].time <= timeMs) lo = mid + 1;
    else hi = mid;
  }

  const kA = keyframes[lo];
  const kB = keyframes[lo + 1];
  const t  = (timeMs - kA.time) / (kB.time - kA.time);
  const te = evaluateEasing(t, kA.easing); // Easing from the *start* keyframe of the segment

  return kA.value.map((vA, i) => {
    const vB = kB.value[i];
    if (!vB) return { x: vA.x, y: vA.y };
    return { x: vA.x + (vB.x - vA.x) * te, y: vA.y + (vB.y - vA.y) * te };
  });
}

/**
 * Compute pose overrides for all tracks in an animation at the given time.
 *
 * @param {Object|null} animation  - single animation object (project.animations[i])
 * @param {number}      timeMs     - current playhead position in milliseconds
 * @returns {Map<string, Object>}  nodeId → {
 *   x?, y?, rotation?, scaleX?, scaleY?, opacity?,
 *   mesh_verts?: [{x,y},...]
 * }
 */
export function computePoseOverrides(animation, timeMs, loopKeyframes = false, endMs = 0) {
  const overrides = new Map();
  if (!animation) return overrides;

  for (const track of animation.tracks) {
    let value;
    if (track.property === 'mesh_verts') {
      value = interpolateMeshVerts(track.keyframes, timeMs, loopKeyframes, endMs);
    } else if (track.property === 'puppet_pins') {
      continue; // puppet warp removed — skip legacy tracks
    } else {
      value = interpolateTrack(track.keyframes, timeMs, loopKeyframes, endMs);
    }
    if (value === undefined) continue;

    if (!overrides.has(track.nodeId)) overrides.set(track.nodeId, {});
    overrides.get(track.nodeId)[track.property] = value;
  }

  return overrides;
}

/**
 * Insert or update a keyframe in a track's keyframe array (mutates in place).
 * Keeps keyframes sorted by time.
 */
export function upsertKeyframe(keyframes, timeMs, value, easing = 'ease-both') {
  const existing = keyframes.find(kf => kf.time === timeMs);
  if (existing) {
    existing.value  = value;
    existing.easing = easing;
  } else {
    keyframes.push({ time: timeMs, value, easing });
    keyframes.sort((a, b) => a.time - b.time);
  }
}

/** All keyframeable transform properties (in display order) */
export const KEYFRAME_PROPS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'visible'];

/** Prefix for blend shape influence track properties */
export const BLEND_SHAPE_TRACK_PREFIX = 'blendShape:';

/** Human-readable labels */
export const PROP_LABELS = {
  x:        'X',
  y:        'Y',
  rotation: 'Rotation',
  scaleX:   'Scale X',
  scaleY:   'Scale Y',
  opacity:  'Opacity',
  visible:  'Visible',
};

/**
 * Get the current value of a property from a node (used when inserting keyframes).
 * Reads from transform for transform props, directly from node for opacity.
 * Handles blend shape influences via blendShape:{shapeId} property names.
 */
export function getNodePropertyValue(node, property) {
  if (property === 'opacity') return node.opacity ?? 1;
  if (property === 'visible') return node.visible ?? true;
  if (property.startsWith(BLEND_SHAPE_TRACK_PREFIX)) {
    const shapeId = property.slice(BLEND_SHAPE_TRACK_PREFIX.length);
    return node.blendShapeValues?.[shapeId] ?? 0;
  }
  return node.transform?.[property] ?? 0;
}
