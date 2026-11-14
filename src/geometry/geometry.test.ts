import { describe, it, expect } from 'vitest';
import { computeWallGeometry, type WallGeom } from './walls';
import { obstacleSegments, itemGaps, castRay } from './raycast';
import type { WallNode, Wall, FurnitureItem } from '../types';

function plan(points: [number, number][], edges: [number, number][], exterior = true) {
  const nodes: WallNode[] = points.map(([x, y], i) => ({ id: i + 1, x, y }));
  const walls: Wall[] = edges.map(([a, b], i) => ({ id: 100 + i, a: a + 1, b: b + 1, exterior }));
  return { nodes, walls };
}

/** Rectangle room 400 × 300 on wall centerlines */
const room = plan([[0, 0], [400, 0], [400, 300], [0, 300]], [[0, 1], [1, 2], [2, 3], [3, 0]]);

const insideLen = (g: WallGeom) => (g.left.room ? g.left.length : g.right.length);
const outsideLen = (g: WallGeom) => (g.left.room ? g.right.length : g.left.length);

describe('wall faces', () => {
  it('rectangle room with 20 cm exterior walls: 3.80 × 2.80 inside, 4.20 × 3.20 outside', () => {
    const g = computeWallGeometry(room.nodes, room.walls);
    const [top, right, bottom, left] = g.walls;
    expect(insideLen(top)).toBeCloseTo(380);
    expect(insideLen(bottom)).toBeCloseTo(380);
    expect(insideLen(right)).toBeCloseTo(280);
    expect(insideLen(left)).toBeCloseTo(280);
    expect(outsideLen(top)).toBeCloseTo(420);
    expect(outsideLen(right)).toBeCloseTo(320);
  });

  it('exactly one side of each wall of a closed room faces the room', () => {
    const g = computeWallGeometry(room.nodes, room.walls);
    for (const w of g.walls) expect(Number(w.left.room) + Number(w.right.room)).toBe(1);
  });

  it('a free-standing wall has square ends and no room sides', () => {
    const p = plan([[0, 0], [300, 0]], [[0, 1]]);
    const [w] = computeWallGeometry(p.nodes, p.walls).walls;
    expect(w.left.length).toBeCloseTo(300);
    expect(w.right.length).toBeCloseTo(300);
    expect(w.left.room || w.right.room).toBe(false);
    expect(w.freeA && w.freeB).toBe(true);
  });

  it('interior partition (T-joint) splits a room in two; both sides are rooms', () => {
    // Room 400×300 with a 16 cm partition at x = 200
    const p = plan(
      [[0, 0], [200, 0], [400, 0], [400, 300], [200, 300], [0, 300]],
      [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
    );
    const partition: Wall = { id: 999, a: 2, b: 5, exterior: false };
    const g = computeWallGeometry(p.nodes, [...p.walls, partition]);
    const part = g.walls.find(w => w.wall.id === 999)!;
    expect(part.left.room && part.right.room).toBe(true);
    // Partition inner length = 300 - 20 (two exterior half-thicknesses)
    expect(part.left.length).toBeCloseTo(280);
    // Top-left segment inside: from inner face of left wall (x=10) to partition face (x=192)
    const topLeft = g.walls.find(w => w.wall.id === 100)!;
    expect(insideLen(topLeft)).toBeCloseTo(182);
    expect(g.hubs.length).toBe(2);
  });

  it('L-shaped corner: inner and outer faces', () => {
    const p = plan([[0, 0], [300, 0], [300, 200]], [[0, 1], [1, 2]]);
    const g = computeWallGeometry(p.nodes, p.walls);
    const [first] = g.walls;
    const lens = [first.left.length, first.right.length].sort((a, b) => a - b);
    // free end at x=0 (square), corner at x=300: inner face 290, outer face 310
    expect(lens[0]).toBeCloseTo(290);
    expect(lens[1]).toBeCloseTo(310);
  });
});

describe('gaps', () => {
  it('measures clearance from a chair to the room walls and to another item', () => {
    const g = computeWallGeometry(room.nodes, room.walls);
    const chair: FurnitureItem = { id: 1, path: 'chair', x: 100, y: 100, w: 50, h: 50, rot: 0, zi: 100 };
    const table: FurnitureItem = { id: 2, path: 'table', x: 250, y: 90, w: 80, h: 80, rot: 0, zi: 100 };
    const obstacles = obstacleSegments(g, [table]);
    const gaps = itemGaps(chair, obstacles);
    const byDist = gaps.map(x => Math.round(x.distance)).sort((a, b) => a - b);
    // top: 100-10 = 90; bottom: 290-150 = 140; left: 100-10 = 90; right: 250-150 = 100
    expect(byDist).toEqual([90, 90, 100, 140]);
  });

  it('ray misses when nothing is in the way', () => {
    expect(castRay({ x: 0, y: 0 }, { x: 1, y: 0 }, [{ a: { x: 5, y: 1 }, b: { x: 5, y: 3 } }])).toBeNull();
  });
});

describe('ruler snapping', () => {
  it('snaps to wall corners first, then onto wall faces, and keeps 45° with Shift', async () => {
    const { snapTargets, snapToTargets, constrain45 } = await import('./snap');
    const g = computeWallGeometry(room.nodes, room.walls);
    const floor = { ...room, furniture: [], dimensions: [] };
    const targets = snapTargets(floor, g);
    // Near the inner corner (10, 10) → exactly the corner
    expect(snapToTargets({ x: 14, y: 12 }, targets, 12)).toEqual({ x: 10, y: 10 });
    // Near the inner face of the left wall (x = 10), far from corners → onto the face
    expect(snapToTargets({ x: 14, y: 150 }, targets, 12)).toEqual({ x: 10, y: 150 });
    // Nothing near → null
    expect(snapToTargets({ x: 200, y: 150 }, targets, 12)).toBeNull();
    expect(constrain45({ x: 0, y: 0 }, { x: 100, y: 7 })).toEqual({ x: 100, y: 0 });
  });
});
