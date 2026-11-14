import { useEffect, useRef, useState } from 'react';
import { Trash2, BringToFront, SendToBack, Bold, Pencil } from 'lucide-react';
import { EditorStage } from './ui/EditorStage';
import { Toolbar } from './ui/Toolbar';
import { FurniturePanel } from './ui/FurniturePanel';
import { PrintView } from './ui/PrintView';
import { TextEditor } from './ui/TextEditor';
import { measureNote } from './ui/AnnotationsLayer';
import { rectCorners } from './geometry/hit';
import { useStore, parseProject, isProjectEmpty } from './store';
import { usePrefs } from './prefs';
import { useT, HTML_LANG } from './i18n';
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

function SelectionPanel() {
  const selectedId   = useStore(s => s.selectedId);
  const floors       = useStore(s => s.floors);
  const fi           = useStore(s => s.fi);
  const stageX       = useStore(s => s.stageX);
  const stageY       = useStore(s => s.stageY);
  const stageScale   = useStore(s => s.stageScale);
  const textEdit     = useStore(s => s.textEdit);
  const updateFurniture = useStore(s => s.updateFurniture);
  const updateText   = useStore(s => s.updateText);
  const deleteSelected = useStore(s => s.deleteSelected);
  const bringToFront = useStore(s => s.bringToFront);
  const sendToBack   = useStore(s => s.sendToBack);
  const setTextEdit  = useStore(s => s.setTextEdit);
  const t            = useT();

  if (selectedId === null || textEdit) return null;
  const item = floors[fi].furniture.find(f => f.id === selectedId);
  const note = item ? null : floors[fi].texts.find(n => n.id === selectedId);

  if (note) {
    const { w, h } = measureNote(note);
    const pos = panelPos(rectCorners(note.x, note.y, w, h, note.rot), stageX, stageY, stageScale, 420);
    return (
      <div className="selection-panel" style={pos}>
        <label>{t('text.size')} <NumField key={`s${note.id}`} value={Math.round(note.size)} min={4}
          onCommit={v => updateText(note.id, { size: v })} /> {t('unit.cm')}</label>
        <label>{t('sel.r')} <NumField key={`r${note.id}`} value={Math.round(note.rot)}
          onCommit={v => updateText(note.id, { rot: v })} /> °</label>
        <button className={'sel-btn' + (note.bold ? ' active' : '')} title={t('text.bold')}
          onClick={() => updateText(note.id, { bold: !note.bold })}>
          <Bold size={14} />
        </button>
        <span className="sel-swatches" title={t('text.color')}>
          {TEXT_COLORS.map(c => (
            <button key={c ?? 'auto'} className={'sel-swatch' + (note.color === c ? ' active' : '') + (c === null ? ' auto' : '')}
              style={c ? { background: c } : undefined} onClick={() => updateText(note.id, { color: c })} />
          ))}
        </span>
        <button className="sel-btn" title={t('text.edit')} onClick={() => setTextEdit({ id: note.id, x: note.x, y: note.y })}>
          <Pencil size={14} />
        </button>
        <button className="sel-delete" title={t('sel.delete')} onClick={deleteSelected}>
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  if (!item) return null;
  const wCm = Math.round(item.w / METER * 100);
  const hCm = Math.round(item.h / METER * 100);
  const rot  = Math.round(item.rot);
  const pos = panelPos(rectCorners(item.x, item.y, item.w, item.h, item.rot), stageX, stageY, stageScale, 540);

  return (
    <div className="selection-panel" style={pos}>
      <label>{t('sel.w')} <NumField key={`w${item.id}`} value={wCm} min={1}
        onCommit={v => updateFurniture(item.id, { w: v / 100 * METER })} /> {t('unit.cm')}</label>
      <label>{t('sel.h')} <NumField key={`h${item.id}`} value={hCm} min={1}
        onCommit={v => updateFurniture(item.id, { h: v / 100 * METER })} /> {t('unit.cm')}</label>
      <label>{t('sel.r')} <NumField key={`r${item.id}`} value={rot}
        onCommit={v => updateFurniture(item.id, { rot: v })} /> °</label>
      <TextField key={`l${item.id}`} value={item.label ?? ''} placeholder={t('sel.label')}
        onCommit={v => updateFurniture(item.id, { label: v.trim() || undefined })} />
      <button className="sel-btn" title={t('sel.front')} onClick={() => bringToFront(item.id)}>
        <BringToFront size={14} />
      </button>
      <button className="sel-btn" title={t('sel.back')} onClick={() => sendToBack(item.id)}>
        <SendToBack size={14} />
      </button>
      <button className="sel-delete" title={t('sel.delete')} onClick={deleteSelected}>
        <Trash2 size={14} />
      </button>
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
