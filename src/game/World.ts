import { Tileset } from './Tileset';
import type { MapConnection, MapData, MapEdge, MapObject, MapWarp } from './types';

export const CELL = 16; // walk-grid cell size in px
const BLOCK_TO_CELL = 2; // 32px block / 16px cell

// Where the player lands when arriving at the opposite edge of a map.
const ARRIVAL_ROW: Record<MapEdge, number> = {
  south: 0,
  north: -1, // use heightCells - 1
  east: 0,
  west: -1,
};

export class World {
  readonly data: MapData;
  readonly tileset: Tileset;
  readonly widthCells: number; // in 16px cells
  readonly heightCells: number;
  private readonly mapId: string;

  constructor(mapId: string, data: MapData, tileset: Tileset) {
    this.mapId = mapId;
    this.data = data;
    this.tileset = tileset;
    this.widthCells = data.width * BLOCK_TO_CELL;
    this.heightCells = data.height * BLOCK_TO_CELL;
  }

  blockAt(bx: number, by: number): number {
    if (bx < 0 || by < 0 || bx >= this.data.width || by >= this.data.height) {
      return this.data.borderBlock;
    }
    return this.data.blocks[by * this.data.width + bx];
  }

  // tile id of the 8x8 tile used for collision checks: the BOTTOM-LEFT tile
  // of the cell (pokered GetTileAndCoordsInFrontOfPlayer / collision)
  cellTile(cx: number, cy: number): number {
    const tx = cx * 2;
    const ty = cy * 2 + 1;
    const bx = Math.floor(tx / 4);
    const by = Math.floor(ty / 4);
    const block = this.blockAt(bx, by);
    return this.tileset.tileInBlock(block, tx % 4, ty % 4);
  }

  isWalkableCell(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.widthCells || cy >= this.heightCells) return false;
    return this.tileset.isWalkableTile(this.cellTile(cx, cy));
  }

  // Attempted move to an out-of-bounds destination on a connected edge:
  // returns the target map and the edge the player will arrive at there.
  connectionFrom(cx: number, cy: number): { mapId: string; arrivalEdge: MapEdge; cx: number; cy: number } | null {
    let edge: MapEdge | null = null;
    if (cy < 0) edge = 'north';
    else if (cy >= this.heightCells) edge = 'south';
    else if (cx < 0) edge = 'west';
    else if (cx >= this.widthCells) edge = 'east';
    if (!edge) return null;

    const conn = this.data.connections.find((c) => c.edge === edge);
    if (!conn) return null;

    // landing on the opposite edge of the connected map
    const arrivalEdge: MapEdge =
      edge === 'north' ? 'south' : edge === 'south' ? 'north' : edge === 'west' ? 'east' : 'west';
    return { mapId: conn.map, arrivalEdge, cx, cy };
  }

  // Warp whose cell is (cx, cy)
  warpAt(cx: number, cy: number): MapWarp | null {
    return this.data.warps.find((w) => w.x === cx && w.y === cy) || null;
  }
}

export type { MapConnection, MapData, MapEdge, MapObject, MapWarp };
