import type { World } from './World';

export type Facing = 'down' | 'left' | 'right' | 'up';
export type Direction = Facing;

const DIR_VEC: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// Facing after arriving at a map edge via a connection. The player keeps
// walking the way they came: arriving at the north edge (came from above)
// means facing down, at the south edge facing up, etc.
const ARRIVAL_EDGE_FACING: Record<string, Facing> = {
  north: 'down',
  south: 'up',
  west: 'right',
  east: 'left',
};

export class Player {
  x: number; // current cell
  y: number;
  facing: Facing = 'down';
  moving = false;
  private fromX = 0;
  private fromY = 0;
  private progress = 0; // 0..1 along a 16px step

  constructor(cx: number, cy: number, facing: Facing = 'down') {
    this.x = cx;
    this.y = cy;
    this.facing = facing;
  }

  spawn(cx: number, cy: number, facing: Facing = 'down'): void {
    this.x = cx;
    this.y = cy;
    this.fromX = cx;
    this.fromY = cy;
    this.progress = 0;
    this.moving = false;
    this.facing = facing;
  }

  placeAt(cx: number, cy: number, facing: Facing): void {
    this.spawn(cx, cy, facing);
  }

  // Resolve a move attempt. Returns a Transition if the player warps or
  // walks across a map edge connection, null for a normal in-map move.
  resolveMove(dir: Direction, world: World): Transition | null {
    const [dx, dy] = DIR_VEC[dir];
    const nx = this.x + dx;
    const ny = this.y + dy;

    // 1. stepped onto a warp cell
    if (world.isWalkableCell(nx, ny)) {
      const warp = world.warpAt(nx, ny);
      if (warp) return { kind: 'warp', warp };
    }

    // 2. blocked move while standing on a warp cell (e.g. walking into the exit door)
    if (!world.isWalkableCell(nx, ny)) {
      const warp = world.warpAt(this.x, this.y);
      if (warp) return { kind: 'warp', warp };
    }

    // 3. walked out of bounds onto a connected edge
    if (nx < 0 || ny < 0 || nx >= world.widthCells || ny >= world.heightCells) {
      const conn = world.connectionFrom(nx, ny);
      if (conn) return { kind: 'connection', conn };
      return null; // blocked by the map border
    }

    return null;
  }

  canMove(dir: Direction, world: World): boolean {
    const [dx, dy] = DIR_VEC[dir];
    return world.isWalkableCell(this.x + dx, this.y + dy);
  }

  tryMove(dir: Direction, world: World): boolean {
    this.facing = dir;
    if (this.moving) return false;
    if (this.canMove(dir, world)) {
      this.fromX = this.x;
      this.fromY = this.y;
      this.x += DIR_VEC[dir][0];
      this.y += DIR_VEC[dir][1];
      this.progress = 0;
      this.moving = true;
      return true;
    }
    return false;
  }

  update(dt: number): void {
    if (!this.moving) return;
    this.progress += dt / 90; // 16px in 90ms
    if (this.progress >= 1) {
      this.progress = 0;
      this.moving = false;
      this.fromX = this.x;
      this.fromY = this.y;
    }
  }

  // pixel position (interpolated while walking)
  px(): [number, number] {
    if (!this.moving) return [this.x * 16, this.y * 16];
    const t = this.progress;
    return [
      this.fromX * 16 + (this.x - this.fromX) * 16 * t,
      this.fromY * 16 + (this.y - this.fromY) * 16 * t,
    ];
  }

  // cell offset of the tile directly in front of the player
  facingOffset(): [number, number] {
    return DIR_VEC[this.facing];
  }

  // Facing after an arrival at a map edge via a connection.
  setArrivalEdge(edge: string): void {
    const f = ARRIVAL_EDGE_FACING[edge];
    if (f) this.facing = f;
  }
}

export interface WarpTransition {
  kind: 'warp';
  warp: { map: string; destX: number; destY: number };
}
export interface ConnectionTransition {
  kind: 'connection';
  conn: { mapId: string; arrivalEdge: string; cx: number; cy: number };
}
export type Transition = WarpTransition | ConnectionTransition;
