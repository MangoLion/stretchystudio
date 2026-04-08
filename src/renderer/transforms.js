/**
 * 2D transform utilities — shared between the renderer and UI components.
 *
 * All matrices are 3×3 column-major Float32Array(9).
 * Index convention: m[col*3 + row]
 *
 *  col0  col1  col2
 *  [0]   [3]   [6]   row 0
 *  [1]   [4]   [7]   row 1
 *  [2]   [5]   [8]   row 2
 */

/** Identity matrix */
export function mat3Identity() {
  return new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1]);
}

/**
 * Multiply two column-major 3×3 matrices: C = A × B
 */
export function mat3Mul(a, b) {
  const c = new Float32Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      c[col * 3 + row] =
        a[row]     * b[col * 3]     +
        a[3 + row] * b[col * 3 + 1] +
        a[6 + row] * b[col * 3 + 2];
    }
  }
  return c;
}

/**
 * Invert a 2D affine 3×3 column-major matrix.
 * Assumes no perspective (last row is [0, 0, 1]).
 */
export function mat3Inverse(m) {
  const a = m[0], b = m[1];   // col 0
  const c = m[3], d = m[4];   // col 1
  const tx = m[6], ty = m[7]; // col 2
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return mat3Identity();
  const inv = 1 / det;
  return new Float32Array([
     d  * inv,              // [0]
    -b  * inv,              // [1]
     0,                     // [2]
    -c  * inv,              // [3]
     a  * inv,              // [4]
     0,                     // [5]
    (c * ty - d * tx) * inv, // [6]
    (b * tx - a * ty) * inv, // [7]
     1,                     // [8]
  ]);
}

/**
 * Build a local 3×3 matrix from a node's transform properties.
 *
 * Applies (right to left):
 *   T(x+pivotX, y+pivotY) × R(rotation°) × S(scaleX, scaleY) × T(-pivotX, -pivotY)
 *
 * @param {{ x?, y?, rotation?, scaleX?, scaleY?, pivotX?, pivotY? }|null|undefined} t
 */
export function makeLocalMatrix(t) {
  const {
    x = 0, y = 0,
    rotation = 0,
    scaleX = 1, scaleY = 1,
    pivotX = 0, pivotY = 0,
  } = t ?? {};

  const θ = rotation * (Math.PI / 180);
  const c = Math.cos(θ);
  const s = Math.sin(θ);

  return new Float32Array([
     scaleX * c,                                                      // [0]
     scaleX * s,                                                      // [1]
     0,                                                               // [2]
    -scaleY * s,                                                      // [3]
     scaleY * c,                                                      // [4]
     0,                                                               // [5]
    (x + pivotX) - scaleX * pivotX * c + scaleY * pivotY * s,       // [6]
    (y + pivotY) - scaleX * pivotX * s - scaleY * pivotY * c,       // [7]
     1,                                                               // [8]
  ]);
}

/**
 * Compute world matrices for every node in a flat array.
 * world = parentWorld × local  (depth-first, memoised).
 *
 * @param {Array} nodes  Flat node array from projectStore
 * @returns {Map<string, Float32Array>}  nodeId → column-major 3×3
 */
export function computeWorldMatrices(nodes) {
  const worldMap = new Map();
  const nodeMap  = new Map(nodes.map(n => [n.id, n]));

  function resolve(node) {
    if (worldMap.has(node.id)) return worldMap.get(node.id);
    const local = makeLocalMatrix(node.transform);
    const world = (node.parent && nodeMap.has(node.parent))
      ? mat3Mul(resolve(nodeMap.get(node.parent)), local)
      : local;
    worldMap.set(node.id, world);
    return world;
  }

  for (const node of nodes) resolve(node);
  return worldMap;
}
