/** Browser side of the export: fonts, sprites, PNG rendering and vector PDF */
import type { FloorState } from '../types';
import { buildPlanSvg, prepareSprite, EXPORT_FONT, type SpriteDef, type Measure, type ExportArea } from './planSvg';
import { darkSvg, spriteUrl } from '../ui/images';
import { DARK, LIGHT } from '../theme';
import type { WallLabelMode, SizesPos, Lang } from '../prefs';
import type { LayerChoice } from '../layers';

export type ExportFormat = 'pdf' | 'png';
export type PdfPage = 'a4' | 'a3' | 'scale50';

export interface ExportRequest {
  format: ExportFormat;
  area: ExportArea;
  dark: boolean;
  /** Floors to export, with their index (for titles and file names) */
  floors: { index: number; floor: FloorState }[];
  /** PNG: pixels per centimetre */
  pxPerCm: number;
  pdfPage: PdfPage;
  layers: LayerChoice;
  view: { wallLabels: WallLabelMode; showNames: boolean; sizesPos: SizesPos; lang: Lang };
  text: { unitM: string; floorTitle: (n: number) => string; scale: string };
}

// ── Fonts (Roboto: Latin, Polish, Cyrillic) ─────────────────────
interface Fonts { regular: string; bold: string }
let fontsPromise: Promise<Fonts> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function loadFonts(): Promise<Fonts> {
  fontsPromise ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const [r, b] = await Promise.all(['Roboto-Regular.ttf', 'Roboto-Bold.ttf'].map(async name => {
      const res = await fetch(`${base}fonts/${name}`);
      if (!res.ok) throw new Error(`font ${name}: ${res.status}`);
      return res.arrayBuffer();
    }));
    // Make the font available for text measuring in this document
    const faces = [new FontFace(EXPORT_FONT, r.slice(0)), new FontFace(EXPORT_FONT, b.slice(0), { weight: 'bold' })];
    for (const ff of faces) { await ff.load(); document.fonts.add(ff); }
    return { regular: toBase64(r), bold: toBase64(b) };
  })();
  fontsPromise.catch(() => { fontsPromise = null; });
  return fontsPromise;
}

let ctx: CanvasRenderingContext2D | null = null;
const measure: Measure = (text, size, bold) => {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${EXPORT_FONT}`;
  return ctx.measureText(text).width;
};

// ── Sprites ─────────────────────────────────────────────────────
async function loadSprites(floors: FloorState[], dark: boolean): Promise<Map<string, SpriteDef>> {
  const paths = [...new Set(floors.flatMap(f => f.furniture.filter(it => !it.simple).map(it => it.path)))];
  const map = new Map<string, SpriteDef>();
  await Promise.all(paths.map(async (path, i) => {
    try {
      const res = await fetch(spriteUrl(path));
      if (!res.ok) return;
      let text = await res.text();
      if (dark) text = darkSvg(text);
      map.set(path, prepareSprite(text, `sp${i}`));
    } catch { /* missing sprite → placeholder rectangle */ }
  }));
  return map;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Browser canvas limits
const MAX_SIDE = 16000;
const MAX_AREA = 120_000_000;

async function exportPng(req: ExportRequest, sprites: Map<string, SpriteDef>, fonts: Fonts) {
  const palette = req.dark ? DARK : LIGHT;
  const css = `@font-face{font-family:${EXPORT_FONT};src:url(data:font/ttf;base64,${fonts.regular}) format('truetype');}`
    + `@font-face{font-family:${EXPORT_FONT};font-weight:bold;src:url(data:font/ttf;base64,${fonts.bold}) format('truetype');}`;
  let exported = 0;
  for (const { index, floor } of req.floors) {
    const probe = buildPlanSvg(floor, sprites, { ...req.view, layers: req.layers, area: req.area, palette, unitM: req.text.unitM, measure });
    if (!probe) continue;
    let k = req.pxPerCm;
    k = Math.min(k, MAX_SIDE / probe.width, MAX_SIDE / probe.height, Math.sqrt(MAX_AREA / (probe.width * probe.height)));
    const pw = Math.round(probe.width * k), ph = Math.round(probe.height * k);
    const r = buildPlanSvg(floor, sprites, { ...req.view, layers: req.layers, area: req.area, palette, unitM: req.text.unitM, measure, css, pixelWidth: pw, pixelHeight: ph })!;
    const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = pw; canvas.height = ph;
      const c = canvas.getContext('2d')!;
      c.drawImage(img, 0, 0, pw, ph);
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('PNG encoding failed');
      download(blob, req.floors.length > 1 ? `floor-plan-${index}.png` : 'floor-plan.png');
      exported++;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return exported;
}

async function exportPdf(req: ExportRequest, sprites: Map<string, SpriteDef>, fonts: Fonts) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const palette = req.dark ? DARK : LIGHT;
  const MARGIN = 10, TITLE = 10; // mm

  const plans = req.floors
    .map(({ index, floor }) => ({ index, r: buildPlanSvg(floor, sprites, { ...req.view, layers: req.layers, area: req.area, palette, unitM: req.text.unitM, measure }) }))
    .filter((x): x is { index: number; r: NonNullable<typeof x.r> } => !!x.r);
  if (plans.length === 0) return 0;

  const pageFor = (w: number, h: number): [number, number] => {
    if (req.pdfPage === 'scale50') return [w * 0.2 + MARGIN * 2, h * 0.2 + MARGIN * 2 + TITLE];
    const [a, b] = req.pdfPage === 'a3' ? [420, 297] : [297, 210];
    return w >= h ? [a, b] : [b, a];
  };

  const first = pageFor(plans[0].r.width, plans[0].r.height);
  const doc = new jsPDF({ unit: 'mm', format: first, orientation: first[0] >= first[1] ? 'landscape' : 'portrait', compress: true });
  doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular);
  doc.addFont('Roboto-Regular.ttf', EXPORT_FONT, 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold);
  doc.addFont('Roboto-Bold.ttf', EXPORT_FONT, 'bold');

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < plans.length; i++) {
      const { index, r } = plans[i];
      const [pw, ph] = pageFor(r.width, r.height);
      if (i > 0) doc.addPage([pw, ph], pw >= ph ? 'landscape' : 'portrait');
      if (req.dark) { doc.setFillColor(palette.paper); doc.rect(0, 0, pw, ph, 'F'); }

      // Fit the plan into the page under the title, keeping proportions
      const availW = pw - MARGIN * 2, availH = ph - MARGIN * 2 - TITLE;
      const s = Math.min(availW / r.width, availH / r.height);
      const w = r.width * s, h = r.height * s;
      const x = (pw - w) / 2, y = MARGIN + TITLE + (availH - h) / 2;

      doc.setFont(EXPORT_FONT, 'bold');
      doc.setFontSize(12);
      doc.setTextColor(palette.text);
      const ratio = Math.round(10 / s); // 1 cm of the plan = s mm on paper
      doc.text(`${req.text.floorTitle(index)}   ·   ${req.text.scale} 1:${ratio}`, pw / 2, MARGIN + 5, { align: 'center' });

      host.innerHTML = r.svg;
      const el = host.querySelector('svg')!;
      await doc.svg(el, { x, y, width: w, height: h });
    }
  } finally {
    host.remove();
  }
  doc.save(plans.length > 1 ? 'floor-plan-all-floors.pdf' : `floor-plan-${plans[0].index}.pdf`);
  return plans.length;
}

/** Runs the export; resolves to the number of floors exported (0 = nothing to export) */
export async function runExport(req: ExportRequest): Promise<number> {
  const [fonts, sprites] = await Promise.all([loadFonts(), loadSprites(req.floors.map(f => f.floor), req.dark)]);
  return req.format === 'png' ? exportPng(req, sprites, fonts) : exportPdf(req, sprites, fonts);
}
