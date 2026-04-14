/**
 * Generate a .cdi3.json (display info) file.
 *
 * Contains human-readable names for parameters and parts, organized into
 * groups. Not required for runtime, but makes debugging and Cubism Viewer
 * inspection much easier.
 *
 * Reference: reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.cdi3.json
 *
 * @module io/live2d/cdi3json
 */

/**
 * @typedef {Object} ParameterInfo
 * @property {string} id       - Parameter ID (e.g. "ParamAngleX")
 * @property {string} name     - Display name (e.g. "Angle X")
 * @property {string} [groupId] - Group ID (e.g. "ParamGroupFace")
 */

/**
 * @typedef {Object} PartInfo
 * @property {string} id       - Part ID (e.g. "PartArmA")
 * @property {string} name     - Display name (e.g. "Arm A")
 */

/**
 * Build a .cdi3.json object.
 *
 * @param {Object} opts
 * @param {ParameterInfo[]} opts.parameters
 * @param {PartInfo[]}      opts.parts
 * @returns {object} JSON-serializable .cdi3.json structure
 */
export function generateCdi3Json({ parameters = [], parts = [] }) {
  const result = { Version: 3 };

  if (parameters.length > 0) {
    result.Parameters = parameters.map(p => {
      const entry = { Id: p.id, Name: p.name || p.id };
      if (p.groupId) entry.GroupId = p.groupId;
      return entry;
    });
  }

  if (parts.length > 0) {
    result.Parts = parts.map(p => ({
      Id: p.id,
      Name: p.name || p.id,
    }));
  }

  return result;
}
