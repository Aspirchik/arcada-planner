/** Project-wide Wiring mode settings: cable width, label sizes, which labels show, plan brightness */
import { useState } from 'react';
import { useStore } from '../store';
import { useT, type TKey } from '../i18n';
import type { WiringSettings } from '../types';

type NumKey = 'cableWidth' | 'cableText' | 'trayWidth' | 'trayText' | 'planDim';

const LIMITS: Record<NumKey, [number, number, number]> = {
  // min, max, step
  cableWidth: [0.5, 50, 0.5],
  cableText: [2, 100, 1],
  trayWidth: [1, 200, 1],
  trayText: [2, 100, 1],
  planDim: [5, 100, 5],
};

/** Number input that applies on Enter / blur; out-of-range values are clamped */
function Num({ k, value, onChange }: { k: NumKey; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [min, max, step] = LIMITS[k];
  const commit = () => {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) { setText(String(value)); return; }
    const v = Math.min(max, Math.max(min, n));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <input type="number" value={text} min={min} max={max} step={step}
      onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export function WiringSettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ws = useStore(s => s.wiring);
  const setWiring = useStore(s => s.setWiring);
  const set = <K extends keyof WiringSettings>(k: K, v: WiringSettings[K]) => setWiring({ [k]: v } as Partial<WiringSettings>);

  const num = (k: NumKey, label: TKey, unit: string, extra?: React.ReactNode) => (
    <div className="export-row">
      <span>{t(label)}</span>
      <span className="wset-field"><Num k={k} value={ws[k]} onChange={v => set(k, v)} /> {unit}{extra}</span>
    </div>
  );
  const check = (k: 'cableLabels' | 'cableLengths', label: TKey) => (
    <label className="export-row wset-check">
      <input type="checkbox" checked={ws[k]} onChange={e => set(k, e.target.checked)} /> {t(label)}
    </label>
  );

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-box export-box" onClick={e => e.stopPropagation()}>
        <h3>{t('wset.title')}</h3>
        {num('cableWidth', 'wset.cableWidth', t('unit.cm'),
          <button className="secondary wset-small" title={t('wset.cableWidthHint')}
            onClick={() => useStore.getState().resetCableWidths()}>{t('wset.resetWidths')}</button>)}
        <p className="dialog-text wset-hint">{t('wset.cableWidthHint')}</p>
        {num('cableText', 'wset.cableText', t('unit.cm'))}
        {check('cableLabels', 'wset.cableLabels')}
        {check('cableLengths', 'wset.cableLengths')}
        {num('trayWidth', 'wset.trayWidth', t('unit.cm'))}
        {num('trayText', 'wset.trayText', t('unit.cm'))}
        {num('planDim', 'wset.planDim', '%')}
        <p className="dialog-text wset-hint">{t('wset.note')}</p>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('help.close')}</button>
        </div>
      </div>
    </div>
  );
}
