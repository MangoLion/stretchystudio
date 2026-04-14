/**
 * Generate .motion3.json files from Stretchy Studio animations.
 *
 * Stretchy Studio tracks animate node properties (x, y, rotation, scaleX,
 * scaleY, opacity, mesh_verts) with keyframes at specific times.
 *
 * Live2D .motion3.json animates Parameters and Part opacities via "Curves"
 * with a flat segment-encoded array.
 *
 * For MVP, we convert simple property tracks (opacity) to Live2D curves.
 * Vertex-level animation (mesh_verts) requires parameter-based keyforms in
 * the .moc3, which is handled separately by the moc3 writer.
 *
 * Segment encoding:
 *   - First two values: [startTime, startValue]
 *   - Then repeating: [segmentType, ...points]
 *     - 0 (linear):          0, time, value
 *     - 1 (bezier):          1, cx1, cy1, cx2, cy2, time, value
 *     - 2 (stepped):         2, time, value
 *     - 3 (inverse stepped): 3, time, value
 *
 * Reference: reference/live2d-sample/Hiyori/runtime/motion/hiyori_m01.motion3.json
 *
 * @module io/live2d/motion3json
 */

/**
 * Convert a Stretchy Studio animation to .motion3.json format.
 *
 * @param {object} animation - From project.animations[]
 * @param {object} [opts]
 * @param {boolean} [opts.loop=true] - Whether the motion should loop
 * @param {Map<string, string>} [opts.parameterMap] - nodeId+property → Live2D parameter ID
 * @returns {object} JSON-serializable .motion3.json structure
 */
export function generateMotion3Json(animation, opts = {}) {
  const { loop = true, parameterMap = new Map() } = opts;

  const durationSec = (animation.duration ?? 2000) / 1000;
  const fps = animation.fps ?? 24;

  const curves = [];
  let totalSegmentCount = 0;
  let totalPointCount = 0;

  for (const track of (animation.tracks ?? [])) {
    // Skip mesh_verts — these are handled by moc3 keyforms, not motion curves
    if (track.property === 'mesh_verts') continue;

    // Determine the Live2D target and ID for this track
    const mapping = resolveTrackMapping(track, parameterMap);
    if (!mapping) continue;

    const { target, id } = mapping;
    const segments = encodeKeyframesToSegments(track.keyframes, durationSec);

    if (segments.length === 0) continue;

    // Count segments and points for metadata
    const segInfo = countSegmentsAndPoints(segments);
    totalSegmentCount += segInfo.segments;
    totalPointCount += segInfo.points;

    curves.push({
      Target: target,
      Id: id,
      Segments: segments,
    });
  }

  return {
    Version: 3,
    Meta: {
      Duration: durationSec,
      Fps: fps,
      Loop: loop,
      AreBeziersRestricted: false,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
  };
}

/**
 * Map a Stretchy Studio track to a Live2D curve target + ID.
 *
 * @param {object} track - { nodeId, property, keyframes }
 * @param {Map<string, string>} parameterMap
 * @returns {{ target: string, id: string } | null}
 */
function resolveTrackMapping(track, parameterMap) {
  const key = `${track.nodeId}.${track.property}`;

  // Check explicit mapping first
  if (parameterMap.has(key)) {
    return { target: 'Parameter', id: parameterMap.get(key) };
  }

  // Default mapping: opacity → Part opacity
  if (track.property === 'opacity') {
    return { target: 'PartOpacity', id: track.nodeId };
  }

  // Properties like x, y, rotation, scaleX, scaleY need parameter mapping
  // to be useful. Without it, skip them for now.
  return null;
}

/**
 * Encode keyframes into the flat segment array format used by .motion3.json.
 *
 * @param {Array<{time: number, value: number, easing?: string}>} keyframes
 * @param {number} durationSec - Total duration in seconds
 * @returns {number[]} Flat segment array
 */
export function encodeKeyframesToSegments(keyframes, durationSec) {
  if (!keyframes || keyframes.length === 0) return [];

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const segments = [];

  // First keyframe: time (sec), value
  segments.push(sorted[0].time / 1000, sorted[0].value);

  // Subsequent keyframes as segments
  for (let i = 1; i < sorted.length; i++) {
    const kf = sorted[i];
    const timeSec = kf.time / 1000;

    // Determine segment type from easing
    const segType = easingToSegmentType(kf.easing);
    segments.push(segType);

    if (segType === 1) {
      // Bezier: compute control points
      // For now, use simple cubic approximation (1/3, 2/3 rule)
      const prevKf = sorted[i - 1];
      const prevTime = prevKf.time / 1000;
      const dt = timeSec - prevTime;
      const cx1 = prevTime + dt / 3;
      const cy1 = prevKf.value;
      const cx2 = prevTime + (2 * dt) / 3;
      const cy2 = kf.value;
      segments.push(cx1, cy1, cx2, cy2, timeSec, kf.value);
    } else {
      // Linear (0), stepped (2), inverse stepped (3): time, value
      segments.push(timeSec, kf.value);
    }
  }

  return segments;
}

/**
 * Map Stretchy Studio easing names to Live2D segment type codes.
 *
 * @param {string} [easing='linear']
 * @returns {number} 0=linear, 1=bezier, 2=stepped, 3=inverse-stepped
 */
function easingToSegmentType(easing = 'linear') {
  switch (easing) {
    case 'ease-in':
    case 'ease-out':
    case 'ease-in-out':
    case 'bezier':
      return 1;
    case 'stepped':
    case 'step':
      return 2;
    case 'inverse-stepped':
      return 3;
    default:
      return 0; // linear
  }
}

/**
 * Count segments and points in a flat segment array (for Meta fields).
 *
 * @param {number[]} segments
 * @returns {{ segments: number, points: number }}
 */
function countSegmentsAndPoints(segments) {
  if (segments.length < 2) return { segments: 0, points: 0 };

  let segCount = 0;
  let ptCount = 1; // first point (time, value)
  let i = 2; // skip first time+value pair

  while (i < segments.length) {
    const type = segments[i];
    segCount++;
    i++; // skip type byte

    if (type === 1) {
      // Bezier: 6 values (cx1, cy1, cx2, cy2, time, value) → 3 points
      ptCount += 3;
      i += 6;
    } else {
      // Linear/stepped/inverse-stepped: 2 values (time, value) → 1 point
      ptCount += 1;
      i += 2;
    }
  }

  return { segments: segCount, points: ptCount };
}
