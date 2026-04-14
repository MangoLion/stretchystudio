/**
 * Generate a .model3.json manifest file.
 *
 * This is the root file that Live2D runtimes use to locate all other
 * resources (moc3, textures, motions, physics, etc.).
 *
 * Reference: reference/live2d-sample/Hiyori/runtime/hiyori_pro_t11.model3.json
 *
 * @module io/live2d/model3json
 */

/**
 * @typedef {Object} Model3Options
 * @property {string}   modelName       - Base name for generated files (e.g. "character")
 * @property {string[]} textureFiles    - Relative paths to texture atlas PNGs
 * @property {string}   [textureDir]    - Subdirectory for textures (e.g. "character.2048")
 * @property {string[]} [motionFiles]   - Relative paths to .motion3.json files
 * @property {string}   [physicsFile]   - Relative path to .physics3.json
 * @property {string}   [poseFile]      - Relative path to .pose3.json
 * @property {string}   [displayInfoFile] - Relative path to .cdi3.json
 * @property {Object}   [groups]        - { LipSync: [...paramIds], EyeBlink: [...paramIds] }
 * @property {Object[]} [hitAreas]      - [{ Id, Name }]
 */

/**
 * Build a .model3.json object from export options.
 *
 * @param {Model3Options} opts
 * @returns {object} JSON-serializable .model3.json structure
 */
export function generateModel3Json(opts) {
  const {
    modelName,
    textureFiles,
    motionFiles = [],
    physicsFile = null,
    poseFile = null,
    displayInfoFile = null,
    groups = {},
    hitAreas = [],
  } = opts;

  const model = {
    Version: 3,
    FileReferences: {
      Moc: `${modelName}.moc3`,
      Textures: textureFiles,
    },
  };

  // Optional file references
  if (physicsFile) {
    model.FileReferences.Physics = physicsFile;
  }
  if (poseFile) {
    model.FileReferences.Pose = poseFile;
  }
  if (displayInfoFile) {
    model.FileReferences.DisplayInfo = displayInfoFile;
  }

  // Motion groups — group by name prefix or put all under "Idle"
  if (motionFiles.length > 0) {
    model.FileReferences.Motions = buildMotionGroups(motionFiles);
  }

  // Groups (LipSync, EyeBlink parameter bindings)
  const groupsArray = [];
  for (const [name, ids] of Object.entries(groups)) {
    if (ids && ids.length > 0) {
      groupsArray.push({
        Target: 'Parameter',
        Name: name,
        Ids: ids,
      });
    }
  }
  if (groupsArray.length > 0) {
    model.Groups = groupsArray;
  }

  // Hit areas
  if (hitAreas.length > 0) {
    model.HitAreas = hitAreas;
  }

  return model;
}

/**
 * Organize motion files into groups.
 *
 * If motion file names contain a group prefix (e.g. "idle_wave.motion3.json"),
 * they are grouped by that prefix. Otherwise all go under "Idle".
 *
 * @param {string[]} motionFiles
 * @returns {Object<string, {File: string}[]>}
 */
function buildMotionGroups(motionFiles) {
  const groups = {};

  for (const file of motionFiles) {
    // Default group is "Idle"
    const groupName = 'Idle';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push({ File: file });
  }

  return groups;
}
