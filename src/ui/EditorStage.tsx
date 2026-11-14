import { useEffect, useRef, useState, useMemo } from 'react';
import { Stage, Layer, Rect, Line, Image as KImage, Circle, Group } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useStore, DEFAULT_Z, DEFAULT_CABLE_COLOR } from '../store';
import { Tool, WORLD, AUTOSAVE_KEY } from '../constants';
import { localToWorld, worldToLocal, sortByZ } from '../helpers';
import { dist, pointInRotatedRect, distToSegment, type Pt } from '../geometry/hit';
import { computeWallGeometry, wallThickness } from '../geometry/walls';
import { obstacleSegments, flushShift } from '../geometry/raycast';
import { snapTargets, snapToTargets, constrain45 } from '../geometry/snap';
import { usePrefs } from '../prefs';
import { usePalette, type Palette } from '../theme';
import { useT } from '../i18n';
import { getSprite } from './images';
import { WallsLayerContent, AlongText, formatMeters } from './WallsLayer';
import { DimensionLine, DimensionsLayerContent, SnapMarker } from './DimensionsLayer';
import { FurnitureLabels, TextNotes, TextSelection, ItemOutline, measureNote } from './AnnotationsLayer';
import { GapsLayerContent } from './GapsLayer';
import { CablesLayerContent, CableLine, CableHandles, TraysLayerContent } from './CablesLayer';
import { hitSegment, hitVertex, dedupePoints, labelObstacles, layoutCables, distToPath, cablesInTray, cableRoute, pathLength } from '../geometry/cable';
import { SimpleFurniture } from './AnnotationsLayer';
import type { WallNode, Wall, FurnitureItem, Dimension, TextNote, Cable, Tray } from '../types';
import { layerView, styleCables } from '../layers';

const TOOLBAR_W = 80;
const PANEL_W = 260;
const NODE_RADIUS = 9;
const NODE_HIT_RADIUS = 14;
const NODE_HIT_RADIUS_WALL = 30; // generous radius for wall-mode node snapping (touch-friendly)
const HANDLE_SIZE = 8;
const HANDLE_HIT = 10;
const ROT_HANDLE_DIST = 30;
const MIN_SIZE = 10;
const MEASURE_SNAP_PX = 12;
const DIM_END_HIT_PX = 10;
const DIM_LINE_HIT_PX = 6;
/** Items closer than this (screen px) to a wall / neighbour snap flush against it */
const FLUSH_SNAP_PX = 10;
const CABLE_HIT_PX = 6;
const CABLE_VERTEX_HIT_PX = 9;

/** Colour for the next new cable (the last one chosen) */
let nextCableColor = DEFAULT_CABLE_COLOR;
export function setNextCableColor(c: string) { nextCableColor = c; }

// ── Grid helpers ──────────────────────────────────────────────
const INTERVALS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
function getGridInterval(scale: number, minPx: number) {
  for (const iv of INTERVALS) if (iv * scale >= minPx) return iv;
  return INTERVALS[INTERVALS.length - 1];
}
function gridSnap(v: number, iv: number) { return Math.round(v / iv) * iv; }
function doSnap(x: number, y: number, snapSz: number) {
  return snapSz > 0 ? { x: gridSnap(x, snapSz), y: gridSnap(y, snapSz) } : { x: Math.round(x), y: Math.round(y) };
}

// ── Handle definitions ────────────────────────────────────────
type HandleAnchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';
const ANCHORS: { id: HandleAnchor; lx: (w: number) => number; ly: (h: number) => number; cursor: string }[] = [
  { id: 'tl', lx: () => 0,     ly: () => 0,     cursor: 'nwse-resize' },
  { id: 'tc', lx: (w) => w / 2, ly: () => 0,     cursor: 'ns-resize' },
  { id: 'tr', lx: (w) => w,     ly: () => 0,     cursor: 'nesw-resize' },
  { id: 'ml', lx: () => 0,     ly: (h) => h / 2, cursor: 'ew-resize' },
  { id: 'mr', lx: (w) => w,     ly: (h) => h / 2, cursor: 'ew-resize' },
  { id: 'bl', lx: () => 0,     ly: (h) => h,     cursor: 'nesw-resize' },
  { id: 'bc', lx: (w) => w / 2, ly: (h) => h,     cursor: 'ns-resize' },
  { id: 'br', lx: (w) => w,     ly: (h) => h,     cursor: 'nwse-resize' },
];

interface PosRef { id: number; x: number; y: number }
interface Mods { multi: boolean }

type DragState =
  /** Selected furniture / texts move together; `flushId` = single furniture item that snaps flush */
  | { type: 'items'; start: Pt; anchor: PosRef; base: PosRef[]; flushId: number | null }
  | { type: 'node'; id: number; offX: number; offY: number }
  | { type: 'resize'; id: number; anchor: HandleAnchor; startItem: FurnitureItem }
  | { type: 'rotate'; id: number; centerX: number; centerY: number; startAngle: number; startRot: number }
  | { type: 'wall-draw'; startNodeId: number; startPt: { x: number; y: number }; moved: boolean }
  | { type: 'wall-move'; start: Pt; a: PosRef; b: PosRef }
  | { type: 'measure'; start: Pt }
  | { type: 'dim-end'; id: number; end: 1 | 2 }
  | { type: 'dim-move'; start: Pt; base: Dimension }
  | { type: 'cable-pt'; id: number; index: number }
  | { type: 'cable-move'; start: Pt; base: Cable }
  | { type: 'tray-pt'; id: number; index: number }
  | { type: 'tray-move'; start: Pt; base: Tray }
  /** Screen-space pan by dragging empty space */
  | { type: 'pan'; start: Pt; pos0: Pt }
  /** Ctrl/Shift + drag on empty space: frame selection */
  | { type: 'marquee'; start: Pt; base: number[] }
  | null;

const WALL_DRAG_THRESHOLD = 8; // px in world coords — distinguishes tap from drag

// ── EditorStage ───────────────────────────────────────────────
export function EditorStage() {
  const stageRef  = useRef<Konva.Stage>(null);
  const isPanning = useRef(false);
  const panStart  = useRef({ x: 0, y: 0 });
  const posAtPan  = useRef({ x: 0, y: 0 });
  const dragRef   = useRef<DragState>(null);
  const pinchRef  = useRef<{ dist: number; midX: number; midY: number; scale0: number; posX0: number; posY0: number } | null>(null);

  const [pos,   setPos]   = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size,  setSize]  = useState({ w: window.innerWidth, h: window.innerHeight });
  const [previewPt, setPreviewPt] = useState<{ x: number; y: number } | null>(null);
  const [measurePreview, setMeasurePreview] = useState<Omit<Dimension, 'id'> | null>(null);
  const [snapMark, setSnapMark] = useState<Pt | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const shiftRef = useRef(false);
  const altRef = useRef(false);
  /** Cable being drawn: points placed so far (state for rendering, ref for event handlers) */
  const [cableDraft, setCableDraftState] = useState<Pt[] | null>(null);
  const cableDraftRef = useRef<Pt[] | null>(null);
  const [cablePreview, setCablePreview] = useState<Pt | null>(null);
  function setCableDraft(d: Pt[] | null) { cableDraftRef.current = d; setCableDraftState(d); if (!d) setCablePreview(null); }

  /** Ends the cable being drawn: saves it if it has at least two distinct points */
  function finishCableDraft() {
    const draft = cableDraftRef.current;
    setCableDraft(null);
    if (!draft) return;
    const pts = dedupePoints(draft);
    if (pts.length >= 2) {
      const st = useStore.getState();
      const id = st.tool === Tool.Tray ? st.addTray(pts) : st.addCable(pts, nextCableColor);
      st.select(id);
    }
  }
  const [, forceRender] = useState(0);

  const store         = useStore();
  const tool          = useStore(s => s.tool);
  const snapSize      = useStore(s => s.snapSize);
  const wallLabels    = usePrefs(s => s.wallLabels);
  const showNames     = usePrefs(s => s.showNames);
  const showGaps      = usePrefs(s => s.gaps);
  const gapWarn       = usePrefs(s => s.gapWarn);
  const sizesPos      = usePrefs(s => s.sizesPos);
  const lang          = usePrefs(s => s.lang);
  const textEdit      = useStore(s => s.textEdit);
  const palette       = usePalette();
  const t             = useT();
  const wallStartId   = useStore(s => s.wallStartId);
  const selectedId    = useStore(s => s.selectedId);
  const selection     = useStore(s => s.selection);
  const floor         = useStore(s => s.floors[s.fi]);
  const wallGeom      = useMemo(() => computeWallGeometry(floor.nodes, floor.walls), [floor.nodes, floor.walls]);
  const mode          = useStore(s => s.mode);
  const wiring        = mode === 'wiring';
  const ws            = useStore(s => s.wiring);
  /** Objects of the layer being edited: main plan, or the wiring layer in Wiring mode (with objects shown on both) */
  const act = useMemo(() => {
    const v = layerView(floor, wiring ? 'wiring' : 'main');
    return { ...v, cables: styleCables(v.cables, ws) };
  }, [floor, wiring, ws]);
  /** In Wiring mode: the main plan, drawn dimmed and not editable */
  const base = useMemo(() => {
    if (!wiring) return null;
    const v = layerView(floor, 'main', true);
    return { ...v, cables: styleCables(v.cables, ws) };
  }, [floor, wiring, ws]);
  const cablePaths = useMemo(() => layoutCables(act.cables), [act.cables]);
  const [hoverTray, setHoverTray] = useState<{ id: number; x: number; y: number } | null>(null);
  const cableAvoid    = useMemo(() => labelObstacles(wallGeom, wallLabels, floor.furniture), [wallGeom, wallLabels, floor.furniture]);

  function updateStage(x: number, y: number, s: number) {
    setPos({ x, y });
    setScale(s);
    store.setStageTransform(x, y, s);
  }

  useEffect(() => {
    const mobile = window.innerWidth < 768;
    const tbW = mobile ? 0 : TOOLBAR_W;
    const pW  = mobile ? 0 : PANEL_W;
    const x = tbW + (window.innerWidth - tbW - pW) / 2 - WORLD / 2;
    const y = (window.innerHeight - (mobile ? 56 : 0)) / 2 - WORLD / 2;
    updateStage(x, y, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fn = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      altRef.current = e.altKey;
      // Don't hijack shortcuts while the user is typing in a text field
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.code === 'KeyS') {
        e.preventDefault();
        localStorage.setItem(AUTOSAVE_KEY, st.save());
        st.markSaved();
      }
      if (mod && !e.shiftKey && e.code === 'KeyZ') { e.preventDefault(); st.undo(); }
      if ((mod && e.shiftKey && e.code === 'KeyZ') || (mod && e.code === 'KeyY')) { e.preventDefault(); st.redo(); }
      if (mod && e.code === 'KeyC') { e.preventDefault(); st.copySelected(); }
      if (mod && e.code === 'KeyV') { e.preventDefault(); st.pasteClipboard(); }
      if (mod && e.code === 'KeyX') { e.preventDefault(); st.cutSelected(); }
      if (mod && e.code === 'KeyA') {
        e.preventDefault();
        const f = layerView(st.floors[st.fi], st.mode === 'wiring' ? 'wiring' : 'main');
        if (st.tool !== Tool.Select) st.setTool(Tool.Select);
        st.setSelection([...f.furniture, ...f.texts].map(o => o.id));
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && st.selection.length > 0) {
        e.preventDefault();
        st.deleteSelected();
      }
      // Arrow keys nudge the selected furniture / texts: 1 cm, with Shift 10 cm
      if (e.code.startsWith('Arrow') && !mod && st.selection.length > 0) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0;
        const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0;
        const f = st.floors[st.fi];
        const moves = [...f.furniture, ...f.texts].filter(o => st.selection.includes(o.id)).map(o => ({ id: o.id, x: o.x + dx, y: o.y + dy }));
        if (moves.length) { e.preventDefault(); st.moveItems(moves); }
      }
      if (cableDraftRef.current && (e.code === 'Enter' || e.code === 'NumpadEnter')) { e.preventDefault(); finishCableDraft(); return; }
      if (e.code === 'Escape' && cableDraftRef.current) { setCableDraft(null); return; }
      if (e.code === 'Escape') { st.setWallStart(null); st.select(null); st.setTool(Tool.Select); setMeasurePreview(null); setSnapMark(null); }
    };
    const up = (e: KeyboardEvent) => { altRef.current = e.altKey; };
    document.addEventListener('keydown', fn);
    document.addEventListener('keyup', up);
    return () => { document.removeEventListener('keydown', fn); document.removeEventListener('keyup', up); };
  }, []);

  // Leaving the Cable tool drops an unfinished cable
  useEffect(() => { setCableDraft(null); }, [tool]);

  // Safety net: pointer released outside the canvas — finish the gesture so undo keeps working
  useEffect(() => {
    const fn = () => {
      if (dragRef.current) { dragRef.current = null; setPreviewPt(null); setMeasurePreview(null); setMarquee(null); }
      useStore.getState().endGesture();
    };
    window.addEventListener('mouseup', fn);
    window.addEventListener('touchend', fn);
    return () => { window.removeEventListener('mouseup', fn); window.removeEventListener('touchend', fn); };
  }, []);

  // Grid
  const minorIv = getGridInterval(scale, 12);
  const majorIv = getGridInterval(scale, 80);
  const viewL = Math.max(0, -pos.x / scale);
  const viewT = Math.max(0, -pos.y / scale);
  const viewR = Math.min(WORLD, viewL + size.w / scale);
  const viewB = Math.min(WORLD, viewT + size.h / scale);

  const mxT = useMemo(() => {
    const out: number[] = [];
    for (let v = Math.floor(viewL / minorIv) * minorIv; v <= viewR && v <= WORLD; v += minorIv) if (v >= 0) out.push(v);
    return out;
  }, [viewL, viewR, minorIv]);
  const myT = useMemo(() => {
    const out: number[] = [];
    for (let v = Math.floor(viewT / minorIv) * minorIv; v <= viewB && v <= WORLD; v += minorIv) if (v >= 0) out.push(v);
    return out;
  }, [viewT, viewB, minorIv]);
  const MxT = majorIv !== minorIv ? (() => { const out: number[] = []; for (let v = Math.floor(viewL / majorIv) * majorIv; v <= viewR && v <= WORLD; v += majorIv) if (v >= 0) out.push(v); return out; })() : [];
  const MyT = majorIv !== minorIv ? (() => { const out: number[] = []; for (let v = Math.floor(viewT / majorIv) * majorIv; v <= viewB && v <= WORLD; v += majorIv) if (v >= 0) out.push(v); return out; })() : [];
  const majSet = new Set([...MxT, ...MyT]);

  // ── Manual hit detection ────────────────────────────────────
  function getWorld(): { x: number; y: number } | null {
    return stageRef.current?.getRelativePointerPosition() ?? null;
  }

  function getScreen(): Pt | null {
    return stageRef.current?.getPointerPosition() ?? null;
  }

  function hitHandle(wx: number, wy: number): { type: 'resize'; anchor: HandleAnchor; cursor: string } | { type: 'rotate' } | null {
    if (selectedId === null) return null;
    const item = act.furniture.find(f => f.id === selectedId);
    if (!item) return null;
    const thr = HANDLE_HIT / scale;

    // Check rotation handle first
    const rotPt = localToWorld(item.w / 2, -ROT_HANDLE_DIST / scale, item.x, item.y, item.rot);
    if (dist(wx, wy, rotPt.x, rotPt.y) < thr) return { type: 'rotate' };

    // Check resize handles
    for (const a of ANCHORS) {
      const hPt = localToWorld(a.lx(item.w), a.ly(item.h), item.x, item.y, item.rot);
      if (dist(wx, wy, hPt.x, hPt.y) < thr) return { type: 'resize', anchor: a.id, cursor: a.cursor };
    }
    return null;
  }

  function hitFurniture(wx: number, wy: number): FurnitureItem | null {
    const ordered = sortByZ(act.furniture);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const f = ordered[i];
      if (pointInRotatedRect(wx, wy, f.x, f.y, f.w, f.h, f.rot)) return f;
    }
    return null;
  }

  function hitNode(wx: number, wy: number, radius = NODE_HIT_RADIUS): WallNode | null {
    const thr = Math.max(radius, radius / scale);
    let best: WallNode | null = null, bestD = thr;
    for (const n of floor.nodes) {
      const d = dist(wx, wy, n.x, n.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function hitWall(wx: number, wy: number): Wall | null {
    for (const w of floor.walls) {
      const na = floor.nodes.find(n => n.id === w.a);
      const nb = floor.nodes.find(n => n.id === w.b);
      if (!na || !nb) continue;
      const thick = wallThickness(w);
      if (distToSegment(wx, wy, na.x, na.y, nb.x, nb.y) < thick / 2 + 4) return w;
    }
    return null;
  }

  function hitText(wx: number, wy: number): TextNote | null {
    for (let i = act.texts.length - 1; i >= 0; i--) {
      const n = act.texts[i];
      const { w, h } = measureNote(n);
      if (pointInRotatedRect(wx, wy, n.x, n.y, w, h, n.rot)) return n;
    }
    return null;
  }

  // ── Ruler helpers ───────────────────────────────────────────
  /** Snaps a ruler end to walls / furniture / other dimensions, else to the grid; Shift keeps 45° steps from `from` */
  function measurePoint(pt: Pt, from?: Pt, excludeDimId?: number, excludeCableId?: number): { p: Pt; snapped: boolean } {
    const target = snapToTargets(pt, snapTargets(floor, wallGeom, excludeDimId, excludeCableId), MEASURE_SNAP_PX / scale);
    let p = target ?? doSnap(pt.x, pt.y, snapSize);
    if (from && shiftRef.current) p = constrain45(from, p);
    return { p, snapped: !!target };
  }

  function hitDimEnd(wx: number, wy: number): { id: number; end: 1 | 2 } | null {
    const thr = DIM_END_HIT_PX / scale;
    for (let i = act.dimensions.length - 1; i >= 0; i--) {
      const d = act.dimensions[i];
      if (dist(wx, wy, d.x1, d.y1) < thr) return { id: d.id, end: 1 };
      if (dist(wx, wy, d.x2, d.y2) < thr) return { id: d.id, end: 2 };
    }
    return null;
  }

  function hitCable(wx: number, wy: number): { cable: Cable; seg: number } | null {
    // The cable drawn nearest to the pointer (its own lane in a bundle) wins
    let best: { cable: Cable; seg: number } | null = null;
    let bestD = Infinity;
    for (let i = act.cables.length - 1; i >= 0; i--) {
      const c = act.cables[i];
      const shown = cablePaths.get(c.id) ?? c.points;
      const thr = Math.max((c.width ?? 3) / 2, CABLE_HIT_PX / scale);
      const d = distToPath(shown, { x: wx, y: wy });
      if (d <= thr && d < bestD) {
        bestD = d;
        best = { cable: c, seg: Math.max(0, hitSegment(c.points, { x: wx, y: wy }, Infinity)) };
      }
    }
    return best;
  }

  function hitTray(wx: number, wy: number): Tray | null {
    for (let i = act.trays.length - 1; i >= 0; i--) {
      const t = act.trays[i];
      if (distToPath(t.points, { x: wx, y: wy }) <= Math.max(t.width / 2, CABLE_HIT_PX / scale)) return t;
    }
    return null;
  }

  function hitDimension(wx: number, wy: number): Dimension | null {
    const thr = DIM_LINE_HIT_PX / scale;
    for (let i = act.dimensions.length - 1; i >= 0; i--) {
      const d = act.dimensions[i];
      if (distToSegment(wx, wy, d.x1, d.y1, d.x2, d.y2) < thr) return d;
    }
    return null;
  }

  // ── Resize math ─────────────────────────────────────────────
  function applyResize(wx: number, wy: number, anchor: HandleAnchor, startItem: FurnitureItem) {
    const local = worldToLocal(wx, wy, startItem.x, startItem.y, startItem.rot);
    let newX = startItem.x, newY = startItem.y;
    let newW = startItem.w, newH = startItem.h;

    const movesLeft   = anchor === 'tl' || anchor === 'ml' || anchor === 'bl';
    const movesTop    = anchor === 'tl' || anchor === 'tc' || anchor === 'tr';
    const movesRight  = anchor === 'tr' || anchor === 'mr' || anchor === 'br';
    const movesBottom = anchor === 'bl' || anchor === 'bc' || anchor === 'br';

    if (movesRight) newW = Math.max(MIN_SIZE, local.x);
    if (movesBottom) newH = Math.max(MIN_SIZE, local.y);
    if (movesLeft) {
      const clampedX = Math.min(local.x, startItem.w - MIN_SIZE);
      newW = startItem.w - clampedX;
      const origin = localToWorld(clampedX, 0, startItem.x, startItem.y, startItem.rot);
      newX = origin.x;
      newY = origin.y;
    }
    if (movesTop) {
      const clampedY = Math.min(local.y, startItem.h - MIN_SIZE);
      newH = startItem.h - clampedY;
      const origin = localToWorld(movesLeft ? Math.min(local.x, startItem.w - MIN_SIZE) : 0, clampedY, startItem.x, startItem.y, startItem.rot);
      newX = origin.x;
      newY = origin.y;
    }

    return { x: newX, y: newY, w: newW, h: newH };
  }

  // ── Drag starters ───────────────────────────────────────────
  function startPan() {
    const s = getScreen();
    if (!s) return;
    dragRef.current = { type: 'pan', start: s, pos0: { ...pos } };
    const container = stageRef.current?.container();
    if (container) container.style.cursor = 'grabbing';
  }

  /** Starts moving the current selection, anchored at the clicked object */
  function startItemsDrag(anchorId: number, pt: Pt) {
    const sel = useStore.getState().selection;
    const base: PosRef[] = [...act.furniture, ...act.texts]
      .filter(o => sel.includes(o.id))
      .map(o => ({ id: o.id, x: o.x, y: o.y }));
    const anchor = base.find(b => b.id === anchorId);
    if (!anchor) return;
    const single = base.length === 1 && act.furniture.some(f => f.id === anchorId) ? anchorId : null;
    dragRef.current = { type: 'items', start: pt, anchor, base, flushId: single };
  }

  // ── Shared pointer logic ────────────────────────────────────
  function handlePointerDown(pt: Pt, mods: Mods) {
    // A click outside the text editor only finishes editing (the editor commits on blur)
    if (useStore.getState().textEdit) return;
    // Everything that happens until pointer-up is one undo step
    store.beginGesture();

    // Remove tool
    if (tool === Tool.Remove) {
      const note = hitText(pt.x, pt.y);
      if (note) { store.deleteText(note.id); store.select(null); return; }
      const cab = hitCable(pt.x, pt.y);
      if (cab) { store.deleteCable(cab.cable.id); store.select(null); return; }
      const dim = hitDimension(pt.x, pt.y);
      if (dim) { store.deleteDimension(dim.id); return; }
      const fur = hitFurniture(pt.x, pt.y);
      if (fur) { store.deleteFurniture(fur.id); store.select(null); return; }
      const tray = hitTray(pt.x, pt.y);
      if (tray) { store.deleteTray(tray.id); store.select(null); return; }
      // Walls belong to the main plan: not editable in Wiring mode
      const node = wiring ? null : hitNode(pt.x, pt.y);
      if (node) { store.deleteNode(node.id); return; }
      const wall = wiring ? null : hitWall(pt.x, pt.y);
      if (wall) { store.deleteWall(wall.id); return; }
      startPan();
      return;
    }

    // Text — click a note to edit it, or empty space to add one
    if (tool === Tool.Text) {
      const note = hitText(pt.x, pt.y);
      if (note) { store.setTextEdit({ id: note.id, x: note.x, y: note.y }); return; }
      const p = doSnap(pt.x, pt.y, snapSize);
      store.setTextEdit({ id: null, x: p.x, y: p.y });
      return;
    }

    // Cable / tray — each click adds a point; clicking the last point again (or double-click / Enter) finishes
    if (tool === Tool.Cable || tool === Tool.Tray) {
      const draft = cableDraftRef.current;
      const last = draft?.[draft.length - 1];
      const { p } = measurePoint(pt, last);
      if (draft && last && dist(p.x, p.y, last.x, last.y) < 1) { finishCableDraft(); return; }
      setCableDraft(draft ? [...draft, p] : [p]);
      setCablePreview(p);
      return;
    }

    // Ruler — drag an existing end to adjust it, otherwise measure from point to point
    if (tool === Tool.Measure) {
      const end = hitDimEnd(pt.x, pt.y);
      if (end) { store.select(end.id); dragRef.current = { type: 'dim-end', ...end }; return; }
      const { p } = measurePoint(pt);
      dragRef.current = { type: 'measure', start: p };
      setMeasurePreview({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      setSnapMark(null);
      return;
    }

    // Wall-add tool — drag-to-draw: down = start node, drag = preview, up = end node + wall
    if (tool === Tool.WallAdd) {
      if (wiring) { startPan(); return; }
      // Try to snap to existing node or wall split
      const existingNode = hitNode(pt.x, pt.y, NODE_HIT_RADIUS_WALL);
      if (existingNode) {
        // If chaining from a previous wall, connect first
        if (wallStartId !== null && wallStartId !== existingNode.id) {
          store.addWall(wallStartId, existingNode.id);
        }
        store.setWallStart(existingNode.id);
        dragRef.current = { type: 'wall-draw', startNodeId: existingNode.id, startPt: pt, moved: false };
        return;
      }
      const wall = hitWall(pt.x, pt.y);
      if (wall) {
        const m = store.splitWall(wall.id, pt.x, pt.y);
        if (m !== null) {
          store.setWallStart(m);
          dragRef.current = { type: 'wall-draw', startNodeId: m, startPt: pt, moved: false };
        }
        return;
      }
      // Empty space — create a new node
      const p = doSnap(pt.x, pt.y, snapSize);
      const nearby = hitNode(p.x, p.y, NODE_HIT_RADIUS_WALL);
      let startId: number;
      if (nearby) {
        if (wallStartId !== null && wallStartId !== nearby.id) store.addWall(wallStartId, nearby.id);
        startId = nearby.id;
      } else {
        startId = store.addNode(p.x, p.y);
        if (wallStartId !== null) store.addWall(wallStartId, startId);
      }
      store.setWallStart(startId);
      dragRef.current = { type: 'wall-draw', startNodeId: startId, startPt: pt, moved: false };
      return;
    }

    // ── Select tool ──
    const handle = hitHandle(pt.x, pt.y);
    if (handle && !mods.multi) {
      const item = act.furniture.find(f => f.id === selectedId)!;
      if (handle.type === 'resize') {
        dragRef.current = { type: 'resize', id: item.id, anchor: handle.anchor, startItem: { ...item } };
      } else {
        const center = localToWorld(item.w / 2, item.h / 2, item.x, item.y, item.rot);
        const startAngle = Math.atan2(pt.y - center.y, pt.x - center.x);
        dragRef.current = { type: 'rotate', id: item.id, centerX: center.x, centerY: center.y, startAngle, startRot: item.rot };
      }
      return;
    }

    if (!mods.multi) {
      const end = hitDimEnd(pt.x, pt.y);
      if (end) { store.select(end.id); dragRef.current = { type: 'dim-end', ...end }; return; }
      // Points of the selected cable
      const selCable = act.cables.find(c => c.id === selectedId);
      if (selCable) {
        const v = hitVertex(selCable.points, pt, CABLE_VERTEX_HIT_PX / scale);
        if (v >= 0) { dragRef.current = { type: 'cable-pt', id: selCable.id, index: v }; return; }
      }
      const selTray = act.trays.find(t => t.id === selectedId);
      if (selTray) {
        const v = hitVertex(selTray.points, pt, CABLE_VERTEX_HIT_PX / scale);
        if (v >= 0) { dragRef.current = { type: 'tray-pt', id: selTray.id, index: v }; return; }
      }
      const cab = hitCable(pt.x, pt.y);
      if (cab) {
        store.select(cab.cable.id);
        dragRef.current = { type: 'cable-move', start: pt, base: { ...cab.cable, points: cab.cable.points.map(q => ({ ...q })) } };
        return;
      }
    }

    // Furniture and text notes (texts are drawn on top)
    const obj = hitText(pt.x, pt.y) ?? hitFurniture(pt.x, pt.y);
    if (obj) {
      const st = useStore.getState();
      if (mods.multi) {
        st.toggleSelect(obj.id);
        if (!useStore.getState().selection.includes(obj.id)) return;
      } else if (!st.selection.includes(obj.id)) {
        st.select(obj.id);
      }
      startItemsDrag(obj.id, pt);
      return;
    }

    if (!mods.multi) {
      const node = wiring ? null : hitNode(pt.x, pt.y);
      if (node) {
        store.select(null);
        dragRef.current = { type: 'node', id: node.id, offX: pt.x - node.x, offY: pt.y - node.y };
        return;
      }
      const dim = hitDimension(pt.x, pt.y);
      if (dim) {
        store.select(dim.id);
        dragRef.current = { type: 'dim-move', start: pt, base: { ...dim } };
        return;
      }
      const tray = hitTray(pt.x, pt.y);
      if (tray) {
        store.select(tray.id);
        dragRef.current = { type: 'tray-move', start: pt, base: { ...tray, points: tray.points.map(q => ({ ...q })) } };
        return;
      }
      const wall = wiring ? null : hitWall(pt.x, pt.y);
      if (wall) {
        const a = floor.nodes.find(n => n.id === wall.a), b = floor.nodes.find(n => n.id === wall.b);
        store.select(wall.id);
        if (a && b) dragRef.current = { type: 'wall-move', start: pt, a: { ...a }, b: { ...b } };
        return;
      }
    }

    // Empty space: Ctrl/Shift → frame selection, otherwise pan the plan
    if (mods.multi) {
      dragRef.current = { type: 'marquee', start: pt, base: [...useStore.getState().selection] };
      setMarquee({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      return;
    }
    store.select(null);
    startPan();
  }

  function handlePointerDrag(pt: Pt) {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === 'pan') {
      const s = getScreen();
      if (s) updateStage(d.pos0.x + s.x - d.start.x, d.pos0.y + s.y - d.start.y, scale);
    } else if (d.type === 'items') {
      let p = doSnap(d.anchor.x + pt.x - d.start.x, d.anchor.y + pt.y - d.start.y, snapSize);
      // A single item snaps flush against walls and neighbours nearby (Alt = place freely)
      if (d.flushId !== null && !altRef.current) {
        const item = act.furniture.find(f => f.id === d.flushId);
        if (item) {
          const others = act.furniture.filter(f => f.id !== item.id && f.zi >= DEFAULT_Z);
          const s = flushShift({ ...item, x: p.x, y: p.y }, obstacleSegments(wallGeom, others), FLUSH_SNAP_PX / scale);
          p = { x: p.x + s.x, y: p.y + s.y };
        }
      }
      const dx = p.x - d.anchor.x, dy = p.y - d.anchor.y;
      store.moveItems(d.base.map(b => ({ id: b.id, x: b.x + dx, y: b.y + dy })));
    } else if (d.type === 'node') {
      const p = doSnap(pt.x - d.offX, pt.y - d.offY, snapSize);
      store.moveNode(d.id, p.x, p.y);
    } else if (d.type === 'wall-move') {
      const p = doSnap(d.a.x + pt.x - d.start.x, d.a.y + pt.y - d.start.y, snapSize);
      const dx = p.x - d.a.x, dy = p.y - d.a.y;
      store.moveNodes([{ id: d.a.id, x: d.a.x + dx, y: d.a.y + dy }, { id: d.b.id, x: d.b.x + dx, y: d.b.y + dy }]);
    } else if (d.type === 'dim-move') {
      const p = doSnap(d.base.x1 + pt.x - d.start.x, d.base.y1 + pt.y - d.start.y, snapSize);
      const dx = p.x - d.base.x1, dy = p.y - d.base.y1;
      store.updateDimension(d.base.id, { x1: d.base.x1 + dx, y1: d.base.y1 + dy, x2: d.base.x2 + dx, y2: d.base.y2 + dy });
    } else if (d.type === 'cable-pt') {
      const c = act.cables.find(x => x.id === d.id);
      if (!c) return;
      const prev = c.points[d.index - 1] ?? c.points[d.index + 1];
      const { p, snapped } = measurePoint(pt, prev, undefined, d.id);
      store.updateCable(d.id, { points: c.points.map((q, i) => i === d.index ? p : q) });
      setSnapMark(snapped ? p : null);
    } else if (d.type === 'cable-move') {
      const first = d.base.points[0];
      const p = doSnap(first.x + pt.x - d.start.x, first.y + pt.y - d.start.y, snapSize);
      const dx = p.x - first.x, dy = p.y - first.y;
      store.updateCable(d.base.id, { points: d.base.points.map(q => ({ x: q.x + dx, y: q.y + dy })) });
    } else if (d.type === 'tray-pt') {
      const tr = act.trays.find(x => x.id === d.id);
      if (!tr) return;
      const prev = tr.points[d.index - 1] ?? tr.points[d.index + 1];
      let p = doSnap(pt.x, pt.y, snapSize);
      if (shiftRef.current && prev) p = constrain45(prev, p);
      store.updateTray(d.id, { points: tr.points.map((q, i) => i === d.index ? p : q) });
    } else if (d.type === 'tray-move') {
      const first = d.base.points[0];
      const p = doSnap(first.x + pt.x - d.start.x, first.y + pt.y - d.start.y, snapSize);
      const dx = p.x - first.x, dy = p.y - first.y;
      store.updateTray(d.base.id, { points: d.base.points.map(q => ({ x: q.x + dx, y: q.y + dy })) });
    } else if (d.type === 'marquee') {
      setMarquee({ x1: d.start.x, y1: d.start.y, x2: pt.x, y2: pt.y });
    } else if (d.type === 'resize') {
      const changes = applyResize(pt.x, pt.y, d.anchor, d.startItem);
      store.updateFurniture(d.id, changes);
    } else if (d.type === 'rotate') {
      const currentAngle = Math.atan2(pt.y - d.centerY, pt.x - d.centerX);
      let newRot = d.startRot + (currentAngle - d.startAngle) * 180 / Math.PI;
      if (snapSize > 0) newRot = Math.round(newRot / 15) * 15;
      store.updateFurniture(d.id, { rot: newRot });
    } else if (d.type === 'measure') {
      const { p, snapped } = measurePoint(pt, d.start);
      setMeasurePreview({ x1: d.start.x, y1: d.start.y, x2: p.x, y2: p.y });
      setSnapMark(snapped ? p : null);
    } else if (d.type === 'dim-end') {
      const dim = act.dimensions.find(x => x.id === d.id);
      if (!dim) return;
      const other = d.end === 1 ? { x: dim.x2, y: dim.y2 } : { x: dim.x1, y: dim.y1 };
      const { p, snapped } = measurePoint(pt, other, d.id);
      store.updateDimension(d.id, d.end === 1 ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y });
      setSnapMark(snapped ? p : null);
    } else if (d.type === 'wall-draw') {
      // Mark as dragged once past threshold
      if (!d.moved && dist(pt.x, pt.y, d.startPt.x, d.startPt.y) > WALL_DRAG_THRESHOLD / scale) {
        d.moved = true;
      }
      if (d.moved) {
        // Show wall preview to snapped endpoint (or snap to nearby node)
        const nearNode = hitNode(pt.x, pt.y, NODE_HIT_RADIUS_WALL);
        if (nearNode) {
          setPreviewPt({ x: nearNode.x, y: nearNode.y });
        } else {
          setPreviewPt(doSnap(pt.x, pt.y, snapSize));
        }
      }
    }
  }

  function handlePointerUp() {
    try {
      finishDrag();
    } finally {
      store.endGesture();
    }
  }

  function finishDrag() {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const pt = getWorld();
    dragRef.current = null;

    if (d.type === 'pan') {
      const container = stageRef.current?.container();
      if (container) container.style.cursor = 'default';
      return;
    }

    if (d.type === 'marquee') {
      setMarquee(null);
      if (!pt) return;
      const x1 = Math.min(d.start.x, pt.x), x2 = Math.max(d.start.x, pt.x);
      const y1 = Math.min(d.start.y, pt.y), y2 = Math.max(d.start.y, pt.y);
      const inside = (p: Pt) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
      const picked = [
        ...act.furniture.filter(f => inside(localToWorld(f.w / 2, f.h / 2, f.x, f.y, f.rot))),
        ...act.texts.filter(n => { const m = measureNote(n); return inside(localToWorld(m.w / 2, m.h / 2, n.x, n.y, n.rot)); }),
      ].map(o => o.id);
      store.setSelection([...d.base, ...picked]);
      return;
    }

    if (d.type === 'measure') {
      setMeasurePreview(null);
      setSnapMark(null);
      // Use the release point itself (the last preview state may not have rendered yet)
      if (!pt) return;
      const { p } = measurePoint(pt, d.start);
      if (dist(d.start.x, d.start.y, p.x, p.y) >= 2) store.addDimension(d.start.x, d.start.y, p.x, p.y);
      return;
    }
    if (d.type === 'dim-end' || d.type === 'cable-pt') {
      setSnapMark(null);
      return;
    }

    if (d.type === 'wall-draw') {
      if (!d.moved) {
        // Tap without drag → end the chain (deselect wallStart)
        store.setWallStart(null);
        setPreviewPt(null);
        return;
      }
      // Drag completed → create end node + wall
      if (!pt) { setPreviewPt(null); return; }
      const nearNode = hitNode(pt.x, pt.y, NODE_HIT_RADIUS_WALL);
      let endId: number;
      if (nearNode && nearNode.id !== d.startNodeId) {
        endId = nearNode.id;
      } else if (nearNode && nearNode.id === d.startNodeId) {
        // Dragged back to start — cancel
        setPreviewPt(null);
        return;
      } else {
        const p = doSnap(pt.x, pt.y, snapSize);
        const existing = hitNode(p.x, p.y, NODE_HIT_RADIUS_WALL);
        if (existing && existing.id !== d.startNodeId) {
          endId = existing.id;
        } else {
          endId = store.addNode(p.x, p.y);
        }
      }
      store.addWall(d.startNodeId, endId);
      store.setWallStart(endId); // chain: ready for next drag
      setPreviewPt(null);
    }
    // items, node, wall-move, dim-move, resize, rotate: already applied (and snapped) while dragging
  }

  // ── Mouse event handlers ───────────────────────────────────
  function onWheel(ev: KonvaEventObject<WheelEvent>) {
    ev.evt.preventDefault();
    const factor = ev.evt.deltaY < 0 ? 1.1 : 0.9;
    const ns = Math.max(0.1, Math.min(20, scale * factor));
    const ptr = stageRef.current!.getPointerPosition()!;
    updateStage(ptr.x - (ptr.x - pos.x) / scale * ns, ptr.y - (ptr.y - pos.y) / scale * ns, ns);
  }

  function onMouseDown(e: KonvaEventObject<MouseEvent>) {
    shiftRef.current = e.evt.shiftKey;
    altRef.current = e.evt.altKey;
    if (e.evt.button === 2 || e.evt.button === 1) {
      if (e.evt.button === 2) {
        const pt = getWorld();
        if (pt) {
          const wall = wiring ? null : hitWall(pt.x, pt.y);
          if (wall) { store.toggleExterior(wall.id); return; }
        }
      }
      e.evt.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY };
      posAtPan.current = { ...pos };
      const container = stageRef.current?.container();
      if (container) container.style.cursor = 'grabbing';
      return;
    }
    if (e.evt.button !== 0) return;
    const pt = getWorld();
    if (!pt) return;
    handlePointerDown(pt, { multi: e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey });
  }

  function onMouseMove(e: KonvaEventObject<MouseEvent>) {
    shiftRef.current = e.evt.shiftKey;
    altRef.current = e.evt.altKey;
    if (isPanning.current) {
      updateStage(
        posAtPan.current.x + e.evt.clientX - panStart.current.x,
        posAtPan.current.y + e.evt.clientY - panStart.current.y,
        scale
      );
      return;
    }

    if (dragRef.current) {
      const pt = getWorld();
      if (!pt) return;
      handlePointerDrag(pt);
      return;
    }

    // Ruler / cable hover: show where the next point would snap
    if (tool === Tool.Measure || tool === Tool.Cable || tool === Tool.Tray) {
      const pt = getWorld();
      if (pt) {
        const draft = cableDraftRef.current;
        const drawing = tool === Tool.Cable || tool === Tool.Tray;
        const { p, snapped } = measurePoint(pt, drawing ? draft?.[draft.length - 1] : undefined);
        setSnapMark(snapped ? p : null);
        if (drawing && draft) setCablePreview(p);
      }
    } else if (snapMark) {
      setSnapMark(null);
    }

    // Tray hover (Wiring mode): show which cables run in it
    if (wiring && !cableDraftRef.current) {
      const pt = getWorld();
      const tr = pt ? hitTray(pt.x, pt.y) : null;
      const sp = getScreen();
      if (tr && sp) setHoverTray({ id: tr.id, x: sp.x, y: sp.y });
      else if (hoverTray) setHoverTray(null);
    } else if (hoverTray) setHoverTray(null);

    // Wall hover preview (mouse only — no button pressed, chain active)
    if (tool === Tool.WallAdd && wallStartId !== null) {
      const pt = getWorld();
      if (pt) setPreviewPt(doSnap(pt.x, pt.y, snapSize));
    } else if (previewPt && !dragRef.current) {
      setPreviewPt(null);
    }

    // Cursor hint
    const container = stageRef.current?.container();
    if (container) {
      const pt = getWorld();
      if (pt) {
        if (tool === Tool.Select) {
          const handle = hitHandle(pt.x, pt.y);
          if (handle) {
            container.style.cursor = handle.type === 'rotate' ? 'grab' : (handle as { cursor: string }).cursor;
          } else if (hitDimEnd(pt.x, pt.y)) {
            container.style.cursor = 'pointer';
          } else if (hitCable(pt.x, pt.y) || hitText(pt.x, pt.y) || hitFurniture(pt.x, pt.y) || hitDimension(pt.x, pt.y) || hitTray(pt.x, pt.y)
            || (!wiring && (hitNode(pt.x, pt.y) || hitWall(pt.x, pt.y)))) {
            container.style.cursor = 'move';
          } else {
            container.style.cursor = e.evt.ctrlKey || e.evt.shiftKey || e.evt.metaKey ? 'crosshair' : 'grab';
          }
        } else if (tool === Tool.Remove) {
          const hit = hitFurniture(pt.x, pt.y) || hitNode(pt.x, pt.y) || hitWall(pt.x, pt.y) || hitDimension(pt.x, pt.y) || hitText(pt.x, pt.y) || hitCable(pt.x, pt.y);
          container.style.cursor = hit ? 'pointer' : 'grab';
        } else if (tool === Tool.Text) {
          container.style.cursor = hitText(pt.x, pt.y) ? 'text' : 'crosshair';
        } else if (tool === Tool.Measure) {
          container.style.cursor = hitDimEnd(pt.x, pt.y) ? 'pointer' : 'crosshair';
        } else if (tool === Tool.Cable || tool === Tool.Tray) {
          container.style.cursor = 'crosshair';
        } else if (tool === Tool.WallAdd) {
          container.style.cursor = 'crosshair';
        } else {
          container.style.cursor = 'default';
        }
      }
    }
  }

  /**
   * Double-click: on a selected cable add / remove a point; on a text note edit it.
   * (A cable is finished by its own rule: clicking the last point again — that is what a real double-click does.
   * Konva reports any two quick clicks as a double-click, even far apart, so it must not finish cables.)
   */
  function onDblClick() {
    if (tool === Tool.Cable || tool === Tool.Tray) return;
    if (tool !== Tool.Select) return;
    const pt = getWorld();
    if (!pt) return;
    const selTray = act.trays.find(t => t.id === selectedId);
    if (selTray) {
      const v = hitVertex(selTray.points, pt, CABLE_VERTEX_HIT_PX / scale);
      if (v >= 0) {
        if (selTray.points.length > 2) store.updateTray(selTray.id, { points: selTray.points.filter((_, i) => i !== v) });
        return;
      }
      const seg = hitSegment(selTray.points, pt, Math.max(selTray.width / 2, CABLE_HIT_PX / scale));
      if (seg >= 0) {
        const pts = [...selTray.points];
        pts.splice(seg + 1, 0, doSnap(pt.x, pt.y, snapSize));
        store.updateTray(selTray.id, { points: pts });
        return;
      }
    }
    const selCable = act.cables.find(c => c.id === selectedId);
    if (selCable) {
      const v = hitVertex(selCable.points, pt, CABLE_VERTEX_HIT_PX / scale);
      if (v >= 0) {
        if (selCable.points.length > 2) store.updateCable(selCable.id, { points: selCable.points.filter((_, i) => i !== v) });
        return;
      }
      const seg = hitSegment(selCable.points, pt, Math.max((selCable.width ?? 3) / 2, CABLE_HIT_PX / scale));
      if (seg >= 0) {
        const p = doSnap(pt.x, pt.y, snapSize);
        const pts = [...selCable.points];
        pts.splice(seg + 1, 0, p);
        store.updateCable(selCable.id, { points: pts });
        return;
      }
    }
    const note = hitText(pt.x, pt.y);
    if (note) store.setTextEdit({ id: note.id, x: note.x, y: note.y });
  }

  function onMouseUp(e: KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 2 || e.evt.button === 1) {
      isPanning.current = false;
      const container = stageRef.current?.container();
      if (container) container.style.cursor = 'default';
      return;
    }
    handlePointerUp();
  }

  // ── Touch event handlers ───────────────────────────────────
  function onTouchStart(e: KonvaEventObject<TouchEvent>) {
    e.evt.preventDefault();
    const touches = e.evt.touches;

    if (touches.length >= 2) {
      // Start pinch/pan — cancel any ongoing drag
      if (dragRef.current) { dragRef.current = null; setPreviewPt(null); setMeasurePreview(null); setMarquee(null); store.endGesture(); }
      const t0 = touches[0], t1 = touches[1];
      pinchRef.current = {
        dist: dist(t0.clientX, t0.clientY, t1.clientX, t1.clientY),
        midX: (t0.clientX + t1.clientX) / 2,
        midY: (t0.clientY + t1.clientY) / 2,
        scale0: scale, posX0: pos.x, posY0: pos.y,
      };
      return;
    }

    // Single touch = left click (empty space pans)
    const pt = getWorld();
    if (!pt) return;
    handlePointerDown(pt, { multi: false });
  }

  function onTouchMove(e: KonvaEventObject<TouchEvent>) {
    e.evt.preventDefault();
    const touches = e.evt.touches;

    if (touches.length >= 2 && pinchRef.current) {
      const t0 = touches[0], t1 = touches[1];
      const newDist = dist(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
      const newMidX = (t0.clientX + t1.clientX) / 2;
      const newMidY = (t0.clientY + t1.clientY) / 2;
      const p = pinchRef.current;

      const zoomFactor = newDist / p.dist;
      const ns = Math.max(0.1, Math.min(20, p.scale0 * zoomFactor));

      // Zoom centered on initial midpoint, then add pan offset
      let nx = p.midX - (p.midX - p.posX0) / p.scale0 * ns;
      let ny = p.midY - (p.midY - p.posY0) / p.scale0 * ns;
      nx += newMidX - p.midX;
      ny += newMidY - p.midY;

      updateStage(nx, ny, ns);
      return;
    }

    if (dragRef.current) {
      const pt = getWorld();
      if (!pt) return;
      handlePointerDrag(pt);
    }
  }

  function onTouchEnd(e: KonvaEventObject<TouchEvent>) {
    e.evt.preventDefault();

    // If pinching and fingers lifted, clear pinch state
    if (pinchRef.current) {
      if (e.evt.touches.length < 2) pinchRef.current = null;
      return;
    }

    handlePointerUp();
  }

  const startNode = wallStartId !== null ? floor.nodes.find(n => n.id === wallStartId) : null;
  const selectedItem = selectedId !== null ? act.furniture.find(f => f.id === selectedId) : null;
  const selectedNote = selectedId !== null ? act.texts.find(n => n.id === selectedId) : null;
  const selectedWall = selectedId !== null ? wallGeom.walls.find(g => g.wall.id === selectedId) : null;
  const selectedDim = selectedId !== null ? act.dimensions.find(d => d.id === selectedId) : null;
  const selectedCable = selectedId !== null ? act.cables.find(c => c.id === selectedId) : null;
  const selectedTray = selectedId !== null ? act.trays.find(t => t.id === selectedId) : null;
  const hoveredTray = hoverTray ? act.trays.find(t => t.id === hoverTray.id) ?? null : null;
  const trayCables = hoveredTray ? cablesInTray(hoveredTray, act.cables) : null;
  const multi = selection.length > 1;
  const onImageLoaded = () => forceRender(c => c + 1);
  const px = 1 / scale;

  return (
    <>
    {hoveredTray && hoverTray && trayCables && (
      <div className="tray-tip" style={{ left: hoverTray.x + 14, top: hoverTray.y + 14 }}>
        <div className="tray-tip-title">{hoveredTray.label || t('tool.tray')} · {t('tray.count', { n: trayCables.length })}</div>
        {trayCables.length === 0 && <div className="tray-tip-row">{t('tray.none')}</div>}
        {trayCables.map(c => (
          <div key={c.id} className="tray-tip-row">
            <span className="tray-tip-dot" style={{ background: c.color }} />
            <span>{[c.label, cableRoute(c)].filter(Boolean).join(' · ') || '—'}</span>
            <span className="tray-tip-len">{formatMeters(pathLength(c.points), t('unit.m'))}</span>
          </div>
        ))}
      </div>
    )}
    <Stage
      ref={stageRef}
      width={size.w} height={size.h}
      x={pos.x} y={pos.y} scaleX={scale} scaleY={scale}
      onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      onDblClick={onDblClick} onDblTap={onDblClick}
      onContextMenu={(e: KonvaEventObject<MouseEvent>) => e.evt.preventDefault()}
      style={{ position: 'fixed', top: 0, left: 0, zIndex: 0, touchAction: 'none' }}
    >
      {/* Grid */}
      <Layer listening={false}>
        <Rect x={0} y={0} width={WORLD} height={WORLD} fill={palette.paper} />
        {mxT.map(t => <Line key={`vx${t}`} points={[t, viewT, t, viewB]} stroke={majSet.has(t) ? palette.gridMajor : palette.gridMinor} strokeWidth={majSet.has(t) ? 0.8 : 0.5} />)}
        {myT.map(t => <Line key={`hy${t}`} points={[viewL, t, viewR, t]} stroke={majSet.has(t) ? palette.gridMajor : palette.gridMinor} strokeWidth={majSet.has(t) ? 0.8 : 0.5} />)}
      </Layer>

      {/* All shapes */}
      <Layer listening={false}>
        <Group opacity={wiring ? ws.planDim / 100 : 1}>
        {/* Walls */}
        <WallsLayerContent geom={wallGeom} palette={palette} labels={wallLabels} unit={t('unit.m')} />
        {selectedWall && (
          <Line points={selectedWall.polygon.flatMap(p => [p.x, p.y])} closed
            stroke={palette.accent} strokeWidth={2 * px} dash={[6 * px, 3 * px]} />
        )}

        {/* Nodes */}
        {!wiring && floor.nodes.map(n => {
          const isStart = n.id === wallStartId;
          return (
            <Circle key={n.id} x={n.x} y={n.y} radius={NODE_RADIUS}
              fill={isStart ? palette.accent : palette.node}
              stroke={isStart ? palette.paper : palette.nodeStroke}
              strokeWidth={isStart ? 2 : 1} />
          );
        })}

        {/* Main plan objects under the wiring layer (Wiring mode only) */}
        {base && (
          <Group>
            {sortByZ(base.furniture).map(item => (
              <FurnitureVisual key={item.id} item={item} palette={palette} onImageLoaded={onImageLoaded} />
            ))}
            <CablesLayerContent cables={base.cables} palette={palette} unitM={t('unit.m')} avoid={cableAvoid}
              labelSize={ws.cableText} showLabels={ws.cableLabels} />
            <FurnitureLabels furniture={base.furniture} palette={palette} showNames={showNames} lang={lang} sizesPos={sizesPos} />
            <TextNotes texts={base.texts} palette={palette} />
            <DimensionsLayerContent dims={base.dimensions} palette={palette} unit={t('unit.m')} px={px} />
          </Group>
        )}
        </Group>

        {/* Cable trays (wiring layer) */}
        <TraysLayerContent trays={act.trays} palette={palette} highlightId={hoveredTray?.id ?? selectedTray?.id} textSize={ws.trayText} />
        {selectedTray && <CableHandles cable={{ id: selectedTray.id, points: selectedTray.points, color: palette.accent }} palette={palette} px={px} />}

        {/* Wall preview */}
        {startNode && previewPt && (
          <>
            <Line points={[startNode.x, startNode.y, previewPt.x, previewPt.y]}
              stroke={palette.accent} strokeWidth={1.5} dash={[6, 4]} />
            {dist(startNode.x, startNode.y, previewPt.x, previewPt.y) > 1 && (
              <PreviewLength a={startNode} b={previewPt} scale={scale} color={palette.accent} bg={palette.paper} unit={t('unit.m')} />
            )}
          </>
        )}

        {/* Furniture */}
        {sortByZ(act.furniture).map(item => (
          <FurnitureVisual key={item.id} item={item} palette={palette} onImageLoaded={onImageLoaded} />
        ))}

        {/* Cables (above furniture) */}
        <CablesLayerContent cables={act.cables} palette={palette} unitM={t('unit.m')} avoid={cableAvoid}
          labelSize={ws.cableText} showLabels={ws.cableLabels}
          highlight={trayCables ? new Set(trayCables.map(c => c.id)) : undefined} />
        {cableDraft && (
          <CableLine points={cablePreview ? [...cableDraft, cablePreview] : cableDraft}
            color={tool === Tool.Tray ? palette.accent : nextCableColor}
            width={tool === Tool.Tray ? ws.trayWidth : ws.cableWidth} palette={palette} dashed />
        )}
        {cableDraft && cableDraft.map((q, i) => <Circle key={`cd${i}`} x={q.x} y={q.y} radius={4 * px} fill={nextCableColor} />)}
        {selectedCable && <CableHandles cable={selectedCable} shown={cablePaths.get(selectedCable.id)} palette={palette} px={px} />}

        {/* Free space around the selected item */}
        {selectedItem && showGaps && (
          <GapsLayerContent item={selectedItem} furniture={floor.furniture} geom={wallGeom} palette={palette}
            px={px} warnBelow={gapWarn} unit={t('unit.cm')} />
        )}

        {/* Labels, sizes and text notes */}
        <FurnitureLabels furniture={act.furniture} palette={palette} showNames={showNames} lang={lang} sizesPos={sizesPos} />
        <TextNotes texts={act.texts} palette={palette} hideId={textEdit?.id} />
        {selectedNote && !textEdit && <TextSelection note={selectedNote} palette={palette} px={px} />}

        {/* Ruler measurements */}
        <DimensionsLayerContent dims={act.dimensions} palette={palette} unit={t('unit.m')} px={px} />
        {selectedDim && (
          <Group>
            <DimensionLine d={selectedDim} palette={palette} unit={t('unit.m')} px={px} preview />
            <Circle x={selectedDim.x1} y={selectedDim.y1} radius={5 * px} fill={palette.paper} stroke={palette.accent} strokeWidth={1.5 * px} />
            <Circle x={selectedDim.x2} y={selectedDim.y2} radius={5 * px} fill={palette.paper} stroke={palette.accent} strokeWidth={1.5 * px} />
          </Group>
        )}
        {measurePreview && <DimensionLine d={measurePreview} palette={palette} unit={t('unit.m')} px={px} preview />}
        {snapMark && <SnapMarker x={snapMark.x} y={snapMark.y} palette={palette} px={px} />}

        {/* Group selection outlines */}
        {multi && act.furniture.filter(f => selection.includes(f.id)).map(f => (
          <ItemOutline key={`o${f.id}`} x={f.x} y={f.y} w={f.w} h={f.h} rot={f.rot} palette={palette} px={px} />
        ))}
        {multi && act.texts.filter(n => selection.includes(n.id)).map(n => (
          <TextSelection key={`o${n.id}`} note={n} palette={palette} px={px} />
        ))}

        {/* Selection handles */}
        {selectedItem && <SelectionHandles item={selectedItem} scale={scale} palette={palette} />}

        {/* Frame selection */}
        {marquee && (
          <Rect x={Math.min(marquee.x1, marquee.x2)} y={Math.min(marquee.y1, marquee.y2)}
            width={Math.abs(marquee.x2 - marquee.x1)} height={Math.abs(marquee.y2 - marquee.y1)}
            fill={palette.accent} opacity={0.12} />
        )}
        {marquee && (
          <Rect x={Math.min(marquee.x1, marquee.x2)} y={Math.min(marquee.y1, marquee.y2)}
            width={Math.abs(marquee.x2 - marquee.x1)} height={Math.abs(marquee.y2 - marquee.y1)}
            stroke={palette.accent} strokeWidth={1 * px} dash={[4 * px, 3 * px]} />
        )}
      </Layer>
    </Stage>
    </>
  );
}

// ── Live length of the wall being drawn ───────────────────────
function PreviewLength({ a, b, scale, color, bg, unit }: { a: { x: number; y: number }; b: { x: number; y: number }; scale: number; color: string; bg: string; unit: string }) {
  const len = dist(a.x, a.y, b.x, b.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const off = 14 / scale;
  const size = 12 / scale;
  const p = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
  return (
    <Group>
      <AlongText p={p} angleDeg={angle} text={formatMeters(len, unit)} color={color} size={size} halo={bg} />
    </Group>
  );
}

// ── Selection handles (purely visual) ─────────────────────────
function SelectionHandles({ item, scale, palette }: { item: FurnitureItem; scale: number; palette: Palette }) {
  const hs = HANDLE_SIZE / scale;
  const rotDist = ROT_HANDLE_DIST / scale;
  const rotRadius = 5 / scale;
  const lineWidth = 1.5 / scale;

  return (
    <Group x={item.x} y={item.y} rotation={item.rot}>
      {/* Selection border */}
      <Rect x={-2 / scale} y={-2 / scale} width={item.w + 4 / scale} height={item.h + 4 / scale}
        stroke={palette.accent} strokeWidth={lineWidth} dash={[6 / scale, 3 / scale]} />

      {/* Resize handles */}
      {ANCHORS.map(a => (
        <Rect key={a.id}
          x={a.lx(item.w) - hs / 2} y={a.ly(item.h) - hs / 2}
          width={hs} height={hs}
          fill={palette.paper} stroke={palette.accent} strokeWidth={lineWidth} />
      ))}

      {/* Rotation handle line + circle */}
      <Line points={[item.w / 2, 0, item.w / 2, -rotDist]} stroke={palette.accent} strokeWidth={lineWidth} />
      <Circle x={item.w / 2} y={-rotDist} radius={rotRadius}
        fill={palette.paper} stroke={palette.accent} strokeWidth={lineWidth} />
    </Group>
  );
}

// ── Purely visual furniture ───────────────────────────────────
function FurnitureVisual({ item, palette, onImageLoaded }: { item: FurnitureItem; palette: Palette; onImageLoaded: () => void }) {
  if (item.simple) return <SimpleFurniture item={item} palette={palette} />;
  const img = getSprite(item.path, palette.dark, onImageLoaded, item.color);

  return (
    <Group x={item.x} y={item.y} rotation={item.rot}>
      {img && <KImage image={img} width={item.w} height={item.h}
        x={item.flipX ? item.w : 0} y={item.flipY ? item.h : 0} scaleX={item.flipX ? -1 : 1} scaleY={item.flipY ? -1 : 1} />}
      {!img && <Rect width={item.w} height={item.h} fill={palette.placeholderFill} stroke={palette.placeholderStroke} strokeWidth={1} dash={[4, 2]} />}
    </Group>
  );
}
