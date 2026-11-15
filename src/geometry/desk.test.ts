import { describe, it, expect } from 'vitest';
import type { FurnitureItem } from '../types';
import { deskFrames, routeViaDesk, frameInset } from './desk';
import { startSegmentDrag, dragSegment, tidyAfterDrag, simplifyPath } from './segdrag';
import { tidyCables } from './tidy';

const desk: FurnitureItem = { id: 1, path: 'table', name: 'Desk', x: 0, y: 0, w: 160, h: 80, rot: 0, zi: 100 };

describe('desk frames', () => {
  it('desks have a 5 cm frame by default; other items only when set', () => {
    expect(frameInset(desk)).toBe(5);
    expect(frameInset({ ...desk, name: 'Bed' })).toBeUndefined();
    expect(frameInset({ ...desk, name: 'Bed', frame: 8 })).toBe(8);
    expect(deskFrames([desk])[0].corners).toEqual([{ x: 5, y: 5 }, { x: 155, y: 5 }, { x: 155, y: 75 }, { x: 5, y: 75 }]);
  });

  it('only the part on the desk is re-laid: to the frame, along it to the corner, then the drawn path', () => {
    const drawn = [{ x: 60, y: 20 }, { x: 60, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 200 }];
    const r = routeViaDesk(drawn, deskFrames([desk]))!;
    expect(r[0]).toEqual({ x: 60, y: 20 });
    expect(r).toContainEqual({ x: 5, y: 75 });
    expect(r.slice(-3)).toEqual([{ x: 60, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 200 }]);
    // the way to the corner is the short one, not round the far side of the desk
    expect(r).not.toContainEqual({ x: 155, y: 5 });
  });

  it('the desk end last: reversed; no desk → null', () => {
    const r = routeViaDesk([{ x: 150, y: 200 }, { x: 150, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 20 }], deskFrames([desk]))!;
    expect(r[0]).toEqual({ x: 150, y: 200 });
    expect(r[r.length - 1]).toEqual({ x: 60, y: 20 });
    expect(routeViaDesk([{ x: 500, y: 500 }, { x: 600, y: 600 }], deskFrames([desk]))).toBeNull();
  });
});

describe('dragging a straight part of a cable', () => {
  it('the ends stay, the part moves across and snaps onto a parallel cable', () => {
    const prep = startSegmentDrag([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0);
    expect(prep.points).toHaveLength(4);
    const moved = dragSegment(prep.points, prep.seg, { x: 3, y: 47 }, [[{ x: -50, y: 50 }, { x: 200, y: 50 }]], 10);
    expect(moved).toEqual([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 0 }]);
    // dragged back: the extra corners go away
    const back = dragSegment(prep.points, prep.seg, { x: 0, y: 0 }, [], 10);
    expect(tidyAfterDrag(back)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });
});

describe('neat patch cords from desks (Tidy)', () => {
  it('cords of one desk leave at one corner and do not go back to their drawn start', async () => {
    const { tidyCables } = await import('./tidy');
    const furn: FurnitureItem[] = [{ id: 1, path: 'table', x: 2000, y: 2580, w: 170, h: 60, rot: 0, zi: 100, name: 'Desk' }];
    const cab = [2030, 2070, 2120].map((x, i) => ({
      id: 10 + i, color: '#000', kind: 'patch' as const,
      points: [{ x, y: 2610 }, { x, y: 2690 + i * 8 }, { x: 2520, y: 2690 + i * 8 }, { x: 2520, y: 2030 }],
    }));
    const out = tidyCables(cab, [], { desks: deskFrames(furn) });
    for (const c of cab) {
      const p = out.get(c.id)!;
      expect(p).toContainEqual({ x: 2165, y: 2635 });
      // after the corner the cord never goes left of it (no loop back)
      const k = p.findIndex(q => q.x === 2165 && q.y === 2635);
      expect(p.slice(k).every(q => q.x >= 2165)).toBe(true);
    }
  });
});

describe('simplifyPath', () => {
  it('removes points on a straight line and back-and-forth spikes, keeps ends, heights and connectors', () => {
    const p = [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },   // 50 lies on the line
      { x: 100, y: 80 }, { x: 100, y: 40 },                 // spike: up to 80 and back to 40
      { x: 100, y: 100 }, { x: 150, y: 100, z: 40 }, { x: 200, y: 100, joint: true }, { x: 300, y: 100 },
    ];
    expect(simplifyPath(p)).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 150, y: 100, z: 40 }, { x: 200, y: 100, joint: true }, { x: 300, y: 100 },
    ]);
  });
  it('keeps a two-point cable', () => {
    expect(simplifyPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });
});

describe('patch cord magnet on trays', () => {
  const cord = { id: 1, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], color: '#000', kind: 'patch' as const };
  const tray = { id: 2, points: [{ x: 0, y: 50 }, { x: 1000, y: 50 }], width: 10 };
  it('a patch cord is not laid into an ordinary tray', () => {
    expect(tidyCables([cord], [tray]).get(1)!.every(p => p.y === 0)).toBe(true);
  });
  it('a patch cord is laid through a tray with the patch cord magnet', () => {
    expect(tidyCables([cord], [{ ...tray, patch: true }]).get(1)!.some(p => p.y === 50)).toBe(true);
  });
});
