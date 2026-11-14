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
  /** English catalog name (used to show the translated name) */
  name?: string;
  /** Custom label shown on the item */
  label?: string;
}

/** Free text note placed on the plan */
export interface TextNote {
  id: number;
  x: number;
  y: number;
  text: string;
  /** Letter height in world units (cm) */
  size: number;
  rot: number;
  bold: boolean;
  /** null = theme text colour */
  color: string | null;
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
  texts: TextNote[];
}

export interface CatalogItem {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  /** Layer order, higher = on top. Default 100 */
  zIndex?: number;
}
