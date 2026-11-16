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

describe('wiring mode and trays', () => {
  it('objects created in wiring mode go to the wiring layer; layers can be switched; trays save', () => {
    st().setMode('wiring');
    const c = st().addCable([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000');
    const f = st().addFurniture(chair, 0, 0);
    st().setMode('plan');
    const f2 = st().addFurniture(chair, 0, 0);
    expect(floor().cables[0].layer).toBe('wiring');
    expect(floor().furniture.find(x => x.id === f)!.layer).toBe('wiring');
    expect(floor().furniture.find(x => x.id === f2)!.layer).toBeUndefined();
    st().setLayer(f, undefined);
    expect(floor().furniture.find(x => x.id === f)!.layer).toBeUndefined();

    const t = st().addTray([{ x: 0, y: 0 }, { x: 300, y: 0 }], 12);
    st().updateCable(c, { from: 'Server room', to: 'User 1' });
    st().load(st().save());
    expect(floor().trays[0]).toMatchObject({ id: t, width: 12 });
    expect(floor().cables[0]).toMatchObject({ from: 'Server room', to: 'User 1', layer: 'wiring' });
  });
});

describe('both layers, colours and wiring settings', () => {
  it('an object can be on both plans; colours and settings are saved', () => {
    const f = st().addFurniture(chair, 0, 0);
    st().select(f);
    st().setLayer(f, 'both');
    st().setMode('wiring');
    st().setLayer(f, 'both');
    st().updateFurniture(f, { color: '#d0021b' });
    const t = st().addTray([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(floor().trays[0].width).toBe(10);
    st().updateTray(t, { color: '#188038' });
    st().setWiring({ cableWidth: 5, planDim: 50, cableLabels: false });
    expect(st().dirty).toBe(true);
    st().addCable([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000');
    st().updateCable(floor().cables[0].id, { width: 9 });
    st().resetCableWidths();
    expect(floor().cables[0].width).toBeUndefined();

    const json = st().save();
    useStore.setState(initial, true);
    st().load(json);
    expect(floor().furniture[0]).toMatchObject({ layer: 'both', color: '#d0021b' });
    expect(floor().trays[0].color).toBe('#188038');
    expect(st().wiring).toMatchObject({ cableWidth: 5, planDim: 50, cableLabels: false, cableText: 11 });
  });

  it('bad wiring settings and colours fall back to defaults', () => {
    const p = parseProject(JSON.stringify({ floors: [{ nodes: [], walls: [], furniture: [{ id: 1, path: 'a', x: 0, y: 0, w: 1, h: 1, color: 'red;x' }] }], wiring: { cableWidth: -1, planDim: 'x' } }));
    expect(p.floors[0].furniture[0].color).toBeUndefined();
    expect(p.wiring.cableWidth).toBe(3);
    expect(p.wiring.planDim).toBe(30);
  });
});

describe('cable connections and groups', () => {
  const socket: CatalogItem = { name: 'LAN socket', imagePath: 'socket-lan', width: 0.15, height: 0.1 };

  it('a cable drawn to a socket follows it and takes its label as To', () => {
    const s = st().addFurniture(socket, 300, 300);
    const it = floor().furniture[0];
    st().updateFurniture(s, { label: 'LAN 12' });
    const c = st().addCable([{ x: 0, y: 0 }, { x: it.x + it.w / 2, y: it.y + it.h / 2 }], '#000');
    expect(floor().cables[0].toLink?.id).toBe(s);
    expect(floor().cables[0].fromLink).toBeUndefined();
    st().moveItems([{ id: s, x: it.x + 100, y: it.y }]);
    expect(floor().cables[0].points[1].x).toBeCloseTo(it.x + 100 + it.w / 2);
    st().undo();
    expect(floor().cables[0].points[1].x).toBeCloseTo(it.x + it.w / 2);
    // dragging the end off the socket disconnects it
    st().updateCable(c, { points: [{ x: 0, y: 0 }, { x: 900, y: 900 }] });
    expect(floor().cables[0].toLink).toBeUndefined();
  });

  it('local and common groups: membership, highlight, delete, save', () => {
    const c = st().addCable([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000');
    const g1 = st().addGroup('local', 'Office');
    const g2 = st().addGroup('common', 'Cameras');
    st().toggleCableGroup(c, g1);
    st().toggleCableGroup(c, g2);
    expect(floor().cables[0].groups).toEqual([g1, g2]);
    st().toggleLit(g2);
    expect(st().litGroups).toEqual([g2]);
    st().renameGroup(g2, 'CCTV');
    st().load(st().save());
    expect(st().commonGroups).toEqual([{ id: g2, name: 'CCTV' }]);
    expect(floor().groups).toEqual([{ id: g1, name: 'Office' }]);
    expect(st().litGroups).toEqual([]);
    st().deleteGroup(g2);
    expect(floor().cables[0].groups).toEqual([g1]);
    st().deleteGroup(g1);
    expect(floor().cables[0].groups).toBeUndefined();
  });

  it('items (sockets, switches) in groups: toggle, save, delete', () => {
    const a = st().addFurniture(chair, 0, 0);
    const g = st().addGroup('common', 'LAN');
    st().toggleItemGroup(a, g);
    st().load(st().save());
    expect(floor().furniture[0].groups).toEqual([g]);
    st().deleteGroup(g);
    expect(floor().furniture[0].groups).toBeUndefined();
  });

  it('assignPort: a cable takes the port, the one there before loses it', () => {
    const sw = st().addFurniture(chair, 0, 0);
    const a = st().addCable([{ x: 30, y: 30 }, { x: 300, y: 0 }], '#000');
    const b = st().addCable([{ x: 30, y: 30 }, { x: 300, y: 100 }], '#000');
    expect(floor().cables.every(c => c.fromLink?.id === sw)).toBe(true);
    st().assignPort(sw, 1, { id: a, end: 'from' });
    expect(floor().cables.find(c => c.id === a)!.fromPort).toBe(1);
    st().assignPort(sw, 1, { id: b, end: 'from' });
    expect(floor().cables.find(c => c.id === a)!.fromPort).toBeUndefined();
    expect(floor().cables.find(c => c.id === b)!.fromPort).toBe(1);
    st().assignPort(sw, 1, null);
    expect(floor().cables.find(c => c.id === b)!.fromPort).toBeUndefined();
  });

  it('setAllPortTags: one tag for every port, then single ports by hand, empty clears', () => {
    const sw = st().addFurniture(chair, 0, 0);
    st().setAllPortTags(sw, '10', 4);
    st().setPortTag(sw, 1, 'uplink');
    expect(floor().furniture[0].portTags).toEqual({ '1': 'uplink', '2': '10', '3': '10', '4': '10' });
    st().setAllPortTags(sw, '', 4);
    expect(floor().furniture[0].portTags).toBeUndefined();
  });

  it('a socket port holds two ends: the wall cable and the cord; a third pushes the oldest out', () => {
    const sock: CatalogItem = { name: 'LAN socket', imagePath: 'socket-lan', width: 0.15, height: 0.15 };
    const s = st().addFurniture(sock, 0, 0);
    const it = floor().furniture[0];
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const a = st().addCable([{ x: 500, y: 0 }, { x: cx, y: cy }], '#000');
    const b = st().addCable([{ x: cx, y: cy }, { x: 500, y: 300 }], '#000');
    const c = st().addCable([{ x: cx, y: cy }, { x: 500, y: 600 }], '#000');
    st().assignPort(s, 1, { id: a, end: 'to' });
    st().assignPort(s, 1, { id: b, end: 'from' });
    expect(floor().cables.find(x => x.id === a)!.toPort).toBe(1);
    expect(floor().cables.find(x => x.id === b)!.fromPort).toBe(1);
    st().assignPort(s, 1, { id: c, end: 'from' });
    expect(floor().cables.find(x => x.id === a)!.toPort).toBeUndefined();
    expect(floor().cables.find(x => x.id === c)!.fromPort).toBe(1);
  });

  it('connectors: put on a cable, toggled off, kept when a point is dragged', () => {
    const c = st().addCable([{ x: 0, y: 0 }, { x: 200, y: 0 }], '#000');
    st().toggleJoint(c, { x: 80, y: 2 }, 5);
    expect(floor().cables[0].points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0, joint: true }, { x: 200, y: 0 }]);
    st().setCablePointHeight(c, 1, 100);
    st().setCablePointHeight(c, 1, undefined);
    expect(floor().cables[0].points[1]).toEqual({ x: 80, y: 0, joint: true });
    st().toggleJoint(c, { x: 81, y: 0 }, 5);
    expect(floor().cables[0].points[1]).toEqual({ x: 80, y: 0 });
  });

  it('point heights: set and clear one point, room height', () => {
    const c = st().addCable([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000');
    st().setCablePointHeight(c, 1, 160);
    expect(floor().cables[0].points[1]).toEqual({ x: 100, y: 0, z: 160 });
    st().setCablePointHeight(c, 1, undefined);
    expect(floor().cables[0].points[1]).toEqual({ x: 100, y: 0 });
    st().setFloorHeight(300);
    st().load(st().save());
    expect(floor().height).toBe(300);
  });

  it('layer for several objects at once, trays included', () => {
    const a = st().addFurniture(chair, 0, 0), b = st().addFurniture(chair, 100, 0);
    st().setMode('wiring');
    const tr = st().addTray([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    st().setMode('plan');
    st().setLayerMany([a, b, tr], 'both');
    expect(floor().furniture.map(f => f.layer)).toEqual(['both', 'both']);
    expect(floor().trays[0].layer).toBe('both');
    st().setLayerMany([tr], undefined);
    expect(floor().trays[0].layer).toBe('plan');
    st().setLayerMany([tr], 'wiring');
    expect(floor().trays[0].layer).toBeUndefined();
    st().setLayerMany([tr], 'both');
    st().load(st().save());
    expect(floor().trays[0].layer).toBe('both');
  });

  it('continue, attach, detach and delete keep the chain consistent', () => {
    const a = st().addCable([{ x: 0, y: 0 }, { x: 300, y: 0 }], '#d0021b');
    st().updateCable(a, { width: 6 });
    const b = st().addCable([{ x: 100, y: 0 }, { x: 100, y: 80 }], '#000', a);
    expect(floor().cables.find(c => c.id === b)).toMatchObject({ parent: a, color: '#d0021b', width: 6 });
    const c = st().addCable([{ x: 200, y: 5 }, { x: 200, y: 80 }], '#188038');
    expect(st().attachCable(c, a)).toBe(true);
    expect(floor().cables.find(x => x.id === c)).toMatchObject({ parent: a, color: '#d0021b' });
    expect(floor().cables.find(x => x.id === c)!.points[0]).toEqual({ x: 200, y: 0 });
    // no cycles
    expect(st().attachCable(a, b)).toBe(false);
    st().updateChain(b, { color: '#1a73e8' });
    expect(floor().cables.every(x => x.color === '#1a73e8')).toBe(true);
    const g = st().addGroup('local', 'Emergency');
    st().toggleCableGroup(c, g);
    expect(floor().cables.every(x => x.groups?.includes(g))).toBe(true);
    // moving the parent keeps the continuations on it
    st().updateCable(a, { points: [{ x: 0, y: 20 }, { x: 300, y: 20 }] });
    expect(floor().cables.find(x => x.id === b)!.points[0]).toEqual({ x: 100, y: 20 });
    st().detachCable(c);
    expect(floor().cables.find(x => x.id === c)!.parent).toBeUndefined();
    st().deleteCable(a);
    expect(floor().cables.find(x => x.id === b)!.parent).toBeUndefined();
    st().load(st().save());
    expect(floor().cables).toHaveLength(2);
  });

  it('tidy is one undo step and keeps cable ends', () => {
    st().addCable([{ x: 0, y: 0 }, { x: 200, y: 80 }], '#000');
    const before = floor().cables[0].points;
    const n = undoLen();
    st().tidyCables();
    const after = floor().cables[0].points;
    expect(after[0]).toEqual(before[0]);
    expect(after[after.length - 1]).toEqual(before[1]);
    expect(after.every((p, i) => i === 0 || p.x === after[i - 1].x || p.y === after[i - 1].y)).toBe(true);
    expect(undoLen()).toBe(n + 1);
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
    expect(p.floors[0].trays).toEqual([]);
    expect(p.nextId).toBe(8);
  });
});

describe('ceiling grids', () => {
  it('reads grids from a file, fills missing sizes and drops broken marks and grids', () => {
    const p = parseProject(JSON.stringify({ floors: [{ nodes: [], walls: [], furniture: [], ceilings: [
      { id: 7, x: 0, y: 0, w: 277.5, h: 180, firstW: 50, marks: [{ c: 1, r: 1, kind: 'lamp' }, { c: -1, r: 0, kind: 'lamp' }, { c: 0, r: 0, kind: 'x' }] },
      { id: 8, x: 0, y: 0, w: 0, h: 10 },
    ] }] }));
    expect(p.floors[0].ceilings).toEqual([{ id: 7, x: 0, y: 0, w: 277.5, h: 180, cellW: 60, cellH: 60, firstW: 50, firstH: 60, marks: [{ c: 1, r: 1, kind: 'lamp' }] }]);
    expect(p.nextId).toBeGreaterThan(7);
    expect(parseProject(JSON.stringify({ floors: [{ nodes: [], walls: [], furniture: [] }] })).floors[0].ceilings).toBeUndefined();
  });

  it('marks a panel with the brush, a second click clears it, one undo step each', () => {
    const st = useStore.getState();
    const id = st.addCeiling(0, 0, 240, 240);
    st.setCeilingBrush('ac');
    useStore.getState().markCeiling(id, 1, 2);
    const g = () => useStore.getState().floors[useStore.getState().fi].ceilings?.find(c => c.id === id);
    expect(g()?.marks).toEqual([{ c: 1, r: 2, kind: 'ac' }]);
    useStore.getState().markCeiling(id, 1, 2);
    expect(g()?.marks).toBeUndefined();
    useStore.getState().undo();
    expect(g()?.marks).toEqual([{ c: 1, r: 2, kind: 'ac' }]);
    useStore.getState().select(id);
    useStore.getState().deleteSelected();
    expect(useStore.getState().floors[useStore.getState().fi].ceilings).toBeUndefined();
  });
});
