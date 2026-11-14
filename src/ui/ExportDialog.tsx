/** Export dialog: PDF (vector) or PNG (high resolution), area, theme, floors */
import { useState } from 'react';
import { useStore } from '../store';
import { usePrefs } from '../prefs';
import { useT, type TKey } from '../i18n';
import { useIsDark } from '../theme';
import type { ExportArea } from '../export/planSvg';
import type { ExportFormat, PdfPage } from '../export/exporter';
import type { LayerChoice } from '../layers';

interface Choice {
  format: ExportFormat;
  area: ExportArea;
  dark: boolean;
  allFloors: boolean;
  pxPerCm: number;
  pdfPage: PdfPage;
  layers: LayerChoice;
}

// Remembered between openings (per session)
let last: Choice | null = null;

function Segmented<T extends string | number | boolean>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={String(o.value)} className={'seg-btn' + (o.value === value ? ' active' : '')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const isDark = useIsDark();
  const floors = useStore(s => s.floors);
  const fi = useStore(s => s.fi);
  const mode = useStore(s => s.mode);
  const [c, setC] = useState<Choice>(() => last ?? { format: 'pdf', area: 'room', dark: isDark, allFloors: false, pxPerCm: 4, pdfPage: 'a4', layers: mode === 'wiring' ? 'wiring' : 'plan' });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Choice>(k: K, v: Choice[K]) => setC(prev => ({ ...prev, [k]: v }));

  async function go() {
    last = c;
    setBusy(true);
    try {
      const { runExport } = await import('../export/exporter');
      const prefs = usePrefs.getState();
      const list = c.allFloors ? floors.map((floor, index) => ({ index, floor })) : [{ index: fi, floor: floors[fi] }];
      const n = await runExport({
        format: c.format, area: c.area, dark: c.dark, floors: list, pxPerCm: c.pxPerCm, pdfPage: c.pdfPage, layers: c.layers,
        view: { wallLabels: prefs.wallLabels, showNames: prefs.showNames, sizesPos: prefs.sizesPos, lang: prefs.lang, wiring: useStore.getState().wiring },
        text: { unitM: t('unit.m'), floorTitle: n => t('floor.title', { n }), scale: t('export.scale') },
      });
      if (n === 0) alert(t('export.empty'));
      else onClose();
    } catch (err) {
      alert(t('export.error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  const row = (label: TKey, control: React.ReactNode) => (
    <div className="export-row"><span>{t(label)}</span>{control}</div>
  );

  return (
    <div className="help-overlay" onClick={() => !busy && onClose()}>
      <div className="help-box export-box" onClick={e => e.stopPropagation()}>
        <h3>{t('export.title')}</h3>
        {row('export.format', <Segmented value={c.format} onChange={v => set('format', v)}
          options={[{ value: 'pdf', label: 'PDF' }, { value: 'png', label: 'PNG' }]} />)}
        {row('export.area', <Segmented value={c.area} onChange={v => set('area', v)}
          options={[{ value: 'room', label: t('export.areaRoom') }, { value: 'all', label: t('export.areaAll') }]} />)}
        {row('export.layers', <Segmented value={c.layers} onChange={v => set('layers', v)}
          options={[{ value: 'plan', label: t('export.layersPlan') }, { value: 'all', label: t('export.layersAll') }, { value: 'wiring', label: t('export.layersWiring') }]} />)}
        {row('theme.label', <Segmented value={c.dark} onChange={v => set('dark', v)}
          options={[{ value: false, label: t('theme.light') }, { value: true, label: t('theme.dark') }]} />)}
        {floors.length > 1 && row('export.floors', <Segmented value={c.allFloors} onChange={v => set('allFloors', v)}
          options={[{ value: false, label: t('export.floorsCurrent') }, { value: true, label: t('export.floorsAll') }]} />)}
        {c.format === 'png' && row('export.quality', <Segmented value={c.pxPerCm} onChange={v => set('pxPerCm', v)}
          options={[{ value: 2, label: t('export.qStandard') }, { value: 4, label: t('export.qHigh') }, { value: 8, label: t('export.qMax') }]} />)}
        {c.format === 'pdf' && row('export.page', <Segmented value={c.pdfPage} onChange={v => set('pdfPage', v)}
          options={[{ value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3' }, { value: 'scale50', label: t('export.pageFit') }]} />)}
        <p className="dialog-text export-hint">{t(c.format === 'pdf' ? 'export.hintPdf' : 'export.hintPng')}</p>
        <div className="dialog-actions">
          <button className="secondary" disabled={busy} onClick={onClose}>{t('export.cancel')}</button>
          <button disabled={busy} onClick={go}>{busy ? t('export.busy') : t('export.go')}</button>
        </div>
      </div>
    </div>
  );
}
