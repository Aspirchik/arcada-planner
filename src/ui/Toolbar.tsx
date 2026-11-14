import { useState } from 'react';
import {
  MousePointer2, Eraser, Minus, Grid3X3,
  Tag, ChevronUp, ChevronDown, Trash2, Printer,
  Save, FolderOpen, HelpCircle, Languages, Sun, Moon, Monitor, Ruler, Type, CaseSensitive,
} from 'lucide-react';
import { useStore, ProjectError } from '../store';
import { usePrefs, LANGS, type WallLabelMode, type Lang, type ThemePref } from '../prefs';
import { useT, t as tNow, LANG_NAMES, type TKey } from '../i18n';
import { Tool, AUTOSAVE_KEY } from '../constants';

/** Theme button cycles: Auto → Light → Dark → Auto */
const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

const HELP_KEYS = ['select', 'wall', 'split', 'exterior', 'lengths', 'measure', 'text', 'gaps', 'pan', 'snap', 'keys'] as const;

function saveToFile(data: string) {
  try { localStorage.setItem(AUTOSAVE_KEY, data); } catch { /* storage unavailable */ }
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'floor-plan.arcada'; a.click();
  URL.revokeObjectURL(url);
}

function loadFromFile(onLoad: (json: string) => void) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,.arcada';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.item(0);
    if (file) onLoad(await file.text());
  };
  input.click();
}

/** Readable, translated message for an error thrown while loading a project */
export function projectErrorText(err: unknown): string {
  if (err instanceof ProjectError) return tNow(err.key, err.params);
  return err instanceof Error ? err.message : String(err);
}

export function Toolbar() {
  const { tool, setTool, snapSize, setSnapSize, fi, changeFloor, removeFloor, save, load, markSaved } = useStore();
  const wallLabels = usePrefs(s => s.wallLabels);
  const lang = usePrefs(s => s.lang);
  const theme = usePrefs(s => s.theme);
  const showNames = usePrefs(s => s.showNames);
  const setPref = usePrefs(s => s.set);
  const t = useT();
  const [showHelp, setShowHelp] = useState(false);

  const loadProject = (json: string) => {
    if (useStore.getState().dirty && !confirm(t('msg.unsavedOpen'))) return;
    try {
      load(json);
    } catch (err) {
      alert(t('msg.loadError', { error: projectErrorText(err) }));
    }
  };

  const toolBtn = (icon: React.ReactNode, key: TKey, tl: Tool) => (
    <button
      key={key}
      title={t(key)}
      className={'tool-btn' + (tool === tl ? ' active' : '')}
      onClick={() => setTool(tl)}
    >
      {icon}
      <span>{t(key)}</span>
    </button>
  );

  const actionBtn = (icon: React.ReactNode, key: TKey, onClick: () => void) => (
    <button key={key} title={t(key)} className="tool-btn" onClick={onClick}>
      {icon}
      <span>{t(key)}</span>
    </button>
  );

  return (
    <>
      <nav className="toolbar">
        <div className="toolbar-logo">A</div>

        <div className="tool-group">
          {toolBtn(<MousePointer2 size={20} />, 'tool.select', Tool.Select)}
          {toolBtn(<Minus size={20} />,         'tool.wall',   Tool.WallAdd)}
          {toolBtn(<Ruler size={20} />,         'tool.measure', Tool.Measure)}
          {toolBtn(<Type size={20} />,          'tool.text',   Tool.Text)}
          {toolBtn(<Eraser size={20} />,        'tool.erase',  Tool.Remove)}
        </div>

        <div className="tool-group">
          <div className="floor-controls">
            <button className="floor-arrow" title={t('floor.up')}   onClick={() => changeFloor(1)}><ChevronUp size={14} /></button>
            <span className="floor-num">{fi}</span>
            <button className="floor-arrow" title={t('floor.down')} onClick={() => changeFloor(-1)}><ChevronDown size={14} /></button>
            <button className="floor-arrow floor-del" title={t('floor.delete')} onClick={() => { if (!removeFloor()) alert(t('floor.cantDelete')); }}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        <div className="tool-group">
          <div className={'snap-btn-wrap' + (snapSize > 0 ? ' active' : '')}>
            <Grid3X3 size={20} />
            <span className="snap-label">{t('snap.label')}</span>
            <select
              className="snap-select"
              value={snapSize}
              onChange={e => setSnapSize(+e.target.value)}
            >
              <option value={0}>{t('snap.off')}</option>
              {[5, 10, 25, 50].map(v => <option key={v} value={v}>{v} {t('unit.cm')}</option>)}
            </select>
          </div>
          <div className={'snap-btn-wrap' + (wallLabels !== 'off' ? ' active' : '')} title={t('lengths.title')}>
            <Tag size={20} />
            <span className="snap-label">{t('lengths.label')}</span>
            <select
              className="snap-select"
              value={wallLabels}
              onChange={e => setPref('wallLabels', e.target.value as WallLabelMode)}
            >
              <option value="off">{t('lengths.off')}</option>
              <option value="interior">{t('lengths.interior')}</option>
              <option value="both">{t('lengths.both')}</option>
              <option value="axis">{t('lengths.axis')}</option>
            </select>
          </div>
          <button title={t('names.title')} className={'tool-btn' + (showNames ? ' active' : '')}
            onClick={() => setPref('showNames', !showNames)}>
            <CaseSensitive size={20} />
            <span>{t('names.label')}</span>
          </button>
        </div>

        <div className="tool-group toolbar-bottom">
          <div className="snap-btn-wrap" title={t('lang.label')}>
            <Languages size={20} />
            <select
              className="snap-select"
              value={lang}
              onChange={e => setPref('lang', e.target.value as Lang)}
            >
              {LANGS.map(l => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </div>
          {actionBtn(
            theme === 'light' ? <Sun size={20} /> : theme === 'dark' ? <Moon size={20} /> : <Monitor size={20} />,
            `theme.${theme}` as TKey,
            () => setPref('theme', NEXT_THEME[theme]),
          )}
          {actionBtn(<Save size={20} />,       'action.save',  () => { saveToFile(save()); markSaved(); })}
          {actionBtn(<FolderOpen size={20} />, 'action.load',  () => loadFromFile(loadProject))}
          {actionBtn(<Printer size={20} />,    'action.print', () => window.print())}
          {actionBtn(<HelpCircle size={20} />, 'action.help',  () => setShowHelp(true))}
        </div>
      </nav>

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-box" onClick={e => e.stopPropagation()}>
            <h3>{t('help.title')}</h3>
            <ul>
              {HELP_KEYS.map(k => (
                <li key={k}><b>{t(`help.${k}.title` as TKey)}</b> {t(`help.${k}.text` as TKey)}</li>
              ))}
            </ul>
            <button onClick={() => setShowHelp(false)}>{t('help.close')}</button>
          </div>
        </div>
      )}
    </>
  );
}
