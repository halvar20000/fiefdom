import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeTerrain, heightFieldOf, findStartSite, isBuildable, GROUND_TYPES } from '../src/game/worldgen';
import { MAPS, MAP_W, MAP_H } from '../src/game/maps';
import { roomAround } from '../src/game/custom';

const IRON = GROUND_TYPES.indexOf('iron');
const ROCK = GROUND_TYPES.indexOf('rock');

test('every built-in map has iron ore, and the start site has a seam in reach', () => {
  for (const map of MAPS) {
    if (map.custom) continue;
    const shape = shapeTerrain(map, MAP_W, MAP_H);
    const field = heightFieldOf(shape);
    let iron = 0, rock = 0, level = 0;
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const g = shape.groundType[z * MAP_W + x];
        if (g === IRON) { iron++; if (isBuildable(field, x, z, 1, 1)) level++; }
        else if (g === ROCK) rock++;
      }
    }
    // A seam is a feature, not the ground: much rarer than rock, never zero.
    assert.ok(iron > 60 && iron < rock, `${map.name}: ${iron} iron vs ${rock} rock`);
    // Iron is carved out of flat rock only, so every ore tile is level.
    assert.equal(level, iron, `${map.name}: iron on a slope`);
    const start = findStartSite(field, shape.groundType);
    const room = roomAround(field, shape.groundType, start);
    assert.ok(room.iron >= 1, `${map.name}: no mine site in reach of the start (${JSON.stringify(room)})`);
    assert.ok(room.rock >= 1 && room.green >= 3, `${map.name}: ${JSON.stringify(room)}`);
  }
});
