export interface WallNode {
  id: number;
  x: number;
  y: number;
}

export interface Wall {
  id: number;
  a: number;
  b: number;
  exterior: boolean;
}

export interface FurnitureItem {
  id: number;
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  zi: number;
}

/** Ruler measurement kept on the plan (a dimension line between two points) */
export interface Dimension {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FloorState {
  nodes: WallNode[];
  walls: Wall[];
  furniture: FurnitureItem[];
  dimensions: Dimension[];
}

export interface CatalogItem {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  /** Layer order, higher = on top. Default 100 */
  zIndex?: number;
}
