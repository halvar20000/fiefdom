import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathGrid } from '../src/game/pathfind';

test('a path goes round a wall and is refused into a sealed yard', () => {
  const g = new PathGrid(20, 20);
  // A wall down x = 10 with one gap at z = 15.
  for (let z = 0; z < 20; z++) if (z !== 15) g.setBlocked(10, z, true);
  const p = g.find(2, 2, 18, 2);
  assert.ok(p, 'found');
  // Waypoints at tile centres, smoothed to the corners that matter: the two
  // either side of the gap, then the goal.
  assert.ok(p.some(n => Math.floor(n.z) === 15 && Math.floor(n.x) <= 10), 'went by the gap');
  assert.deepEqual(p[p.length - 1], { x: 18.5, z: 2.5 });
  for (let i = 1; i < p.length; i++) {
    assert.ok(g.isLineClear(p[i - 1].x, p[i - 1].z, p[i].x, p[i].z), `leg ${i} crosses the wall`);
  }
  // Close the gap: no path, and the regions say so without a search.
  g.setBlocked(10, 15, true);
  assert.equal(g.connected(2, 2, 18, 2), false);
  assert.equal(g.find(2, 2, 18, 2), null);
  assert.equal(g.connected(2, 2, 5, 5), true);
});

test('nearestOpen finds the closest walkable tile in the same region', () => {
  const g = new PathGrid(10, 10);
  g.fill(4, 4, 3, 3, true);
  const n = g.nearestOpen(5, 5);
  assert.ok(n);
  assert.equal(g.isBlocked(n.x, n.z), false);
  assert.ok(Math.abs(n.x - 5) <= 2 && Math.abs(n.z - 5) <= 2);
});
