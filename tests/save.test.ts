import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_dom';
import {
  upgrade, readSlot, writeSlot, writeAutosave, listAutosaves, listSlots, freeSlot,
  clearSlot, isAutosave, SAVE_VERSION, AUTOSAVES,
} from '../src/game/save';

/** A save as build 1.x of 21 Aug 2026 wrote it: one enemy, sides by name. */
const v3 = () => ({
  version: 3, savedAt: 1, elapsed: 100, map: { name: 'Fen' },
  gold: 5, stock: {}, population: 3, idle: 1, popularity: 50, rations: 'normal',
  taxLevel: 0, trade: {}, buildings: [], felled: [], animals: [], fires: [],
  enemyBuildings: [{ n: 'keep', x: 1, z: 2, staff: 0, hp: 9, held: {} }],
  soldiers: [{ t: 'archer', side: 'player', x: 0, z: 0, hp: 1 },
             { t: 'archer', side: 'enemy', x: 5, z: 5, hp: 2 }],
  lord: { gold: 7, stock: { wood: 1 }, population: 4, idle: 2, elapsed: 90,
          recruited: 3, built: 2, wavesSent: 1, defeated: false },
});

const v4 = (savedAt: number, name: string) => ({
  ...v3(), version: SAVE_VERSION, factions: [], savedAt, map: { name },
  enemyBuildings: undefined, lord: undefined,
});

test('a v3 save is lifted to the current shape', () => {
  const up = upgrade(v3());
  assert.ok('save' in up, 'error' in up ? up.error : '');
  const s = up.save;
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.factions.length, 1);
  assert.equal(s.factions[0].id, 1);
  assert.equal(s.factions[0].buildings.length, 1);
  assert.equal(s.factions[0].defeated, false);
  assert.equal(s.factions[0].gold, 7);
  assert.deepEqual(s.soldiers.map(u => u.side), [0, 1]);
  assert.equal('enemyBuildings' in s, false);
  assert.equal('lord' in s, false);
});

test('current saves pass through; older-than-known and newer are refused', () => {
  const cur = upgrade({ version: SAVE_VERSION, map: { name: 'x' } });
  assert.ok('save' in cur);
  assert.match((upgrade({ version: 2 }) as { error: string }).error, /older build \(v2\)/);
  assert.match((upgrade({ version: SAVE_VERSION + 5 }) as { error: string }).error, /newer build/);
  assert.equal((upgrade(null) as { error: string }).error, 'unreadable');
  assert.equal((upgrade({}) as { error: string }).error, 'unreadable');
});

test('readSlot upgrades on read and leaves the stored copy alone', () => {
  localStorage.clear();
  localStorage.setItem('fiefdom.save.2', JSON.stringify(v3()));
  const info = readSlot(2);
  assert.equal(info.save?.version, SAVE_VERSION);
  assert.equal(JSON.parse(localStorage.getItem('fiefdom.save.2')!).version, 3);
  localStorage.setItem('fiefdom.save.3', JSON.stringify({ version: 99, map: { name: 'x' } }));
  assert.match(readSlot(3).error ?? '', /newer build/);
  assert.equal(readSlot(1).save, null);
});

test('the autosave ring fills, then wraps over the oldest', () => {
  localStorage.clear();
  assert.deepEqual(listAutosaves(), []);
  for (const [at, name] of [[10, 'a'], [20, 'b'], [30, 'c']] as const) {
    assert.equal(writeAutosave(v4(at, name) as never), null);
  }
  assert.deepEqual(listAutosaves().map(i => i.save!.map.name), ['c', 'b', 'a']);
  assert.equal(listAutosaves().length, AUTOSAVES);
  writeAutosave(v4(40, 'd') as never);
  assert.deepEqual(listAutosaves().map(i => i.save!.map.name), ['d', 'c', 'b']);
  assert.equal(readSlot('auto1').save?.map.name, 'd');
  // A corrupt entry is the one replaced, whatever its age.
  localStorage.setItem('fiefdom.save.auto2', '{not json');
  writeAutosave(v4(50, 'e') as never);
  assert.equal(readSlot('auto2').save?.map.name, 'e');
  // The manual slots are untouched by any of it.
  assert.equal(listSlots().filter(i => i.save).length, 0);
  writeSlot(1, v4(60, 'manual') as never);
  assert.equal(listSlots().filter(i => i.save).length, 1);
  assert.equal(isAutosave('auto1'), true);
  assert.equal(isAutosave(1), false);
});

test('manual slots are open-ended: a new save takes the lowest free number', () => {
  localStorage.clear();
  assert.deepEqual(listSlots(), []);
  assert.equal(freeSlot(), 1);
  for (let n = 1; n <= 7; n++) writeSlot(freeSlot(), v4(n, `s${n}`) as never);
  assert.deepEqual(listSlots().map(i => i.slot), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(freeSlot(), 8);
  // A gap is filled before the list grows; the order stays numeric, not
  // insertion or lexicographic (10 after 9, not after 1).
  clearSlot(3);
  assert.equal(freeSlot(), 3);
  writeSlot(freeSlot(), v4(30, 'gap') as never);
  writeSlot(10, v4(100, 'ten') as never);
  assert.deepEqual(listSlots().map(i => i.slot), [1, 2, 3, 4, 5, 6, 7, 10]);
  assert.equal(readSlot(3).save?.map.name, 'gap');
  assert.equal(freeSlot(), 8);
  // Autosaves and unrelated keys are not slots; an unreadable slot still
  // lists, with its error, so it can be deleted from the menu.
  writeAutosave(v4(1, 'auto') as never);
  localStorage.setItem('fiefdom.maps', '[]');
  localStorage.setItem('fiefdom.save.11', '{not json');
  assert.deepEqual(listSlots().map(i => i.slot), [1, 2, 3, 4, 5, 6, 7, 10, 11]);
  assert.equal(listSlots().at(-1)?.error, 'unreadable');
});
