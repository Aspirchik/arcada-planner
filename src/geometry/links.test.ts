import { describe, it, expect } from 'vitest';
import { itemAt, linkTo, linkPoint, relink, syncLinks } from './links';
import { tidyCables, orthogonal, simplify, unstair } from './tidy';
import type { Cable, FloorState, FurnitureItem } from '../types';

const item = (id: number, x: number, y: number, w: number, h: number, rot = 0): FurnitureItem => ({ id, path: 'p', x, y, w, h, rot, zi: 100 });

describe('cable links', () => {
  it('picks the smallest item under a point and keeps the spot when the item turns', () => {
    const desk = item(1, 0, 0, 160, 80), socket = item(2, 10, 10, 15, 10);
    expect(itemAt([desk, socket], { x: 15, y: 15 })!.id).toBe(2);
    expect(itemAt([desk, socket], { x: 100, y: 50 })!.id).toBe(1);
    expect(itemAt([desk], { x: 300, y: 50 })).toBeNull();
    const l = linkTo(desk, { x: 40, y: 20 });
    expect(l).toEqual({ id: 1, u: 0.25, v: 0.25 });
    const p = linkPoint({ ...desk, rot: 90 }, l);
    expect(p.x).toBeCloseTo(-20);
    expect(p.y).toBeCloseTo(40);
  });

  it('ends follow moved items; links to deleted items are dropped', () => {
    const sw = item(1, 0, 0, 40, 20), sock = item(2, 300, 200, 20, 20);
    const c: Cable = { id: 9, color: '#000', points: [{ x: 20, y: 10 }, { x: 310, y: 10 }, { x: 310, y: 210 }] };
    const linked = { ...c, ...relink(c, [sw, sock]) };
    expect(linked.fromLink?.id).toBe(1);
    expect(linked.toLink?.id).toBe(2);
    const floor: FloorState = { nodes: [], walls: [], dimensions: [], texts: [], trays: [], groups: [], furniture: [sw, { ...sock, x: 400 }], cables: [linked] };
    const moved = syncLinks(floor);
    expect(moved.cables[0].points[2]).toEqual({ x: 410, y: 210 });
    expect(moved.cables[0].points[0]).toEqual({ x: 20, y: 10 });
    expect(syncLinks(moved)).toBe(moved);
    const gone = syncLinks({ ...moved, furniture: [sw] });
    expect(gone.cables[0].toLink).toBeUndefined();
  });
});

describe('tidy cables', () => {
  it('turns slanted segments into right angles and drops extra points', () => {
    expect(orthogonal([{ x: 0, y: 0 }, { x: 100, y: 40 }])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }]);
    expect(simplify([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('a staircase becomes one bend', () => {
    const stair = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: -40, y: 50 }, { x: -40, y: 100 }, { x: -90, y: 100 }];
    expect(unstair(stair)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: -90, y: 100 }]);
  });

  it('merges close parallel runs into one and keeps the ends', () => {
    const a: Cable = { id: 1, color: '#000', points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 200 }] };
    const b: Cable = { id: 2, color: '#000', points: [{ x: 10, y: 0 }, { x: 10, y: 112 }, { x: 390, y: 112 }, { x: 390, y: 200 }] };
    const out = tidyCables([a, b], []);
    const pa = out.get(1)!, pb = out.get(2)!;
    expect(pa[0]).toEqual(a.points[0]);
    expect(pa[pa.length - 1]).toEqual(a.points[3]);
    expect(pb[pb.length - 1]).toEqual(b.points[3]);
    // the long horizontal runs now share one line
    const runY = (p: { x: number; y: number }[]) => p.find((q, i) => i > 0 && i < p.length - 1 && p[i + 1] && Math.abs(p[i + 1].y - q.y) < 0.5 && Math.abs(p[i + 1].x - q.x) > 100)!.y;
    expect(runY(pa)).toBe(runY(pb));
  });

  it('puts runs near a tray onto its centre line', () => {
    const c: Cable = { id: 1, color: '#000', points: [{ x: 0, y: 0 }, { x: 0, y: 92 }, { x: 300, y: 92 }, { x: 300, y: 200 }] };
    const out = tidyCables([c], [{ id: 5, points: [{ x: -50, y: 100 }, { x: 350, y: 100 }], width: 10 }]).get(1)!;
    expect(out.some((q, i) => i > 0 && out[i - 1].y === 100 && q.y === 100 && Math.abs(q.x - out[i - 1].x) > 100)).toBe(true);
  });
});
