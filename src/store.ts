import { create } from 'zustand';
import { Tool, METER } from './constants';
import type { FurnitureItem, FloorState, CatalogItem, Dimension, TextNote, Wall, LabelPos, Cable, Tray, Layer, WiringSettings, CableGroup, CableLink, DeviceInfo, CeilingGrid, CeilingMarkKind } from './types';
import { relink, syncLinks } from './geometry/links';
import { tidyCables, orthogonal, simplify } from './geometry/tidy';
import { chainMembers, subtree, projectOnPath } from './geometry/chain';
import { DEFAULT_WIRING, onLayer, trayLayer } from './layers';
import { carryHeights } from './geometry/heights';
import { simplifyPath } from './geometry/segdrag';
import { toggleMark, DEFAULT_CEILING_CELL } from './geometry/ceiling';

/**
 * The floor's cables with `list` laid again by `tidyCables` (through `trays`, desk frames for patch cords);
 * continuations start on the new path of their parent. Null when nothing changed.
 */
function layCables(f: FloorState, list: Cable[], trays: Tray[]): Cable[] | null {
  const paths = tidyCables(list, trays, { desks: deskFrames(f.furniture) });
  const done = new Set<number>();
  const place = (c: Cable) => {
    if (done.has(c.id)) return;
    done.add(c.id);
    const up = c.parent !== undefined ? list.find(x => x.id === c.parent) : undefined;
    const own = paths.get(c.id);
    if (!up || !own) return;
    place(up);
    const upPath = paths.get(up.id) ?? up.points;
    if (projectOnPath(up.points, c.points[0]).dist > 1) return;
    const start = projectOnPath(upPath, own[0]).p;
    paths.set(c.id, simplify(orthogonal([start, ...own.slice(1)])));
  };
  list.forEach(place);
  let changed = false;
  const cables = f.cables.map(c => {
    const p = paths.get(c.id);
    if (!p) return c;
    // Own point heights stay with the points they belonged to
    const pts = carryHeights(c.points, p);
    if (JSON.stringify(pts) === JSON.stringify(c.points)) return c;
    changed = true;
    return { ...c, points: pts };
  });
  return changed ? cables : null;
}
import { deskFrames } from './geometry/desk';
import { isPassThrough } from './labels';
import { translate, type TKey, type TParams } from './i18n';
import { usePrefs } from './prefs';

const HISTORY_LIMIT = 50;
/** Project file format. 2.1.0 adds dimensions (ruler), text notes, furniture labels and cables; 2.0.0 files still load. */
export const FILE_VERSION = '2.2.0';
export const DEFAULT_Z = 100;
export const DEFAULT_TEXT_SIZE = 20;
export const DEFAULT_CABLE_COLOR = '#1a73e8';
export const DEFAULT_CABLE_WIDTH = 3;
export const DEFAULT_TRAY_WIDTH = 10;

export type EditMode = 'plan' | 'wiring';

const layerOf = (o: object) => {
  const l = (o as { layer?: unknown }).layer;
  return l === 'wiring' || l === 'both' ? { layer: l as Layer } : {};
};
const colorOf = (o: object) => {
  const c = (o as { color?: unknown }).color;
  return typeof c === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? { color: c } : {};
};

const linkOf = (v: unknown): CableLink | undefined => {
  const l = v as { id?: unknown; u?: unknown; v?: unknown } | null;
  return l && isNum(l.id) && isNum(l.u) && isNum(l.v) ? { id: l.id, u: l.u, v: l.v } : undefined;
};

const groupsOf = (v: unknown): CableGroup[] => (Array.isArray(v) ? v : [])
  .filter((g): g is { id: number; name: string } => !!g && isNum(g.id) && typeof g.name === 'string')
  .map(g => ({ id: g.id, name: g.name }));

/** Wiring settings from a file; missing or invalid values take the defaults */
export function parseWiring(raw: unknown): WiringSettings {
  const w = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof WiringSettings, min: number, max: number) => {
    const v = w[k];
    return isNum(v) && v >= min && v <= max ? v : DEFAULT_WIRING[k] as number;
  };
  return {
    cableWidth: num('cableWidth', 0.5, 50),
    cableText: num('cableText', 2, 100),
    cableLabels: typeof w.cableLabels === 'boolean' ? w.cableLabels : DEFAULT_WIRING.cableLabels,
    cableLengths: typeof w.cableLengths === 'boolean' ? w.cableLengths : DEFAULT_WIRING.cableLengths,
    trayPatch: typeof w.trayPatch === 'boolean' ? w.trayPatch : DEFAULT_WIRING.trayPatch,
    trayWidth: num('trayWidth', 1, 200),
    trayText: num('trayText', 2, 100),
    planDim: num('planDim', 5, 100),
  };
}
/** Share of the door picture height taken by the frame band along its top edge (door.svg: 25 of 133) */
export const DOOR_FRAME_RATIO = 25 / 133;

export interface Clipboard { furniture: FurnitureItem[]; texts: TextNote[] }

const LABEL_POS: LabelPos[] = ['c', 't', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'];

export interface History {
  undo: FloorState[];
  redo: FloorState[];
}

function emptyFloor(): FloorState {
  return { nodes: [], walls: [], furniture: [], dimensions: [], texts: [], cables: [], trays: [], groups: [] };
}

function emptyHistory(): History {
  return { undo: [], redo: [] };
}

// ── Project file parsing / validation ──────────────────────────
export interface ParsedProject {
  floors: FloorState[];
  nextId: number;
  createdAt: string | null;
  wiring: WiringSettings;
  /** Cable groups common to all floors */
  groups: CableGroup[];
}

/** Error with a translation key, so the UI can show it in the current language */
export class ProjectError extends Error {
  constructor(public key: TKey, public params?: TParams) {
    super(translate('en', key, params));
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Port tags: { "1": "uplink", "3": "10" } — only port numbers with non-empty text */
const tagsOf = (v: unknown): { portTags?: Record<string, string> } => {
  if (!v || typeof v !== 'object') return {};
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>)
    .filter(([k, t]) => /^\d+$/.test(k) && typeof t === 'string' && t.trim()).map(([k, t]) => [k, (t as string).trim().slice(0, 40)]));
  return Object.keys(out).length ? { portTags: out } : {};
};
/** Computer data: host name, HDMI / DP counts, network ports with MAC / IP */
const deviceOf = (v: unknown): { device?: DeviceInfo } => {
  if (!v || typeof v !== 'object') return {};
  const d = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 80) : undefined);
  const cnt = (x: unknown) => (isNum(x) && x >= 0 ? Math.min(16, Math.round(x)) : undefined);
  const nics = Array.isArray(d.nics) ? d.nics.slice(0, 16).map(n => {
    const o = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
    const mac = str(o.mac), ip = str(o.ip);
    return { ...(mac ? { mac } : {}), ...(ip ? { ip } : {}) };
  }) : undefined;
  const out: DeviceInfo = {
    ...(str(d.hostname) ? { hostname: str(d.hostname) } : {}),
    ...(cnt(d.hdmi) !== undefined ? { hdmi: cnt(d.hdmi) } : {}),
    ...(cnt(d.dp) !== undefined ? { dp: cnt(d.dp) } : {}),
    ...(nics && nics.length ? { nics } : {}),
  };
  return Object.keys(out).length ? { device: out } : {};
};
/** Optional height above the floor (cm) */
const elevOf = (v: unknown): { elev?: number } => (isNum(v) && v >= 0 ? { elev: v } : {});

/** Parses and validates a .arcada file. Throws a ProjectError (translatable) if the file is invalid. */
export function parseProject(json: string): ParsedProject {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ProjectError('err.json');
  }
  if (!data || typeof data !== 'object') throw new ProjectError('err.noProject');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.floors) || d.floors.length === 0) throw new ProjectError('err.noFloors');

  let maxId = 0;
  const floors: FloorState[] = d.floors.map((raw, i) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (!Array.isArray(f.nodes) || !Array.isArray(f.walls) || !Array.isArray(f.furniture))
      throw new ProjectError('err.floorDamaged', { n: i });

    const nodes = f.nodes.filter((n): n is { id: number; x: number; y: number } =>
      !!n && isNum(n.id) && isNum(n.x) && isNum(n.y)
    ).map(n => ({ id: n.id, x: n.x, y: n.y }));
    const nodeIds = new Set(nodes.map(n => n.id));

    const walls = f.walls.filter((w): w is { id: number; a: number; b: number; exterior?: unknown; thickness?: unknown } =>
      !!w && isNum(w.id) && isNum(w.a) && isNum(w.b) && w.a !== w.b && nodeIds.has(w.a) && nodeIds.has(w.b)
    ).map(w => ({
      id: w.id, a: w.a, b: w.b, exterior: w.exterior === true,
      ...(isNum(w.thickness) && w.thickness > 0 ? { thickness: w.thickness } : {}),
    }));

    const furniture = f.furniture.filter((it): it is Record<string, unknown> & { id: number; path: string; x: number; y: number; w: number; h: number } =>
      !!it && isNum(it.id) && typeof it.path === 'string' && isNum(it.x) && isNum(it.y) && isNum(it.w) && isNum(it.h) && it.w > 0 && it.h > 0
    ).map(it => ({
      id: it.id, path: it.path, x: it.x, y: it.y, w: it.w, h: it.h,
      rot: isNum(it.rot) ? it.rot : 0,
      zi: isNum(it.zi) ? it.zi : DEFAULT_Z,
      ...(typeof it.name === 'string' ? { name: it.name } : {}),
      ...(typeof it.label === 'string' && it.label ? { label: it.label } : {}),
      ...(LABEL_POS.includes(it.labelPos as LabelPos) ? { labelPos: it.labelPos as LabelPos } : {}),
      ...(isNum(it.labelSize) && it.labelSize > 0 ? { labelSize: it.labelSize } : {}),
      ...(it.labelBold === true ? { labelBold: true } : {}),
      ...(typeof it.labelColor === 'string' ? { labelColor: it.labelColor } : {}),
      ...(it.simple === true ? { simple: true } : {}),
      ...(it.flipX === true ? { flipX: true } : {}),
      ...(it.textMode === 'on' || it.textMode === 'off' ? { textMode: it.textMode as 'on' | 'off' } : {}),
      ...(it.sizeMode === 'on' || it.sizeMode === 'off' ? { sizeMode: it.sizeMode as 'on' | 'off' } : {}),
      ...layerOf(it),
      ...(it.flipY === true ? { flipY: true } : {}),
      ...colorOf(it),
      ...elevOf(it.elev),
      ...(isNum(it.ports) && it.ports >= 0 ? { ports: Math.min(512, Math.round(it.ports)) } : {}),
      ...(Array.isArray(it.groups) && it.groups.some(isNum) ? { groups: (it.groups as unknown[]).filter(isNum) } : {}),
      ...tagsOf(it.portTags),
      ...deviceOf(it.device),
      ...(isNum(it.frame) && it.frame >= 0 ? { frame: Math.min(100, it.frame) } : {}),
      ...(typeof it.color2 === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(it.color2) ? { color2: it.color2 } : {}),
    }));

    const dimensions = (Array.isArray(f.dimensions) ? f.dimensions : []).filter((dm): dm is Dimension =>
      !!dm && isNum(dm.id) && isNum(dm.x1) && isNum(dm.y1) && isNum(dm.x2) && isNum(dm.y2)
    ).map(dm => ({ id: dm.id, x1: dm.x1, y1: dm.y1, x2: dm.x2, y2: dm.y2, ...(typeof dm.color === 'string' ? { color: dm.color } : {}), ...layerOf(dm) }));

    const texts = (Array.isArray(f.texts) ? f.texts : []).filter((tx): tx is Record<string, unknown> & { id: number; x: number; y: number; text: string } =>
      !!tx && isNum(tx.id) && isNum(tx.x) && isNum(tx.y) && typeof tx.text === 'string'
    ).map((tx): TextNote => ({
      id: tx.id, x: tx.x, y: tx.y, text: tx.text,
      size: isNum(tx.size) && tx.size > 0 ? tx.size : DEFAULT_TEXT_SIZE,
      rot: isNum(tx.rot) ? tx.rot : 0,
      bold: tx.bold === true,
      color: typeof tx.color === 'string' ? tx.color : null,
      ...layerOf(tx),
    }));

    const cables = (Array.isArray(f.cables) ? f.cables : []).filter((c): c is Record<string, unknown> & { id: number; points: unknown[] } =>
      !!c && isNum(c.id) && Array.isArray(c.points)
    ).map((c): Cable => ({
      id: c.id,
      points: c.points.filter((p): p is { x: number; y: number; z?: unknown } => !!p && isNum((p as { x: unknown }).x) && isNum((p as { y: unknown }).y))
        .map(p => ({ x: p.x, y: p.y, ...(isNum(p.z) && p.z >= 0 ? { z: p.z } : {}), ...((p as { joint?: unknown }).joint === true ? { joint: true } : {}) })),
      color: typeof c.color === 'string' ? c.color : DEFAULT_CABLE_COLOR,
      ...(isNum(c.width) && c.width > 0 ? { width: c.width } : {}),
      ...(typeof c.label === 'string' && c.label ? { label: c.label } : {}),
      ...(c.showLength === true ? { showLength: true } : {}),
      ...(typeof c.from === 'string' && c.from ? { from: c.from } : {}),
      ...(typeof c.to === 'string' && c.to ? { to: c.to } : {}),
      ...(linkOf(c.fromLink) ? { fromLink: linkOf(c.fromLink) } : {}),
      ...(linkOf(c.toLink) ? { toLink: linkOf(c.toLink) } : {}),
      ...(Array.isArray(c.groups) && c.groups.some(isNum) ? { groups: c.groups.filter(isNum) } : {}),
      ...(isNum(c.parent) && c.parent !== c.id ? { parent: c.parent } : {}),
      ...(c.noTray === true ? { noTray: true } : {}),
      ...(c.kind === 'patch' ? { kind: 'patch' as const } : {}),
      ...(isNum(c.fromPort) && c.fromPort >= 1 ? { fromPort: Math.round(c.fromPort) } : {}),
      ...(isNum(c.toPort) && c.toPort >= 1 ? { toPort: Math.round(c.toPort) } : {}),
      ...(isNum(c.height) && c.height >= 0 ? { height: c.height } : {}),
      ...layerOf(c),
    })).filter(c => c.points.length >= 2)
      // Ends lying on an item are connected to it (also for cables drawn before connections existed)
      .map(c => {
        const { fromLink, toLink } = relink(c, furniture);
        return { ...c, ...(fromLink && c.parent === undefined ? { fromLink } : {}), ...(toLink ? { toLink } : {}) };
      });

    const trays = (Array.isArray(f.trays) ? f.trays : []).filter((t): t is Record<string, unknown> & { id: number; points: unknown[] } =>
      !!t && isNum(t.id) && Array.isArray(t.points)
    ).map((t): Tray => ({
      id: t.id,
      points: t.points.filter((p): p is { x: number; y: number } => !!p && isNum((p as { x: unknown }).x) && isNum((p as { y: unknown }).y))
        .map(p => ({ x: p.x, y: p.y })),
      width: isNum(t.width) && t.width > 0 ? t.width : DEFAULT_TRAY_WIDTH,
      ...(typeof t.label === 'string' && t.label ? { label: t.label } : {}),
      ...colorOf(t),
      ...(t.layer === 'plan' || t.layer === 'both' ? { layer: t.layer as 'plan' | 'both' } : {}),
      ...elevOf(t.elev),
      ...(t.patch === true ? { patch: true } : {}),
    })).filter(t => t.points.length >= 2);

    const groups = groupsOf(f.groups);
    const ceilings = ceilingsOf(f.ceilings);
    for (const o of [...nodes, ...walls, ...furniture, ...dimensions, ...texts, ...cables, ...trays, ...groups, ...ceilings]) maxId = Math.max(maxId, o.id);
    return syncLinks({ nodes, walls, furniture, dimensions, texts, cables, trays, groups, ...(isNum(f.height) && f.height > 0 ? { height: f.height } : {}),
      ...(ceilings.length ? { ceilings } : {}) });
  });

  const groups = groupsOf(d.cableGroups);
  for (const g of groups) maxId = Math.max(maxId, g.id);
  const nextId = Math.max(isNum(d.nextId) ? d.nextId : 1, maxId + 1);
  const createdAt = typeof d.createdAt === 'string' ? d.createdAt : null;
  return { floors, nextId, createdAt, wiring: parseWiring(d.wiring), groups };
}

export function isProjectEmpty(floors: FloorState[]): boolean {
  return floors.every(f => f.nodes.length === 0 && f.furniture.length === 0 && f.dimensions.length === 0 && f.texts.length === 0 && f.cables.length === 0 && f.trays.length === 0
    && !f.ceilings?.length);
}

const CEILING_KINDS: CeilingMarkKind[] = ['lamp', 'ac', 'vent', 'cable', 'hatch'];

/** Ceiling grids of a saved floor (broken ones are left out) */
function ceilingsOf(v: unknown): CeilingGrid[] {
  if (!Array.isArray(v)) return [];
  const pos = (x: unknown, d: number) => (isNum(x) && x > 0 ? x : d);
  return v.filter((g): g is Record<string, unknown> & { id: number; x: number; y: number; w: number; h: number } =>
    !!g && isNum(g.id) && isNum(g.x) && isNum(g.y) && isNum(g.w) && isNum(g.h) && g.w > 0 && g.h > 0,
  ).map((g): CeilingGrid => {
    const cellW = pos(g.cellW, 60), cellH = pos(g.cellH, 60);
    const marks = (Array.isArray(g.marks) ? g.marks : []).filter((m): m is { c: number; r: number; kind: CeilingMarkKind } =>
      !!m && Number.isInteger(m.c) && Number.isInteger(m.r) && m.c >= 0 && m.r >= 0 && CEILING_KINDS.includes(m.kind))
      .map(m => ({ c: m.c, r: m.r, kind: m.kind }));
    return {
      id: g.id, x: g.x, y: g.y, w: g.w, h: g.h, cellW, cellH,
      firstW: pos(g.firstW, cellW), firstH: pos(g.firstH, cellH),
      ...(marks.length ? { marks } : {}),
    };
  });
}

// ── Store ──────────────────────────────────────────────────────
interface Store {
  tool: Tool;
  snapSize: number; // 0 = off, otherwise world units (e.g. 10 = 10cm)
  floors: FloorState[];
  /** Undo/redo history, one entry per floor (same index as `floors`) */
  histories: History[];
  fi: number;
  /** The single selected object (any kind), or null when nothing or several are selected */
  selectedId: number | null;
  /** All selected objects; groups contain furniture and text notes */
  selection: number[];
  wallStartId: number | null;
  nextId: number;
  stageX: number;
  stageY: number;
  stageScale: number;

  clipboard: Clipboard | null;
  fileCreatedAt: string | null;
  /** True when there are changes not saved to a file or quick save */
  dirty: boolean;
  /** Plan or Wiring mode: in Wiring mode the main plan is dimmed and new objects go to the wiring layer */
  mode: EditMode;
  /** Project-wide Wiring mode settings (saved in the file) */
  wiring: WiringSettings;
  /** Cable groups common to all floors (saved in the file); local groups are in each floor */
  commonGroups: CableGroup[];
  /** Highlighted groups: while any is on, other cables are dimmed (not saved) */
  litGroups: number[];
  /** Text note being edited in place: existing note (id) or a new one at (x, y) */
  textEdit: { id: number | null; x: number; y: number } | null;

  setTool(t: Tool): void;
  setSnapSize(s: number): void;
  select(id: number | null): void;
  setSelection(ids: number[]): void;
  /** Ctrl/Shift-click: add to or remove from the selection */
  toggleSelect(id: number): void;
  setWallStart(id: number | null): void;
  setStageTransform(x: number, y: number, scale: number): void;
  setTextEdit(edit: { id: number | null; x: number; y: number } | null): void;
  setMode(mode: EditMode): void;
  /** Moves an object (furniture, text, dimension, cable) to the main plan or the wiring layer */
  setLayer(id: number, layer: Layer | undefined): void;
  /** Same layer for several objects (furniture, texts, dimensions, cables, trays), one undo step */
  setLayerMany(ids: number[], layer: Layer | undefined): void;
  setWiring(changes: Partial<WiringSettings>): void;
  /** Room height of the current floor (cm); undefined clears it */
  setFloorHeight(h: number | undefined): void;
  /**
   * Connector on a cable at `p`: a point within `near` gets it (or loses it), else a new point with a connector
   * is put on the cable there
   */
  toggleJoint(id: number, p: { x: number; y: number }, near: number): void;
  /** Connector at one point of a cable on / off */
  setJoint(id: number, index: number, on: boolean): void;
  /** Sets (z = number) or clears (undefined) the own height of one cable point */
  setCablePointHeight(id: number, index: number, z: number | undefined): void;
  /** Removes a middle point of a cable (the ends stay) */
  removeCablePoint(id: number, index: number): void;
  /** Removes the extra points of a cable: on a straight line, repeated, tips of back-and-forth spikes */
  simplifyCable(id: number): void;
  /** Drops the own width of every cable on the floor, so the global width applies */
  resetCableWidths(): void;
  addGroup(scope: 'local' | 'common', name: string): number;
  renameGroup(id: number, name: string): void;
  /** Deletes a group and takes its cables out of it */
  deleteGroup(id: number): void;
  /** Adds the cable to the group or takes it out */
  toggleCableGroup(cableId: number, groupId: number): void;
  /**
   * Plugs a cable end into port `port` of an item (null = leave the port free): the end leaves its old port,
   * an end that was in this port loses its port. One undo step.
   */
  assignPort(itemId: number, port: number, pick: { id: number; end: 'from' | 'to' } | null): void;
  /** Lays a patch cord with an end on a desk along the desk frame (to its corner); nothing when no end is on a desk */
  layPatch(id: number): void;
  /** Changes the computer data of an item (host name, HDMI / DP, network ports) */
  updateDevice(itemId: number, changes: Partial<DeviceInfo>): void;
  /** Gives ports 1…count of an item the same tag (e.g. one VLAN for all), replacing their tags; empty clears them. One undo step */
  setAllPortTags(itemId: number, tag: string, count: number): void;
  /** Tag of a port of an item ("uplink", "VLAN 10", a number = VLAN); empty clears it */
  setPortTag(itemId: number, port: number, tag: string): void;
  /** Adds the item (socket, switch…) to the group or takes it out */
  toggleItemGroup(itemId: number, groupId: number): void;
  toggleLit(groupId: number): void;
  /** Moves a group up (-1) or down (+1) in its list: the order of groups in a bundle (first = along the wall) */
  moveGroup(id: number, by: -1 | 1): void;
  /** Lays out the cables of the current layer neatly (right angles, shared runs, onto trays); one undo step */
  tidyCables(): void;

  /** Starts a gesture: all changes until endGesture() become a single undo step */
  beginGesture(): void;
  endGesture(): void;

  addNode(x: number, y: number): number;
  addWall(a: number, b: number): void;
  deleteWall(id: number): void;
  deleteNode(id: number): void;
  moveNode(id: number, x: number, y: number): void;
  toggleExterior(id: number): void;
  splitWall(wallId: number, x: number, y: number): number | null;
  updateWall(id: number, changes: Partial<Pick<Wall, 'exterior' | 'thickness'>>): void;
  /** Sets the centre-line length; the end with fewer connected walls moves */
  setWallLength(id: number, length: number): void;
  moveNodes(moves: { id: number; x: number; y: number }[]): void;
  /** Moves furniture items and text notes to the given positions */
  moveItems(moves: { id: number; x: number; y: number }[]): void;

  addFurniture(item: CatalogItem, cx: number, cy: number): number;
  deleteFurniture(id: number): void;
  updateFurniture(id: number, changes: Partial<FurnitureItem>): void;
  /** Mirrors an item. A door flipped top ↕ bottom is moved so its frame stays in the wall. */
  flipFurniture(id: number, axis: 'x' | 'y'): void;
  /** Same change for several items, one undo step */
  updateFurnitureMany(ids: number[], changes: Partial<FurnitureItem>): void;
  bringToFront(id: number): void;
  sendToBack(id: number): void;

  addDimension(x1: number, y1: number, x2: number, y2: number): number;
  updateDimension(id: number, changes: Partial<Omit<Dimension, 'id'>>): void;
  deleteDimension(id: number): void;
  /** Keeps the first end, moves the second along the line */
  setDimensionLength(id: number, length: number): void;

  /** New cable; with `parent` it continues that cable (same colour, width, layer and groups) */
  addCable(points: { x: number; y: number }[], color: string, parent?: number): number;
  /** Makes the cable a continuation of another one: its start moves onto that cable, the style is taken from it */
  attachCable(id: number, parentId: number): boolean;
  /** Makes the cable a separate run again */
  detachCable(id: number): void;
  /** Same change for every cable of the chain */
  updateChain(id: number, changes: Partial<Pick<Cable, 'color' | 'width' | 'showLength' | 'noTray'>>): void;
  /** Waiting for a click on a cable: where to continue it from, or which cable to attach it to */
  chainPick: { id: number; mode: 'continue' | 'attach' | 'joint' } | null;
  setChainPick(pick: { id: number; mode: 'continue' | 'attach' | 'joint' } | null): void;
  updateCable(id: number, changes: Partial<Omit<Cable, 'id'>>): void;
  deleteCable(id: number): void;
  addTray(points: { x: number; y: number }[], width?: number): number;
  updateTray(id: number, changes: Partial<Omit<Tray, 'id'>>): void;
  deleteTray(id: number): void;
  /** Ceiling grid over the rectangle (standard 60 × 60 panels, edge panels the same until changed) */
  addCeiling(x: number, y: number, w: number, h: number): number;
  updateCeiling(id: number, changes: Partial<Omit<CeilingGrid, 'id'>>): void;
  deleteCeiling(id: number): void;
  /** What a click on a ceiling panel puts there (null = clears it); not saved */
  ceilingBrush: CeilingMarkKind | null;
  setCeilingBrush(kind: CeilingMarkKind | null): void;
  /** Puts the brush mark into a panel of the grid (the same mark again clears it) */
  markCeiling(id: number, c: number, r: number): void;

  addText(x: number, y: number, text: string): number;
  updateText(id: number, changes: Partial<Omit<TextNote, 'id'>>): void;
  deleteText(id: number): void;
  /** Deletes everything selected (furniture, texts, walls, dimensions) */
  deleteSelected(): void;

  changeFloor(by: number): void;
  removeFloor(): boolean;

  undo(): void;
  redo(): void;
  copySelected(): void;
  pasteClipboard(): void;
  cutSelected(): void;

  save(): string;
  markSaved(): void;
  /** Loads a project. Throws an Error with a readable message if the file is invalid. */
  load(json: string): void;
}

export const useStore = create<Store>((set, get) => {
  /** Active gesture: snapshot of the floor before the gesture started */
  let gesture: { fi: number; base: FloorState } | null = null;

  function pushHistory(floorIndex: number, snapshot: FloorState) {
    set(s => ({
      histories: s.histories.map((h, i) => i === floorIndex
        ? { undo: [...h.undo, snapshot].slice(-HISTORY_LIMIT), redo: [] }
        : h),
    }));
  }

  /** Applies a change to the current floor. Floors are immutable, so the old object is the undo snapshot. */
  function upFloor(fn: (f: FloorState) => FloorState) {
    const { fi, floors } = get();
    const current = floors[fi];
    let next = fn(current);
    if (next === current) return;
    // Linked cable ends follow their items
    if (next.furniture !== current.furniture) next = syncLinks(next);
    set({ floors: floors.map((f, i) => i === fi ? next : f), dirty: true });
    if (!gesture) pushHistory(fi, current);
  }

  function beginGesture() {
    if (gesture) endGesture();
    const { fi, floors } = get();
    gesture = { fi, base: floors[fi] };
  }

  function endGesture() {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    const current = get().floors[g.fi];
    if (current && current !== g.base && JSON.stringify(current) !== JSON.stringify(g.base))
      pushHistory(g.fi, g.base);
  }

  /** Runs several changes as a single undo step */
  function transact<T>(fn: () => T): T {
    if (gesture) return fn();
    beginGesture();
    try { return fn(); } finally { endGesture(); }
  }

  /** Cable with its end links updated: ends on an item get connected to it */
  function withLinks(c: Cable, f: FloorState): Cable {
    // Any item can be a consumer (e.g. a desk of the main plan seen under the wiring); the smallest one under the end wins
    const { fromLink, toLink } = relink(c, f.furniture);
    const { fromLink: _a, toLink: _b, fromPort, toPort, ...rest } = c;
    const from = fromLink && c.parent === undefined ? fromLink : undefined;
    // A continuation starts on its parent cable, not on an item; a port stays only while the end is on the same item
    return {
      ...rest, ...(from ? { fromLink: from } : {}), ...(toLink ? { toLink } : {}),
      ...(fromPort !== undefined && from && c.fromLink?.id === from.id ? { fromPort } : {}),
      ...(toPort !== undefined && toLink && c.toLink?.id === toLink.id ? { toPort } : {}),
    };
  }

  /** What a continuation takes from the cable it continues */
  function chainStyle(up: Cable): Partial<Cable> {
    return {
      ...(up.width !== undefined ? { width: up.width } : {}),
      ...(up.groups ? { groups: [...up.groups] } : {}),
      ...(up.layer ? { layer: up.layer } : {}),
    };
  }

  /** Layer for new objects: the wiring layer while in Wiring mode */
  function curLayer(): { layer?: Layer } {
    return get().mode === 'wiring' ? { layer: 'wiring' } : {};
  }

  function sel(ids: number[]) {
    const unique = [...new Set(ids)];
    return { selection: unique, selectedId: unique.length === 1 ? unique[0] : null };
  }

  function newId() {
    const id = get().nextId;
    set(s => ({ nextId: s.nextId + 1 }));
    return id;
  }

  return {
    tool: Tool.Select,
    snapSize: usePrefs.getState().snap, // off by default, the last choice is remembered
    floors: [emptyFloor()],
    histories: [emptyHistory()],
    fi: 0,
    selectedId: null,
    selection: [],
    wallStartId: null,
    nextId: 1,
    stageX: 0,
    stageY: 0,
    stageScale: 1,
    clipboard: null,
    fileCreatedAt: null,
    dirty: false,
    textEdit: null,
    mode: 'plan',
    wiring: DEFAULT_WIRING,
    commonGroups: [],
    litGroups: [],
    chainPick: null,
    setChainPick: (chainPick) => set({ chainPick }),
    ceilingBrush: 'lamp',
    setCeilingBrush: (ceilingBrush) => set({ ceilingBrush }),

    setTool: (tool) => set({ tool, wallStartId: null, selectedId: null, selection: [] }),
    setSnapSize: (snapSize) => { set({ snapSize }); usePrefs.getState().set('snap', snapSize); },
    select: (id) => set(sel(id === null ? [] : [id])),
    setSelection: (ids) => set(sel(ids)),
    toggleSelect(id) {
      const cur = get().selection;
      set(sel(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
    },
    setWallStart: (id) => set({ wallStartId: id }),
    setStageTransform: (x, y, scale) => set({ stageX: x, stageY: y, stageScale: scale }),
    setTextEdit: (textEdit) => set({ textEdit }),
    setMode: (mode) => set({ mode, selectedId: null, selection: [], wallStartId: null, textEdit: null, chainPick: null }),
    setLayer(id, layer) {
      get().setLayerMany([id], layer);
    },
    setLayerMany(ids, layer) {
      const has = (o: { id: number }) => ids.includes(o.id);
      const L = layer ? { layer } : { layer: undefined };
      // Trays: missing = wiring, so the plan is stored as 'plan'
      const T = { layer: layer === 'wiring' ? undefined : layer === 'both' ? 'both' as const : 'plan' as const };
      upFloor(f => ({
        ...f,
        furniture: f.furniture.map(o => has(o) ? { ...o, ...L } : o),
        texts: f.texts.map(o => has(o) ? { ...o, ...L } : o),
        dimensions: f.dimensions.map(o => has(o) ? { ...o, ...L } : o),
        cables: f.cables.map(o => has(o) ? { ...o, ...L } : o),
        trays: f.trays.map(o => has(o) ? { ...o, ...T } : o),
      }));
      // Objects moved out of the layer being edited leave the selection
      const st = get();
      const f = st.floors[st.fi];
      const cur = st.mode === 'wiring' ? 'wiring' : 'main';
      const visible = (id: number) => {
        const tr = f.trays.find(x => x.id === id);
        if (tr) return onLayer({ layer: trayLayer(tr) }, cur);
        const o = [...f.furniture, ...f.texts, ...f.dimensions, ...f.cables].find(x => x.id === id);
        return !o || onLayer(o, cur);
      };
      if (st.selection.some(id => !visible(id))) set(sel(st.selection.filter(visible)));
    },
    setWiring: (changes) => set(s => ({ wiring: { ...s.wiring, ...changes }, dirty: true })),
    setFloorHeight(h) {
      upFloor(f => (f.height === h ? f : { ...f, height: h }));
    },
    toggleJoint(id, p, near) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => {
        if (c.id !== id) return c;
        const at = c.points.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) <= near);
        if (at >= 0) return { ...c, points: c.points.map((q, i) => (i !== at ? q : q.joint ? (({ joint: _j, ...r }) => r)(q) : { ...q, joint: true })) };
        const pr = projectOnPath(c.points, p);
        let seg = 0, best = Infinity;
        for (let i = 1; i < c.points.length; i++) {
          const d = projectOnPath([c.points[i - 1], c.points[i]], pr.p).dist;
          if (d < best) { best = d; seg = i - 1; }
        }
        const pts = [...c.points];
        pts.splice(seg + 1, 0, { x: Math.round(pr.p.x * 10) / 10, y: Math.round(pr.p.y * 10) / 10, joint: true });
        return { ...c, points: pts };
      }) }));
    },
    setJoint(id, index, on) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => {
        if (c.id !== id || !c.points[index]) return c;
        return { ...c, points: c.points.map((q, i) => (i !== index ? q : on ? { ...q, joint: true } : (({ joint: _j, ...r }) => r)(q))) };
      }) }));
    },
    removeCablePoint(id, index) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => {
        if (c.id !== id || index <= 0 || index >= c.points.length - 1) return c;
        return { ...c, points: c.points.filter((_, i) => i !== index) };
      }) }));
    },
    simplifyCable(id) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => {
        if (c.id !== id) return c;
        const pts = simplifyPath(c.points);
        return pts.length === c.points.length ? c : { ...c, points: pts };
      }) }));
    },
    setCablePointHeight(id, index, z) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => {
        if (c.id !== id || !c.points[index]) return c;
        return { ...c, points: c.points.map((p, i) => {
          if (i !== index) return p;
          if (z !== undefined) return { ...p, z };
          const { z: _z, ...rest } = p;
          return rest;
        }) };
      }) }));
    },

    addGroup(scope, name) {
      const id = newId();
      if (scope === 'local') upFloor(f => ({ ...f, groups: [...f.groups, { id, name }] }));
      else set(s => ({ commonGroups: [...s.commonGroups, { id, name }], dirty: true }));
      return id;
    },
    renameGroup(id, name) {
      if (get().commonGroups.some(g => g.id === id)) set(s => ({ commonGroups: s.commonGroups.map(g => g.id === id ? { ...g, name } : g), dirty: true }));
      else upFloor(f => ({ ...f, groups: f.groups.map(g => g.id === id ? { ...g, name } : g) }));
    },
    deleteGroup(id) {
      const out = <T extends { groups?: number[] }>(c: T): T => {
        if (!c.groups?.includes(id)) return c;
        const groups = c.groups.filter(g => g !== id);
        return { ...c, groups: groups.length ? groups : undefined };
      };
      const inIt = (f: FloorState) => f.cables.some(c => c.groups?.includes(id)) || f.furniture.some(c => c.groups?.includes(id));
      if (get().commonGroups.some(g => g.id === id)) {
        // Common group: cables on every floor leave it (not an undo step, like other project settings)
        set(s => ({
          commonGroups: s.commonGroups.filter(g => g.id !== id),
          floors: s.floors.map(f => (inIt(f) ? { ...f, cables: f.cables.map(out), furniture: f.furniture.map(out) } : f)),
          dirty: true,
        }));
      } else {
        upFloor(f => ({ ...f, groups: f.groups.filter(g => g.id !== id), cables: f.cables.map(out), furniture: f.furniture.map(out) }));
      }
      set(s => ({ litGroups: s.litGroups.filter(g => g !== id) }));
    },
    toggleCableGroup(cableId, groupId) {
      upFloor(f => {
        const has = !!f.cables.find(c => c.id === cableId)?.groups?.includes(groupId);
        const ids = new Set(chainMembers(f.cables, cableId));
        return { ...f, cables: f.cables.map(c => {
          if (!ids.has(c.id)) return c;
          const groups = has ? (c.groups ?? []).filter(g => g !== groupId) : [...new Set([...(c.groups ?? []), groupId])];
          return { ...c, groups: groups.length ? groups : undefined };
        }) };
      });
    },
    assignPort(itemId, port, pick) {
      upFloor(f => {
        // A socket port holds two ends (wall cable + cord to a device), other ports one: the oldest ends leave
        const item = f.furniture.find(it => it.id === itemId);
        const room = item && isPassThrough(item) ? 2 : 1;
        const isPick = (c: Cable, end: 'from' | 'to') => !!pick && pick.id === c.id && pick.end === end;
        const at: { id: number; end: 'from' | 'to' }[] = [];
        for (const c of f.cables) {
          if (c.fromLink?.id === itemId && c.fromPort === port && !isPick(c, 'from')) at.push({ id: c.id, end: 'from' });
          if (c.toLink?.id === itemId && c.toPort === port && !isPick(c, 'to')) at.push({ id: c.id, end: 'to' });
        }
        const out = pick ? at.slice(0, Math.max(0, at.length - (room - 1))) : at;
        const leaves = (c: Cable, end: 'from' | 'to') => out.some(o => o.id === c.id && o.end === end);
        return { ...f, cables: f.cables.map(c => {
          let next = c;
          if (leaves(c, 'from')) next = { ...next, fromPort: undefined };
          if (leaves(c, 'to')) next = { ...next, toPort: undefined };
          if (pick && c.id === pick.id) next = pick.end === 'from' ? { ...next, fromPort: port } : { ...next, toPort: port };
          return next;
        }) };
      });
    },
    layPatch(id) {
      upFloor(f => {
        const c = f.cables.find(x => x.id === id);
        if (!c || c.points.length < 2) return f;
        const p = tidyCables([c], [], { desks: deskFrames(f.furniture) }).get(id);
        if (!p) return f;
        const pts = carryHeights(c.points, p);
        return { ...f, cables: f.cables.map(x => (x.id === id ? { ...x, points: pts } : x)) };
      });
    },
    updateDevice(itemId, changes) {
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => {
        if (it.id !== itemId) return it;
        const next: DeviceInfo = { ...(it.device ?? {}), ...changes };
        for (const k of Object.keys(next) as (keyof DeviceInfo)[]) if (next[k] === undefined || next[k] === '') delete next[k];
        return { ...it, device: Object.keys(next).length ? next : undefined };
      }) }));
    },
    setAllPortTags(itemId, tag, count) {
      const v = tag.trim().slice(0, 40);
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => {
        if (it.id !== itemId) return it;
        const tags = { ...(it.portTags ?? {}) };
        for (let n = 1; n <= count; n++) { if (v) tags[String(n)] = v; else delete tags[String(n)]; }
        return { ...it, portTags: Object.keys(tags).length ? tags : undefined };
      }) }));
    },
    setPortTag(itemId, port, tag) {
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => {
        if (it.id !== itemId) return it;
        const tags = { ...(it.portTags ?? {}) };
        const v = tag.trim().slice(0, 40);
        if (v) tags[String(port)] = v; else delete tags[String(port)];
        return { ...it, portTags: Object.keys(tags).length ? tags : undefined };
      }) }));
    },
    toggleItemGroup(itemId, groupId) {
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => {
        if (it.id !== itemId) return it;
        const has = !!it.groups?.includes(groupId);
        const groups = has ? (it.groups ?? []).filter(g => g !== groupId) : [...(it.groups ?? []), groupId];
        return { ...it, groups: groups.length ? groups : undefined };
      }) }));
    },
    moveGroup(id, by) {
      const move = (list: CableGroup[]) => {
        const i = list.findIndex(g => g.id === id), j = i + by;
        if (i < 0 || j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      };
      if (get().commonGroups.some(g => g.id === id)) set(s => ({ commonGroups: move(s.commonGroups), dirty: true }));
      else upFloor(f => { const groups = move(f.groups); return groups === f.groups ? f : { ...f, groups }; });
    },
    toggleLit: (groupId) => set(s => ({ litGroups: s.litGroups.includes(groupId) ? s.litGroups.filter(g => g !== groupId) : [...s.litGroups, groupId] })),

    tidyCables() {
      const { mode } = get();
      upFloor(f => {
        const mine = f.cables.filter(c => onLayer(c, mode === 'wiring' ? 'wiring' : 'main'));
        if (mine.length === 0) return f;
        const cables = layCables(f, mine, mode === 'wiring' ? f.trays : []);
        return cables ? { ...f, cables } : f;
      });
    },
    resetCableWidths() {
      upFloor(f => (f.cables.some(c => c.width !== undefined)
        ? { ...f, cables: f.cables.map(c => (c.width === undefined ? c : { ...c, width: undefined })) }
        : f));
    },

    beginGesture,
    endGesture,

    addNode(x, y) {
      const id = newId();
      upFloor(f => ({ ...f, nodes: [...f.nodes, { id, x, y }] }));
      return id;
    },

    addWall(a, b) {
      if (a === b) return;
      const f = get().floors[get().fi];
      if (!f.nodes.some(n => n.id === a) || !f.nodes.some(n => n.id === b)) return;
      if (f.walls.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return;
      const id = newId();
      upFloor(f => ({ ...f, walls: [...f.walls, { id, a, b, exterior: false }] }));
    },

    deleteWall(id) {
      const wall = get().floors[get().fi].walls.find(w => w.id === id);
      if (!wall) return;
      let orphans: number[] = [];
      upFloor(f => {
        const walls = f.walls.filter(w => w.id !== id);
        const connected = new Set(walls.flatMap(w => [w.a, w.b]));
        orphans = [wall.a, wall.b].filter(nid => !connected.has(nid));
        return { ...f, walls, nodes: f.nodes.filter(n => !orphans.includes(n.id)) };
      });
      const ws = get().wallStartId;
      if (ws !== null && orphans.includes(ws)) set({ wallStartId: null });
    },

    deleteNode(nodeId) {
      if (get().wallStartId === nodeId) set({ wallStartId: null });
      upFloor(f => ({
        ...f,
        walls: f.walls.filter(w => w.a !== nodeId && w.b !== nodeId),
        nodes: f.nodes.filter(n => n.id !== nodeId),
      }));
    },

    moveNode(id, x, y) {
      upFloor(f => ({ ...f, nodes: f.nodes.map(n => n.id === id ? { ...n, x, y } : n) }));
    },

    toggleExterior(id) {
      upFloor(f => ({ ...f, walls: f.walls.map(w => w.id === id ? { ...w, exterior: !w.exterior } : w) }));
    },

    splitWall(wallId, x, y) {
      const f = get().floors[get().fi];
      const wall = f.walls.find(w => w.id === wallId);
      if (!wall) return null;
      const a = f.nodes.find(n => n.id === wall.a);
      const b = f.nodes.find(n => n.id === wall.b);
      if (!a || !b) return null;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return a.id;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const nx = Math.round(a.x + t * dx);
      const ny = Math.round(a.y + t * dy);
      // Split point coincides with an endpoint — nothing to split, reuse the endpoint
      if (Math.hypot(nx - a.x, ny - a.y) < 1) return a.id;
      if (Math.hypot(nx - b.x, ny - b.y) < 1) return b.id;

      const mid = newId(), w1 = newId(), w2 = newId();
      upFloor(fl => ({
        ...fl,
        nodes: [...fl.nodes, { id: mid, x: nx, y: ny }],
        walls: [
          ...fl.walls.filter(w => w.id !== wallId),
          { ...wall, id: w1, a: wall.a, b: mid },
          { ...wall, id: w2, a: mid, b: wall.b },
        ],
      }));
      return mid;
    },

    updateWall(id, changes) {
      upFloor(f => ({ ...f, walls: f.walls.map(w => w.id === id ? { ...w, ...changes } : w) }));
    },

    setWallLength(id, length) {
      const f = get().floors[get().fi];
      const w = f.walls.find(x => x.id === id);
      if (!w || !(length > 0)) return;
      const a = f.nodes.find(n => n.id === w.a), b = f.nodes.find(n => n.id === w.b);
      if (!a || !b) return;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) return;
      const degree = (nid: number) => f.walls.filter(x => x.a === nid || x.b === nid).length;
      // Move the end that disturbs fewer other walls
      const [fixed, moving] = degree(a.id) < degree(b.id) ? [b, a] : [a, b];
      const ux = (moving.x - fixed.x) / len, uy = (moving.y - fixed.y) / len;
      get().moveNode(moving.id, Math.round((fixed.x + ux * length) * 10) / 10, Math.round((fixed.y + uy * length) * 10) / 10);
    },

    moveNodes(moves) {
      const m = new Map(moves.map(x => [x.id, x]));
      upFloor(f => ({ ...f, nodes: f.nodes.map(n => m.has(n.id) ? { ...n, x: m.get(n.id)!.x, y: m.get(n.id)!.y } : n) }));
    },

    moveItems(moves) {
      const m = new Map(moves.map(x => [x.id, x]));
      upFloor(f => ({
        ...f,
        furniture: f.furniture.map(it => m.has(it.id) ? { ...it, x: m.get(it.id)!.x, y: m.get(it.id)!.y } : it),
        texts: f.texts.map(tx => m.has(tx.id) ? { ...tx, x: m.get(tx.id)!.x, y: m.get(tx.id)!.y } : tx),
      }));
    },

    addFurniture(item, cx, cy) {
      const id = newId();
      upFloor(f => ({
        ...f,
        furniture: [...f.furniture, {
          id,
          path: item.imagePath,
          x: cx - (item.width * METER) / 2,
          y: cy - (item.height * METER) / 2,
          w: item.width * METER,
          h: item.height * METER,
          rot: 0,
          zi: item.zIndex ?? DEFAULT_Z,
          name: item.name,
          ...curLayer(),
        }],
      }));
      set({ ...sel([id]), tool: Tool.Select });
      return id;
    },

    deleteFurniture(id) {
      upFloor(f => ({ ...f, furniture: f.furniture.filter(it => it.id !== id) }));
    },

    updateFurniture(id, changes) {
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => it.id === id ? { ...it, ...changes } : it) }));
    },

    flipFurniture(id, axis) {
      const it = get().floors[get().fi].furniture.find(f => f.id === id);
      if (!it) return;
      if (axis === 'x') { get().updateFurniture(id, { flipX: it.flipX ? undefined : true }); return; }
      const flipY = !it.flipY;
      let { x, y } = it;
      if (it.path === 'door') {
        // The door frame is a band along the top of the picture; keep it where it is
        const shift = it.h * (1 - DOOR_FRAME_RATIO) * (flipY ? -1 : 1);
        const rad = it.rot * Math.PI / 180;
        x += -Math.sin(rad) * shift;
        y += Math.cos(rad) * shift;
      }
      get().updateFurniture(id, { flipY: flipY || undefined, x, y });
    },

    updateFurnitureMany(ids, changes) {
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => ids.includes(it.id) ? { ...it, ...changes } : it) }));
    },

    bringToFront(id) {
      const items = get().floors[get().fi].furniture;
      const others = items.filter(it => it.id !== id);
      const top = others.length ? Math.max(...others.map(it => it.zi)) : DEFAULT_Z;
      const item = items.find(it => it.id === id);
      if (item && (others.length === 0 || item.zi > top)) return;
      get().updateFurniture(id, { zi: top + 1 });
    },

    sendToBack(id) {
      const items = get().floors[get().fi].furniture;
      const others = items.filter(it => it.id !== id);
      const bottom = others.length ? Math.min(...others.map(it => it.zi)) : DEFAULT_Z;
      const item = items.find(it => it.id === id);
      if (item && (others.length === 0 || item.zi < bottom)) return;
      get().updateFurniture(id, { zi: bottom - 1 });
    },

    addDimension(x1, y1, x2, y2) {
      const id = newId();
      upFloor(f => ({ ...f, dimensions: [...f.dimensions, { id, x1, y1, x2, y2, ...curLayer() }] }));
      return id;
    },

    updateDimension(id, changes) {
      upFloor(f => ({ ...f, dimensions: f.dimensions.map(d => d.id === id ? { ...d, ...changes } : d) }));
    },

    deleteDimension(id) {
      upFloor(f => ({ ...f, dimensions: f.dimensions.filter(d => d.id !== id) }));
    },

    setDimensionLength(id, length) {
      const d = get().floors[get().fi].dimensions.find(x => x.id === id);
      if (!d || !(length > 0)) return;
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      const ux = len > 0 ? (d.x2 - d.x1) / len : 1, uy = len > 0 ? (d.y2 - d.y1) / len : 0;
      get().updateDimension(id, { x2: d.x1 + ux * length, y2: d.y1 + uy * length });
    },

    addCable(points, color, parent) {
      const id = newId();
      upFloor(f => {
        const up = parent !== undefined ? f.cables.find(c => c.id === parent) : undefined;
        const c: Cable = up
          ? { id, points: points.map(p => ({ x: p.x, y: p.y })), color: up.color, parent: up.id, ...chainStyle(up) }
          : { id, points: points.map(p => ({ x: p.x, y: p.y })), color, ...curLayer() };
        return { ...f, cables: [...f.cables, withLinks(c, f)] };
      });
      return id;
    },

    updateCable(id, changes) {
      upFloor(f => {
        const old = f.cables.find(c => c.id === id);
        let cables = f.cables.map(c => {
          if (c.id !== id) return c;
          const next = { ...c, ...changes };
          return changes.points ? withLinks(next, f) : next;
        });
        // Continuations that started on the moved cable stay on it
        if (old && changes.points) {
          const now = cables.find(c => c.id === id)!;
          cables = cables.map(k => {
            if (k.parent !== id || k.points.length < 2) return k;
            const at = projectOnPath(old.points, k.points[0]);
            if (at.dist > 1) return k;
            const p = projectOnPath(now.points, k.points[0]).p;
            return { ...k, points: [p, ...k.points.slice(1)] };
          });
        }
        return { ...f, cables };
      });
    },

    attachCable(id, parentId) {
      const f = get().floors[get().fi];
      const c = f.cables.find(x => x.id === id), up = f.cables.find(x => x.id === parentId);
      if (!c || !up || subtree(f.cables, id).has(parentId)) return false;
      const start = projectOnPath(up.points, c.points[0]).p;
      const members = new Set(subtree(f.cables, id));
      upFloor(fl => ({ ...fl, cables: fl.cables.map(x => {
        if (x.id === id) {
          const { fromLink: _l, ...rest } = x;
          return { ...rest, parent: parentId, color: up.color, ...chainStyle(up), points: [start, ...x.points.slice(1)] };
        }
        return members.has(x.id) ? { ...x, color: up.color, ...chainStyle(up) } : x;
      }) }));
      return true;
    },

    detachCable(id) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => (c.id === id ? { ...c, parent: undefined } : c)) }));
    },

    updateChain(id, changes) {
      const ids = new Set(chainMembers(get().floors[get().fi].cables, id));
      upFloor(f => ({ ...f, cables: f.cables.map(c => (ids.has(c.id) ? { ...c, ...changes } : c)) }));
    },

    deleteCable(id) {
      // Continuations of a deleted cable continue its parent (or become separate runs)
      upFloor(f => {
        const gone = f.cables.find(c => c.id === id);
        return { ...f, cables: f.cables.filter(c => c.id !== id).map(c => (c.parent === id ? { ...c, parent: gone?.parent } : c)) };
      });
    },

    addTray(points, width = get().wiring.trayWidth) {
      const id = newId();
      upFloor(f => ({ ...f, trays: [...f.trays, { id, points: points.map(p => ({ x: p.x, y: p.y })), width }] }));
      return id;
    },

    updateTray(id, changes) {
      upFloor(f => ({ ...f, trays: f.trays.map(t => t.id === id ? { ...t, ...changes } : t) }));
    },

    deleteTray(id) {
      upFloor(f => ({ ...f, trays: f.trays.filter(t => t.id !== id) }));
    },

    addCeiling(x, y, w, h) {
      const id = newId();
      const g: CeilingGrid = { id, x, y, w, h, cellW: DEFAULT_CEILING_CELL, cellH: DEFAULT_CEILING_CELL, firstW: DEFAULT_CEILING_CELL, firstH: DEFAULT_CEILING_CELL };
      upFloor(f => ({ ...f, ceilings: [...(f.ceilings ?? []), g] }));
      return id;
    },

    updateCeiling(id, changes) {
      upFloor(f => ({ ...f, ceilings: (f.ceilings ?? []).map(g => g.id === id ? { ...g, ...changes } : g) }));
    },

    deleteCeiling(id) {
      upFloor(f => {
        const ceilings = (f.ceilings ?? []).filter(g => g.id !== id);
        const { ceilings: _, ...rest } = f;
        return ceilings.length ? { ...f, ceilings } : rest;
      });
    },

    markCeiling(id, c, r) {
      const kind = get().ceilingBrush;
      upFloor(f => ({ ...f, ceilings: (f.ceilings ?? []).map(g => {
        if (g.id !== id) return g;
        const marks = toggleMark(g.marks, c, r, kind);
        const { marks: _, ...rest } = g;
        return marks.length ? { ...rest, marks } : rest;
      }) }));
    },

    addText(x, y, text) {
      const id = newId();
      upFloor(f => ({ ...f, texts: [...f.texts, { id, x, y, text, size: DEFAULT_TEXT_SIZE, rot: 0, bold: false, color: null, ...curLayer() }] }));
      return id;
    },

    updateText(id, changes) {
      upFloor(f => ({ ...f, texts: f.texts.map(tx => tx.id === id ? { ...tx, ...changes } : tx) }));
    },

    deleteText(id) {
      upFloor(f => ({ ...f, texts: f.texts.filter(tx => tx.id !== id) }));
    },

    deleteSelected() {
      const ids = get().selection;
      if (ids.length === 0) return;
      transact(() => {
        for (const id of ids) {
          const f = get().floors[get().fi];
          if (f.texts.some(tx => tx.id === id)) get().deleteText(id);
          else if (f.furniture.some(it => it.id === id)) get().deleteFurniture(id);
          else if (f.walls.some(w => w.id === id)) get().deleteWall(id);
          else if (f.dimensions.some(d => d.id === id)) get().deleteDimension(id);
          else if (f.cables.some(c => c.id === id)) get().deleteCable(id);
          else if (f.trays.some(t => t.id === id)) get().deleteTray(id);
          else if (f.ceilings?.some(g => g.id === id)) get().deleteCeiling(id);
        }
      });
      set(sel([]));
    },

    changeFloor(by) {
      endGesture();
      const { fi, floors, histories } = get();
      const newFi = fi + by;
      if (newFi < 0) return;
      const adding = newFi >= floors.length;
      set({
        fi: newFi,
        floors: adding ? [...floors, emptyFloor()] : floors,
        histories: adding ? [...histories, emptyHistory()] : histories,
        selectedId: null,
        selection: [],
        wallStartId: null,
      });
    },

    removeFloor() {
      endGesture();
      const { fi, floors, histories } = get();
      if (floors.length <= 1) return false;
      set({
        fi: Math.max(0, fi - 1),
        floors: floors.filter((_, i) => i !== fi),
        histories: histories.filter((_, i) => i !== fi),
        selectedId: null,
        selection: [],
        wallStartId: null,
        dirty: true,
      });
      return true;
    },

    undo() {
      endGesture();
      const { fi, floors, histories } = get();
      const h = histories[fi];
      if (h.undo.length === 0) return;
      const prev = h.undo[h.undo.length - 1];
      set({
        floors: floors.map((f, i) => i === fi ? prev : f),
        histories: histories.map((x, i) => i === fi ? { undo: h.undo.slice(0, -1), redo: [...h.redo, floors[fi]] } : x),
        selectedId: null,
        selection: [],
        wallStartId: null,
        dirty: true,
      });
    },

    redo() {
      endGesture();
      const { fi, floors, histories } = get();
      const h = histories[fi];
      if (h.redo.length === 0) return;
      const next = h.redo[h.redo.length - 1];
      set({
        floors: floors.map((f, i) => i === fi ? next : f),
        histories: histories.map((x, i) => i === fi ? { undo: [...h.undo, floors[fi]], redo: h.redo.slice(0, -1) } : x),
        selectedId: null,
        selection: [],
        wallStartId: null,
        dirty: true,
      });
    },

    copySelected() {
      const { selection, fi, floors } = get();
      const furniture = floors[fi].furniture.filter(it => selection.includes(it.id)).map(it => ({ ...it }));
      const texts = floors[fi].texts.filter(tx => selection.includes(tx.id)).map(tx => ({ ...tx }));
      if (furniture.length + texts.length > 0) set({ clipboard: { furniture, texts } });
    },

    pasteClipboard() {
      const { clipboard } = get();
      if (!clipboard) return;
      const furniture: FurnitureItem[] = clipboard.furniture.map(it => ({ ...it, id: newId(), x: it.x + 20, y: it.y + 20 }));
      const texts: TextNote[] = clipboard.texts.map(tx => ({ ...tx, id: newId(), x: tx.x + 20, y: tx.y + 20 }));
      upFloor(f => ({ ...f, furniture: [...f.furniture, ...furniture], texts: [...f.texts, ...texts] }));
      set({ ...sel([...furniture, ...texts].map(x => x.id)), clipboard: { furniture, texts } });
    },

    cutSelected() {
      const { selection, fi, floors } = get();
      const f = floors[fi];
      if (!selection.some(id => f.furniture.some(it => it.id === id) || f.texts.some(tx => tx.id === id))) return;
      transact(() => {
        get().copySelected();
        get().deleteSelected();
      });
    },

    save() {
      const { floors, nextId, fileCreatedAt, wiring, commonGroups } = get();
      const now = new Date().toISOString();
      const created = fileCreatedAt ?? now;
      if (!fileCreatedAt) set({ fileCreatedAt: created });
      return JSON.stringify({ version: FILE_VERSION, createdAt: created, lastModified: now, floors, nextId, wiring, cableGroups: commonGroups });
    },

    markSaved: () => set({ dirty: false }),

    load(json) {
      const p = parseProject(json);
      endGesture();
      set({
        floors: p.floors,
        histories: p.floors.map(emptyHistory),
        nextId: p.nextId,
        fi: 0,
        selectedId: null,
        selection: [],
        wallStartId: null,
        fileCreatedAt: p.createdAt,
        wiring: p.wiring,
        commonGroups: p.groups,
        litGroups: [],
        chainPick: null,
        dirty: false,
      });
    },
  };
});
