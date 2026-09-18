import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathGrid, DIRS } from '../src/game/pathfind';

/** Walk the field from a tile to the goal, returning the tiles stepped on. */
function walk(g: PathGrid, f: NonNullable<ReturnType<PathGrid['flowField']>>, x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (let n = 0; n < 500; n++) {
    out.push([x, z]);
    if (x === f.gx && z === f.gz) return out;
    const k = f.dir[z * f.width + x];
    assert.ok(k >= 0, `no way on from ${x},${z}`);
    assert.equal(g.isBlocked(x + DIRS[k][0], z + DIRS[k][1]), false, 'stepped into stone');
    // The corner rule: a diagonal step never squeezes between two blocked tiles.
    if (DIRS[k][0] && DIRS[k][1]) {
      assert.equal(g.isBlocked(x + DIRS[k][0], z) || g.isBlocked(x, z + DIRS[k][1]), false, 'cut a corner');
    }
    x += DIRS[k][0]; z += DIRS[k][1];
  }
  throw new Error('never arrived');
}

test('every tile flows to the goal round a wall, and the distance matches the walk', () => {
  const g = new PathGrid(30, 30);
  for (let z = 0; z < 30; z++) if (z !== 25) g.setBlocked(15, z, true);
  const f = g.flowField(28, 3, 0)!;
  assert.ok(f);
  assert.equal(f.dist[3 * 30 + 28], 0);
  const route = walk(g, f, 2, 2);
  assert.ok(route.some(([x, z]) => x === 15 && z === 25), 'went through the gap');
  // A walk's length equals the field's distance, to the diagonal.
  let len = 0;
  for (let i = 1; i < route.length; i++) len += (route[i][0] !== route[i - 1][0] && route[i][1] !== route[i - 1][1]) ? Math.SQRT2 : 1;
  assert.ok(Math.abs(len - f.dist[2 * 30 + 2]) < 1e-3);
  // Across the wall with the gap closed: unreachable, and says so.
  g.setBlocked(15, 25, true);
  const f2 = g.flowField(28, 3, 100)!;
  assert.equal(f2.dist[2 * 30 + 2], Infinity);
  assert.equal(f2.dir[2 * 30 + 2], -1);
  assert.ok(f2.dist[3 * 30 + 20] < Infinity);
});

test('a field is reused until the ground changes, then for a moment more', () => {
  const g = new PathGrid(10, 10);
  const a = g.flowField(5, 5, 0)!;
  assert.equal(g.flowField(5, 5, 0.5), a);
  g.setBlocked(2, 2, true);
  assert.equal(g.flowField(5, 5, 1.0), a, 'stale but young: still handed out');
  const b = g.flowField(5, 5, 3.0)!;
  assert.equal(b.version, g.version);
  assert.equal(b.dist[2 * 10 + 2], Infinity, 'rebuilt with the new stone');
});

test('a blocked goal moves to the nearest open tile', () => {
  const g = new PathGrid(10, 10);
  g.fill(4, 4, 2, 2, true);
  const f = g.flowField(4, 4, 0)!;
  assert.equal(g.isBlocked(f.gx, f.gz), false);
  assert.ok(Math.abs(f.gx - 4) <= 1 && Math.abs(f.gz - 4) <= 1);
});
