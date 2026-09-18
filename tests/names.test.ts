import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, hashString, mapName, lordName } from '../src/game/names';

test('the same seed gives the same names', () => {
  assert.equal(lordName(seededRng(7), 'the Red Lord'), lordName(seededRng(7), 'the Red Lord'));
  assert.equal(mapName(seededRng(7)), mapName(seededRng(7)));
  assert.notEqual(lordName(seededRng(7), 'the Red Lord'), lordName(seededRng(8), 'the Red Lord'));
  assert.equal(hashString('m-1'), hashString('m-1'));
  assert.notEqual(hashString('m-1'), hashString('m-2'));
});

test('a lord keeps his banner colour and two lords never share a given name', () => {
  const rng = seededRng(1);
  const taken = new Set<string>();
  const names = ['the Red Lord', 'the Blue Lord', 'the Violet Lord'].map(b => lordName(rng, b, taken));
  assert.match(names[0], /^[A-Z][a-z]+ the Red$/);
  assert.match(names[1], / the Blue$/);
  assert.match(names[2], / the Violet$/);
  assert.equal(taken.size, 3);
  const given = names.map(n => n.split(' ')[0]);
  assert.equal(new Set(given).size, 3);
});

test('names are varied and never show the seam', () => {
  const rng = seededRng(3);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const n = lordName(rng, 'the Red Lord').replace(' the Red', '');
    seen.add(n);
    assert.doesNotMatch(n, /(.)\1\1/, n);          // no triple letters
    assert.doesNotMatch(n, /^(..+)\1$/i, n);       // no element repeated
  }
  assert.ok(seen.size > 800, `${seen.size} distinct`);
  const maps = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const m = mapName(rng);
    maps.add(m);
    assert.doesNotMatch(m, /^(\w+) and \1$/, m);   // "Dust and Dust"
  }
  assert.ok(maps.size > 1200, `${maps.size} distinct`);
});
