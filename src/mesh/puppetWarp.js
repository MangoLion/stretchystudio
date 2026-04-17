/**
 * Puppet Warp — Inverse Distance Weighted (IDW) deformation.
 *
 * Each pin has a rest position and a current position.
 * For each mesh vertex, the displacement is the weighted average
 * of all pin displacements, where weight = 1 / dist^2.
 *
 * Unmoved pins (dx=dy=0) act as natural anchors because they
 * contribute zero displacement while still pulling total weight.
 */

/**
 * @param {Array<{x:number, y:number}>} vertices - current vertex positions
 * @param {Array<{restX:number, restY:number, x:number, y:number}>} pins
 * @returns {Array<{x:number, y:number}>}
 */
export function applyPuppetWarp(vertices, pins) {
  if (!pins || pins.length === 0) return vertices;

  return vertices.map(v => {
    let totalWeight = 0;
    let dx = 0;
    let dy = 0;

    for (const pin of pins) {
      const ex = v.x - pin.restX;
      const ey = v.y - pin.restY;
      const dist2 = ex * ex + ey * ey;

      const w = dist2 < 1e-6 ? 1e10 : 1.0 / dist2;

      totalWeight += w;
      dx += w * (pin.x - pin.restX);
      dy += w * (pin.y - pin.restY);
    }

    if (totalWeight < 1e-10) return { x: v.x, y: v.y };

    return {
      x: v.x + dx / totalWeight,
      y: v.y + dy / totalWeight,
    };
  });
}
