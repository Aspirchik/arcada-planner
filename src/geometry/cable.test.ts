import { describe, it, expect } from 'vitest';
import { layoutCables, placeCableLabels, pathLength, cablesInTray, cableLabel } from './cable';
import type { Cable } from '../types';

const cable = (id: number, points: [number, number][], width = 3): Cable =>
  ({ id, points: points.map(([x, y]) => ({ x, y })), color: '#000', width });

describe('cable bundling', () => {
  it('a lone cable keeps its points', () => {
    const c = cable(1, [[0, 0], [100, 0], [100, 100]]);
    expect(layoutCables([c]).get(1)).toEqual(c.points);
  });

  it('cables on the same run are drawn side by side, each in its own lane, with leads to their real ends', () => {
    const a = cable(1, [[0, 0], [200, 0]]);
    const b = cable(2, [[50, 0], [300, 0], [300, 100]]);
    const c = cable(3, [[300, 0], [100, 0]]); // opposite direction, same run
    const m = layoutCables([a, b, c]);
    // lane = y of the second point (the first is the lead from the real end)
    const ys = [m.get(1)![1].y, m.get(2)![1].y, m.get(3)![1].y];
    expect(new Set(ys.map(y => Math.round(y * 10))).size).toBe(3);
    expect(ys.reduce((s, y) => s + y, 0)).toBeCloseTo(0);
    expect(Math.abs(ys[0] - ys[1]) % 4.5).toBeCloseTo(0);
    // ends are where the cable really ends
    expect(m.get(1)![0]).toEqual({ x: 0, y: 0 });
    expect(m.get(1)![m.get(1)!.length - 1]).toEqual({ x: 200, y: 0 });
    expect(m.get(2)![m.get(2)!.length - 1]).toEqual({ x: 300, y: 100 });
  });

  it('a cable keeps its lane when others leave the bundle; the one turning off first is on that side', () => {
    // three cables from the left along y = 0, dropping down (+y) at x = 100, 200 and 300
    const a = cable(1, [[0, 0], [100, 0], [100, 100]]);
    const b = cable(2, [[0, 0], [200, 0], [200, 100]]);
    const c = cable(3, [[0, 0], [300, 0], [300, 100]]);
    const m = layoutCables([c, b, a]);
    const lane = (id: number) => m.get(id)![1].y;
    expect(new Set([lane(1), lane(2), lane(3)]).size).toBe(3);
    // first to leave is lowest (on the side it turns to), so nobody crosses
    expect(lane(1)).toBeGreaterThan(lane(2));
    expect(lane(2)).toBeGreaterThan(lane(3));
    // c stays in one lane all the way to x = 300 although a and b have left
    expect(m.get(3)!.filter(p => p.y < 1 && p.y > -10 && p.x > 1 && p.x < 299).every(p => Math.abs(p.y - lane(3)) < 0.01)).toBe(true);
  });

  it('a chain keeps one lane past its consumers', () => {
    // red chain: entry → drop at 100, continued → drop at 200; a second cable runs to 300
    const red1 = cable(1, [[0, 0], [100, 0], [100, 100]]);
    const red2: Cable = { ...cable(2, [[100, 0], [200, 0], [200, 100]]), parent: 1 };
    const other = cable(3, [[0, 0], [300, 0], [300, 100]]);
    const m = layoutCables([red1, red2, other]);
    expect(m.get(1)![1].y).toBeCloseTo(m.get(2)!.find(p => p.x > 150 && p.x < 199)?.y ?? m.get(2)![1].y);
    expect(m.get(1)![1].y).not.toBeCloseTo(m.get(3)![1].y);
  });

  it('groups lie together in list order, the first one on the outer side', () => {
    // a bundle along the top (y = 0) of a drawing whose middle is below it
    const mk = (id: number, x: number, groups?: number[]): Cable => ({ ...cable(id, [[0, 0], [x, 0], [x, 300]]), ...(groups ? { groups } : {}) });
    const m = layoutCables([mk(1, 100, [8]), mk(2, 150, [7]), mk(3, 200, [8]), mk(4, 250)], [7, 8]);
    const lane = (id: number) => m.get(id)![1].y;
    // group 7 outermost (top), then group 8, then the cable without a group
    expect(lane(2)).toBeLessThan(lane(1));
    expect(lane(2)).toBeLessThan(lane(3));
    expect(Math.max(lane(1), lane(3))).toBeLessThan(lane(4));
  });

  it('a continuation starts on the drawn line of its parent', () => {
    const trunk = cable(1, [[0, 0], [400, 0]]);
    const other = cable(2, [[0, 0], [400, 0]]);
    const branch: Cable = { ...cable(3, [[200, 0], [200, 100]]), parent: 1 };
    const m = layoutCables([trunk, other, branch]);
    const trunkLane = m.get(1)![1].y;
    expect(trunkLane).not.toBe(0);
    expect(m.get(3)![0]).toEqual({ x: 200, y: trunkLane });
  });

  it('cables that only cross are not bundled', () => {
    const m = layoutCables([cable(1, [[0, 50], [100, 50]]), cable(2, [[50, 0], [50, 100]])]);
    expect(m.get(1)![0]).toEqual({ x: 0, y: 50 });
  });
});

describe('cable labels', () => {
  it('a second label on the same run does not cover the first', () => {
    const a = cable(1, [[0, 0], [400, 0]]);
    const b = cable(2, [[0, 0], [400, 0]]);
    const paths = layoutCables([a, b]);
    const labels = new Map([[1, 'LAN 1'], [2, 'LAN 2']]);
    const pos = placeCableLabels([a, b], paths, labels, 11, t => t.length * 6);
    // apart along the run, or on opposite sides of it
    const p1 = pos.get(1)!.p, p2 = pos.get(2)!.p;
    expect(Math.abs(p1.x - p2.x) > 30 || Math.abs(p1.y - p2.y) >= 11).toBe(true);
    expect(pathLength(paths.get(1)!)).toBeCloseTo(400 + 2 * 2.25, 0);
  });
});

describe('trays', () => {
  it('lists cables that run inside the tray, not ones that only cross it', () => {
    const tray = { id: 9, points: [{ x: 0, y: 0 }, { x: 500, y: 0 }], width: 10 };
    const along = cable(1, [[-50, 2], [400, 2], [400, 200]]);
    const crossing = cable(2, [[200, -100], [200, 100]]);
    const far = cable(3, [[0, 50], [500, 50]]);
    expect(cablesInTray(tray, [along, crossing, far]).map(c => c.id)).toEqual([1]);
  });

  it('cable label includes the route', () => {
    expect(cableLabel({ ...cable(1, [[0, 0], [100, 0]]), label: 'Line 3', from: 'Server', to: 'User 1' }, 'm')).toBe('Line 3 · Server → User 1');
  });
});

describe('layoutCables: a tray fed from the side, cables going both ways', () => {
  // count crossings between the laid out cables (shared end points don't count)
  const crossings = (paths: { x: number; y: number }[][]) => {
    const cross = (a: any, b: any, c: any, d: any) => {
      const o = (p: any, q: any, r: any) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    let n = 0;
    for (let i = 0; i < paths.length; i++)
      for (let j = i + 1; j < paths.length; j++)
        for (let s = 1; s < paths[i].length; s++)
          for (let t = 1; t < paths[j].length; t++)
            if (cross(paths[i][s - 1], paths[i][s], paths[j][t - 1], paths[j][t])) n++;
    return n;
  };
  it('lanes keep the order the cables come in, so they do not cross at the entry', () => {
    const cables = [
      ...[0, 1, 2, 3].map(i => ({ id: i + 1, color: '#000', points: [{ x: 0, y: 500 + 10 * i }, { x: 100, y: 500 + 10 * i }, { x: 100, y: 0 }, { x: 400, y: 0 }] })),
      ...[0, 1, 2, 3].map(i => ({ id: i + 11, color: '#000', points: [{ x: 0, y: 540 + 10 * i }, { x: 100, y: 540 + 10 * i }, { x: 100, y: 1000 }, { x: 400, y: 1000 }] })),
    ];
    const m = layoutCables(cables);
    expect(crossings(cables.map(c => m.get(c.id)!))).toBe(0);
  });
  it('cables from one point take the order of the run they turn into, so the bend is nested', () => {
    // from one port: right to the tray, up it, along the top and down to sockets one after another
    const cables = [0, 1, 2, 3, 4].map(i => ({ id: i + 1, color: '#000',
      points: [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 0 }, { x: 300 + 100 * i, y: 0 }, { x: 300 + 100 * i, y: 40 }] }));
    const down = [0, 1, 2].map(i => ({ id: i + 11, color: '#000',
      points: [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 1000 }, { x: 300 + 100 * i, y: 1000 }, { x: 300 + 100 * i, y: 960 }] }));
    for (const list of [[...cables, ...down], [...cables].reverse(), [...down, ...cables].reverse()]) {
      const m = layoutCables(list);
      expect(crossings(list.map(c => m.get(c.id)!))).toBe(0);
    }
  });
  it('cables that do not run side by side share lanes, so the bundle stays in the middle of the run', () => {
    // all from one port: right to the tray, then up or down it
    const up = [0, 1, 2, 3].map(i => ({ id: i + 1, color: '#000',
      points: [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 0 }, { x: 300 + 100 * i, y: 0 }, { x: 300 + 100 * i, y: 40 }] }));
    const down = [0, 1, 2, 3].map(i => ({ id: i + 11, color: '#000',
      points: [{ x: 0, y: 500 }, { x: 100, y: 500 }, { x: 100, y: 1000 }, { x: 300 + 100 * i, y: 1000 }, { x: 300 + 100 * i, y: 960 }] }));
    const all = [...up, ...down];
    const m = layoutCables(all);
    // x of the long vertical part of a cable (its lane in the tray)
    const laneX = (c: typeof up[0]) => { const p = m.get(c.id)!; for (let i = 1; i < p.length; i++) if (Math.abs(p[i].x - p[i - 1].x) < 0.01 && Math.abs(p[i].y - p[i - 1].y) > 100) return p[i].x; return NaN; };
    const xs = (list: typeof up) => list.map(laneX).sort((a, b) => a - b);
    // the cables going up lie in the same lanes as the ones going down: no room kept for the other bundle
    expect(xs(up)).toEqual(xs(down));
    expect(Math.abs(xs(up).reduce((a, b) => a + b, 0) / 4 - 100)).toBeLessThan(0.01);
    expect(crossings(all.map(c => m.get(c.id)!))).toBe(0);
  });
});
