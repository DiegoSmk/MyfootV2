export interface BlockDef {
  tiles: number[]; // 16 tile ids, row-major 4x4 (32x32 px block)
}

// Walkable tile ids per tileset, from pokered data/tilesets/collision_tile_ids.asm.
// A cell is passable when its BOTTOM-LEFT 8x8 tile is in this list
// (pokered GetTileAndCoordsInFrontOfPlayer checks the tile at the feet).
const WALKABLE: Record<string, number[]> = {
  overworld: [0x00, 0x10, 0x1b, 0x20, 0x21, 0x23, 0x2c, 0x2d, 0x2e, 0x30, 0x31, 0x33, 0x39, 0x3c, 0x3e, 0x52, 0x54, 0x58, 0x5b],
  house: [0x01, 0x12, 0x14, 0x28, 0x32, 0x37, 0x44, 0x54, 0x5c],
  forest: [0x1e, 0x20, 0x2e, 0x30, 0x34, 0x37, 0x39, 0x3a, 0x40, 0x51, 0x52, 0x5a, 0x5c, 0x5e, 0x5f],
  interior: [0x04, 0x0f, 0x15, 0x1f, 0x3b, 0x45, 0x47, 0x55, 0x56],
  pokecenter: [0x11, 0x1a, 0x1c, 0x3c, 0x5e],
  gate: [0x01, 0x12, 0x14, 0x1a, 0x1c, 0x37, 0x38, 0x3b, 0x3c, 0x5e],
  reds_house: [0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x14, 0x1c, 0x1a],
  gym: [0x11, 0x16, 0x19, 0x2b, 0x3c, 0x3d, 0x3f, 0x4a, 0x4c, 0x4d, 0x03],
};

// Tilesets that animate their water tile ($14) with a horizontal pixel shift
// (home/vcopy.asm tile animation; the GB rotates the tile one pixel per step).
const ANIMATED_WATER: Record<string, boolean> = { overworld: true, forest: true };
const WATER_TILE = 0x14;

// The atlas is 16 tiles per row; each tile is 8x8 px.
const TILES_PER_ROW = 16;
const TILE = 8;
export const BLOCK = 32; // a block is 4x4 tiles

// Global water-animation frame (0..7); advanced by the game loop.
let waterShift = 0;

export class Tileset {
  readonly blocks: BlockDef[];
  readonly walkable: Set<number>;
  readonly image: HTMLImageElement;
  readonly animateWater: boolean;

  constructor(image: HTMLImageElement, blocks: number[][], tilesetName: string) {
    this.image = image;
    this.blocks = blocks.map((b) => ({ tiles: b }));
    const walk = WALKABLE[tilesetName] || [];
    this.walkable = new Set(walk);
    this.animateWater = ANIMATED_WATER[tilesetName] === true;
  }

  static advanceWater(frame: number): void {
    waterShift = frame % 8;
  }

  isWalkableTile(tileId: number): boolean {
    return this.walkable.has(tileId);
  }

  // tile id at (tx, ty), 8px tile coords, within an already-resolved block
  tileInBlock(blockId: number, tx: number, ty: number): number {
    const b = this.blocks[blockId];
    if (!b) return -1;
    return b.tiles[(ty % 4) * 4 + (tx % 4)];
  }

  private drawTile(ctx: CanvasRenderingContext2D, id: number, x: number, y: number): void {
    const sx = (id % TILES_PER_ROW) * TILE;
    const sy = Math.floor(id / TILES_PER_ROW) * TILE;
    if (this.animateWater && id === WATER_TILE && waterShift > 0) {
      // horizontally wrapped shift of the water tile (rrca/rlca animation)
      const s = waterShift;
      ctx.drawImage(this.image, sx + s, sy, TILE - s, TILE, x, y, TILE - s, TILE);
      ctx.drawImage(this.image, sx, sy, s, TILE, x + TILE - s, y, s, TILE);
      return;
    }
    ctx.drawImage(this.image, sx, sy, TILE, TILE, x, y, TILE, TILE);
  }

  drawBlock(ctx: CanvasRenderingContext2D, blockId: number, x: number, y: number): void {
    const b = this.blocks[blockId];
    if (!b) return;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const idx = b.tiles[r * 4 + c];
        if (idx < 0) continue;
        this.drawTile(ctx, idx, x + c * TILE, y + r * TILE);
      }
    }
  }
}
