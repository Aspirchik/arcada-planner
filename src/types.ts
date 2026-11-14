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
  /** Custom thickness in cm; when missing: 20 (exterior) or 16 (interior) */
  thickness?: number;
}

/** Plan layer: missing = main plan only, 'wiring' = Wiring mode only, 'both' = shown and editable in both */
export type Layer = 'wiring' | 'both';

/** Project-wide settings of Wiring mode */
export interface WiringSettings {
  /** Width of cables that have no own width, cm */
  cableWidth: number;
  /** Letter height of cable labels, cm */
  cableText: number;
  /** Show cable labels (name, route, length) */
  cableLabels: boolean;
  /** Show the length on every cable */
  cableLengths: boolean;
  /** Width of new trays, cm */
  trayWidth: number;
  /** Letter height of tray labels, cm */
  trayText: number;
  /** How strongly the main plan shows in Wiring mode, % (100 = not dimmed) */
  planDim: number;
}

/** Where a label sits on an item: centre, sides or corners */
export type LabelPos = 'c' | 't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br';

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
  /** Label placement (default centre) */
  labelPos?: LabelPos;
  /** Label letter height in cm (default: fitted to the item) */
  labelSize?: number;
  labelBold?: boolean;
  /** null / missing = theme text colour */
  labelColor?: string | null;
  /** Draw as a plain rectangle instead of the detailed picture */
  simple?: boolean;
  /** Text inside: missing = follow the toolbar ("Names"), 'on' = always, 'off' = never */
  textMode?: 'on' | 'off';
  /** Size (W×D) inside: missing = follow the toolbar ("Sizes"), 'on' = always, 'off' = never */
  sizeMode?: 'on' | 'off';
  /** Mirror the picture left ↔ right (doors: hinges on the other side) */
  flipX?: boolean;
  /** Mirror the picture top ↕ bottom (doors: opens to the other side of the wall) */
  flipY?: boolean;
  /** Object colour (lines of the picture, outline of the simple view); missing = as drawn */
  color?: string;
  layer?: Layer;
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
  layer?: Layer;
}

/** Ruler measurement kept on the plan (a dimension line between two points) */
export interface Dimension {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Line colour; missing = theme ruler colour */
  color?: string;
  layer?: Layer;
}

/** Cable run: a polyline with its own colour and label */
export interface Cable {
  id: number;
  points: { x: number; y: number }[];
  color: string;
  /** Line width in cm (default 3) */
  width?: number;
  label?: string;
  /** Show the run length next to the label */
  showLength?: boolean;
  /** Where the cable starts and ends, e.g. "Server room" → "User 1" */
  from?: string;
  to?: string;
  layer?: Layer;
}

/** Cable tray: a wide band along a polyline that cables run in (always on the wiring layer) */
export interface Tray {
  id: number;
  points: { x: number; y: number }[];
  /** Tray width in cm */
  width: number;
  label?: string;
  /** Edge and label colour; missing = theme colour */
  color?: string;
}

export interface FloorState {
  nodes: WallNode[];
  walls: Wall[];
  furniture: FurnitureItem[];
  dimensions: Dimension[];
  texts: TextNote[];
  cables: Cable[];
  trays: Tray[];
}

export interface CatalogItem {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  /** Layer order, higher = on top. Default 100 */
  zIndex?: number;
}
