import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/hub/nav.js';

/** Quads on a 1 m grid over [0,w) x [0,h), skipping cells in `holes`. */
function gridMesh(w, h, holes = new Set()) {
  const pos = [];
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (holes.has(`${x},${z}`)) continue;
    pos.push(x, 0, z, x + 1, 0, z, x + 1, 0, z + 1);
    pos.push(x, 0, z, x + 1, 0, z + 1, x, 0, z + 1);
  }
  return new Float32Array(pos);
}

describe('nav grid', () => {
  it('rasterises triangles, including holes', () => {
    const nav = NavGrid.fromTriangles(gridMesh(4, 4, new Set(['1,1'])), null, 0.25);
    expect(nav.isWalkable(0.5, 0.5)).toBe(true);
    expect(nav.isWalkable(1.5, 1.5)).toBe(false);
    expect(nav.isWalkable(5, 5)).toBe(false);
  });

  it('walks in one straight line when nothing is in the way', () => {
    const nav = NavGrid.fromTriangles(gridMesh(10, 10), null);
    const p = nav.findPath(0.5, 0.5, 9.5, 8.5);
    expect(p).toEqual([{ x: 9.5, z: 8.5 }]);
  });

  it('routes around a wall and every segment stays walkable', () => {
    const holes = new Set();
    for (let z = 0; z < 8; z++) holes.add(`5,${z}`); // wall with a gap at z = 8, 9
    const nav = NavGrid.fromTriangles(gridMesh(10, 10, holes), null);
    const path = nav.findPath(1, 1, 9, 1);
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
    let ax = 1, az = 1;
    for (const p of path) { expect(nav.lineOfSight(ax, az, p.x, p.z)).toBe(true); ax = p.x; az = p.z; }
    expect(path.at(-1)).toEqual({ x: 9, z: 1 });
    expect(Math.max(...path.map((p) => p.z))).toBeGreaterThan(8);
  });

  it('returns null when the goal is cut off', () => {
    const holes = new Set();
    for (let z = 0; z < 10; z++) holes.add(`5,${z}`);
    const nav = NavGrid.fromTriangles(gridMesh(10, 10, holes), null);
    expect(nav.findPath(1, 1, 9, 1)).toBeNull();
  });

  it('snaps a click outside the walk area to the nearest walkable point', () => {
    const nav = NavGrid.fromTriangles(gridMesh(4, 4), null);
    const p = nav.nearestWalkable(6, 2);
    expect(p.x).toBeLessThan(4);
    expect(nav.isWalkable(p.x, p.z)).toBe(true);
    const path = nav.findPath(0.5, 0.5, 6, 2);
    expect(nav.isWalkable(path.at(-1).x, path.at(-1).z)).toBe(true);
  });
});
