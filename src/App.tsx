import { useEffect, useRef, useState } from 'react';
import { Trash2, BringToFront, SendToBack } from 'lucide-react';
import { EditorStage } from './ui/EditorStage';
import { Toolbar } from './ui/Toolbar';
import { FurniturePanel } from './ui/FurniturePanel';
import { PrintView } from './ui/PrintView';
import { useStore, parseProject, isProjectEmpty } from './store';
import { usePrefs } from './prefs';
import { useT, HTML_LANG } from './i18n';
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

function SelectionPanel() {
  const selectedId   = useStore(s => s.selectedId);
  const floors       = useStore(s => s.floors);
  const fi           = useStore(s => s.fi);
  const stageX       = useStore(s => s.stageX);
  const stageY       = useStore(s => s.stageY);
  const stageScale   = useStore(s => s.stageScale);
  const updateFurniture = useStore(s => s.updateFurniture);
  const deleteFurniture = useStore(s => s.deleteFurniture);
  const bringToFront = useStore(s => s.bringToFront);
  const sendToBack   = useStore(s => s.sendToBack);
  const select       = useStore(s => s.select);
  const t            = useT();

  if (selectedId === null) return null;
  const item = floors[fi].furniture.find(f => f.id === selectedId);
  if (!item) return null;

  // Screen coordinates: center-bottom of item (accounting for rotation)
  const rad = item.rot * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: item.x, y: item.y },
    { x: item.x + item.w * cos, y: item.y + item.w * sin },
    { x: item.x - item.h * sin, y: item.y + item.h * cos },
    { x: item.x + item.w * cos - item.h * sin, y: item.y + item.w * sin + item.h * cos },
  ];
  const centerX = corners.reduce((s, c) => s + c.x, 0) / 4;
  const maxY = Math.max(...corners.map(c => c.y));
  const sx = stageX + centerX * stageScale;
  const sy = stageY + maxY * stageScale + 12;

  const wCm = Math.round(item.w / METER * 100);
  const hCm = Math.round(item.h / METER * 100);
  const rot  = Math.round(item.rot);

  return (
    <div className="selection-panel" style={{ left: Math.max(8, Math.min(sx - 200, window.innerWidth - 400)), top: Math.min(window.innerHeight - (window.innerWidth < 768 ? 110 : 50), Math.max(8, sy)) }}>
      <label>{t('sel.w')} <NumField key={`w${item.id}`} value={wCm} min={1}
        onCommit={v => updateFurniture(item.id, { w: v / 100 * METER })} /> {t('unit.cm')}</label>
      <label>{t('sel.h')} <NumField key={`h${item.id}`} value={hCm} min={1}
        onCommit={v => updateFurniture(item.id, { h: v / 100 * METER })} /> {t('unit.cm')}</label>
      <label>{t('sel.r')} <NumField key={`r${item.id}`} value={rot}
        onCommit={v => updateFurniture(item.id, { rot: v })} /> °</label>
      <button className="sel-btn" title={t('sel.front')} onClick={() => bringToFront(item.id)}>
        <BringToFront size={14} />
      </button>
      <button className="sel-btn" title={t('sel.back')} onClick={() => sendToBack(item.id)}>
        <SendToBack size={14} />
      </button>
      <button className="sel-delete" title={t('sel.delete')} onClick={() => { deleteFurniture(item.id); select(null); }}>
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
      <PrintView />
      <RestoreDialog />
    </div>
  );
}
