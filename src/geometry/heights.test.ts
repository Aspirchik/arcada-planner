import { describe, it, expect } from 'vitest';
import type { Cable, FurnitureItem, Tray } from '../types';
import { cableHeights, verticalRun, length3d, itemElevation, carryHeights } from './heights';
import { tidyCables } from './tidy';
import { cablesInTray } from './cable';
import { styleCables, heightCtx, DEFAULT_WIRING } from '../layers';
import { itemNamer, portCount } from '../labels';

const item = (id: number, x: number, y: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, path: 'x', x, y, w: 10, h: 10, rot: 0, zi: 100, ...extra });
const tray: Tray = { id: 50, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }], width: 10, elev: 40 };
const floor = (furniture: FurnitureItem[], cables: Cable[], trays: Tray[] = []) =>
  ({ nodes: [], walls: [], furniture, dimensions: [], texts: [], cables, trays, groups: [] });

describe('cable heights', () => {
  it('adds the drop from the ceiling run down to a panel', () => {
    // AC at 300 cm, run under the ceiling, control panel at 160 cm
    const ac = item(1, 0, 0, { elev: 300 }), panel = item(2, 0, 300, { elev: 160 });
    const c: Cable = { id: 10, color: '#000', points: [{ x: 5, y: 5 }, { x: 5, y: 305 }], fromLink: { id: 1, u: 0.5, v: 0.5 }, toLink: { id: 2, u: 0.5, v: 0.5 }, height: 300 };
    const zs = cableHeights([c], heightCtx(floor([ac, panel], [c])));
    expect(zs.get(10)).toEqual([300, 160]);
    expect(verticalRun(zs.get(10))).toBe(140);
    expect(length3d(c.points, zs.get(10))).toBe(440);
  });

  it('own point heights: up over a wardrobe and down into the tray', () => {
    const c: Cable = { id: 10, color: '#000', points: [{ x: 0, y: 100, z: 50 }, { x: 100, y: 100, z: 220 }, { x: 200, y: 100, z: 220 }, { x: 200, y: 0 }, { x: 300, y: 0 }] };
    const zs = cableHeights([c], { elevOf: () => undefined, trays: [tray] }).get(10)!;
    // last two points lie in the tray at 40 cm
    expect(zs).toEqual([50, 220, 220, 40, 40]);
    expect(verticalRun(zs)).toBe(170 + 180);
  });

  it('a cable marked outside trays ignores the tray height', () => {
    const c: Cable = { id: 10, color: '#000', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], noTray: true, height: 280 };
    expect(cableHeights([c], { elevOf: () => undefined, trays: [tray] }).get(10)).toEqual([280, 280]);
    expect(cablesInTray(tray, [c])).toEqual([]);
  });

  it('no heights known → flat, plan length only', () => {
    const c: Cable = { id: 10, color: '#000', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    expect(cableHeights([c], { elevOf: () => undefined, trays: [] }).get(10)).toBeNull();
    const [s] = styleCables([c], DEFAULT_WIRING, undefined, { elevOf: () => undefined, trays: [] });
    expect(s.totalLength).toBe(100);
  });

  it('a socket standing in a tray takes the tray height', () => {
    expect(itemElevation(item(1, 100, -5), [tray])).toEqual({ z: 40, inTray: true });
    expect(itemElevation(item(1, 100, -5, { elev: 120 }), [tray])).toEqual({ z: 120, inTray: false });
    expect(itemElevation(item(1, 100, 200), [tray])).toBeUndefined();
  });

  it('a continuation starts at its parent height', () => {
    const a: Cable = { id: 1, color: '#000', points: [{ x: 0, y: 0, z: 250 }, { x: 200, y: 0 }] };
    const b: Cable = { id: 2, color: '#000', parent: 1, points: [{ x: 100, y: 0 }, { x: 100, y: 100, z: 100 }] };
    const zs = cableHeights([a, b], { elevOf: () => undefined, trays: [] });
    expect(zs.get(2)).toEqual([250, 100]);
  });

  it('carryHeights keeps own heights of nearby points after re-laying', () => {
    const old = [{ x: 0, y: 0, z: 50 }, { x: 100, y: 3, z: 220 }, { x: 200, y: 0 }];
    expect(carryHeights(old, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]))
      .toEqual([{ x: 0, y: 0, z: 50 }, { x: 100, y: 0, z: 220 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
  });
});

describe('tidy and trays', () => {
  it('a cable outside trays is not routed through them', () => {
    const c: Cable = { id: 10, color: '#000', points: [{ x: 10, y: 30 }, { x: 390, y: 30 }] };
    const inTray = tidyCables([c], [tray]).get(10)!;
    expect(inTray.some(p => p.y === 0)).toBe(true);
    const out = tidyCables([{ ...c, noTray: true }], [tray]).get(10)!;
    expect(out.every(p => p.y === 30)).toBe(true);
  });
});

describe('switch ports', () => {
  it('port count from the catalog name or own setting', () => {
    expect(portCount(item(1, 0, 0, { name: 'Switch 24' }))).toBe(24);
    expect(portCount(item(1, 0, 0, { name: 'Switch 24', ports: 8 }))).toBe(8);
    expect(portCount(item(1, 0, 0, { name: 'LAN socket' }))).toBe(1);
    expect(portCount(item(1, 0, 0, { name: 'Chair' }))).toBe(0);
  });

  it('route shows the port: "Switch A, port 1 → User 1"', () => {
    const sw = item(1, 0, 0, { name: 'Switch 24', label: 'Switch A' }), lan = item(2, 0, 100, { label: 'User 1' });
    const c: Cable = { id: 10, color: '#000', points: [{ x: 5, y: 5 }, { x: 5, y: 105 }], fromLink: { id: 1, u: 0.5, v: 0.5 }, toLink: { id: 2, u: 0.5, v: 0.5 }, fromPort: 1 };
    const [s] = styleCables([c], DEFAULT_WIRING, itemNamer([sw, lan], 'en'));
    expect(`${s.from} → ${s.to}`).toBe('Switch A, port 1 → User 1');
    const [r] = styleCables([c], DEFAULT_WIRING, itemNamer([sw, lan], 'ru'));
    expect(r.from).toBe('Switch A, порт 1');
  });
});

describe('file', () => {
  it('heights, ports and "outside trays" survive save / load', async () => {
    const { parseProject } = await import('../store');
    const sw = item(1, 0, 0, { elev: 50, ports: 16 }), lan = item(2, 0, 100);
    const c: Cable = { id: 10, color: '#000', points: [{ x: 5, y: 5 }, { x: 50, y: 50, z: 220 }, { x: 5, y: 105 }],
      fromLink: { id: 1, u: 0.5, v: 0.5 }, toLink: { id: 2, u: 0.5, v: 0.5 }, fromPort: 3, noTray: true, height: 280 };
    const json = JSON.stringify({ version: '2.2.0', floors: [{ ...floor([sw, lan], [c], [tray]), height: 300 }], nextId: 100 });
    const f = parseProject(json).floors[0];
    expect(f.height).toBe(300);
    expect(f.furniture[0]).toMatchObject({ elev: 50, ports: 16 });
    expect(f.trays[0].elev).toBe(40);
    expect(f.cables[0]).toMatchObject({ fromPort: 3, noTray: true, height: 280 });
    expect(f.cables[0].points[1].z).toBe(220);
  });
});

describe('port tags and double socket', () => {
  it('a tagged port shows in the route; a number is a VLAN', () => {
    const sw = item(1, 0, 0, { name: 'Switch 24', label: 'Switch A', portTags: { '1': 'uplink', '3': '10' } });
    const name = itemNamer([sw], 'en');
    expect(name(1, 3)).toBe('Switch A, port 3, VLAN 10');
    expect(name(1, 1)).toBe('Switch A, port 1, uplink');
    expect(name(1, 2)).toBe('Switch A, port 2');
  });

  it('double LAN socket has 2 ports', () => {
    expect(portCount(item(1, 0, 0, { name: 'LAN socket double' }))).toBe(2);
  });

  it('tags and the second colour survive save / load', async () => {
    const { parseProject } = await import('../store');
    const sock = item(1, 0, 0, { name: 'LAN socket double', color: '#d0021b', color2: '#1a73e8', portTags: { '2': 'VLAN 20', x: 'bad' } as Record<string, string> });
    const f = parseProject(JSON.stringify({ floors: [floor([sock], [])], nextId: 10 })).floors[0];
    expect(f.furniture[0]).toMatchObject({ color2: '#1a73e8', portTags: { '2': 'VLAN 20' } });
  });
});

describe('socket ports: VLAN through the wall cable, cord to a device', () => {
  const sw = item(1, 0, 0, { name: 'Switch 24', label: 'Switch A', portTags: { '3': '10' } });
  const sock = item(2, 0, 300, { name: 'LAN socket', label: 'User 1', portTags: { '1': 'A1' } });
  const pc = item(3, 100, 300, { name: 'PC Dell SFF', device: { hostname: 'PC-02' } });
  const wall: Cable = { id: 10, color: '#000', points: [{ x: 5, y: 5 }, { x: 5, y: 305 }], fromLink: { id: 1, u: 0.5, v: 0.5 }, fromPort: 3, toLink: { id: 2, u: 0.5, v: 0.5 }, toPort: 1 };
  const cord: Cable = { id: 11, color: '#000', points: [{ x: 5, y: 305 }, { x: 105, y: 305 }], fromLink: { id: 2, u: 0.5, v: 0.5 }, fromPort: 1, toLink: { id: 3, u: 0.5, v: 0.5 }, toPort: 1 };

  it('the cord route names the socket port with its label and the VLAN it gets', () => {
    const [, c] = styleCables([wall, cord], DEFAULT_WIRING, itemNamer([sw, sock, pc], 'en', [wall, cord]));
    expect(`${c.from} → ${c.to}`).toBe('User 1, port 1, A1, VLAN 10 → PC-02, port 1');
  });

  it('the wall cable does not repeat the VLAN on the socket end', () => {
    const [w] = styleCables([wall, cord], DEFAULT_WIRING, itemNamer([sw, sock, pc], 'en', [wall, cord]));
    expect(`${w.from} → ${w.to}`).toBe('Switch A, port 3, VLAN 10 → User 1, port 1, A1');
  });
});

describe('connectors', () => {
  it('cableJoints puts a connector on the drawn path; re-laying keeps it', async () => {
    const { cableJoints } = await import('./cable');
    const c: Cable = { id: 1, color: '#000', points: [{ x: 0, y: 0 }, { x: 100, y: 0, joint: true }, { x: 200, y: 0 }] };
    expect(cableJoints(c, [{ x: 0, y: 6 }, { x: 200, y: 6 }])).toEqual([{ p: { x: 100, y: 6 }, angle: 0 }]);
    const out = carryHeights(c.points, [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 0 }]);
    expect(out.filter(p => p.joint)).toHaveLength(1);
  });
});

describe('patch cords', () => {
  it('standard length that fits, label, plugs at free ends', async () => {
    const { patchLength, cableLabel, cablePlugs } = await import('./cable');
    expect(patchLength(80)).toBe(100);
    expect(patchLength(240)).toBe(300);
    expect(patchLength(300)).toBe(300);
    expect(patchLength(1200)).toBe(0);
    const c: Cable = { id: 1, color: '#000', kind: 'patch', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }], toLink: { id: 5, u: 0.5, v: 0.5 } };
    const [s] = styleCables([c], DEFAULT_WIRING, undefined, { elevOf: () => undefined, trays: [] });
    expect(s.patchLen).toBe(300);
    expect(cableLabel(s, 'm', 'patch cord')).toBe('patch cord 3 m');
    // only the free start gets a plug, pointing outwards (to the left)
    expect(cablePlugs(c, c.points)).toEqual([{ p: { x: 0, y: 0 }, angle: 180 }]);
  });
});

describe('patch cord plugs on items', () => {
  it('an end on a desk shows a plug, an end in a socket does not', async () => {
    const { cablePlugs } = await import('./cable');
    const desk = item(1, 0, 0, { name: 'Desk', w: 100, h: 60 }), sock = item(2, 200, 0, { name: 'LAN socket' });
    const c: Cable = { id: 9, color: '#000', kind: 'patch', points: [{ x: 50, y: 30 }, { x: 207, y: 7 }], fromLink: { id: 1, u: 0.5, v: 0.5 }, toLink: { id: 2, u: 0.5, v: 0.5 } };
    const [s] = styleCables([c], DEFAULT_WIRING, undefined, heightCtx(floor([desk, sock], [c])));
    expect([s.plugFrom, s.plugTo]).toEqual([true, false]);
    expect(cablePlugs(s, s.points)).toHaveLength(1);
  });
});
