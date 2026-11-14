import { describe, it, expect } from 'vitest';
import { chainInfos, chainRoute, chainRoots, collapseToChains, projectOnPath, subtree } from './chain';
import { styleCables, DEFAULT_WIRING } from '../layers';
import { cableLabel } from './cable';
import type { Cable } from '../types';

// Entry point at the left; a trunk along y = 0 with drops to desks; continuations are drawn out of order
const trunk: Cable = { id: 1, color: '#d0021b', from: 'Entry', to: 'User 3', points: [{ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] };
const toUser5: Cable = { id: 3, color: '#d0021b', parent: 2, to: 'User 5', points: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 50 }] };
const toUser4: Cable = { id: 2, color: '#d0021b', parent: 1, to: 'User 4', points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 50 }] };
const other: Cable = { id: 9, color: '#000', from: 'A', to: 'B', points: [{ x: 0, y: 300 }, { x: 100, y: 300 }] };

describe('cable chains', () => {
  it('projects a point onto a path', () => {
    const r = projectOnPath(trunk.points, { x: 60, y: 4 });
    expect(r.p).toEqual({ x: 60, y: 0 });
    expect(r.along).toBe(160);
    expect(r.dist).toBe(4);
  });

  it('finds roots and subtrees', () => {
    const all = [trunk, toUser5, toUser4, other];
    expect(chainRoots(all).get(3)).toBe(1);
    expect(chainRoots(all).get(9)).toBe(9);
    expect([...subtree(all, 2)].sort()).toEqual([2, 3]);
    // a cycle does not hang
    expect(chainRoots([{ ...trunk, parent: 3 }, toUser5, toUser4]).size).toBe(3);
  });

  it('route lists the consumers in order along the run, length is the total', () => {
    const info = chainInfos([toUser5, trunk, toUser4]).get(1)!;
    expect(chainRoute(info)).toBe('Entry → User 3 → User 4 → User 5');
    expect(info.length).toBe(250 + 150 + 150);
  });

  it('the chain is labelled once; tray lists show one entry per chain', () => {
    const styled = styleCables([trunk, toUser4, toUser5, other], { ...DEFAULT_WIRING, cableLengths: true });
    expect(cableLabel(styled[0], 'm')).toBe('Entry → User 3 → User 4 → User 5 · 5.50 m');
    expect(cableLabel(styled[1], 'm')).toBe('');
    expect(cableLabel(styled[3], 'm')).toBe('A → B · 1.00 m');
    const { shown, ids } = collapseToChains([styled[1], styled[2], styled[3]], styled);
    expect(shown.map(c => c.id)).toEqual([1, 9]);
    expect([...ids].sort()).toEqual([1, 2, 3, 9]);
  });
});
