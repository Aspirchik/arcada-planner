import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, parseProject } from './store';
import type { CatalogItem } from './types';

const initial = useStore.getState();
const st = () => useStore.getState();
const floor = () => st().floors[st().fi];
const undoLen = () => st().histories[st().fi].undo.length;

const chair: CatalogItem = { name: 'Chair', imagePath: 'chair', width: 0.6, height: 0.6 };

beforeEach(() => {
  st().endGesture();
  useStore.setState(initial, true);
});

describe('undo gestures', () => {
  it('a drag with many moves is a single undo step', () => {
    const id = st().addFurniture(chair, 100, 100);
    expect(undoLen()).toBe(1);
    const startX = floor().furniture[0].x;

    st().beginGesture();
    for (let i = 1; i <= 30; i++) st().updateFurniture(id, { x: startX + i });
    st().endGesture();

    expect(undoLen()).toBe(2);
    st().undo();
    expect(floor().furniture[0].x).toBe(startX);
  });

  it('a gesture without changes adds no undo step', () => {
    const id = st().addFurniture(chair, 100, 100);
    const x = floor().furniture[0].x;
    st().beginGesture();
    st().updateFurniture(id, { x: x + 10 });
    st().updateFurniture(id, { x });
    st().endGesture();
    expect(undoLen()).toBe(1);
  });

  it('redo restores the undone change', () => {
    st().addNode(10, 10);
    st().undo();
    expect(floor().nodes).toHaveLength(0);
    st().redo();
    expect(floor().nodes).toHaveLength(1);
  });

  it('each floor keeps its own history', () => {
    st().addNode(0, 0);
    st().changeFloor(1);
    st().addNode(5, 5);
    st().addNode(6, 6);
    st().changeFloor(-1);
    expect(undoLen()).toBe(1);
    st().undo();
    expect(floor().nodes).toHaveLength(0);
    expect(st().floors[1].nodes).toHaveLength(2);
  });
});

describe('walls', () => {
  function singleWall(exterior = false) {
    const a = st().addNode(0, 0);
    const b = st().addNode(400, 0);
    st().addWall(a, b);
    if (exterior) st().toggleExterior(floor().walls[0].id);
    return { a, b };
  }

  it('splitting a lone wall keeps both endpoints', () => {
    const { a, b } = singleWall(true);
    const before = undoLen();
    const mid = st().splitWall(floor().walls[0].id, 150, 30);

    expect(mid).not.toBeNull();
    expect(floor().nodes.map(n => n.id).sort()).toEqual([a, b, mid].sort());
    expect(floor().nodes.find(n => n.id === mid)).toMatchObject({ x: 150, y: 0 });
    expect(floor().walls).toHaveLength(2);
    expect(floor().walls.every(w => w.exterior)).toBe(true);
    expect(undoLen()).toBe(before + 1);

    st().undo();
    expect(floor().nodes).toHaveLength(2);
    expect(floor().walls).toHaveLength(1);
  });

  it('splitting at an endpoint reuses the endpoint', () => {
    const { a } = singleWall();
    expect(st().splitWall(floor().walls[0].id, -50, 0)).toBe(a);
    expect(floor().walls).toHaveLength(1);
  });

  it('deleting a wall removes orphan nodes in one undo step', () => {
    singleWall();
    const before = undoLen();
    st().deleteWall(floor().walls[0].id);
    expect(floor().nodes).toHaveLength(0);
    expect(undoLen()).toBe(before + 1);
  });

  it('does not create walls to missing nodes', () => {
    const a = st().addNode(0, 0);
    st().addWall(a, 9999);
    expect(floor().walls).toHaveLength(0);
  });
});

describe('layers', () => {
  it('catalog zIndex is used and front/back reorder items', () => {
    const rug = st().addFurniture({ ...chair, zIndex: 50 }, 0, 0);
    const c = st().addFurniture(chair, 0, 0);
    expect(floor().furniture.find(f => f.id === rug)!.zi).toBe(50);
    st().bringToFront(rug);
    const zRug = floor().furniture.find(f => f.id === rug)!.zi;
    expect(zRug).toBeGreaterThan(floor().furniture.find(f => f.id === c)!.zi);
  });
});

describe('dirty flag', () => {
  it('is set by edits and cleared by markSaved / load', () => {
    expect(st().dirty).toBe(false);
    st().addNode(0, 0);
    expect(st().dirty).toBe(true);
    st().markSaved();
    expect(st().dirty).toBe(false);
    st().addNode(1, 1);
    st().load(st().save());
    expect(st().dirty).toBe(false);
  });
});

describe('parseProject', () => {
  it('rejects broken files with a readable message', () => {
    expect(() => parseProject('not json')).toThrow(/JSON/);
    expect(() => parseProject('{}')).toThrow(/no floors/);
    expect(() => parseProject('{"floors":[{}]}')).toThrow(/floor 0/);
  });

  it('fills defaults, drops dangling walls and fixes nextId', () => {
    const p = parseProject(JSON.stringify({
      floors: [{
        nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }],
        walls: [{ id: 3, a: 1, b: 2 }, { id: 4, a: 1, b: 99, exterior: true }],
        furniture: [{ id: 7, path: 'sofa', x: 0, y: 0, w: 100, h: 50 }],
      }],
      nextId: 2,
    }));
    expect(p.floors[0].walls).toEqual([{ id: 3, a: 1, b: 2, exterior: false }]);
    expect(p.floors[0].furniture[0]).toMatchObject({ rot: 0, zi: 100 });
    expect(p.nextId).toBe(8);
  });
});
