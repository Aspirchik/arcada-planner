import { useEffect, useRef, useState } from 'react';
import { Trash2, BringToFront, SendToBack, Bold, Pencil, Type, Square, Image as ImageIcon, FlipHorizontal2, FlipVertical2, Ruler, Layers, Palette as PaletteIcon } from 'lucide-react';
import { EditorStage } from './ui/EditorStage';
import { Toolbar } from './ui/Toolbar';
import { FurniturePanel } from './ui/FurniturePanel';
import { PrintView } from './ui/PrintView';
import { TextEditor } from './ui/TextEditor';
import { measureNote } from './ui/AnnotationsLayer';
import { rectCorners } from './geometry/hit';
import { useStore, parseProject, isProjectEmpty } from './store';
import { onLayer, styleCables, trayLayer } from './layers';
import { itemNamer } from './labels';
import { CableGroupChips } from './ui/GroupsPanel';
import { cablesInTray, cableRoute, pathLength } from './geometry/cable';
import { formatMeters } from './geometry/wallLabels';
import { setNextCableColor } from './ui/EditorStage';
import { usePrefs } from './prefs';
import { useT, HTML_LANG, type TKey } from './i18n';
import { wallThickness } from './geometry/walls';
import type { LabelPos, Layer } from './types';
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
function panelPos(points: { x: number; y: number }[], stageX: number, stageY: number, stageScale: number, width: number) {
  const cx = points.reduce((s, c) => s + c.x, 0) / points.length;
  const maxY = Math.max(...points.map(c => c.y));
  const sx = stageX + cx * stageScale;
  const sy = stageY + maxY * stageScale + 12;
  return {
    left: Math.max(8, Math.min(sx - width / 2, window.innerWidth - width - 8)),
    top: Math.min(window.innerHeight - (window.innerWidth < 768 ? 150 : 60), Math.max(8, sy)),
  };
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
function ObjectColor({ value, onChange }: { value: string | null | undefined; onChange: (c: string | undefined) => void }) {
  const t = useT();
  return (
    <span className="sel-color" title={t('obj.color')}>
      <PaletteIcon size={13} />
      <ColorSwatches value={value} title={t('obj.color')} colors={OBJECT_COLORS} onChange={c => onChange(c ?? undefined)} />
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
  const lang         = usePrefs(s => s.lang);
  const st           = useStore.getState();
  const t            = useT();

  if (textEdit || selection.length === 0) return null;
  const floor = floors[fi];
  const at = (points: { x: number; y: number }[], width: number) => panelPos(points, stageX, stageY, stageScale, width);

  // ── Group ──
  if (selection.length > 1) {
    const pts = [
      ...floor.furniture.filter(f => selection.includes(f.id)).flatMap(f => rectCorners(f.x, f.y, f.w, f.h, f.rot)),
      ...floor.texts.filter(n => selection.includes(n.id)).flatMap(n => { const m = measureNote(n); return rectCorners(n.x, n.y, m.w, m.h, n.rot); }),
    ];
    if (pts.length === 0) return null;
    return (
      <div className="selection-panel" style={at(pts, 520)}>
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
      <div className="selection-panel" style={at(rectCorners(note.x, note.y, w, h, note.rot), 420)}>
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
      <div className="selection-panel" style={at([a, b], 460)}>
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
    const inside = cablesInTray(tray, styleCables(floor.cables.filter(c => onLayer(c, 'wiring')), st.wiring, itemNamer(floor.furniture, lang)));
    return (
      <div className="selection-panel" style={at(tray.points, 460)}>
        <TextField key={`tl${tray.id}`} value={tray.label ?? ''} placeholder={t('sel.label')}
          onCommit={v => st.updateTray(tray.id, { label: v.trim() || undefined })} />
        <label>{t('tray.width')} <NumField key={`tw${tray.id}`} value={tray.width} min={1}
          onCommit={v => st.updateTray(tray.id, { width: v })} /> {t('unit.cm')}</label>
        <ObjectColor value={tray.color} onChange={c => st.updateTray(tray.id, { color: c })} />
        <LayerButton id={tray.id} layer={trayLayer(tray)} />
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
        <div className="sel-break" />
        <div className="tray-list">
          <span className="sel-title">{t('tool.tray')} · {t('tray.count', { n: inside.length })}</span>
          {inside.map(c => (
            <div key={c.id} className="tray-tip-row">
              <span className="tray-tip-dot" style={{ background: c.color }} />
              <span>{[c.label, cableRoute(c)].filter(Boolean).join(' · ') || '—'}</span>
              <span className="tray-tip-len">{formatMeters(pathLength(c.points), t('unit.m'))}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Cable ──
  const cable = floor.cables.find(c => c.id === selectedId);
  if (cable) {
    const nameOf = itemNamer(floor.furniture, lang);
    const autoFrom = cable.fromLink ? nameOf(cable.fromLink.id) : undefined;
    const autoTo = cable.toLink ? nameOf(cable.toLink.id) : undefined;
    return (
      <div className="selection-panel" style={at(cable.points, 620)}>
        <TextField key={`cl${cable.id}`} value={cable.label ?? ''} placeholder={t('sel.label')}
          onCommit={v => st.updateCable(cable.id, { label: v.trim() || undefined })} />
        <span className={'sel-link' + (cable.fromLink ? ' on' : '')} title={cable.fromLink ? t('cable.linked', { name: autoFrom ?? '?' }) : t('cable.notLinked')}>●</span>
        <TextField key={`cf${cable.id}`} value={cable.from ?? ''} placeholder={autoFrom ?? t('cable.from')}
          onCommit={v => st.updateCable(cable.id, { from: v.trim() || undefined })} />
        <span className="sel-arrow">→</span>
        <TextField key={`ct${cable.id}`} value={cable.to ?? ''} placeholder={autoTo ?? t('cable.to')}
          onCommit={v => st.updateCable(cable.id, { to: v.trim() || undefined })} />
        <span className={'sel-link' + (cable.toLink ? ' on' : '')} title={cable.toLink ? t('cable.linked', { name: autoTo ?? '?' }) : t('cable.notLinked')}>●</span>
        <div className="sel-break" />
        <ColorSwatches value={cable.color} title={t('text.color')} colors={CABLE_COLORS}
          onChange={c => { if (c) { setNextCableColor(c); st.updateCable(cable.id, { color: c }); } }} />
        <label>{t('cable.width')} <NumField key={`cw${cable.id}`} value={cable.width ?? st.wiring.cableWidth} min={0.5}
          onCommit={v => st.updateCable(cable.id, { width: v })} /> {t('unit.cm')}</label>
        <button className={'sel-btn' + (cable.showLength ? ' active' : '')} title={t('cable.showLength')}
          onClick={() => st.updateCable(cable.id, { showLength: cable.showLength ? undefined : true })}><Ruler size={14} /></button>
        <LayerButton id={cable.id} layer={cable.layer} />
        <button className="sel-delete" title={t('sel.delete')} onClick={st.deleteSelected}><Trash2 size={14} /></button>
        <div className="sel-break" />
        <span className="sel-title">{t('cable.groups')}</span>
        <CableGroupChips cableId={cable.id} groups={cable.groups} />
      </div>
    );
  }

  // ── Ruler measurement ──
  if (dim) {
    const len = Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1);
    return (
      <div className="selection-panel" style={at([{ x: dim.x1, y: dim.y1 }, { x: dim.x2, y: dim.y2 }], 380)}>
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
    <div className="selection-panel" style={at(rectCorners(item.x, item.y, item.w, item.h, item.rot), 540)}>
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
    </div>
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
