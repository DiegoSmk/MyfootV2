import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, isWalkable } from '../tests/helpers.mjs';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

const blocksets = {};
for (const f of fs.readdirSync(ASSETS).filter((f) => f.startsWith('blockset_') && f.endsWith('.json'))) {
  blocksets[f.replace(/^blockset_/, '').replace(/\.json$/, '')] = readJSON(f).blocks;
}
const maps = {};
for (const f of fs.readdirSync(ASSETS).filter((f) => f.startsWith('map_') && f.endsWith('.json'))) {
  maps[f.replace(/^map_/, '').replace(/\.json$/, '')] = readJSON(f);
}

const DIR = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
];

// BFS from (sx,sy), avoiding warp cells (except the start) so the path is
// actually walkable in-game without triggering door warps.
export function pathTo(mapId, sx, sy, target, avoidWarpCells = true) {
  const map = maps[mapId];
  const bs = blocksets[map.tileset];
  const warpSet = new Set(map.warps.map((w) => `${w.x},${w.y}`));
  const W = map.width * 2;
  const H = map.height * 2;
  const start = `${sx},${sy}`;
  const targetKey = `${target[0]},${target[1]}`;
  const prev = new Map([[start, null]]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (`${cx},${cy}` === targetKey) break;
    for (const [d, dx, dy] of DIR) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (prev.has(key)) continue;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (nx === sx && ny === sy) continue;
      if (!isWalkable(map, bs, nx, ny)) continue;
      // don't pass THROUGH other warp cells, but the target may be a warp
      if (avoidWarpCells && warpSet.has(key) && key !== targetKey) continue;
      prev.set(key, `${cx},${cy}#${d}`);
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(targetKey)) throw new Error(`no path ${mapId} (${sx},${sy}) -> ${targetKey}`);
  // reconstruct
  const steps = [];
  let cur = targetKey;
  while (prev.get(cur) !== null) {
    const [parent, d] = prev.get(cur).split('#');
    steps.unshift(d);
    cur = parent;
  }
  return steps;
}

export function walkableCellsOnEdge(mapId, edge) {
  const map = maps[mapId];
  const bs = blocksets[map.tileset];
  const cells = [];
  const y = edge === 'north' ? 0 : map.height * 2 - 1;
  for (let x = 0; x < map.width * 2; x++) {
    if (isWalkable(map, bs, x, y)) cells.push([x, y]);
  }
  return cells;
}

export { maps, blocksets };
