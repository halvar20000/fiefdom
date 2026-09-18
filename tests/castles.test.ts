import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUEPRINTS, LAYOUTS, parse, preference } from '../src/game/castles';

test('every blueprint parses: closed lines, 2x2 towers, paired gates, one keep', () => {
  for (const bp of BLUEPRINTS) {
    const l = parse(bp);
    assert.ok(l.line.length > 30, `${bp.key} line`);
    assert.ok(l.towers.length >= 4, `${bp.key} towers`);
    assert.ok(l.gates.every(g => g.length >= 1), `${bp.key} gates per ring`);
    assert.ok(l.inside.has('0,0'), `${bp.key} keep inside`);
    // The keep's 3x3 is clear of the line.
    for (const [x, z] of l.line) assert.ok(Math.abs(x) > 1 || Math.abs(z) > 1, `${bp.key} wall on the keep`);
  }
  assert.equal(LAYOUTS.length, BLUEPRINTS.length);
});

test('the bailey has two rings and a gate in each; the square one', () => {
  const bailey = LAYOUTS.find(l => l.key === 'bailey')!;
  assert.equal(bailey.gates.length, 2);
  // Outer first.
  const far = (g: [number, number][]) => Math.max(...g.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))));
  assert.ok(far(bailey.gates[0]) > far(bailey.gates[1]));
  assert.equal(LAYOUTS.find(l => l.key === 'square')!.gates.length, 1);
});

test('a hole, a lone gate and a three-tile tower are rejected', () => {
  assert.throws(() => parse({ key: 'hole', label: '', rows: [
    '#####', '#...#', '#.K..', '#...#', '#####'] }), /hole/);
  assert.throws(() => parse({ key: 'lonegate', label: '', rows: [
    '#####', '#...#', 'G.K.#', '#...#', '#####'] }), /no pair/);
  assert.throws(() => parse({ key: 'tower', label: '', rows: [
    'TT###', 'T...#', 'G.K.#', 'G...#', '#####'] }), /2x2/);
  assert.throws(() => parse({ key: 'nogate', label: '', rows: [
    '#####', '#...#', '#.K.#', '#...#', '#####'] }), /no gate/);
});

test('preference always ends on the square and respects the difficulty', () => {
  let n = 0;
  const rng = () => ((n++ * 7919) % 100) / 100;
  for (const d of ['easy', 'normal', 'heavy'] as const) {
    const p = preference(d, rng);
    assert.equal(p[p.length - 1].key, 'square');
    if (d === 'heavy') assert.ok(p.some(l => l.key === 'bailey'));
    if (d === 'easy') assert.ok(!p.some(l => l.key === 'bailey'));
  }
  // A shape another lord took goes to the back, ahead only of the square.
  const p = preference('heavy', rng, new Set(['bailey']));
  assert.equal(p[p.length - 1].key, 'square');
  assert.equal(p[p.length - 2].key, 'bailey');
});
