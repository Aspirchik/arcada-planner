import { describe, it, expect } from 'vitest';
import { layerView, layerPasses, styleCables, DEFAULT_WIRING } from './layers';
import { mixHex, isGrey, spriteKey } from './color';
import type { FloorState, FurnitureItem } from './types';

const item = (id: number, layer?: 'wiring' | 'both'): FurnitureItem => ({ id, path: 'x', x: 0, y: 0, w: 10, h: 10, rot: 0, zi: 100, ...(layer ? { layer } : {}) });
const floor: FloorState = {
  nodes: [], walls: [], dimensions: [], texts: [], trays: [],
  furniture: [item(1), item(2, 'wiring'), item(3, 'both')],
  cables: [{ id: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: '#000' }, { id: 5, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: '#000', width: 6 }],
};
const ids = (v: { furniture: { id: number }[] }) => v.furniture.map(f => f.id);

describe('layers', () => {
  it('objects on both layers are shown on each; `own` leaves them out', () => {
    expect(ids(layerView(floor, 'main'))).toEqual([1, 3]);
    expect(ids(layerView(floor, 'wiring'))).toEqual([2, 3]);
    expect(ids(layerView(floor, 'main', true))).toEqual([1]);
    expect(ids(layerView(floor, 'wiring', true))).toEqual([2]);
  });

  it('every output draws a "both" object exactly once', () => {
    for (const choice of ['plan', 'all', 'wiring'] as const) {
      const p = layerPasses(floor, choice);
      const all = [...ids(p.main), ...(p.wiring ? ids(p.wiring) : [])];
      expect(all.filter(id => id === 3), choice).toHaveLength(1);
    }
    // over a dimmed plan the shared object is drawn with the wiring (full strength)
    expect(ids(layerPasses(floor, 'wiring').wiring!)).toContain(3);
  });

  it('global cable settings: default width, length on all', () => {
    const c = styleCables(floor.cables, { ...DEFAULT_WIRING, cableWidth: 8, cableLengths: true });
    expect(c.map(x => x.width)).toEqual([8, 6]);
    expect(c.every(x => x.showLength)).toBe(true);
  });
});

describe('colour helpers', () => {
  it('mixes colours and tells greys from real colours', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#f00', '#000', 1)).toBe('#ff0000');
    expect(isGrey('#777')).toBe(true);
    expect(isGrey('#d0021b')).toBe(false);
    expect(spriteKey({ path: 'sofa' })).toBe('sofa');
    expect(spriteKey({ path: 'sofa', color: '#d0021b' })).toBe('sofa|#d0021b');
  });
});
