import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, readJSON, tileCount, WALKABLE, isWalkable } from './helpers.mjs';

const TILES_PER_ROW = 16;

test('every blockset entry is 16 tiles; every block used by a map is in range', () => {
  const files = fs.readdirSync(ASSETS).filter((f) => f.startsWith('blockset_') && f.endsWith('.json'));
  assert.ok(files.length >= 8, 'expected at least 8 blocksets');

  // collect block ids actually referenced by maps, per tileset
  const used = new Map();
  for (const mf of fs.readdirSync(ASSETS).filter((f) => f.startsWith('map_') && f.endsWith('.json'))) {
    const map = readJSON(mf);
    if (!used.has(map.tileset)) used.set(map.tileset, new Set());
    for (const id of map.blocks) used.get(map.tileset).add(id);
  }

  for (const f of files) {
    const name = f.replace(/^blockset_/, '').replace(/\.json$/, '');
    const { blocks } = readJSON(f);
    const count = tileCount(`tileset_${name}.png`);
    assert.ok(blocks.length > 0, `${name}: no blocks`);
    for (let i = 0; i < blocks.length; i++) {
      assert.equal(blocks[i].length, 16, `${name}: block ${i} must have 16 tiles`);
    }
    // only blocks referenced by a map must reference valid atlas tiles
    // (pokered blocksets carry unused padding blocks with garbage tile ids)
    const usedIds = used.get(name) || new Set();
    for (const id of usedIds) {
      const block = blocks[id];
      assert.ok(block, `${name}: map references missing block ${id}`);
      for (const t of block) {
        assert.ok(Number.isInteger(t) && t >= 0 && t < count, `${name}: block ${id} tile ${t} out of range (max ${count - 1})`);
      }
    }
  }
});

test('every tileset atlas is 16 tiles per row', () => {
  const files = fs.readdirSync(ASSETS).filter((f) => f.startsWith('tileset_') && f.endsWith('.png'));
  for (const f of files) {
    const buf = fs.readFileSync(path.join(ASSETS, f));
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(w % (TILES_PER_ROW * 8), 0, `${f}: width ${w} not a multiple of 128`);
    assert.equal(h % 8, 0, `${f}: height ${h} not a multiple of 8`);
  }
});

test('every map JSON is structurally valid', () => {
  const files = fs.readdirSync(ASSETS).filter((f) => f.startsWith('map_') && f.endsWith('.json'));
  assert.ok(files.length >= 5, 'expected at least 5 maps');
  for (const f of files) {
    const map = readJSON(f);
    assert.equal(map.blocks.length, map.width * map.height, `${f}: blocks count mismatch`);
    assert.ok(map.borderBlock >= 0, `${f}: missing borderBlock`);
    assert.ok(WALKABLE[map.tileset], `${f}: unknown tileset ${map.tileset}`);
    const bsCount = readJSON(`blockset_${map.tileset}.json`).blocks.length;
    for (const block of map.blocks) {
      assert.ok(block >= 0 && block < bsCount, `${f}: block ${block} out of range`);
    }
    for (const w of map.warps) {
      assert.ok(fs.existsSync(path.join(ASSETS, `map_${w.map}.json`)), `${f}: warp to missing map ${w.map}`);
      assert.ok(Number.isInteger(w.destX) && Number.isInteger(w.destY), `${f}: warp dest not integer`);
    }
    for (const c of map.connections) {
      assert.ok(fs.existsSync(path.join(ASSETS, `map_${c.map}.json`)), `${f}: connection to missing map ${c.map}`);
    }
    for (const o of map.objects) {
      assert.ok(
        fs.existsSync(path.join(ASSETS, `sprite_${o.sprite}.png`)) || o.sprite === 'red',
        `${f}: missing sprite for ${o.sprite}`,
      );
      assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y), `${f}: object coords not integer`);
    }
  }
});

test('collision: spawn and every warp cell is walkable', () => {
  const blocksets = {};
  for (const f of fs.readdirSync(ASSETS).filter((f) => f.startsWith('blockset_') && f.endsWith('.json'))) {
    blocksets[f.replace(/^blockset_/, '').replace(/\.json$/, '')] = readJSON(f).blocks;
  }
  const spawns = { pallet: [5, 5] };
  const maps = {};
  for (const f of fs.readdirSync(ASSETS).filter((f) => f.startsWith('map_') && f.endsWith('.json'))) {
    maps[f.replace(/^map_/, '').replace(/\.json$/, '')] = readJSON(f);
  }

  for (const [name, [x, y]] of Object.entries(spawns)) {
    assert.ok(isWalkable(maps[name], blocksets[maps[name].tileset], x, y), `${name}: spawn (${x},${y}) not walkable`);
  }

  for (const [name, map] of Object.entries(maps)) {
    const bs = blocksets[map.tileset];
    for (const w of map.warps) {
      assert.ok(isWalkable(map, bs, w.x, w.y), `${name}: warp cell (${w.x},${w.y}) not walkable`);
      const dest = maps[w.map];
      assert.ok(dest, `${name}: warp dest map missing`);
      assert.ok(isWalkable(dest, blocksets[dest.tileset], w.destX, w.destY), `${name}: dest (${w.destX},${w.destY}) in ${w.map} not walkable`);
    }
  }
});

test('connections: crossing the shared edge lands on a walkable cell', () => {
  const blocksets = {};
  for (const f of fs.readdirSync(ASSETS).filter((f) => f.startsWith('blockset_') && f.endsWith('.json'))) {
    blocksets[f.replace(/^blockset_/, '').replace(/\.json$/, '')] = readJSON(f).blocks;
  }
  const maps = {};
  for (const f of fs.readdirSync(ASSETS).filter((f) => f.startsWith('map_') && f.endsWith('.json'))) {
    maps[f.replace(/^map_/, '').replace(/\.json$/, '')] = readJSON(f);
  }

  // For every connection, the walkable cells on A's exit edge must align with
  // the walkable cells on B's entry edge (same x/y coordinates).
  for (const [name, map] of Object.entries(maps)) {
    for (const c of map.connections) {
      const other = maps[c.map];
      assert.ok(other, `${name}: missing map ${c.map}`);
      const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' }[c.edge];
      assert.ok(
        other.connections.some((oc) => oc.map === name && oc.edge === opposite),
        `${name}: ${c.map} does not connect back across the ${c.edge} edge`,
      );
      const edgeCells = (m, bs, edge) => {
        const cells = [];
        const y = edge === 'north' ? 0 : m.height * 2 - 1;
        for (let x = 0; x < m.width * 2; x++) {
          if (isWalkable(m, bs, x, y)) cells.push(x);
        }
        return cells;
      };
      const aCells = edgeCells(map, blocksets[map.tileset], c.edge);
      const bCells = edgeCells(other, blocksets[other.tileset], opposite);
      assert.ok(aCells.length > 0, `${name}: no walkable cells on ${c.edge} edge`);
      assert.deepEqual(aCells, bCells, `${name}->${c.map}: ${c.edge}/${opposite} edge cells must align`);
    }
  }
});
