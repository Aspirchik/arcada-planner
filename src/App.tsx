import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2, BringToFront, SendToBack, Bold, Pencil, Type, Square, Image as ImageIcon, FlipHorizontal2, FlipVertical2, Ruler, Layers, Palette as PaletteIcon, GitBranchPlus, Link2, Unlink, Cable as CableIcon, MoveVertical, ArrowUpToLine, Plus, Minus, Combine, Plug, X, Eraser, Lock, LockOpen, Magnet } from 'lucide-react';
import { EditorStage } from './ui/EditorStage';
import { Toolbar } from './ui/Toolbar';
import { FurniturePanel } from './ui/FurniturePanel';
import { PrintView } from './ui/PrintView';
import { TextEditor } from './ui/TextEditor';
import { measureNote } from './ui/AnnotationsLayer';
import { rectCorners } from './geometry/hit';
import { useStore, parseProject, isProjectEmpty } from './store';
import { onLayer, styleCables, trayLayer, heightCtx } from './layers';
import { cableHeights, itemElevation, verticalRun } from './geometry/heights';
import { pathLength, patchLength, PATCH_LENGTHS } from './geometry/cable';
import { itemNamer, portCount, portTag, isTwoPart, isDevice, deviceNics, isPassThrough } from './labels';
import { derivedTag, otherEnd } from './geometry/ports';
import { frameInset, DEFAULT_FRAME_INSET } from './geometry/desk';
import { translate } from './i18n';
import { itemName } from './labels';
import { normalizeMac, isMac, isIp } from './geometry/netaddr';
import { CableGroupChips } from './ui/GroupsPanel';
import { cablesInTray, cableRouteText, cableLength } from './geometry/cable';
import { chainMembers, collapseToChains, chainInfos, chainRoots } from './geometry/chain';
import { formatMeters } from './geometry/wallLabels';
import { setNextCableColor } from './ui/EditorStage';
import { usePrefs, type Lang } from './prefs';
import { useT, HTML_LANG, type TKey } from './i18n';
import { wallThickness } from './geometry/walls';
import type { LabelPos, Layer, Cable, FloorState, FurnitureItem } from './types';
import { useIsDark } from './theme';
import { projectErrorText } from './ui/Toolbar';
import { METER, AUTOSAVE_KEY } from './constants';
import './App.css';

const AUTOSAVE_INTERVAL_MS = 30_000;

/**
 * Number field that commits its value only on Enter / blur (one undo step per edit),
 * not on every keystroke. Escape reverts the typed text.
 */
function NumField({ value, min, onCommit }: { value: number; min?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  const skipCommit = useRef(false);
  // Latest values for the unmount commit (panel can disappear while the field is focused)
  const latest = useRef({ text, value, onCommit });
  latest.current = { text, value, onCommit };

  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);

  function commit(t: string, v: number, cb: (n: number) => void) {
    const n = parseFloat(t);
    if (Number.isFinite(n) && (min === undefined || n >= min)) {
      if (n !== v) cb(n);
    } else {
      setText(String(v));
    }
  }

  useEffect(() => () => {
    if (focused.current) {
      const l = latest.current;
      commit(l.text, l.value, l.onCommit);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      type="number"
      value={text}
      min={min}
      onFocus={() => { focused.current = true; }}
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (skipCommit.current) { skipCommit.current = false; setText(String(value)); return; }
        commit(text, value, onCommit);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { skipCommit.current = true; e.currentTarget.blur(); }
      }}
    />
  );
}

/**
 * Optional number (cm, ≥ 0) that commits on Enter / blur; empty = not set (the placeholder shows what is used then).
 */
function OptNum({ value, placeholder, title, onCommit }: { value: number | undefined; placeholder?: string; title?: string; onCommit: (v: number | undefined) => void }) {
  const show = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 10) / 10));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(show(value)); }, [value]);
  const commit = () => {
    const tx = text.trim();
    if (tx === '') { if (value !== undefined) onCommit(undefined); return; }
    const n = parseFloat(tx.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) { if (n !== value) onCommit(n); } else setText(show(value));
  };
  return (
    <input type="text" inputMode="decimal" className="sel-opt" value={text} placeholder={placeholder} title={title}
      onFocus={() => { focused.current = true; }}
      onChange={e => setText(e.target.value)}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setText(show(value)); e.currentTarget.blur(); }
      }} />
  );
}

/** A cable end connected to an item, and where the cable goes from there */
interface ItemEnd { c: Cable; end: 'from' | 'to'; port?: number; other: string }

/**
 * Name of a port for traces in panels: "User 2, port 1 (A1)" — a socket's own label in brackets;
 * switch tags (VLAN) are not in it, panels show them apart, first.
 */
function hopNamer(floor: FloorState, lang: Lang) {
  const byId = new Map(floor.furniture.map(f => [f.id, f]));
  return (id: number, port?: number, _via?: number): string | undefined => {
    const it = byId.get(id);
    const name = it ? itemName(it, lang) : '';
    if (!name) return undefined;
    if (!port) return name;
    const label = isPassThrough(it!) ? portTag(it!, port) : '';
    return `${name}, ${translate(lang, 'port.short')} ${port}${label ? ` (${label})` : ''}`;
  };
}

/** Item and port at the other end of every cable plugged into a port (the cable `exclude` skipped) */
function portPeers(floor: FloorState, itemId: number, port: number, exclude?: number): { id?: number; port?: number; cable: Cable; text?: string }[] {
  const byId = new Map(floor.cables.map(c => [c.id, c]));
  const out: { id?: number; port?: number; cable: Cable; text?: string }[] = [];
  for (const c of floor.cables) {
    if (c.id === exclude) continue;
    const end = c.toLink?.id === itemId && c.toPort === port ? 'to' : c.fromLink?.id === itemId && c.fromPort === port ? 'from' : null;
    if (!end) continue;
    const o = otherEnd(c, end, byId);
    out.push(o ? { id: o.id, port: o.port, cable: c } : { cable: c, text: (end === 'to' ? c.from : c.to) || c.label });
  }
  return out;
}

/**
 * What a port leads to, VLAN first and then the run in order:
 * switch — "User 2, port 1 (A1) → PC-01"; socket — "Switch A, port 3 → port 1 (A1) → PC-01";
 * computer — "Switch A, port 3 → User 2, port 1 (A1)".
 */
function portTrace(floor: FloorState, lang: Lang, itemId: number, port: number): { vlan: string; text: string } {
  const byId = new Map(floor.furniture.map(f => [f.id, f]));
  const item = byId.get(itemId);
  if (!item) return { vlan: '', text: '' };
  const hop = hopNamer(floor, lang);
  const name = (p: { id?: number; port?: number; text?: string }) => (p.id !== undefined ? hop(p.id, p.port) : p.text) || '?';
  const through = (id?: number) => (id !== undefined && byId.get(id) ? isPassThrough(byId.get(id)!) : false);
  const isDev = (id?: number) => (id !== undefined && byId.get(id) ? isDevice(byId.get(id)!) : false);
  const tagOf = (id: number, n: number) => { const it = byId.get(id); return it ? portTag(it, n) : ''; };
  const peers = portPeers(floor, itemId, port);
  if (isPassThrough(item)) {
    const back = peers.filter(p => !isDev(p.id)).map(name), front = peers.filter(p => isDev(p.id)).map(name);
    const label = portTag(item, port);
    const self = `${translate(lang, 'port.short')} ${port}${label ? ` (${label})` : ''}`;
    return { vlan: derivedTag(itemId, port, floor.cables, tagOf), text: peers.length ? [back.join(', ') || '…', self, front.join(', ') || '…'].join(' → ') : '' };
  }
  const runs = peers.map(p => {
    const next = through(p.id) && p.port ? portPeers(floor, p.id!, p.port, p.cable.id).map(name) : [];
    // a computer reads from the switch side: "Switch, port 3 → User 2, port 1"; a switch away from itself
    return isDevice(item) ? [...next, name(p)].join(' → ') : [name(p), ...next].join(' → ');
  });
  return { vlan: isDevice(item) ? derivedTag(itemId, port, floor.cables, tagOf) : portTag(item, port), text: runs.join('; ') };
}

/** Cable ends connected to an item (switch), with the other end of each run ("User 1", or a chain's consumers) */
function itemEnds(floor: FloorState, itemId: number, lang: Lang): ItemEnd[] {
  const nameOf = hopNamer(floor, lang);
  const infos = chainInfos(floor.cables, nameOf);
  const roots = chainRoots(floor.cables);
  const byId = new Map(floor.cables.map(c => [c.id, c]));
  return floor.cables.flatMap(c => {
    const out: ItemEnd[] = [];
    if (c.fromLink?.id === itemId) {
      const info = infos.get(c.id);
      out.push({ c, end: 'from', port: c.fromPort, other: (info ? info.stops.slice(1).join(' → ') : (c.to || (c.toLink && nameOf(c.toLink.id, c.toPort, c.id)))) || c.label || '—' });
    }
    if (c.toLink?.id === itemId) {
      const root = byId.get(roots.get(c.id) ?? c.id) ?? c;
      out.push({ c, end: 'to', port: c.toPort, other: root.from || (root.fromLink && nameOf(root.fromLink.id, root.fromPort, root.id)) || c.label || '—' });
    }
    return out;
  });
}

/** Ends of an item by port */
function endsByPort(ends: ItemEnd[]): Map<number, ItemEnd[]> {
  const m = new Map<number, ItemEnd[]>();
  for (const e of ends) if (e.port) m.set(e.port, [...(m.get(e.port) ?? []), e]);
  return m;
}

/** Port of a cable end on an item with ports: only free ports are offered (plus the one it is in), with their tags */
function PortSelect({ cable, end, item, byPort }: { cable: Cable; end: 'from' | 'to'; item: FurnitureItem; byPort: Map<number, ItemEnd[]> }) {
  const t = useT();
  const value = end === 'from' ? cable.fromPort : cable.toPort;
  const count = portCount(item);
  const room = isPassThrough(item) ? 2 : 1;
  const ports = Array.from({ length: Math.max(count, value ?? 0) }, (_, i) => i + 1)
    .filter(n => n === value || (byPort.get(n) ?? []).filter(o => !(o.c.id === cable.id && o.end === end)).length < room);
  return (
    <select className="sel-select port-select" title={t('port.select')} value={value ?? ''}
      onChange={e => {
        const v = e.target.value ? Number(e.target.value) : undefined;
        if (v) useStore.getState().assignPort(item.id, v, { id: cable.id, end });
        else useStore.getState().updateCable(cable.id, end === 'from' ? { fromPort: undefined } : { toPort: undefined });
      }}>
      <option value="">{t('port.short')} —</option>
      {ports.map(n => {
        const tag = portTag(item, n);
        return <option key={n} value={n}>{t('port.short')} {n}{tag ? ` · ${tag}` : ''}</option>;
      })}
    </select>
  );
}

/** Text field that commits on Enter / blur (one undo step per edit); Escape reverts */
function TextField({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const skipCommit = useRef(false);
  const latest = useRef({ text, value, onCommit });
  latest.current = { text, value, onCommit };

  useEffect(() => { if (!focused.current) setText(value); }, [value]);
  useEffect(() => () => {
    const l = latest.current;
    if (focused.current && l.text !== l.value) l.onCommit(l.text);
  }, []);

  return (
    <input
      type="text"
      className="sel-text"
      value={text}
      placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (skipCommit.current) { skipCommit.current = false; setText(value); return; }
        if (text !== value) onCommit(text);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { skipCommit.current = true; e.currentTarget.blur(); }
      }}
    />
  );
}

const TEXT_COLORS: (string | null)[] = [null, '#d0021b', '#1a73e8', '#188038', '#e8710a', '#8e24aa', '#5f6368'];

/** Places the floating panel under the given world-space bounding points */
/** Where the panel goes (screen px): centred on `x`, below `below` — or above `above` when there is no room below */
interface PanelAnchor { x: number; below: number; above: number }

/** Last press on the plan, in world coordinates: the panel of the object picked by it opens there */
let lastPress: { x: number; y: number } | null = null;

/** Remembers presses on the plan canvas (in world coordinates, so the spot follows panning and zoom) */
function trackPlanPresses() {
  // While something is dragged on the plan the selection panel is hidden, so it doesn't get in the way
  let down: { x: number; y: number } | null = null;
  const fn = (e: PointerEvent) => {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    const { stageX, stageY, stageScale } = useStore.getState();
    lastPress = { x: (e.clientX - stageX) / stageScale, y: (e.clientY - stageY) / stageScale };
    down = { x: e.clientX, y: e.clientY };
  };
  const move = (e: PointerEvent) => {
    if (down && e.buttons && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) document.body.classList.add('plan-drag');
  };
  const up = () => { down = null; document.body.classList.remove('plan-drag'); };
  window.addEventListener('pointerdown', fn, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  return () => {
    window.removeEventListener('pointerdown', fn, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
  };
}

/**
 * Anchor of the panel for an object with these points: the spot it was clicked at when that is on or near
 * the object, else under the middle of the object (e.g. selected by a frame or just pasted).
 */
function panelAnchor(points: { x: number; y: number }[], stageX: number, stageY: number, stageScale: number): PanelAnchor {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const near = 40 / stageScale;
  const p = lastPress;
  if (p && p.x >= Math.min(...xs) - near && p.x <= Math.max(...xs) + near && p.y >= Math.min(...ys) - near && p.y <= Math.max(...ys) + near) {
    const sx = stageX + p.x * stageScale, sy = stageY + p.y * stageScale;
    return { x: sx, below: sy + 18, above: sy - 18 };
  }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  return { x: stageX + cx * stageScale, below: stageY + Math.max(...ys) * stageScale + 12, above: stageY + Math.min(...ys) * stageScale - 12 };
}

/** Right edge of what a panel child really takes (full-width wrappers count by their own children) */
function usedRight(el: Element): number {
  if (el.classList.contains('sel-break')) return 0;
  const full = getComputedStyle(el).flexBasis === '100%';
  if (!full) return el.getBoundingClientRect().right;
  if (el.children.length === 0) return 0; // a hint text just wraps in the width the rest needs
  let r = 0;
  for (const c of Array.from(el.children)) r = Math.max(r, usedRight(c));
  return r;
}

/**
 * Fits the open selection panel: as wide as its widest row (not the whole screen) and placed at its anchor,
 * flipped above when it doesn't fit below.
 */
function fitPanel(el: HTMLElement | null, a: PanelAnchor | null) {
  if (!el || !a) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  el.style.width = '';
  el.style.maxWidth = `${Math.min(1000, vw - 16)}px`;
  el.style.left = '8px';
  el.style.top = '8px';
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  let right = 0;
  for (const c of Array.from(el.children)) right = Math.max(right, usedRight(c));
  if (right > 0) el.style.width = `${Math.ceil(right - box.left + parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) + 1}px`;
  const r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(a.x - r.width / 2, vw - r.width - 8));
  let top = a.below;
  if (top + r.height > vh - 8) top = a.above - r.height >= 8 ? a.above - r.height : Math.max(8, vh - 8 - r.height);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

const LABEL_POSITIONS: { pos: LabelPos; icon: string }[] = [
  { pos: 'c', icon: '•' }, { pos: 't', icon: '↑' }, { pos: 'b', icon: '↓' }, { pos: 'l', icon: '←' }, { pos: 'r', icon: '→' },
  { pos: 'tl', icon: '↖' }, { pos: 'tr', icon: '↗' }, { pos: 'bl', icon: '↙' }, { pos: 'br', icon: '↘' },
];

const CABLE_COLORS: (string | null)[] = ['#1a73e8', '#d0021b', '#188038', '#e8710a', '#f9ab00', '#8e24aa', '#00897b', '#5f6368'];

function ColorSwatches({ value, onChange, title, colors = TEXT_COLORS }: { value: string | null | undefined; onChange: (c: string | null) => void; title: string; colors?: (string | null)[] }) {
  return (
    <span className="sel-swatches" title={title}>
      {colors.map(c => (
        <button key={c ?? 'auto'} className={'sel-swatch' + ((value ?? null) === c ? ' active' : '') + (c === null ? ' auto' : '')}
          style={c ? { background: c } : undefined} onClick={() => onChange(c)} />
      ))}
    </span>
  );
}

type Tri = 'global' | 'on' | 'off';

/** Three-way switch: follow the toolbar (global) / always on / always off */
function TriSelect({ value, label, title, onChange }: { value: Tri | ''; label: string; title: string; onChange: (v: Tri) => void }) {
  const t = useT();
  return (
    <label title={title}>{label}
      <select className="sel-select" value={value} onChange={e => onChange(e.target.value as Tri)}>
        {value === '' && <option value="">—</option>}
        <option value="global">{t('mode.global')}</option>
        <option value="on">{t('mode.on')}</option>
        <option value="off">{t('mode.off')}</option>
      </select>
    </label>
  );
}

const triOf = (v: 'on' | 'off' | undefined): Tri => v ?? 'global';

/** Which plan shows the object(s): main plan, wiring layer or both ('' = mixed) */
function LayerButton({ id, ids, layer }: { id?: number; ids?: number[]; layer?: Layer | '' }) {
  const t = useT();
  return (
    <label title={t('layer.title')}><Layers size={13} />
      <select className="sel-select" value={layer === '' ? '' : layer ?? 'plan'}
        onChange={e => useStore.getState().setLayerMany(ids ?? [id!], e.target.value === 'plan' ? undefined : e.target.value as Layer)}>
        {layer === '' && <option value="">—</option>}
        <option value="plan">{t('layer.plan')}</option>
        <option value="wiring">{t('layer.wiring')}</option>
        <option value="both">{t('layer.both')}</option>
      </select>
    </label>
  );
}

const OBJECT_COLORS: (string | null)[] = [null, '#d0021b', '#1a73e8', '#188038', '#e8710a', '#f9ab00', '#8e24aa', '#00897b', '#5f6368'];

/** Object colour: swatches with "as drawn" first */
function ObjectColor({ value, onChange, title }: { value: string | null | undefined; onChange: (c: string | undefined) => void; title?: string }) {
  const t = useT();
  return (
    <span className="sel-color" title={title ?? t('obj.color')}>
      <PaletteIcon size={13} />{title && <b className="sel-color-n">2</b>}
      <ColorSwatches value={value} title={title ?? t('obj.color')} colors={OBJECT_COLORS} onChange={c => onChange(c ?? undefined)} />
    </span>
  );
}
const fromTri = (v: Tri) => (v === 'global' ? undefined : v);

function SelectionPanel() {
  const selectedId   = useStore(s => s.selectedId);
  const selection    = useStore(s => s.selection);
  const floors       = useStore(s => s.floors);
  const fi           = useStore(s => s.fi);
  const stageX       = useStore(s => s.stageX);
  const stageY       = useStore(s => s.stageY);
  const stageScale   = useStore(s => s.stageScale);
  const textEdit     = useStore(s => s.textEdit);
  useStore(s => s.chainPick); // the connector button shows when picking is on
  const lang         = usePrefs(s => s.lang);
  const st           = useStore.getState();
  const t            = useT();
  /** Cable panel: the list of point heights is open */
  const [showPts, setShowPts] = useState(false);

  // The panel is fitted to its content and placed at the anchor after every render (before paint)
  const anchorRef = useRef<PanelAnchor | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => fitPanel(panelRef.current, anchorRef.current));

  if (textEdit || selection.length === 0) return null;
  const floor = floors[fi];
  const at = (points: { x: number; y: number }[], _width: number) => {
    anchorRef.current = panelAnchor(points, stageX, stageY, stageScale);
    return undefined;
  };

  // ── Group ──
  if (selection.length > 1) {
    const pts = [
      ...floor.furniture.filter(f => selection.includes(f.id)).flatMap(f => rectCorners(f.x, f.y, f.w, f.h, f.rot)),
      ...floor.texts.filter(n => selection.includes(n.id)).flatMap(n => { const m = measureNote(n); return rectCorners(n.x, n.y, m.w, m.h, n.rot); }),
    ];
    if (pts.length === 0) return null;
    return (
      <div className="selection-panel" ref={panelRef} style={at(pts, 520)}>
        <span className="sel-title">{t('sel.count', { n: selection.length })}</span>
        {floor.furniture.some(f => selection.includes(f.id)) && (() => {
          const items = floor.furniture.filter(f => selection.includes(f.id));
          const common = (k: 'textMode' | 'sizeMode'): Tri | '' => {
            const vals = new Set(items.map(it => triOf(it[k])));
            return vals.size === 1 ? [...vals][0] : '';
          };
          return (
          <>
            <TriSelect value={common('textMode')} label={t('sel.textMode')} title={t('sel.textModeTitle')}
              onChange={v => st.updateFurnitureMany(selection, { textMode: fromTri(v) })} />
            <TriSelect value={common('sizeMode')} label={t('sel.sizeMode')} title={t('sel.sizeModeTitle')}
              onChange={v => st.updateFurnitureMany(selection, { sizeMode: fromTri(v) })} />
            <button className="sel-btn" title={t('sel.simple')}
              onClick={() => st.updateFurnitureMany(selection, { simple: true })}><Square size={14} /></button>
            <button className="sel-btn" title={t('sel.detailed')}
              onClick={() => st.updateFurnitureMany(selection, { simple: undefined })}><ImageIcon size={14} /></button>
            <ObjectColor value={(() => { const v = new Set(items.map(i => i.color ?? null)); return v.size === 1 ? [...v][0] : undefined; })()}
              onChange={c => st.updateFurnitureMany(selection, { color: c })} />
          </>
          );
        })()}
        <LayerButton ids={selection} layer={(() => {
          const v = new Set([...floor.furniture, ...floor.texts].filter(o => selection.includes(o.id)).map(o => o.layer ?? 'plan'));
          return v.size === 1 ? ([...v][0] === 'plan' ? undefined : [...v][0] as Layer) : '';
        })()} />
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
      </div>
    );
  }

  const item = floor.furniture.find(f => f.id === selectedId);
  const note = floor.texts.find(n => n.id === selectedId);
  const wall = floor.walls.find(w => w.id === selectedId);
  const dim = floor.dimensions.find(d => d.id === selectedId);

  // ── Text note ──
  if (note) {
    const { w, h } = measureNote(note);
    return (
      <div className="selection-panel" ref={panelRef} style={at(rectCorners(note.x, note.y, w, h, note.rot), 420)}>
        <label>{t('text.size')} <NumField key={`s${note.id}`} value={Math.round(note.size)} min={4}
          onCommit={v => st.updateText(note.id, { size: v })} /> {t('unit.cm')}</label>
        <label>{t('sel.r')} <NumField key={`r${note.id}`} value={Math.round(note.rot)}
          onCommit={v => st.updateText(note.id, { rot: v })} /> °</label>
        <button className={'sel-btn' + (note.bold ? ' active' : '')} title={t('text.bold')}
          onClick={() => st.updateText(note.id, { bold: !note.bold })}>
          <Bold size={14} />
        </button>
        <ColorSwatches value={note.color} title={t('text.color')} onChange={c => st.updateText(note.id, { color: c })} />
        <button className="sel-btn" title={t('text.edit')} onClick={() => st.setTextEdit({ id: note.id, x: note.x, y: note.y })}>
          <Pencil size={14} />
        </button>
        <LayerButton id={note.id} layer={note.layer} />
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
      </div>
    );
  }

  // ── Wall ──
  if (wall) {
    const a = floor.nodes.find(n => n.id === wall.a), b = floor.nodes.find(n => n.id === wall.b);
    if (!a || !b) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return (
      <div className="selection-panel" ref={panelRef} style={at([a, b], 460)}>
        <select className="sel-select" value={wall.exterior ? 'ext' : 'int'}
          onChange={e => st.updateWall(wall.id, { exterior: e.target.value === 'ext' })}>
          <option value="ext">{t('wall.exterior')}</option>
          <option value="int">{t('wall.interior')}</option>
        </select>
        <label>{t('wall.thickness')} <NumField key={`t${wall.id}`} value={Math.round(wallThickness(wall))} min={1}
          onCommit={v => st.updateWall(wall.id, { thickness: v })} /> {t('unit.cm')}</label>
        <label>{t('wall.length')} <NumField key={`l${wall.id}`} value={Math.round(len)} min={1}
          onCommit={v => st.setWallLength(wall.id, v)} /> {t('unit.cm')}</label>
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
      </div>
    );
  }

  // ── Tray ──
  const tray = floor.trays.find(x => x.id === selectedId);
  if (tray) {
    const styled = styleCables(floor.cables.filter(c => onLayer(c, 'wiring')), st.wiring, itemNamer(floor.furniture, lang, floor.cables), heightCtx(floor));
    const inside = collapseToChains(cablesInTray(tray, styled), styled).shown;
    return (
      <div className="selection-panel" ref={panelRef} style={at(tray.points, 460)}>
        <TextField key={`tl${tray.id}`} value={tray.label ?? ''} placeholder={t('sel.label')}
          onCommit={v => st.updateTray(tray.id, { label: v.trim() || undefined })} />
        <label>{t('tray.width')} <NumField key={`tw${tray.id}`} value={tray.width} min={1}
          onCommit={v => st.updateTray(tray.id, { width: v })} /> {t('unit.cm')}</label>
        <label title={t('elev.tray')}>{t('elev.label')} <OptNum key={`te${tray.id}`} value={tray.elev} placeholder="—" title={t('elev.tray')}
          onCommit={v => st.updateTray(tray.id, { elev: v })} /> {t('unit.cm')}</label>
        <ObjectColor value={tray.color} onChange={c => st.updateTray(tray.id, { color: c })} />
        <LayerButton id={tray.id} layer={trayLayer(tray)} />
        <button className={'sel-btn' + (tray.patch ? ' active' : '')} title={t(tray.patch ? 'tray.patchOn' : 'tray.patchOff')}
          onClick={() => st.updateTray(tray.id, { patch: tray.patch ? undefined : true })}><Magnet size={14} /></button>
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
        <div className="sel-break" />
        <div className="tray-list">
          <span className="sel-title">{t('tool.tray')} · {t('tray.count', { n: inside.length })}</span>
          {inside.map(c => (
            <div key={c.id} className="tray-tip-row">
              <span className="tray-tip-dot" style={{ background: c.color }} />
              <span>{[c.label, cableRouteText(c)].filter(Boolean).join(' · ') || '—'}</span>
              <span className="tray-tip-len">{formatMeters(cableLength(c), t('unit.m'))}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Cable ──
  const cable = floor.cables.find(c => c.id === selectedId);
  if (cable) {
    const nameOf = itemNamer(floor.furniture, lang, floor.cables);
    const autoFrom = cable.fromLink ? nameOf(cable.fromLink.id) : undefined;
    const autoTo = cable.toLink ? nameOf(cable.toLink.id) : undefined;
    // Ports of the items the ends are connected to (switches)
    const portsOf = (id?: number) => { const it = id !== undefined ? floor.furniture.find(f => f.id === id) : undefined; return it ? portCount(it) : 0; };
    const fromPorts = cable.parent === undefined ? portsOf(cable.fromLink?.id) : 0;
    const toPorts = portsOf(cable.toLink?.id);
    // Chain: this cable and the cables continued from it / it continues
    const layerCables = floor.cables.filter(c => onLayer(c, st.mode === 'wiring' ? 'wiring' : 'main'));
    const chain = chainMembers(floor.cables, cable.id);
    const hctx = heightCtx(floor);
    const chainView = chain.length > 1 ? collapseToChains([cable], styleCables(layerCables, st.wiring, nameOf, hctx)).shown[0] : undefined;
    // Heights used for the points (own, item, tray or run height) and the length with the runs up / down
    const zs = cableHeights(floor.cables, hctx).get(cable.id) ?? null;
    const flat = pathLength(cable.points), vert = verticalRun(zs);
    const joints = cable.points.filter(p => p.joint).length;
    const m = (v: number) => formatMeters(v, t('unit.m'));
    return (
      <div className="selection-panel" ref={panelRef} style={at(cable.points, 620)}>
        {chainView && (
          <>
            <span className="sel-chain" title={t('chain.title')}>{cableRouteText(chainView) || '—'} · {formatMeters(cableLength(chainView), t('unit.m'))}</span>
            <div className="sel-break" />
          </>
        )}
        <TextField key={`cl${cable.id}`} value={cable.label ?? ''} placeholder={t('sel.label')}
          onCommit={v => st.updateCable(cable.id, { label: v.trim() || undefined })} />
        {cable.parent === undefined && (
          <>
            <span className={'sel-link' + (cable.fromLink ? ' on' : '')} title={cable.fromLink ? t('cable.linked', { name: autoFrom ?? '?' }) : t('cable.notLinked')}>●</span>
            <TextField key={`cf${cable.id}`} value={cable.from ?? ''} placeholder={autoFrom ?? t('cable.from')}
              onCommit={v => st.updateCable(cable.id, { from: v.trim() || undefined })} />
            {fromPorts > 0 && <PortSelect cable={cable} end="from" item={floor.furniture.find(f => f.id === cable.fromLink!.id)!} byPort={endsByPort(itemEnds(floor, cable.fromLink!.id, lang))} />}
          </>
        )}
        <span className="sel-arrow">→</span>
        <TextField key={`ct${cable.id}`} value={cable.to ?? ''} placeholder={autoTo ?? t('cable.to')}
          onCommit={v => st.updateCable(cable.id, { to: v.trim() || undefined })} />
        <span className={'sel-link' + (cable.toLink ? ' on' : '')} title={cable.toLink ? t('cable.linked', { name: autoTo ?? '?' }) : t('cable.notLinked')}>●</span>
        {toPorts > 0 && <PortSelect cable={cable} end="to" item={floor.furniture.find(f => f.id === cable.toLink!.id)!} byPort={endsByPort(itemEnds(floor, cable.toLink!.id, lang))} />}
        <div className="sel-break" />
        <ColorSwatches value={cable.color} title={t('text.color')} colors={CABLE_COLORS}
          onChange={c => { if (c) { setNextCableColor(c); st.updateChain(cable.id, { color: c }); } }} />
        <label>{t('cable.width')} <NumField key={`cw${cable.id}`} value={cable.width ?? st.wiring.cableWidth} min={0.5}
          onCommit={v => st.updateChain(cable.id, { width: v })} /> {t('unit.cm')}</label>
        <button className={'sel-btn' + (cable.showLength ? ' active' : '')} title={t('cable.showLength')}
          onClick={() => st.updateChain(cable.id, { showLength: cable.showLength ? undefined : true })}><Ruler size={14} /></button>
        <LayerButton ids={chain} layer={cable.layer} />
        <button className={'sel-btn' + (st.chainPick?.mode === 'joint' && st.chainPick.id === cable.id ? ' active' : '')} title={t('joint.add')}
          onClick={() => st.setChainPick(st.chainPick?.mode === 'joint' ? null : { id: cable.id, mode: 'joint' })}>
          <Combine size={14} />{joints > 0 && <span className="sel-badge">{joints}</span>}
        </button>
        <button className="sel-btn" title={t('chain.continue')} onClick={() => st.setChainPick({ id: cable.id, mode: 'continue' })}>
          <GitBranchPlus size={14} />
        </button>
        {cable.parent === undefined
          ? <button className="sel-btn" title={t('chain.attach')} onClick={() => st.setChainPick({ id: cable.id, mode: 'attach' })}><Link2 size={14} /></button>
          : <button className="sel-btn" title={t('chain.detach')} onClick={() => st.detachCable(cable.id)}><Unlink size={14} /></button>}
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
        <div className="sel-break" />
        <span className="sel-title">{t('cable.groups')}</span>
        <CableGroupChips cableId={cable.id} groups={cable.groups} />
        <div className="sel-break" />
        <button className={'sel-btn' + (cable.kind === 'patch' ? ' active' : '')} title={t('cable.patchTitle')}
          onClick={() => {
            if (cable.kind === 'patch') { st.updateCable(cable.id, { kind: undefined }); return; }
            // one undo step: becomes a patch cord and is fixed to the desk frame
            st.beginGesture();
            st.updateCable(cable.id, { kind: 'patch' });
            st.layPatch(cable.id);
            st.endGesture();
          }}><Plug size={14} /></button>
        {cable.kind === 'patch' && (() => {
          const need = patchLength(flat + vert);
          return (
            <span className={'sel-patch' + (need ? '' : ' long')}>
              {need
                ? t('cable.patchNeed', { len: m(need), real: m(flat + vert) })
                : t('cable.patchTooLong', { max: m(PATCH_LENGTHS[PATCH_LENGTHS.length - 1]), real: m(flat + vert) })}
            </span>
          );
        })()}
        <div className="sel-break" />
        <button className={'sel-btn' + (cable.noTray ? '' : ' active')} title={t('cable.inTray')}
          onClick={() => st.updateChain(cable.id, { noTray: cable.noTray ? undefined : true })}><CableIcon size={14} /></button>
        <button className={'sel-btn' + (cable.fixed ? ' active' : '')} title={t(cable.fixed ? 'cable.fixedOn' : 'cable.fixedOff')}
          onClick={() => st.updateCable(cable.id, { fixed: cable.fixed ? undefined : true })}>{cable.fixed ? <Lock size={14} /> : <LockOpen size={14} />}</button>
        <label title={t('cable.heightTitle')}>{t('cable.height')} <OptNum key={`ch${cable.id}`} value={cable.height} placeholder="—" title={t('cable.heightTitle')}
          onCommit={v => st.updateCable(cable.id, { height: v })} /> {t('unit.cm')}</label>
        <button className="sel-btn" title={floor.height ? t('cable.ceiling', { h: floor.height }) : t('cable.noCeiling')} disabled={!floor.height}
          onClick={() => st.updateCable(cable.id, { height: floor.height })}><ArrowUpToLine size={14} /></button>
        <button className={'sel-btn' + (showPts ? ' active' : '')} title={t('cable.points')} onClick={() => setShowPts(!showPts)}><MoveVertical size={14} /></button>
        <button className="sel-btn" title={t('cable.simplify')} disabled={cable.points.length <= 2}
          onClick={() => st.simplifyCable(cable.id)}><Eraser size={14} /></button>
        {vert > 0 && <span className="sel-len3d">{t('cable.length3d', { plan: m(flat), vert: m(vert), total: m(flat + vert) })}</span>}
        {showPts && (
          <>
            <div className="sel-break" />
            <div className="pt-heights" title={t('cable.pointsHint')}>
              <span className="sel-title">{t('cable.points')}, {t('unit.cm')}</span>
              {cable.points.map((p, i) => (
                <label key={i} className="pt-h">{i + 1}
                  <OptNum key={`pz${cable.id}-${i}-${cable.points.length}`} value={p.z} placeholder={zs ? String(Math.round(zs[i])) : '—'}
                    onCommit={v => st.setCablePointHeight(cable.id, i, v)} />
                  <button className={'pt-joint' + (p.joint ? ' on' : '')} title={t('joint.point')}
                    onClick={e => { e.preventDefault(); st.setJoint(cable.id, i, !p.joint); }}><Combine size={11} /></button>
                  {i > 0 && i < cable.points.length - 1 && (
                    <button className="pt-joint" title={t('cable.pointDel')}
                      onClick={e => { e.preventDefault(); st.removeCablePoint(cable.id, i); }}><X size={11} /></button>
                  )}
                </label>
              ))}
              <span className="pt-hint">{t('cable.pointsHint')}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Ruler measurement ──
  if (dim) {
    const len = Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1);
    return (
      <div className="selection-panel" ref={panelRef} style={at([{ x: dim.x1, y: dim.y1 }, { x: dim.x2, y: dim.y2 }], 380)}>
        <label>{t('dim.length')} <NumField key={`d${dim.id}`} value={Math.round(len)} min={1}
          onCommit={v => st.setDimensionLength(dim.id, v)} /> {t('unit.cm')}</label>
        <ColorSwatches value={dim.color} title={t('text.color')} onChange={c => st.updateDimension(dim.id, { color: c ?? undefined })} />
        <LayerButton id={dim.id} layer={dim.layer} />
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
      </div>
    );
  }

  if (!item) return null;

  // ── Furniture ──
  const wCm = Math.round(item.w / METER * 100);
  const hCm = Math.round(item.h / METER * 100);
  const rot  = Math.round(item.rot);

  return (
    <div className="selection-panel" ref={panelRef} style={at(rectCorners(item.x, item.y, item.w, item.h, item.rot), 540)}>
      <label>{t('sel.w')} <NumField key={`w${item.id}`} value={wCm} min={1}
        onCommit={v => st.updateFurniture(item.id, { w: v / 100 * METER })} /> {t('unit.cm')}</label>
      <label>{t('sel.h')} <NumField key={`h${item.id}`} value={hCm} min={1}
        onCommit={v => st.updateFurniture(item.id, { h: v / 100 * METER })} /> {t('unit.cm')}</label>
      <label>{t('sel.r')} <NumField key={`r${item.id}`} value={rot}
        onCommit={v => st.updateFurniture(item.id, { rot: v })} /> °</label>
      <button className={'sel-btn' + (item.simple ? ' active' : '')} title={item.simple ? t('sel.detailed') : t('sel.simple')}
        onClick={() => st.updateFurniture(item.id, { simple: item.simple ? undefined : true })}>
        {item.simple ? <ImageIcon size={14} /> : <Square size={14} />}
      </button>
      <button className={'sel-btn' + (item.flipX ? ' active' : '')} title={item.path === 'door' ? t('door.hinge') : t('sel.flipX')}
        onClick={() => st.flipFurniture(item.id, 'x')}><FlipHorizontal2 size={14} /></button>
      <button className={'sel-btn' + (item.flipY ? ' active' : '')} title={item.path === 'door' ? t('door.swing') : t('sel.flipY')}
        onClick={() => st.flipFurniture(item.id, 'y')}><FlipVertical2 size={14} /></button>
      <ObjectColor value={item.color} onChange={c => st.updateFurniture(item.id, { color: c })} />
      {isTwoPart(item) && <ObjectColor value={item.color2} title={t('obj.color2')} onChange={c => st.updateFurniture(item.id, { color2: c })} />}
      {(() => {
        const e = itemElevation({ ...item, elev: undefined }, floor.trays);
        return (
          <label title={t('elev.item')}>{t('elev.label')} <OptNum key={`ie${item.id}`} value={item.elev} title={t('elev.item')}
            placeholder={e ? `${e.z} · ${t('elev.fromTray')}` : '—'} onCommit={v => st.updateFurniture(item.id, { elev: v })} /> {t('unit.cm')}</label>
        );
      })()}
      <LayerButton id={item.id} layer={item.layer} />
      <button className="sel-btn" title={t('sel.front')} onClick={() => st.bringToFront(item.id)}>
        <BringToFront size={14} />
      </button>
      <button className="sel-btn" title={t('sel.back')} onClick={() => st.sendToBack(item.id)}>
        <SendToBack size={14} />
      </button>
      <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}>
        <Trash2 size={14} />
      </button>
      <div className="sel-break" />
      <TextField key={`l${item.id}`} value={item.label ?? ''} placeholder={t('sel.label')}
        onCommit={v => st.updateFurniture(item.id, { label: v.trim() || undefined })} />
      <select className="sel-select" title={t('sel.labelPos')} value={item.labelPos ?? 'c'}
        onChange={e => st.updateFurniture(item.id, { labelPos: e.target.value as LabelPos })}>
        {LABEL_POSITIONS.map(p => <option key={p.pos} value={p.pos}>{p.icon} {t(`pos.${p.pos}` as TKey)}</option>)}
      </select>
      <label title={t('sel.labelSize')}><Type size={13} /> <NumField key={`ls${item.id}`} value={Math.round(item.labelSize ?? 0)} min={0}
        onCommit={v => st.updateFurniture(item.id, { labelSize: v > 0 ? v : undefined })} /></label>
      <button className={'sel-btn' + (item.labelBold ? ' active' : '')} title={t('text.bold')}
        onClick={() => st.updateFurniture(item.id, { labelBold: !item.labelBold || undefined })}>
        <Bold size={14} />
      </button>
      <ColorSwatches value={item.labelColor} title={t('text.color')} onChange={c => st.updateFurniture(item.id, { labelColor: c ?? undefined })} />
      <TriSelect value={triOf(item.textMode)} label={t('sel.textMode')} title={t('sel.textModeTitle')}
        onChange={v => st.updateFurniture(item.id, { textMode: fromTri(v) })} />
      <TriSelect value={triOf(item.sizeMode)} label={t('sel.sizeMode')} title={t('sel.sizeModeTitle')}
        onChange={v => st.updateFurniture(item.id, { sizeMode: fromTri(v) })} />
      {st.mode === 'wiring' && (
        <>
          <div className="sel-break" />
          <span className="sel-title">{t('cable.groups')}</span>
          <CableGroupChips itemId={item.id} groups={item.groups} />
          {!isDevice(item) && <ItemPorts floor={floor} itemId={item.id} />}
        </>
      )}
      {isDevice(item) && <DevicePanel floor={floor} itemId={item.id} />}
      {(frameInset(item) !== undefined || (item.w >= 60 && item.h >= 40)) && (
        <>
          <div className="sel-break" />
          <label title={t('desk.frameTitle')}>{t('desk.frame')} <OptNum key={`fr${item.id}`} value={item.frame}
            placeholder={frameInset({ ...item, frame: undefined }) !== undefined ? String(DEFAULT_FRAME_INSET) : '—'} title={t('desk.frameTitle')}
            onCommit={v => st.updateFurniture(item.id, { frame: v })} /> {t('unit.cm')}</label>
        </>
      )}
    </div>
  );
}

/**
 * Ports and cables of an item. A switch is drawn like its front: RJ45 ports in blocks of 12, odd numbers on top,
 * even below; a port with a cable has the cable's colour and shows its tag (uplink, VLAN…). Click a port to tag it
 * and to plug in one of the connected cables that has no port yet. Below — a text list of all ports.
 * An item without ports (a socket) lists where its cables go, e.g. "← Switch A, port 3, VLAN 10".
 */
function ItemPorts({ floor, itemId }: { floor: FloorState; itemId: number }) {
  const t = useT();
  const lang = usePrefs(s => s.lang);
  const [pick, setPick] = useState<number | null>(null);
  const [allTag, setAllTag] = useState('');
  const item = floor.furniture.find(f => f.id === itemId)!;
  const auto = portCount({ ...item, ports: undefined });
  const count = portCount(item);
  // One tag for every port (then single ports can be changed by hand); empty clears all tags
  const applyAll = () => {
    const v = allTag.trim();
    if (!v && !confirm(t('port.allClear'))) return;
    useStore.getState().setAllPortTags(itemId, v, count);
    setAllTag('');
  };
  const ends = itemEnds(floor, itemId, lang);
  const byPort = endsByPort(ends);
  const max = Math.max(count, ...byPort.keys());
  const free = Array.from({ length: count }, (_, i) => i + 1).filter(n => !byPort.has(n)).length;
  const key = (e: ItemEnd) => `${e.c.id}:${e.end}`;
  const loose = ends.filter(e => !e.port);
  // A socket port holds the wall cable and the cord to a device; it gets the tag (VLAN) of the switch port
  const passThru = isPassThrough(item);
  const room = passThru ? 2 : 1;
  const tagOf = (id: number, n: number) => { const it = floor.furniture.find(f => f.id === id); return it ? portTag(it, n) : ''; };
  const gotTag = (n: number) => (passThru ? derivedTag(itemId, n, floor.cables, tagOf) : '');
  const trace = (n: number) => portTrace(floor, lang, itemId, n);
  const what = (n: number) => trace(n).text;
  const selected = pick !== null && pick <= max ? pick : null;
  const arrow = (e: ItemEnd) => (e.end === 'from' ? '→' : '←');

  // Blocks of 12 ports: 6 columns, odd port on top, even below
  const blocks: number[][][] = [];
  for (let start = 1; start <= max; start += 12) {
    const cols: number[][] = [];
    for (let c = 0; c < 6 && start + c * 2 <= max; c++) cols.push([start + c * 2, start + c * 2 + 1].filter(n => n <= max));
    blocks.push(cols);
  }
  const port = (n: number) => {
    const here = byPort.get(n) ?? [];
    const tag = portTag(item, n) || gotTag(n);
    const cls = 'sw-port' + (here.length ? ' busy' : '') + (here.length > room || n > count ? ' clash' : '') + (selected === n ? ' picked' : '');
    return (
      <button key={n} className={cls} style={here.length ? { ['--cable' as string]: here[0].c.color } : undefined}
        title={`${t('port.short')} ${n}${tag ? ` · ${tag}` : ''} · ${what(n) || t('port.isFree')}`}
        onClick={() => setPick(selected === n ? null : n)}>
        {tag ? <span className="sw-tag">{tag.replace(/^VLAN /, '')}</span> : <span className="sw-jack" />}
      </button>
    );
  };
  const here = selected !== null ? byPort.get(selected) ?? [] : [];
  // Cables that can go into the picked port: the ones in it and the ones without a port
  const choices = selected !== null ? [...here, ...loose] : [];

  return (
    <>
      <div className="sel-break" />
      <label title={t('port.countTitle')}>{t('port.count')} <OptNum key={`ip${item.id}`} value={item.ports} placeholder={auto ? String(auto) : '—'}
        title={t('port.countTitle')} onCommit={v => useStore.getState().updateFurniture(item.id, { ports: v === undefined ? undefined : Math.min(512, Math.round(v)) })} /></label>
      {count > 0 && <span className="sel-len3d">{t('port.free', { n: free, total: count })}</span>}
      {count > 1 && (
        <span className="sw-all" title={t('port.allTitle')}>
          <input type="text" className="sel-text sw-all-in" value={allTag} placeholder="VLAN 10"
            onChange={e => setAllTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyAll(); }} />
          <button className="secondary sw-all-btn" onClick={applyAll}>{t('port.allApply', { n: count })}</button>
        </span>
      )}
      {max > 0 && (
        <>
          <div className="sel-break" />
          <div className="sw-face" title={t('port.faceHint')}>
            {blocks.map((cols, bi) => (
              <div key={bi} className="sw-block">
                {cols.map(([top, bottom]) => (
                  <div key={top} className="sw-col">
                    <span className="sw-num">{top}</span>
                    {port(top)}
                    {bottom !== undefined ? port(bottom) : <span className="sw-port none" />}
                    <span className="sw-num">{bottom ?? ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {selected !== null && (
            <>
              <div className="sel-break" />
              <span className="sw-pick">{t('port.short')} {selected}</span>
              <label title={t('port.tagTitle')}>{t('port.tag')}
                <TextField key={`pt${item.id}-${selected}`} value={item.portTags?.[String(selected)] ?? ''} placeholder="uplink / VLAN 10"
                  onCommit={v => useStore.getState().setPortTag(itemId, selected, v)} />
              </label>
              {(() => {
                const tr = trace(selected);
                return tr.text ? (
                  <span className="sw-trace">
                    {tr.vlan && <span className={'sw-line-tag' + (passThru ? ' got' : '')}>{tr.vlan}</span>} {tr.text}
                  </span>
                ) : null;
              })()}
              <div className="sel-break" />
              {passThru ? (
                <>
                  {here.map(e => (
                    <span key={key(e)} className="sw-end">
                      <span className="tray-tip-dot" style={{ background: e.c.color }} /> {arrow(e)} {e.other}
                      <button className="sw-unplug" title={t('port.unplug')}
                        onClick={() => useStore.getState().updateCable(e.c.id, e.end === 'from' ? { fromPort: undefined } : { toPort: undefined })}>×</button>
                    </span>
                  ))}
                  {here.length < room && (
                    <select className="sel-select sw-cable" title={t('port.plugTitle')} value=""
                      onChange={e => {
                        const it = loose.find(x => key(x) === e.target.value);
                        if (it) useStore.getState().assignPort(itemId, selected, { id: it.c.id, end: it.end });
                      }}>
                      <option value="">{here.length ? t('port.plugDevice') : t('port.plugCable')}</option>
                      {loose.map(e => <option key={key(e)} value={key(e)}>{arrow(e)} {e.other}</option>)}
                    </select>
                  )}
                </>
              ) : (
                <select className="sel-select sw-cable" title={t('port.pick')} value={here[0] ? key(here[0]) : ''}
                  onChange={e => {
                    const v = e.target.value;
                    const it = ends.find(x => key(x) === v);
                    useStore.getState().assignPort(itemId, selected, it ? { id: it.c.id, end: it.end } : null);
                  }}>
                  <option value="">{t('port.isFree')}</option>
                  {choices.map(e => <option key={key(e)} value={key(e)}>{arrow(e)} {e.other}</option>)}
                </select>
              )}
              {ends.length === 0
                ? <span className="sel-len3d">{t('port.noCables')}</span>
                : loose.length === 0 && here.length === 0 && <span className="sel-len3d">{t('port.noLoose')}</span>}
            </>
          )}
          <div className="sel-break" />
          <div className="sw-list" style={{ gridTemplateRows: `repeat(${Math.min(12, max)}, auto)` }}>
            {Array.from({ length: max }, (_, i) => i + 1).map(n => {
              const at = byPort.get(n) ?? [];
              const tr = trace(n);
              return (
                <button key={n} className={'sw-line' + (at.length ? ' busy' : '') + (selected === n ? ' picked' : '') + (at.length > room || n > count ? ' clash' : '')}
                  onClick={() => setPick(selected === n ? null : n)}>
                  <span className="sw-line-n">{n}</span>
                  {at.length > 0 && <span className="tray-tip-dot" style={{ background: at[0].c.color }} />}
                  {tr.vlan && <span className={'sw-line-tag' + (passThru ? ' got' : '')} title={passThru ? t('port.gotTitle') : undefined}>{tr.vlan}</span>}
                  <span>{at.length ? tr.text : t('port.isFree')}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {loose.length > 0 && (
        <>
          <div className="sel-break" />
          <span className="sel-title">{max > 0 ? t('port.loose') : t('port.links')}</span>
          <div className="sw-links">
            {loose.map(e => (
              <span key={key(e)} className="sw-link">
                <span className="tray-tip-dot" style={{ background: e.c.color }} /> {arrow(e)} {e.other}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Computer (PC, laptop): host name, HDMI / DP outputs and network ports — each with its MAC and IP address
 * and the cable plugged into it (a connected cable without a port can be chosen).
 */
function DevicePanel({ floor, itemId }: { floor: FloorState; itemId: number }) {
  const t = useT();
  const lang = usePrefs(s => s.lang);
  const st = useStore.getState();
  const item = floor.furniture.find(f => f.id === itemId)!;
  const dev = item.device ?? {};
  const nics = deviceNics(item);
  const ends = itemEnds(floor, itemId, lang);
  const byPort = endsByPort(ends);
  const loose = ends.filter(e => !e.port);
  const key = (e: ItemEnd) => `${e.c.id}:${e.end}`;
  const setNic = (i: number, changes: { mac?: string; ip?: string }) => {
    const next = nics.map((n, k) => (k === i ? { ...n, ...changes } : n)).map(n => Object.fromEntries(Object.entries(n).filter(([, v]) => v)));
    st.updateDevice(itemId, { nics: next });
  };
  const count = (v: number | undefined) => (v === undefined ? undefined : Math.min(16, Math.round(v)));
  return (
    <>
      <div className="sel-break" />
      <label title={t('dev.hostnameTitle')}>{t('dev.hostname')}
        <TextField key={`dh${itemId}`} value={dev.hostname ?? ''} placeholder="PC-01" onCommit={v => st.updateDevice(itemId, { hostname: v.trim() || undefined })} />
      </label>
      <label title={t('dev.videoTitle')}>{t('dev.hdmi')} <OptNum key={`dhd${itemId}`} value={dev.hdmi} placeholder="0" title={t('dev.videoTitle')}
        onCommit={v => st.updateDevice(itemId, { hdmi: count(v) })} /></label>
      <label title={t('dev.videoTitle')}>{t('dev.dp')} <OptNum key={`ddp${itemId}`} value={dev.dp} placeholder="0" title={t('dev.videoTitle')}
        onCommit={v => st.updateDevice(itemId, { dp: count(v) })} /></label>
      <div className="sel-break" />
      <span className="sel-title">{t('dev.lan')}</span>
      <button className="sel-btn" title={t('dev.addNic')} disabled={nics.length >= 16}
        onClick={() => st.updateDevice(itemId, { nics: [...nics, {}] })}><Plus size={14} /></button>
      <button className="sel-btn" title={t('dev.removeNic')} disabled={nics.length <= 1}
        onClick={() => st.updateDevice(itemId, { nics: nics.slice(0, -1) })}><Minus size={14} /></button>
      <div className="dev-nics">
        {nics.map((n, i) => {
          const port = i + 1;
          const here = byPort.get(port) ?? [];
          const badMac = !!n.mac && !isMac(n.mac), badIp = !!n.ip && !isIp(n.ip);
          return (
            <div key={i} className="dev-nic">
              <span className="dev-nic-n">LAN {port}</span>
              <label className={badMac ? 'dev-bad' : ''} title={badMac ? t('dev.badMac') : undefined}>{t('dev.mac')}
                <TextField key={`dm${itemId}-${i}`} value={n.mac ?? ''} placeholder="AA:BB:CC:DD:EE:FF" onCommit={v => setNic(i, { mac: normalizeMac(v) })} />
              </label>
              <label className={badIp ? 'dev-bad' : ''} title={badIp ? t('dev.badIp') : undefined}>{t('dev.ip')}
                <TextField key={`di${itemId}-${i}`} value={n.ip ?? ''} placeholder="192.168.1.20" onCommit={v => setNic(i, { ip: v.trim() || undefined })} />
              </label>
              {here.length > 0 && <span className="tray-tip-dot" style={{ background: here[0].c.color }} />}
              <select className="sel-select sw-cable" title={t('port.pick')} value={here[0] ? key(here[0]) : ''}
                onChange={e => {
                  const it = ends.find(x => key(x) === e.target.value);
                  st.assignPort(itemId, port, it ? { id: it.c.id, end: it.end } : null);
                }}>
                <option value="">{t('port.isFree')}</option>
                {[...here, ...loose].map(e => <option key={key(e)} value={key(e)}>{e.end === 'from' ? '→' : '←'} {e.other}</option>)}
              </select>
              {(() => {
                const tr = portTrace(floor, lang, itemId, port);
                return tr.text ? <span className="sw-trace">{tr.vlan && <span className="sw-line-tag got">{tr.vlan}</span>} {tr.text} → LAN {port}</span> : null;
              })()}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Offers to restore the project from the last quick save / autosave */
function RestoreDialog() {
  const t = useT();
  const [saved, setSaved] = useState<string | null>(() => {
    try {
      const json = localStorage.getItem(AUTOSAVE_KEY);
      if (!json) return null;
      return isProjectEmpty(parseProject(json).floors) ? null : json;
    } catch {
      return null;
    }
  });
  if (!saved) return null;

  const restore = () => {
    try { useStore.getState().load(saved); } catch (err) { alert(t('msg.restoreError', { error: projectErrorText(err) })); }
    setSaved(null);
  };
  const discard = () => {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* storage unavailable */ }
    setSaved(null);
  };

  return (
    <div className="help-overlay">
      <div className="help-box">
        <h3>{t('restore.title')}</h3>
        <p className="dialog-text">{t('restore.text')}</p>
        <div className="dialog-actions">
          <button className="secondary" onClick={discard}>{t('restore.new')}</button>
          <button onClick={restore}>{t('restore.restore')}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const lang = usePrefs(s => s.lang);
  useEffect(() => { document.documentElement.lang = HTML_LANG[lang]; }, [lang]);
  const dark = useIsDark();
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  // Panels open where the object was clicked
  useEffect(trackPlanPresses, []);

  // Warn before leaving only when there are unsaved changes
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, []);

  // Periodic autosave to browser storage while there are unsaved changes
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = useStore.getState();
      if (!st.dirty) return;
      try { localStorage.setItem(AUTOSAVE_KEY, st.save()); } catch { /* storage full or unavailable */ }
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="app">
      <EditorStage />
      <Toolbar />
      <FurniturePanel />
      <SelectionPanel />
      <TextEditor />
      <PrintView />
      <RestoreDialog />
    </div>
  );
}
