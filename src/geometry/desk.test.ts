import { describe, it, expect } from 'vitest';
import type { FurnitureItem } from '../types';
import { deskFrames, routeViaDesk, frameInset } from './desk';
import { startSegmentDrag, dragSegment, tidyAfterDrag } from './segdrag';

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
