import { describe, it, expect } from 'vitest';
import { buildPlanSvg, prepareSprite, contentBounds, wrapText, approxMeasure } from './planSvg';
import { computeWallGeometry } from '../geometry/walls';
import { LIGHT, DARK } from '../theme';
import type { FloorState } from '../types';

// Room 400 × 300 on wall centre-lines, 20 cm exterior walls, a sofa inside and a table far outside
const floor: FloorState = {
  nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 400, y: 0 }, { id: 3, x: 400, y: 300 }, { id: 4, x: 0, y: 300 }],
  walls: [
    { id: 11, a: 1, b: 2, exterior: true }, { id: 12, a: 2, b: 3, exterior: true },
    { id: 13, a: 3, b: 4, exterior: true }, { id: 14, a: 4, b: 1, exterior: true },
  ],
  furniture: [
    { id: 21, path: 'couch', x: 50, y: 50, w: 200, h: 90, rot: 0, zi: 100, label: 'Sofa & co' },
    { id: 22, path: 'table', x: 900, y: 900, w: 100, h: 60, rot: 0, zi: 100, simple: true },
  ],
  dimensions: [{ id: 31, x1: 10, y1: 200, x2: 390, y2: 200 }],
  texts: [{ id: 41, x: 60, y: 220, text: 'Room <1>', size: 20, rot: 0, bold: true, color: null }],
  cables: [],
  trays: [],
};

const base = { palette: LIGHT, wallLabels: 'interior' as const, showNames: false, sizesPos: 'br' as const, lang: 'en' as const, unitM: 'm' };

describe('export bounds', () => {
  it('room = walls around rooms only (stray walls ignored), all = everything', () => {
    const g = computeWallGeometry(floor.nodes, floor.walls);
    expect(contentBounds(floor, g, 'room')).toEqual({ minX: -10, minY: -10, maxX: 410, maxY: 310 });
    const stray = { ...floor, nodes: [...floor.nodes, { id: 5, x: 700, y: 0 }, { id: 6, x: 900, y: 0 }], walls: [...floor.walls, { id: 15, a: 5, b: 6, exterior: false }] };
    const g2 = computeWallGeometry(stray.nodes, stray.walls);
    expect(contentBounds(stray, g2, 'room')!.maxX).toBe(410);
    expect(contentBounds(floor, g, 'all')!.maxX).toBe(1000);
  });

  it('crops the SVG to the room plus margin', () => {
    const r = buildPlanSvg(floor, new Map(), { ...base, area: 'room', margin: 20 })!;
    expect(r.width).toBe(460);
    expect(r.height).toBe(360);
    expect(r.svg).toContain('viewBox="-30 -30 460 360"');
  });

  it('returns null for an empty floor', () => {
    expect(buildPlanSvg({ nodes: [], walls: [], furniture: [], dimensions: [], texts: [], cables: [], trays: [] }, new Map(), { ...base, area: 'all' })).toBeNull();
  });
});

describe('export content', () => {
  it('contains inside wall lengths, labels, sizes, texts and dimensions (escaped)', () => {
    const r = buildPlanSvg(floor, new Map(), { ...base, area: 'all' })!;
    expect(r.svg).toContain('>3.80 m<');
    expect(r.svg).toContain('>2.80 m<');
    expect(r.svg).toContain('Sofa &amp; co');
    expect(r.svg).toContain('>200×90<');
    expect(r.svg).toContain('Room &lt;1&gt;');
    expect(r.svg).toContain('>3.80 m<'); // ruler 380 cm
    expect(r.svg).toContain('font-family="Roboto"');
  });

  it('draws cables with their colour, label and length', () => {
    const withCable = { ...floor, cables: [{ id: 51, points: [{ x: 20, y: 20 }, { x: 220, y: 20 }], color: '#e8710a', label: 'Cat6', showLength: true }] };
    const r = buildPlanSvg(withCable, new Map(), { ...base, area: 'room' })!;
    expect(r.svg).toContain('stroke="#e8710a"');
    expect(r.svg).toContain('Cat6 · 2.00 m');
  });

  it('layers: plan hides the wiring layer, wiring dims the plan', () => {
    const wf = { ...floor, cables: [{ id: 52, points: [{ x: 20, y: 40 }, { x: 220, y: 40 }], color: '#00897b', layer: 'wiring' as const }],
      trays: [{ id: 53, points: [{ x: 20, y: 40 }, { x: 220, y: 40 }], width: 10 }] };
    const plan = buildPlanSvg(wf, new Map(), { ...base, area: 'room', layers: 'plan' })!.svg;
    const wiring = buildPlanSvg(wf, new Map(), { ...base, area: 'room', layers: 'wiring' })!.svg;
    expect(plan).not.toContain('#00897b');
    expect(wiring).toContain('#00897b');
    // dimmed plan: wall colours mixed with the paper, wiring cable at full colour
    expect(wiring).not.toContain(`fill="${LIGHT.wallExterior}"`);
    expect(wiring).toContain(`stroke="${LIGHT.trayFill}"`);
  });

  it('draws a ruler in its own colour', () => {
    const r = buildPlanSvg({ ...floor, dimensions: [{ ...floor.dimensions[0], color: '#188038' }] }, new Map(), { ...base, area: 'room' })!;
    expect(r.svg).toContain('stroke="#188038"');
  });

  it('uses the chosen theme colours', () => {
    const r = buildPlanSvg(floor, new Map(), { ...base, area: 'room', palette: DARK })!;
    expect(r.svg).toContain(`fill="${DARK.paper}"`);
  });

  it('inlines sprites with namespaced classes and ids', () => {
    const sprite = prepareSprite(
      '<?xml version="1.0"?><svg width="120" height="60" sodipodi:docname="x"><sodipodi:namedview id="nv"/><style>.s0 { fill: #fff; stroke-width: 0.4 }</style><path class="s0 s1" id="p" d="M0 0"/><use href="#p"/><rect fill="url(#g)"/></svg>',
      'sp1');
    expect(sprite.viewBox).toBe('0 0 120 60');
    expect(sprite.body).toContain('.sp1-s0 { fill: #fff; stroke-width: 0.4 }');
    expect(sprite.body).toContain('class="sp1-s0 sp1-s1"');
    expect(sprite.body).toContain('id="sp1-p"');
    expect(sprite.body).toContain('href="#sp1-p"');
    expect(sprite.body).toContain('url(#sp1-g)');
    expect(sprite.body).not.toContain('sodipodi');
    const r = buildPlanSvg(floor, new Map([['couch', sprite]]), { ...base, area: 'room' })!;
    expect(r.svg).toContain('viewBox="0 0 120 60" preserveAspectRatio="none"');
  });

  it('wraps long labels', () => {
    expect(wrapText('one two three four', 60, 10, false, approxMeasure).length).toBeGreaterThan(1);
  });
});
