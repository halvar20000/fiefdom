import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchRuntime } from '../src/net/match';
import type { MatchView } from '../src/net/protocol';
import type { Net } from '../src/net/socket';

const net = { on: () => () => {}, onStatus: () => {} } as unknown as Net;
const view = {
  id: 'm-7f3a', map: { name: 'x', seed: 0 }, mode: 'ffa', difficulty: 'normal', aiLords: 2,
  players: [{ slot: 0, username: 'thomas', team: 1, host: true }, { slot: 1, username: 'anna', team: 2 }],
  seats: null,
} as unknown as MatchView;

test('every client names the AI lords the same, and another match names them differently', () => {
  const names = (you: number) => {
    const m = new MatchRuntime(view, you, net);
    return [0, 1, 2, 3].map(g => m.nameOfGlobal(g));
  };
  assert.deepEqual(names(0), names(1));
  assert.equal(names(0)[0], 'thomas');
  assert.match(names(0)[2], / the Blue$/);
  assert.match(names(0)[3], / the Violet$/);
  const other = new MatchRuntime({ ...view, id: 'm-0001' } as MatchView, 0, net);
  assert.notEqual(other.nameOfGlobal(2), names(0)[2]);
});

test('rivalSides puts the other humans first and the AI lords after, on every client', () => {
  assert.deepEqual(new MatchRuntime(view, 0, net).rivalSides, [1, 2, 3]);
  assert.deepEqual(new MatchRuntime(view, 1, net).rivalSides, [0, 2, 3]);
});
