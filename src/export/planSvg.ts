/**
 * Builds a vector SVG of one floor (pure — no DOM), used for PDF and PNG export.
 * Units inside the SVG are world units (1 = 1 cm), exactly like the editor.
 */
import type { FloorState, FurnitureItem, LabelPos, TextNote, WiringSettings } from '../types';
import type { Palette } from '../theme';
import type { WallLabelMode, SizesPos, Lang } from '../prefs';
import { computeWallGeometry, type FloorWallGeom } from '../geometry/walls';
import { rectCorners, type Pt } from '../geometry/hit';
import { wallLabelSpecs, formatMeters, LABEL_SIZE } from '../geometry/wallLabels';
import { sortByZ } from '../helpers';
import { layerPasses, styleCables, heightCtx, DEFAULT_WIRING, type LayerView, type LayerChoice } from '../layers';
import { mixHex, spriteKey } from '../color';
import { furnitureLabel, sizesCorner, itemNamer } from '../labels';
import { cableLabel, layoutCables, placeCableLabels, labelObstacles, midAlong, cableJoints, jointSize, cablePlugs, plugSize } from '../geometry/cable';
import { translate } from '../i18n';

export const EXPORT_FONT = 'Roboto';
const LINE_HEIGHT = 1.2;

export type ExportArea = 'room' | 'all';

/** A furniture sprite ready to be inlined: its viewBox, root fill and namespaced inner markup */
export interface SpriteDef { viewBox: string; fill: string | null; body: string }

/** Measures text width in world units for the given font size */
export type Measure = (text: string, size: number, bold: boolean) => number;

export const approxMeasure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.54);

export interface PlanSvgOptions {
  area: ExportArea;
  palette: Palette;
  wallLabels: WallLabelMode;
  showNames: boolean;
  sizesPos: SizesPos;
  lang: Lang;
  unitM: string;
  /** Empty space around the content, cm */
  margin?: number;
  measure?: Measure;
  /** Extra CSS (e.g. @font-face) put into <defs><style> */
  css?: string;
  /** Layers to output (default: everything) */
  layers?: LayerChoice;
  /** Wiring mode settings: cable width and labels, tray labels, how strongly the plan shows under the wiring */
  wiring?: WiringSettings;
  /** Ids of the project's common cable groups (after the floor's own groups in lane order) */
  commonGroups?: number[];
  /** Pixel size written to the root element (PNG); the viewBox stays in cm */
  pixelWidth?: number;
  pixelHeight?: number;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

// ── Small helpers ───────────────────────────────────────────────
/** Mixes a #rrggbb colour towards `to` (amount = how much of the original stays) */
export function fadeHex(hex: string, to: string, amount = 0.3): string {
  return mixHex(hex, to, amount);
}

function fadePalette(p: Palette, amount: number): Palette {
  const out = { ...p } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && k !== 'paper') out[k] = fadeHex(v, p.paper, amount);
  return out as unknown as Palette;
}

const f = (n: number) => String(Math.round(n * 100) / 100);
const esc = (s: string) => s.replace(/→/g, '»').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pts = (p: Pt[]) => p.map(q => `${f(q.x)},${f(q.y)}`).join(' ');

function grow(b: Bounds | null, p: Pt): Bounds {
  if (!b) return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  return { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) };
}

/** Text with an optional halo; (x, y) is the baseline anchor */
function textEl(x: number, y: number, str: string, size: number, fill: string, opts: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; halo?: string } = {}): string {
  const common = `x="${f(x)}" y="${f(y)}" font-family="${EXPORT_FONT}" font-size="${f(size)}" text-anchor="${opts.anchor ?? 'middle'}"${opts.bold ? ' font-weight="bold"' : ''}`;
  const halo = opts.halo
    ? `<text ${common} fill="${opts.halo}" stroke="${opts.halo}" stroke-width="${f(size / 4)}" stroke-linejoin="round">${esc(str)}</text>`
    : '';
  return `${halo}<text ${common} fill="${fill}">${esc(str)}</text>`;
}

/** Text centred on p along a direction, never upside down (like AlongText on the canvas) */
function alongText(p: Pt, angleDeg: number, str: string, size: number, fill: string, halo?: string): string {
  let a = angleDeg;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return `<g transform="translate(${f(p.x)} ${f(p.y)}) rotate(${f(a)})">${textEl(0, size * 0.35, str, size, fill, { halo })}</g>`;
}

/** Greedy word wrap to a maximum width */
export function wrapText(text: string, maxW: number, size: number, bold: boolean, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      const next = `${line} ${w}`;
      if (measure(next, size, bold) <= maxW) line = next;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

// ── Sprites ─────────────────────────────────────────────────────
/**
 * Prepares a furniture SVG for inlining into one document: strips editor metadata
 * and prefixes class names and ids with `ns` so styles of different sprites can't clash.
 */
export function prepareSprite(svg: string, ns: string): SpriteDef {
  const root = svg.match(/<svg\b([^>]*)>/i);
  const attrs = root ? root[1] : '';
  const attr = (name: string) => attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? null;
  const num = (v: string | null) => (v ? parseFloat(v) : NaN);
  let viewBox = attr('viewBox');
  if (!viewBox) {
    const w = num(attr('width')), h = num(attr('height'));
    viewBox = `0 0 ${Number.isFinite(w) ? w : 100} ${Number.isFinite(h) ? h : 100}`;
  }
  const start = root ? (root.index ?? 0) + root[0].length : 0;
  const end = svg.lastIndexOf('</svg>');
  let body = svg.slice(start, end > start ? end : svg.length);

  body = body
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(sodipodi|inkscape):[\w-]+\b[^>]*\/>/g, '')
    .replace(/<(sodipodi|inkscape):([\w-]+)\b[^>]*>[\s\S]*?<\/\1:\2>/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/\s(sodipodi|inkscape):[\w-]+\s*=\s*"[^"]*"/g, '');
  // Namespacing: ids and references to them, classes and class selectors in <style>
  body = body
    .replace(/\sid\s*=\s*"([^"]+)"/g, (_m, id: string) => ` id="${ns}-${id}"`)
    .replace(/(href\s*=\s*")#([^"]+)"/g, (_m, pre: string, id: string) => `${pre}#${ns}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${ns}-${id})`)
    .replace(/\sclass\s*=\s*"([^"]+)"/g, (_m, cls: string) => ` class="${cls.split(/\s+/).filter(Boolean).map(c => `${ns}-${c}`).join(' ')}"`)
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/g, (_m, sa: string, css: string) =>
      `<style${sa}>${css.replace(/\.(-?[A-Za-z_][\w-]*)/g, (_x, c: string) => `.${ns}-${c}`)}</style>`);
  return { viewBox, fill: attr('fill'), body };
}

// ── Bounds ──────────────────────────────────────────────────────
function noteSize(n: TextNote, measure: Measure) {
  const lines = (n.text || ' ').split('\n');
  return { w: Math.max(...lines.map(l => measure(l, n.size, n.bold)), n.size * 0.5), h: lines.length * n.size * LINE_HEIGHT };
}

/** Area to export: the walls (room) or everything on the plan; null when the floor is empty */
export function contentBounds(floor: FloorState, geom: FloorWallGeom, area: ExportArea, measure: Measure = approxMeasure): Bounds | null {
  let b: Bounds | null = null;
  if (area === 'room') {
    // Walls that enclose a room; stray free-standing walls don't widen the frame
    const roomWalls = geom.walls.filter(w => w.left.room || w.right.room);
    for (const w of roomWalls.length ? roomWalls : geom.walls) for (const p of w.polygon) b = grow(b, p);
    if (b) return b;
  }
  for (const w of geom.walls) for (const p of w.polygon) b = grow(b, p);
  for (const it of floor.furniture) for (const p of rectCorners(it.x, it.y, it.w, it.h, it.rot)) b = grow(b, p);
  for (const n of floor.texts) { const s = noteSize(n, measure); for (const p of rectCorners(n.x, n.y, s.w, s.h, n.rot)) b = grow(b, p); }
  for (const d of floor.dimensions) { b = grow(b, { x: d.x1, y: d.y1 }); b = grow(b, { x: d.x2, y: d.y2 }); }
  for (const c of floor.cables) for (const p of c.points) b = grow(b, p);
  for (const t of floor.trays) for (const p of t.points) b = grow(b, p);
  for (const n of floor.nodes) b = grow(b, n);
  return b;
}

// ── Labels on furniture (same rules as the canvas) ──────────────
const MIRROR: Record<LabelPos, LabelPos> = { c: 'c', t: 'b', b: 't', l: 'r', r: 'l', tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
const H = (p: LabelPos) => (p === 'l' || p === 'tl' || p === 'bl' ? 'start' : p === 'r' || p === 'tr' || p === 'br' ? 'end' : 'middle');
const V = (p: LabelPos) => (p === 't' || p === 'tl' || p === 'tr' ? 'top' : p === 'b' || p === 'bl' || p === 'br' ? 'bottom' : 'middle');

/** Lines of text placed in a box (inside the item's own frame) */
function boxText(lines: string[], size: number, pos: LabelPos, x0: number, y0: number, w: number, h: number, fill: string, halo: string, bold: boolean): string {
  const lh = size * LINE_HEIGHT;
  const blockH = lines.length * lh;
  const v = V(pos);
  const top = v === 'top' ? y0 : v === 'bottom' ? y0 + h - blockH : y0 + (h - blockH) / 2;
  const anchor = H(pos);
  const x = anchor === 'start' ? x0 : anchor === 'end' ? x0 + w : x0 + w / 2;
  return lines.map((l, i) => textEl(x, top + i * lh + size * 0.82, l, size, fill, { anchor, bold, halo })).join('');
}

function furnitureLabels(item: FurnitureItem, o: Required<Pick<PlanSvgOptions, 'palette' | 'showNames' | 'sizesPos' | 'lang' | 'measure'>>): string {
  const text = furnitureLabel(item, o.showNames, o.lang);
  const corner = sizesCorner(item, o.sizesPos);
  if (!text && corner === 'off') return '';
  const rot = ((item.rot % 360) + 360) % 360;
  const flip = rot > 90 && rot <= 270;
  const pos = (p: LabelPos) => (flip ? MIRROR[p] : p);
  const pad = Math.min(4, item.w * 0.05, item.h * 0.05);
  const bw = Math.max(1, item.w - pad * 2), bh = Math.max(1, item.h - pad * 2);
  let inner = '';
  if (text) {
    const bold = !!item.labelBold;
    let size = item.labelSize;
    if (!size) {
      const perUnit = o.measure(text, 10, bold) / 10;
      size = Math.max(7, Math.min(14, Math.min(item.w, item.h) * 0.3, (item.w * 0.92) / Math.max(perUnit, 0.01)));
    }
    const lines = wrapText(text, bw, size, bold, o.measure);
    inner += boxText(lines, size, pos(item.labelPos ?? 'c'), pad, pad, bw, bh, item.labelColor ?? o.palette.text, o.palette.textHalo, bold);
  }
  if (corner !== 'off') {
    const sz = Math.max(6, Math.min(11, Math.min(item.w, item.h) * 0.16));
    inner += boxText([`${Math.round(item.w)}×${Math.round(item.h)}`], sz, pos(corner), pad, pad, bw, bh, o.palette.wallLabel, o.palette.textHalo, false);
  }
  const flipT = flip ? ` transform="translate(${f(item.w)} ${f(item.h)}) rotate(180)"` : '';
  return `<g transform="translate(${f(item.x)} ${f(item.y)}) rotate(${f(item.rot)})"><g${flipT}>${inner}</g></g>`;
}

// ── Dimension line (same look as the canvas, px = 1) ────────────
function dimension(d: { x1: number; y1: number; x2: number; y2: number; color?: string }, palette: Palette, unit: string): string {
  const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  if (len < 0.5) return '';
  const ux = (d.x2 - d.x1) / len, uy = (d.y2 - d.y1) / len;
  const nx = -uy, ny = ux;
  const c = d.color ?? palette.dimension;
  const arrow = Math.min(8, len / 3), half = arrow * 0.375;
  const head = (tx: number, ty: number, dir: 1 | -1) => {
    const bx = tx - ux * arrow * dir, by = ty - uy * arrow * dir;
    return `<polygon points="${pts([{ x: tx, y: ty }, { x: bx + nx * half, y: by + ny * half }, { x: bx - nx * half, y: by - ny * half }])}" fill="${c}"/>`;
  };
  const tick = (x: number, y: number) => `<line x1="${f(x - nx * 6)}" y1="${f(y - ny * 6)}" x2="${f(x + nx * 6)}" y2="${f(y + ny * 6)}" stroke="${c}" stroke-width="1.3"/>`;
  const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
  const mid = { x: (d.x1 + d.x2) / 2 + nx * 11 * side, y: (d.y1 + d.y2) / 2 + ny * 11 * side };
  return `<line x1="${f(d.x1)}" y1="${f(d.y1)}" x2="${f(d.x2)}" y2="${f(d.y2)}" stroke="${c}" stroke-width="1.3"/>`
    + head(d.x2, d.y2, 1) + head(d.x1, d.y1, -1) + tick(d.x1, d.y1) + tick(d.x2, d.y2)
    + alongText(mid, Math.atan2(uy, ux) * 180 / Math.PI, formatMeters(len, unit), 12, c, palette.paper);
}

// ── Main ────────────────────────────────────────────────────────
export function buildPlanSvg(floor: FloorState, sprites: Map<string, SpriteDef>, opts: PlanSvgOptions): { svg: string; width: number; height: number } | null {
  const measure = opts.measure ?? approxMeasure;
  const p = opts.palette;
  const geom = computeWallGeometry(floor.nodes, floor.walls);
  const b0 = contentBounds(floor, geom, opts.area, measure);
  if (!b0) return null;
  const m = opts.margin ?? 20;
  const b = { minX: b0.minX - m, minY: b0.minY - m, maxX: b0.maxX + m, maxY: b0.maxY + m };
  const W = b.maxX - b.minX, Hh = b.maxY - b.minY;

  const parts: string[] = [];
  parts.push(`<rect x="${f(b.minX)}" y="${f(b.minY)}" width="${f(W)}" height="${f(Hh)}" fill="${p.paper}"/>`);

  // Walls: fills, joint hubs, face outlines, square ends
  const walls = (pal: Palette): string => {
    const out: string[] = [];
    for (const g of geom.walls) {
      const fill = g.wall.exterior ? pal.wallExterior : pal.wallInterior;
      out.push(`<polygon points="${pts(g.polygon)}" fill="${fill}" stroke="${fill}" stroke-width="0.6"/>`);
    }
    for (const h of geom.hubs) {
      const fill = h.exterior ? pal.wallExterior : pal.wallInterior;
      out.push(`<polygon points="${pts(h.polygon)}" fill="${fill}" stroke="${fill}" stroke-width="0.6"/>`);
    }
    const line = (a: Pt, c: Pt) => `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(c.x)}" y2="${f(c.y)}" stroke="${pal.wallStroke}" stroke-width="1"/>`;
    for (const g of geom.walls) {
      out.push(line(g.left.a, g.left.b), line(g.right.a, g.right.b));
      if (g.freeA) out.push(line(g.left.a, g.right.a));
      if (g.freeB) out.push(line(g.left.b, g.right.b));
    }
    for (const g of geom.walls)
      for (const l of wallLabelSpecs(g, opts.wallLabels))
        out.push(alongText(l.p, l.angle, formatMeters(l.length, opts.unitM), LABEL_SIZE, pal.wallLabel));
    return out.join('');
  };

  const ws = opts.wiring ?? DEFAULT_WIRING;
  const dimBy = ws.planDim / 100;
  // Cable trays of one layer — drawn for all layers before any furniture, since sockets often sit in a tray
  const traysSvg = (v: LayerView, pal: Palette): string => {
    const out: string[] = [];
    for (const t of v.trays) {
      const tp = pts(t.points);
      const edge = t.color ?? pal.trayStroke;
      out.push(`<polyline points="${tp}" fill="none" stroke="${edge}" stroke-width="${f(t.width + 2)}" stroke-linejoin="miter"/>`);
      out.push(`<polyline points="${tp}" fill="none" stroke="${t.color ? mixHex(t.color, pal.paper, 0.18) : pal.trayFill}" stroke-width="${f(t.width)}" stroke-linejoin="miter"/>`);
    }
    for (const t of v.trays) {
      if (!t.label) continue;
      const mid = midAlong(t.points);
      out.push(alongText(mid.p, mid.angle, t.label, ws.trayText, t.color ?? pal.trayStroke, pal.paper));
    }
    return out.join('');
  };

  // Objects of one layer: furniture, cables, labels, texts, rulers
  const objects = (v: LayerView, pal: Palette, faded: boolean): string => {
    const fade = (c: string) => (faded ? fadeHex(c, pal.paper, dimBy) : c);
    const out: string[] = [];
    for (const it of sortByZ(v.furniture)) {
      const tr = `translate(${f(it.x)} ${f(it.y)}) rotate(${f(it.rot)})`;
      const sp = it.simple ? undefined : sprites.get(spriteKey(it));
      if (!sp) {
        const stroke = it.simple ? (it.color ? fade(it.color) : pal.wallStroke) : pal.placeholderStroke;
        const fill = it.simple ? (it.color ? mixHex(fade(it.color), pal.paper, 0.14) : pal.paper) : pal.placeholderFill;
        out.push(`<g transform="${tr}"><rect width="${f(it.w)}" height="${f(it.h)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></g>`);
        continue;
      }
      const flip = it.flipX || it.flipY
        ? ` transform="translate(${f(it.flipX ? it.w : 0)} ${f(it.flipY ? it.h : 0)}) scale(${it.flipX ? -1 : 1} ${it.flipY ? -1 : 1})"`
        : '';
      out.push(`<g transform="${tr}"${faded ? ` opacity="${f(dimBy)}"` : ''}><g${flip}><svg x="0" y="0" width="${f(it.w)}" height="${f(it.h)}" viewBox="${sp.viewBox}" preserveAspectRatio="none" overflow="hidden"${sp.fill ? ` fill="${sp.fill}"` : ''}>${sp.body}</svg></g></g>`);
    }
    // Cables (above furniture): shared runs side by side, labels kept apart
    const cables = styleCables(v.cables, ws, itemNamer(floor.furniture, opts.lang, floor.cables), heightCtx(floor));
    const size = ws.cableText;
    const cablePaths = layoutCables(cables, [...(floor.groups ?? []).map(g => g.id), ...(opts.commonGroups ?? [])]);
    const cableTexts = new Map(ws.cableLabels ? cables.map(c => [c.id, cableLabel(c, opts.unitM, translate(opts.lang, 'cable.patchShort'))] as [number, string]).filter(([, l]) => !!l) : []);
    const cableSpots = placeCableLabels(cables, cablePaths, cableTexts, size, t => measure(t, size, false),
      labelObstacles(geom, opts.wallLabels, floor.furniture));
    for (const c of cables) {
      const path = cablePaths.get(c.id) ?? c.points;
      if (path.length < 2) continue;
      out.push(`<polyline points="${pts(path)}" fill="none" stroke="${fade(c.color)}" stroke-width="${f(c.width ?? ws.cableWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      // Connectors: a sleeve across the line
      const js = jointSize(c.width ?? ws.cableWidth);
      // Plugs at the free ends of a patch cord
      const ps = plugSize(c.width ?? ws.cableWidth);
      for (const j of cablePlugs(c, path)) {
        out.push(`<g transform="translate(${f(j.p.x)} ${f(j.p.y)}) rotate(${f(j.angle)})"><rect x="${f(-ps.len)}" y="${f(-ps.thick / 2)}" width="${f(ps.len)}" height="${f(ps.thick)}" rx="${f(ps.thick * 0.15)}" fill="${fade(c.color)}"/><rect x="${f(-ps.tip)}" y="${f(-ps.thick / 2 + ps.stroke)}" width="${f(ps.tip)}" height="${f(ps.thick - ps.stroke * 2)}" fill="${mixHex(fade(c.color), pal.paper, 0.35)}"/></g>`);
      }
      for (const j of cableJoints(c, path)) {
        out.push(`<g transform="translate(${f(j.p.x)} ${f(j.p.y)}) rotate(${f(j.angle)})"><rect x="${f(-js.len / 2)}" y="${f(-js.thick / 2)}" width="${f(js.len)}" height="${f(js.thick)}" rx="${f(js.thick * 0.25)}" fill="${pal.paper}" stroke="${fade(c.color)}" stroke-width="${f(js.stroke)}"/><line x1="0" y1="${f(-js.thick / 2)}" x2="0" y2="${f(js.thick / 2)}" stroke="${fade(c.color)}" stroke-width="${f(js.stroke)}"/></g>`);
      }
    }
    for (const c of cables) {
      const label = cableTexts.get(c.id), at = cableSpots.get(c.id);
      if (label && at) out.push(alongText(at.p, at.angle, label, size, fade(c.color), pal.paper));
    }
    // Furniture labels and sizes
    const lo = { palette: pal, showNames: opts.showNames, sizesPos: opts.sizesPos, lang: opts.lang, measure };
    for (const it of v.furniture) out.push(furnitureLabels(it, lo));
    // Text notes
    for (const n of v.texts) {
      const lines = (n.text || '').split('\n');
      const inner = lines.map((l, i) => textEl(0, i * n.size * LINE_HEIGHT + n.size * 0.82, l, n.size, n.color ?? pal.text, { anchor: 'start', bold: n.bold })).join('');
      out.push(`<g transform="translate(${f(n.x)} ${f(n.y)}) rotate(${f(n.rot)})">${inner}</g>`);
    }
    // Ruler measurements
    for (const d of v.dimensions) out.push(dimension(d, pal, opts.unitM));
    return out.join('');
  };

  const layers = opts.layers ?? 'all';
  // A dimmed plan is drawn in colours mixed with the paper (opacity on groups is not reliable in PDF)
  const passes = layerPasses(floor, layers);
  const mainPal = passes.dim ? fadePalette(p, dimBy) : p;
  parts.push(walls(mainPal), traysSvg(passes.main, mainPal));
  if (passes.wiring) parts.push(traysSvg(passes.wiring, p));
  parts.push(objects(passes.main, mainPal, passes.dim));
  if (passes.wiring) parts.push(objects(passes.wiring, p, false));

  const size = opts.pixelWidth && opts.pixelHeight ? ` width="${Math.round(opts.pixelWidth)}" height="${Math.round(opts.pixelHeight)}"` : ` width="${f(W)}" height="${f(Hh)}"`;
  const defs = opts.css ? `<defs><style>${opts.css}</style></defs>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${size} viewBox="${f(b.minX)} ${f(b.minY)} ${f(W)} ${f(Hh)}">${defs}${parts.join('')}</svg>`;
  return { svg, width: W, height: Hh };
}
