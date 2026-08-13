import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS = path.join(ROOT, 'public', 'assets');

export function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ASSETS, rel), 'utf8'));
}

// Parse just the IHDR of a PNG to get width/height (no deps needed).
export function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ASSETS, rel));
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== magic[i]) throw new Error(`${rel} is not a PNG`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

export function tileCount(rel) {
  const { width, height } = pngSize(rel);
  return (width / 8) * (height / 8);
}

// Walkable tile ids per tileset, mirrored from src/game/Tileset.ts
// (source: pokered data/tilesets/collision_tile_ids.asm).
export const WALKABLE = {
  overworld: [0x00, 0x10, 0x1b, 0x20, 0x21, 0x23, 0x2c, 0x2d, 0x2e, 0x30, 0x31, 0x33, 0x39, 0x3c, 0x3e, 0x52, 0x54, 0x58, 0x5b],
  house: [0x01, 0x12, 0x14, 0x28, 0x32, 0x37, 0x44, 0x54, 0x5c],
  forest: [0x1e, 0x20, 0x2e, 0x30, 0x34, 0x37, 0x39, 0x3a, 0x40, 0x51, 0x52, 0x5a, 0x5c, 0x5e, 0x5f],
  interior: [0x04, 0x0f, 0x15, 0x1f, 0x3b, 0x45, 0x47, 0x55, 0x56],
  pokecenter: [0x11, 0x1a, 0x1c, 0x3c, 0x5e],
  gate: [0x01, 0x12, 0x14, 0x1a, 0x1c, 0x37, 0x38, 0x3b, 0x3c, 0x5e],
  reds_house: [0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x14, 0x1c, 0x1a],
  gym: [0x11, 0x16, 0x19, 0x2b, 0x3c, 0x3d, 0x3f, 0x4a, 0x4c, 0x4d, 0x03],
};

export function isWalkable(map, blockset, cx, cy) {
  const tx = cx * 2;
  const ty = cy * 2 + 1;
  const bx = Math.floor(tx / 4);
  const by = Math.floor(ty / 4);
  let block;
  if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) {
    block = map.borderBlock;
  } else {
    block = map.blocks[by * map.width + bx];
  }
  const tiles = blockset[block];
  if (!tiles) return false;
  const tile = tiles[(ty % 4) * 4 + (tx % 4)];
  return WALKABLE[map.tileset].includes(tile);
}
