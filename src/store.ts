import { create } from 'zustand';
import { Tool, METER } from './constants';
import type { FurnitureItem, FloorState, CatalogItem, Dimension, TextNote, Wall, LabelPos, Cable } from './types';
import { translate, type TKey, type TParams } from './i18n';

const HISTORY_LIMIT = 50;
/** Project file format. 2.1.0 adds dimensions (ruler), text notes, furniture labels and cables; 2.0.0 files still load. */
export const FILE_VERSION = '2.1.0';
export const DEFAULT_Z = 100;
export const DEFAULT_TEXT_SIZE = 20;
export const DEFAULT_CABLE_COLOR = '#1a73e8';
export const DEFAULT_CABLE_WIDTH = 3;
/** Share of the door picture height taken by the frame band along its top edge (door.svg: 25 of 133) */
export const DOOR_FRAME_RATIO = 25 / 133;

export interface Clipboard { furniture: FurnitureItem[]; texts: TextNote[] }

const LABEL_POS: LabelPos[] = ['c', 't', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'];

export interface History {
  undo: FloorState[];
  redo: FloorState[];
}

function emptyFloor(): FloorState {
  return { nodes: [], walls: [], furniture: [], dimensions: [], texts: [], cables: [] };
}

function emptyHistory(): History {
  return { undo: [], redo: [] };
}

// ── Project file parsing / validation ──────────────────────────
export interface ParsedProject {
  floors: FloorState[];
  nextId: number;
  createdAt: string | null;
}

/** Error with a translation key, so the UI can show it in the current language */
export class ProjectError extends Error {
  constructor(public key: TKey, public params?: TParams) {
    super(translate('en', key, params));
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
      ...(it.flipY === true ? { flipY: true } : {}),
    }));

    const dimensions = (Array.isArray(f.dimensions) ? f.dimensions : []).filter((dm): dm is Dimension =>
      !!dm && isNum(dm.id) && isNum(dm.x1) && isNum(dm.y1) && isNum(dm.x2) && isNum(dm.y2)
    ).map(dm => ({ id: dm.id, x1: dm.x1, y1: dm.y1, x2: dm.x2, y2: dm.y2, ...(typeof dm.color === 'string' ? { color: dm.color } : {}) }));

    const texts = (Array.isArray(f.texts) ? f.texts : []).filter((tx): tx is Record<string, unknown> & { id: number; x: number; y: number; text: string } =>
      !!tx && isNum(tx.id) && isNum(tx.x) && isNum(tx.y) && typeof tx.text === 'string'
    ).map((tx): TextNote => ({
      id: tx.id, x: tx.x, y: tx.y, text: tx.text,
      size: isNum(tx.size) && tx.size > 0 ? tx.size : DEFAULT_TEXT_SIZE,
      rot: isNum(tx.rot) ? tx.rot : 0,
      bold: tx.bold === true,
      color: typeof tx.color === 'string' ? tx.color : null,
    }));

    const cables = (Array.isArray(f.cables) ? f.cables : []).filter((c): c is Record<string, unknown> & { id: number; points: unknown[] } =>
      !!c && isNum(c.id) && Array.isArray(c.points)
    ).map((c): Cable => ({
      id: c.id,
      points: c.points.filter((p): p is { x: number; y: number } => !!p && isNum((p as { x: unknown }).x) && isNum((p as { y: unknown }).y))
        .map(p => ({ x: p.x, y: p.y })),
      color: typeof c.color === 'string' ? c.color : DEFAULT_CABLE_COLOR,
      ...(isNum(c.width) && c.width > 0 ? { width: c.width } : {}),
      ...(typeof c.label === 'string' && c.label ? { label: c.label } : {}),
      ...(c.showLength === true ? { showLength: true } : {}),
    })).filter(c => c.points.length >= 2);

    for (const o of [...nodes, ...walls, ...furniture, ...dimensions, ...texts, ...cables]) maxId = Math.max(maxId, o.id);
    return { nodes, walls, furniture, dimensions, texts, cables };
  });

  const nextId = Math.max(isNum(d.nextId) ? d.nextId : 1, maxId + 1);
  const createdAt = typeof d.createdAt === 'string' ? d.createdAt : null;
  return { floors, nextId, createdAt };
}

export function isProjectEmpty(floors: FloorState[]): boolean {
  return floors.every(f => f.nodes.length === 0 && f.furniture.length === 0 && f.dimensions.length === 0 && f.texts.length === 0 && f.cables.length === 0);
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

  addCable(points: { x: number; y: number }[], color: string): number;
  updateCable(id: number, changes: Partial<Omit<Cable, 'id'>>): void;
  deleteCable(id: number): void;

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
    const next = fn(current);
    if (next === current) return;
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
    snapSize: 10, // 10 world units = 10cm default
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

    setTool: (tool) => set({ tool, wallStartId: null, selectedId: null, selection: [] }),
    setSnapSize: (snapSize) => set({ snapSize }),
    select: (id) => set(sel(id === null ? [] : [id])),
    setSelection: (ids) => set(sel(ids)),
    toggleSelect(id) {
      const cur = get().selection;
      set(sel(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
    },
    setWallStart: (id) => set({ wallStartId: id }),
    setStageTransform: (x, y, scale) => set({ stageX: x, stageY: y, stageScale: scale }),
    setTextEdit: (textEdit) => set({ textEdit }),

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
      upFloor(f => ({ ...f, dimensions: [...f.dimensions, { id, x1, y1, x2, y2 }] }));
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

    addCable(points, color) {
      const id = newId();
      upFloor(f => ({ ...f, cables: [...f.cables, { id, points: points.map(p => ({ x: p.x, y: p.y })), color }] }));
      return id;
    },

    updateCable(id, changes) {
      upFloor(f => ({ ...f, cables: f.cables.map(c => c.id === id ? { ...c, ...changes } : c) }));
    },

    deleteCable(id) {
      upFloor(f => ({ ...f, cables: f.cables.filter(c => c.id !== id) }));
    },

    addText(x, y, text) {
      const id = newId();
      upFloor(f => ({ ...f, texts: [...f.texts, { id, x, y, text, size: DEFAULT_TEXT_SIZE, rot: 0, bold: false, color: null }] }));
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
      const { floors, nextId, fileCreatedAt } = get();
      const now = new Date().toISOString();
      const created = fileCreatedAt ?? now;
      if (!fileCreatedAt) set({ fileCreatedAt: created });
      return JSON.stringify({ version: FILE_VERSION, createdAt: created, lastModified: now, floors, nextId });
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
        dirty: false,
      });
    },
  };
});
