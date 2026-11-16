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
  /** List patch cords among the cables of a tray (tray panel, hover hint) */
  trayPatch: boolean;
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
  /** Mounting height above the floor (cm): where cables connected to the item come in */
  elev?: number;
  /** Number of ports (switch, patch panel); missing = from the catalog name ("Switch 24" → 24) */
  ports?: number;
  /** Cable groups (local or common) the item belongs to, e.g. sockets and the switch of one network */
  groups?: number[];
  /** Tag of each port (key = port number): "uplink", "VLAN 10"…; a plain number means a VLAN */
  portTags?: Record<string, string>;
  /** Second colour of a two-port item (double LAN socket): the half with port 2 */
  color2?: string;
  /** Computer data (PC, laptop): host name, video outputs, network ports */
  device?: DeviceInfo;
  /** Desk frame under the desktop: inset from the desk edge (cm); patch cords on the desk are fixed to it */
  frame?: number;
  layer?: Layer;
}

/** Network port of a device: its MAC and IP address */
export interface DeviceNic {
  mac?: string;
  ip?: string;
}

/** Computer data shown in its panel; the network ports are the item's ports (cables plug into them) */
export interface DeviceInfo {
  hostname?: string;
  /** Number of HDMI / DisplayPort outputs */
  hdmi?: number;
  dp?: number;
  /** Network ports, in order (port 1, 2…) */
  nics?: DeviceNic[];
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
  /**
   * Plan points; `z` = height of the point above the floor (cm), missing = taken from the item / tray / run height;
   * `joint` = a connector here (two cables joined to extend a run)
   */
  points: { x: number; y: number; z?: number; joint?: boolean }[];
  color: string;
  /** Line width in cm (default 3) */
  width?: number;
  label?: string;
  /** Show the run length next to the label */
  showLength?: boolean;
  /** Where the cable starts and ends, e.g. "Server room" → "User 1" */
  from?: string;
  to?: string;
  /** Item the start / end is connected to: the end moves with it, and its name is the default From / To */
  fromLink?: CableLink;
  toLink?: CableLink;
  /** Port of the connected item (switch) the start / end is plugged into, from 1 */
  fromPort?: number;
  toPort?: number;
  /** Cable groups (local to the floor or common to the project) this cable belongs to */
  groups?: number[];
  /** Cable this one continues from (it starts on that cable): together they are one chain */
  parent?: number;
  /** Runs outside the trays (e.g. under the ceiling): "Tidy" doesn't put it into trays, trays don't count it */
  noTray?: boolean;
  /** 'patch' = patch cord: a ready-made cord of a standard length (1, 2, 3, 5, 10 m); a free end shows a plug */
  kind?: 'patch';
  /** Height of the run above the floor (cm) for points without their own height */
  height?: number;
  /** Display only (set by styleCables, never saved): route text of the chain and its total length */
  route?: string;
  /** Display only: standard patch cord length that fits (cm), 0 = longer than the longest standard one */
  patchLen?: number;
  /** Display only: patch cord end drawn with a plug (free, or lying on an item without ports such as a desk) */
  plugFrom?: boolean;
  plugTo?: boolean;
  totalLength?: number;
  layer?: Layer;
}

/** Cable end attached to a furniture item, at a spot given as fractions of its width / depth */
export interface CableLink {
  id: number;
  u: number;
  v: number;
}

/** Named group of cables; local groups live on a floor, common ones in the project */
export interface CableGroup {
  id: number;
  name: string;
}

/** Cable tray: a wide band along a polyline that cables run in (on the wiring layer unless `layer` says otherwise) */
export interface Tray {
  id: number;
  points: { x: number; y: number }[];
  /** Tray width in cm */
  width: number;
  label?: string;
  /** Edge and label colour; missing = theme colour */
  color?: string;
  /** Missing = wiring layer only, 'plan' = main plan only, 'both' = both plans */
  layer?: 'plan' | 'both';
  /** Height above the floor (cm): cable points lying in the tray are at this height */
  elev?: number;
  /** Patch cord magnet: Tidy lays patch cords through this tray too (other trays take ordinary cables only) */
  patch?: boolean;
}

/** What sits in a ceiling panel */
export type CeilingMarkKind = 'lamp' | 'ac' | 'vent' | 'cable' | 'hatch';

/**
 * Suspended ceiling: a rectangle of panels. The first column / row are edge panels of their own size,
 * then standard panels follow and the last column / row take what is left.
 */
export interface CeilingGrid {
  id: number;
  /** Top-left corner and size of the ceiling area (cm) */
  x: number; y: number; w: number; h: number;
  /** Standard panel (cm), usually 60 × 60 */
  cellW: number; cellH: number;
  /** Width of the first column and height of the first row (cm) */
  firstW: number; firstH: number;
  /** Panels with a lamp, AC unit, vent… (column, row from the top-left corner) */
  marks?: { c: number; r: number; kind: CeilingMarkKind }[];
}

export interface FloorState {
  nodes: WallNode[];
  walls: Wall[];
  furniture: FurnitureItem[];
  dimensions: Dimension[];
  texts: TextNote[];
  cables: Cable[];
  trays: Tray[];
  /** Cable groups of this floor */
  groups: CableGroup[];
  /** Room height of the floor (cm), used for "under the ceiling" */
  height?: number;
  /** Suspended ceiling grids (the Ceiling layer) */
  ceilings?: CeilingGrid[];
}

export interface CatalogItem {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  /** Layer order, higher = on top. Default 100 */
  zIndex?: number;
}
