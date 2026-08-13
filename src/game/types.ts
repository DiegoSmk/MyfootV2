export interface MapObject {
  sprite: string;
  x: number; // 16x16 walk-grid cell
  y: number;
  text: string;
}

export interface MapWarp {
  x: number;
  y: number;
  map: string; // destination map asset id
  destX: number;
  destY: number;
}

export type MapEdge = 'north' | 'south' | 'east' | 'west';

export interface MapConnection {
  edge: MapEdge;
  map: string;
}

export interface MapData {
  name: string;
  label: string;
  tileset: string; // tileset asset id (overworld, reds_house, ...)
  width: number; // in 32x32 blocks
  height: number;
  borderBlock: number;
  blocks: number[];
  connections: MapConnection[];
  warps: MapWarp[];
  objects: MapObject[];
}
