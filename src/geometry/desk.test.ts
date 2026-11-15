import { describe, it, expect } from 'vitest';
import type { FurnitureItem } from '../types';
import { deskFrames, routeViaDesk, frameInset } from './desk';

const desk: FurnitureItem = { id: 1, path: 'table', name: 'Desk', x: 0, y: 0, w: 160, h: 80, rot: 0, zi: 100 };

describe('desk frames', () => {
  it('desks have a 5 cm frame by default; other items only when set', () => {
    expect(frameInset(desk)).toBe(5);
    expect(frameInset({ ...desk, name: 'Bed' })).toBeUndefined();
    expect(frameInset({ ...desk, name: 'Bed', frame: 8 })).toBe(8);
    expect(deskFrames([desk])[0].corners).toEqual([{ x: 5, y: 5 }, { x: 155, y: 5 }, { x: 155, y: 75 }, { x: 5, y: 75 }]);
  });

  it('a patch cord goes to the frame, along it to the corner nearest the socket, then to the socket', () => {
    const r = routeViaDesk({ x: 60, y: 20 }, { x: 150, y: 200 }, deskFrames([desk]));
    expect(r).toEqual([{ x: 60, y: 20 }, { x: 60, y: 5 }, { x: 155, y: 5 }, { x: 155, y: 75 }, { x: 150, y: 75 }, { x: 150, y: 200 }]);
  });

  it('the socket end first: same route reversed; no desk → null', () => {
    const r = routeViaDesk({ x: 150, y: 200 }, { x: 60, y: 20 }, deskFrames([desk]));
    expect(r![0]).toEqual({ x: 150, y: 200 });
    expect(r![r!.length - 1]).toEqual({ x: 60, y: 20 });
    expect(routeViaDesk({ x: 500, y: 500 }, { x: 600, y: 600 }, deskFrames([desk]))).toBeNull();
  });
});
