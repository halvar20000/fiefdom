import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fortunes, SEASONS } from '../src/game/fortune';
import type { Resource } from '../src/game/defs';

const make = (outputs: () => Set<Resource>, said: [string, string][] = []) =>
  new Fortunes(outputs, (t, k) => said.push([t, k]));

test('no season before the eighth minute, and none without a trade to lean on', () => {
  const said: [string, string][] = [];
  let outputs = new Set<Resource>();
  const f = make(() => outputs, said);
  for (let t = 0; t < 8 * 60; t++) f.update(t);
  assert.equal(said.length, 0);
  f.update(8 * 60 + 1);
  assert.equal(f.current, null);
  outputs = new Set<Resource>(['wheat']);
  f.update(9 * 60 + 2);
  assert.equal(said.length, 1);
  assert.ok(['harvest', 'blight'].includes(f.current!.key));
  assert.equal(f.factor('wheat'), f.current!.factor);
  assert.equal(f.factor('apples'), 1);
});

test('a season lasts three to four minutes, then the next comes five to nine later', () => {
  const said: [string, string][] = [];
  const f = make(() => new Set<Resource>(['wheat']), said);
  f.update(8 * 60 + 1);
  const started = 8 * 60 + 1;
  f.update(started + 3 * 60 - 1);
  assert.ok(f.current);
  let over = 0;
  for (let t = started + 3 * 60; t <= started + 4 * 60 + 1; t++) { f.update(t); if (!f.current) { over = t; break; } }
  assert.ok(over, 'passed within four minutes');
  assert.equal(said.length, 2);
  assert.equal(f.factor('wheat'), 1);
  let next = 0;
  for (let t = over + 1; t <= over + 9 * 60 + 1; t++) { f.update(t); if (f.current) { next = t; break; } }
  assert.ok(next - over >= 5 * 60 && next - over <= 9 * 60 + 1, `${next - over}s`);
});

test('save and restore carry the season and its clock', () => {
  const f = make(() => new Set<Resource>(['fish']));
  f.update(8 * 60 + 1);
  const sv = f.save();
  assert.equal(sv.key, f.current!.key);
  const g = make(() => new Set<Resource>());
  g.restore(sv);
  assert.equal(g.current!.key, sv.key);
  assert.equal(g.factor('fish'), f.factor('fish'));
  g.restore({ key: null, until: 0, nextAt: 99999 });
  assert.equal(g.current, null);
});

test('good and bad news come out even, whatever the pool holds', () => {
  const all = new Set<Resource>(SEASONS.map(s => s.output));
  let good = 0, bad = 0;
  for (let i = 0; i < 400; i++) {
    const h = make(() => all);
    h.update(8 * 60 + 1);
    if (h.current!.factor > 1) good++; else bad++;
  }
  assert.ok(good > 150 && bad > 150, `good ${good} bad ${bad}`);
  // Stone has only good news; the draw falls back to it rather than to nothing.
  const h = make(() => new Set<Resource>(['stone']));
  h.update(8 * 60 + 1);
  assert.equal(h.current!.output, 'stone');
});
