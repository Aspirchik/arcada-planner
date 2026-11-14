import { create } from 'zustand';
import { Tool, METER } from './constants';
import type { FurnitureItem, FloorState, CatalogItem, Dimension, TextNote } from './types';
import { translate, type TKey, type TParams } from './i18n';

const HISTORY_LIMIT = 50;
/** Project file format. 2.1.0 adds dimensions (ruler), text notes and furniture labels; 2.0.0 files still load. */
export const FILE_VERSION = '2.1.0';
export const DEFAULT_Z = 100;
export const DEFAULT_TEXT_SIZE = 20;

export type Clipboard = { kind: 'furniture'; item: FurnitureItem } | { kind: 'text'; item: TextNote };

export interface History {
  undo: FloorState[];
  redo: FloorState[];
}

function emptyFloor(): FloorState {
  return { nodes: [], walls: [], furniture: [], dimensions: [], texts: [] };
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

    const walls = f.walls.filter((w): w is { id: number; a: number; b: number; exterior?: unknown } =>
      !!w && isNum(w.id) && isNum(w.a) && isNum(w.b) && w.a !== w.b && nodeIds.has(w.a) && nodeIds.has(w.b)
    ).map(w => ({ id: w.id, a: w.a, b: w.b, exterior: w.exterior === true }));

    const furniture = f.furniture.filter((it): it is Record<string, unknown> & { id: number; path: string; x: number; y: number; w: number; h: number } =>
      !!it && isNum(it.id) && typeof it.path === 'string' && isNum(it.x) && isNum(it.y) && isNum(it.w) && isNum(it.h) && it.w > 0 && it.h > 0
    ).map(it => ({
      id: it.id, path: it.path, x: it.x, y: it.y, w: it.w, h: it.h,
      rot: isNum(it.rot) ? it.rot : 0,
      zi: isNum(it.zi) ? it.zi : DEFAULT_Z,
      ...(typeof it.name === 'string' ? { name: it.name } : {}),
      ...(typeof it.label === 'string' && it.label ? { label: it.label } : {}),
    }));

    const dimensions = (Array.isArray(f.dimensions) ? f.dimensions : []).filter((dm): dm is Dimension =>
      !!dm && isNum(dm.id) && isNum(dm.x1) && isNum(dm.y1) && isNum(dm.x2) && isNum(dm.y2)
    ).map(dm => ({ id: dm.id, x1: dm.x1, y1: dm.y1, x2: dm.x2, y2: dm.y2 }));

    const texts = (Array.isArray(f.texts) ? f.texts : []).filter((tx): tx is Record<string, unknown> & { id: number; x: number; y: number; text: string } =>
      !!tx && isNum(tx.id) && isNum(tx.x) && isNum(tx.y) && typeof tx.text === 'string'
    ).map((tx): TextNote => ({
      id: tx.id, x: tx.x, y: tx.y, text: tx.text,
      size: isNum(tx.size) && tx.size > 0 ? tx.size : DEFAULT_TEXT_SIZE,
      rot: isNum(tx.rot) ? tx.rot : 0,
      bold: tx.bold === true,
      color: typeof tx.color === 'string' ? tx.color : null,
    }));

    for (const o of [...nodes, ...walls, ...furniture, ...dimensions, ...texts]) maxId = Math.max(maxId, o.id);
    return { nodes, walls, furniture, dimensions, texts };
  });

  const nextId = Math.max(isNum(d.nextId) ? d.nextId : 1, maxId + 1);
  const createdAt = typeof d.createdAt === 'string' ? d.createdAt : null;
  return { floors, nextId, createdAt };
}

export function isProjectEmpty(floors: FloorState[]): boolean {
  return floors.every(f => f.nodes.length === 0 && f.furniture.length === 0 && f.dimensions.length === 0 && f.texts.length === 0);
}

// ── Store ──────────────────────────────────────────────────────
interface Store {
  tool: Tool;
  snapSize: number; // 0 = off, otherwise world units (e.g. 10 = 10cm)
  floors: FloorState[];
  /** Undo/redo history, one entry per floor (same index as `floors`) */
  histories: History[];
  fi: number;
  selectedId: number | null;
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

  addFurniture(item: CatalogItem, cx: number, cy: number): number;
  deleteFurniture(id: number): void;
  updateFurniture(id: number, changes: Partial<FurnitureItem>): void;
  bringToFront(id: number): void;
  sendToBack(id: number): void;

  addDimension(x1: number, y1: number, x2: number, y2: number): number;
  updateDimension(id: number, changes: Partial<Omit<Dimension, 'id'>>): void;
  deleteDimension(id: number): void;

  addText(x: number, y: number, text: string): number;
  updateText(id: number, changes: Partial<Omit<TextNote, 'id'>>): void;
  deleteText(id: number): void;
  /** Deletes the selected furniture item or text note */
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
    wallStartId: null,
    nextId: 1,
    stageX: 0,
    stageY: 0,
    stageScale: 1,
    clipboard: null,
    fileCreatedAt: null,
    dirty: false,
    textEdit: null,

    setTool: (tool) => set({ tool, wallStartId: null, selectedId: null }),
    setSnapSize: (snapSize) => set({ snapSize }),
    select: (id) => set({ selectedId: id }),
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
          { id: w1, a: wall.a, b: mid, exterior: wall.exterior },
          { id: w2, a: mid, b: wall.b, exterior: wall.exterior },
        ],
      }));
      return mid;
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
      set({ selectedId: id, tool: Tool.Select });
      return id;
    },

    deleteFurniture(id) {
      upFloor(f => ({ ...f, furniture: f.furniture.filter(it => it.id !== id) }));
    },

    updateFurniture(id, changes) {
      upFloor(f => ({ ...f, furniture: f.furniture.map(it => it.id === id ? { ...it, ...changes } : it) }));
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
      const { selectedId, fi, floors } = get();
      if (selectedId === null) return;
      if (floors[fi].texts.some(tx => tx.id === selectedId)) get().deleteText(selectedId);
      else get().deleteFurniture(selectedId);
      set({ selectedId: null });
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
        wallStartId: null,
        dirty: true,
      });
    },

    copySelected() {
      const { selectedId, fi, floors } = get();
      if (selectedId === null) return;
      const item = floors[fi].furniture.find(f => f.id === selectedId);
      if (item) { set({ clipboard: { kind: 'furniture', item: { ...item } } }); return; }
      const note = floors[fi].texts.find(tx => tx.id === selectedId);
      if (note) set({ clipboard: { kind: 'text', item: { ...note } } });
    },

    pasteClipboard() {
      const { clipboard } = get();
      if (!clipboard) return;
      const id = newId();
      if (clipboard.kind === 'furniture') {
        const pasted: FurnitureItem = { ...clipboard.item, id, x: clipboard.item.x + 20, y: clipboard.item.y + 20 };
        upFloor(f => ({ ...f, furniture: [...f.furniture, pasted] }));
        set({ selectedId: id, clipboard: { kind: 'furniture', item: { ...pasted } } });
      } else {
        const pasted: TextNote = { ...clipboard.item, id, x: clipboard.item.x + 20, y: clipboard.item.y + 20 };
        upFloor(f => ({ ...f, texts: [...f.texts, pasted] }));
        set({ selectedId: id, clipboard: { kind: 'text', item: { ...pasted } } });
      }
    },

    cutSelected() {
      if (get().selectedId === null) return;
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
        wallStartId: null,
        fileCreatedAt: p.createdAt,
        dirty: false,
      });
    },
  };
});
