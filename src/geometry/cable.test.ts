import { describe, it, expect } from 'vitest';
import { layoutCables, placeCableLabels, pathLength } from './cable';
import type { Cable } from '../types';

const cable = (id: number, points: [number, number][], width = 3): Cable =>
  ({ id, points: points.map(([x, y]) => ({ x, y })), color: '#000', width });

describe('cable bundling', () => {
  it('a lone cable keeps its points', () => {
    const c = cable(1, [[0, 0], [100, 0], [100, 100]]);
    expect(layoutCables([c]).get(1)).toEqual(c.points);
  });

  it('cables on the same run are drawn side by side, each in its own lane', () => {
    const a = cable(1, [[0, 0], [200, 0]]);
    const b = cable(2, [[50, 0], [300, 0], [300, 100]]);
    const c = cable(3, [[300, 0], [100, 0]]); // opposite direction, same run
    const m = layoutCables([a, b, c]);
    const ys = [m.get(1)![0].y, m.get(2)![0].y, m.get(3)![0].y];
    // three distinct, evenly spaced lanes (3 cm cable + 1.5 cm gap), centred on the run
    expect(new Set(ys.map(y => Math.round(y * 10))).size).toBe(3);
    expect(ys.reduce((s, y) => s + y, 0)).toBeCloseTo(0);
    expect(Math.abs(ys[0] - ys[1])).toBeCloseTo(4.5);
    // the vertical part of b is alone and stays on its line
    expect(m.get(2)![m.get(2)!.length - 1]).toEqual({ x: 300 + (m.get(2)![1].x - 300), y: 100 });
  });

  it('cables that only cross are not bundled', () => {
    const m = layoutCables([cable(1, [[0, 50], [100, 50]]), cable(2, [[50, 0], [50, 100]])]);
    expect(m.get(1)![0]).toEqual({ x: 0, y: 50 });
  });
});

describe('cable labels', () => {
  it('a second label on the same run moves away from the first', () => {
    const a = cable(1, [[0, 0], [400, 0]]);
    const b = cable(2, [[0, 0], [400, 0]]);
    const paths = layoutCables([a, b]);
    const labels = new Map([[1, 'LAN 1'], [2, 'LAN 2']]);
    const pos = placeCableLabels([a, b], paths, labels, 11, t => t.length * 6);
    expect(Math.abs(pos.get(1)!.p.x - pos.get(2)!.p.x)).toBeGreaterThan(30);
    expect(pathLength(paths.get(1)!)).toBeCloseTo(400);
  });
});
