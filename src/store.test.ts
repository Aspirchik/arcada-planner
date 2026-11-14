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

describe('dimensions', () => {
  it('add, move an end and delete — each one undo step', () => {
    const id = st().addDimension(0, 0, 300, 0);
    st().updateDimension(id, { x2: 400 });
    expect(floor().dimensions[0]).toMatchObject({ x1: 0, x2: 400 });
    st().deleteDimension(id);
    expect(floor().dimensions).toHaveLength(0);
    expect(undoLen()).toBe(3);
  });

  it('are saved and loaded', () => {
    const id = st().addDimension(1, 2, 3, 4);
    st().updateDimension(id, { color: '#1a73e8' });
    st().load(st().save());
    expect(floor().dimensions).toEqual([expect.objectContaining({ x1: 1, y1: 2, x2: 3, y2: 4, color: '#1a73e8' })]);
  });
});

describe('texts and labels', () => {
  it('adds, edits and deletes a text note', () => {
    const id = st().addText(10, 20, 'Kitchen');
    st().updateText(id, { text: 'Kuchnia', bold: true });
    expect(floor().texts[0]).toMatchObject({ x: 10, y: 20, text: 'Kuchnia', bold: true, color: null });
    st().select(id);
    st().deleteSelected();
    expect(floor().texts).toHaveLength(0);
    expect(st().selectedId).toBeNull();
  });

  it('copy / paste works for text notes and furniture keeps its catalog name and label', () => {
    const t = st().addText(0, 0, 'A');
    st().select(t);
    st().copySelected();
    st().pasteClipboard();
    expect(floor().texts.map(x => x.x)).toEqual([0, 20]);

    const f = st().addFurniture(chair, 0, 0);
    st().updateFurniture(f, { label: 'My chair' });
    st().load(st().save());
    expect(floor().furniture[0]).toMatchObject({ name: 'Chair', label: 'My chair' });
  });

  it('cut is a single undo step', () => {
    const f = st().addFurniture(chair, 0, 0);
    st().select(f);
    const before = undoLen();
    st().cutSelected();
    expect(floor().furniture).toHaveLength(0);
    expect(undoLen()).toBe(before + 1);
  });
});

describe('selection and groups', () => {
  it('ctrl-click toggles; a group moves, copies and deletes together', () => {
    const a = st().addFurniture(chair, 0, 0);
    const b = st().addFurniture(chair, 100, 0);
    const t = st().addText(50, 50, 'x');
    st().select(a);
    st().toggleSelect(b);
    st().toggleSelect(t);
    expect(st().selection).toEqual([a, b, t]);
    expect(st().selectedId).toBeNull();
    st().toggleSelect(t);
    expect(st().selection).toEqual([a, b]);

    st().moveItems([{ id: a, x: 500, y: 500 }, { id: b, x: 600, y: 500 }]);
    expect(floor().furniture.map(f => f.x)).toEqual([500, 600]);

    st().copySelected();
    st().pasteClipboard();
    expect(floor().furniture).toHaveLength(4);
    expect(st().selection).toHaveLength(2);

    const before = undoLen();
    st().deleteSelected();
    expect(floor().furniture).toHaveLength(2);
    expect(undoLen()).toBe(before + 1);
  });
});

describe('mirroring / door direction', () => {
  it('flipping a door to open the other way keeps its frame in place', () => {
    const d = st().addFurniture({ name: 'Door', imagePath: 'door', width: 1, height: 1 }, 50, 50);
    const before = { ...floor().furniture[0] };
    st().flipFurniture(d, 'y');
    const after = floor().furniture[0];
    expect(after.flipY).toBe(true);
    // frame band: top before (y .. y+18.8), bottom after (y' + 81.2 .. y' + 100) → same place
    expect(after.y + after.h * (1 - 25 / 133)).toBeCloseTo(before.y);
    st().flipFurniture(d, 'y');
    expect(floor().furniture[0].y).toBeCloseTo(before.y);
    st().flipFurniture(d, 'x');
    expect(floor().furniture[0]).toMatchObject({ flipX: true, x: before.x });
    st().load(st().save());
    expect(floor().furniture[0].flipX).toBe(true);
  });
});

describe('simple view', () => {
  it('is set for several items in one step and survives save / load', () => {
    const a = st().addFurniture(chair, 0, 0);
    const b = st().addFurniture(chair, 100, 0);
    const before = undoLen();
    st().updateFurnitureMany([a, b], { simple: true });
    expect(undoLen()).toBe(before + 1);
    st().updateFurnitureMany([a], { textMode: 'off', sizeMode: 'on' });
    st().load(st().save());
    expect(floor().furniture.every(f => f.simple)).toBe(true);
    expect(floor().furniture[0]).toMatchObject({ textMode: 'off', sizeMode: 'on' });
  });
});

describe('wall settings', () => {
  it('custom thickness is kept when splitting; length moves the free end', () => {
    const a = st().addNode(0, 0);
    const b = st().addNode(300, 0);
    const c = st().addNode(300, 200);
    st().addWall(a, b);
    st().addWall(b, c);
    const w = floor().walls[0].id;
    st().updateWall(w, { thickness: 30, exterior: true });
    st().setWallLength(w, 450);
    // a has one wall, b has two → a moves
    expect(floor().nodes.find(n => n.id === a)).toMatchObject({ x: -150, y: 0 });
    st().splitWall(w, 0, 0);
    expect(floor().walls.filter(x => x.thickness === 30)).toHaveLength(2);
    st().load(st().save());
    expect(floor().walls.filter(x => x.thickness === 30)).toHaveLength(2);
  });

  it('dimension length keeps the first end', () => {
    const d = st().addDimension(0, 0, 100, 0);
    st().setDimensionLength(d, 250);
    expect(floor().dimensions[0]).toMatchObject({ x1: 0, x2: 250, y2: 0 });
  });
});

describe('cables', () => {
  it('add, edit, delete, save / load', () => {
    const id = st().addCable([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], '#188038');
    st().updateCable(id, { label: 'Cat6', showLength: true, width: 4 });
    st().load(st().save());
    expect(floor().cables[0]).toMatchObject({ id, color: '#188038', label: 'Cat6', showLength: true, width: 4 });
    expect(floor().cables[0].points).toHaveLength(3);
    st().select(id);
    st().deleteSelected();
    expect(floor().cables).toHaveLength(0);
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
    expect(p.floors[0].dimensions).toEqual([]);
    expect(p.floors[0].texts).toEqual([]);
    expect(p.floors[0].cables).toEqual([]);
    expect(p.nextId).toBe(8);
  });
});
