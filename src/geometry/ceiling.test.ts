import { describe, it, expect } from 'vitest';
import { panelEdges, ceilingEdges, lastPanel, firstForLast, cellAt, panelCounts, toggleMark, markCounts } from './ceiling';
import type { CeilingGrid } from '../types';

const grid = (o: Partial<CeilingGrid> = {}): CeilingGrid => ({
  id: 1, x: 100, y: 200, w: 50 + 60 * 3 + 47.5, h: 30 + 60 * 2 + 30, cellW: 60, cellH: 60, firstW: 50, firstH: 30, ...o,
});

describe('ceiling grid', () => {
  it('puts the edge panel first, standard panels after it and the rest into the last one', () => {
    expect(panelEdges(0, 277.5, 50, 60)).toEqual([0, 50, 110, 170, 230, 277.5]);
    expect(panelEdges(0, 100, 150, 60)).toEqual([0, 100]);
    // a sliver under 0.5 cm joins the panel before it
    expect(panelEdges(0, 170.3, 50, 60)).toEqual([0, 50, 110, 170.3]);
    const { xs, ys } = ceilingEdges(grid());
    expect(lastPanel(xs)).toBe(47.5);
    expect(ys).toEqual([200, 230, 290, 350, 380]);
  });

  it('finds the first panel that gives the wanted last one', () => {
    expect(firstForLast(277.5, 60, 47.5)).toBe(50);
    expect(firstForLast(240, 60, 60)).toBe(60);
    expect(firstForLast(100, 60, 100)).toBe(100);
  });

  it('finds the cell under a point', () => {
    const g = grid();
    expect(cellAt(g, { x: 101, y: 201 })).toEqual({ c: 0, r: 0 });
    expect(cellAt(g, { x: 160, y: 240 })).toEqual({ c: 1, r: 1 });
    expect(cellAt(g, { x: 100 + 277.5, y: 380 })).toEqual({ c: 4, r: 3 });
    expect(cellAt(g, { x: 99, y: 240 })).toBeNull();
  });

  it('counts panels by size, turned panels together', () => {
    expect(panelCounts(grid())).toEqual([
      { a: 60, b: 60, n: 6 }, { a: 60, b: 30, n: 6 }, { a: 60, b: 47.5, n: 2 }, { a: 60, b: 50, n: 2 },
      { a: 50, b: 30, n: 2 }, { a: 47.5, b: 30, n: 2 },
    ].sort((p, q) => q.n - p.n || q.a * q.b - p.a * p.b));
  });

  it('sets, replaces and clears cell marks', () => {
    let m = toggleMark(undefined, 1, 1, 'lamp');
    expect(m).toEqual([{ c: 1, r: 1, kind: 'lamp' }]);
    m = toggleMark(m, 1, 1, 'ac');
    expect(m).toEqual([{ c: 1, r: 1, kind: 'ac' }]);
    m = toggleMark(m, 2, 1, 'lamp');
    expect(markCounts(grid({ marks: m }))).toEqual(new Map([['ac', 1], ['lamp', 1]]));
    expect(toggleMark(m, 1, 1, 'ac')).toEqual([{ c: 2, r: 1, kind: 'lamp' }]);
    expect(toggleMark(m, 2, 1, null)).toEqual([{ c: 1, r: 1, kind: 'ac' }]);
  });
});
