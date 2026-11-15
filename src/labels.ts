/** What is written inside a furniture item — shared by the canvas, print and export (pure) */
import type { Cable, FurnitureItem } from './types';
import { derivedTag } from './geometry/ports';
import type { Lang, SizesPos } from './prefs';
import { catalogName, translate } from './i18n';
import catalog from './catalog.json';

/** English catalog name for items saved before names were stored */
const nameByPath = new Map<string, string>();
for (const c of catalog.categories) for (const it of c.items) if (!nameByPath.has(it.imagePath)) nameByPath.set(it.imagePath, it.name);

/**
 * Text shown inside the item.
 * textMode: missing = global (own label, or the catalog name when "Names" is on), 'on' = own label or name always, 'off' = nothing.
 */
export function furnitureLabel(item: FurnitureItem, showNames: boolean, lang: Lang): string {
  if (item.textMode === 'off') return '';
  const own = item.label?.trim() || item.device?.hostname?.trim();
  if (own) return own;
  if (!showNames && item.textMode !== 'on') return '';
  const name = item.name ?? nameByPath.get(item.path);
  return name ? catalogName(lang, 'item', name) : '';
}

/** Name of an item for cable routes: its own label, else the host name of a computer, else the translated catalog name */
export function itemName(item: FurnitureItem, lang: Lang): string {
  const own = item.label?.trim() || item.device?.hostname?.trim();
  if (own) return own;
  const name = item.name ?? nameByPath.get(item.path);
  return name ? catalogName(lang, 'item', name) : '';
}

/** Item name for a cable end; with a port: "Switch A, port 1"; `via` = the cable being named */
export type EndNamer = (id: number, port?: number, via?: number) => string | undefined;

/**
 * Looks up item names by id (for cable ends connected to items), with the port the end is plugged into and its tag.
 * With `cables`, a socket port also shows the tag it gets through its other cable — "User 1, port 1, VLAN 10".
 */
export function itemNamer(furniture: FurnitureItem[], lang: Lang, cables?: Cable[]): EndNamer {
  const byId = new Map(furniture.map(f => [f.id, f]));
  const tagOf = (id: number, port: number) => { const it = byId.get(id); return it ? portTag(it, port) : ''; };
  return (id, port, via) => {
    const it = byId.get(id);
    const name = it ? itemName(it, lang) : '';
    if (!name) return undefined;
    if (!port) return name;
    const own = portTag(it!, port);
    const got = cables && isPassThrough(it!) ? derivedTag(id, port, cables, tagOf, via) : '';
    const tags = [own, got !== own ? got : ''].filter(Boolean).join(', ');
    return `${name}, ${translate(lang, 'port.short')} ${port}${tags ? `, ${tags}` : ''}`;
  };
}

/** Tag of a port as shown: "uplink", "VLAN 10" (a plain number is a VLAN); '' when none */
export function portTag(item: FurnitureItem, port: number): string {
  const t = item.portTags?.[String(port)]?.trim() ?? '';
  return /^\d+$/.test(t) ? `VLAN ${t}` : t;
}

/** Catalog items with a fixed number of ports (other than "Switch N") */
const PORTS_BY_NAME: Record<string, number> = { 'LAN socket': 1, 'LAN socket double': 2 };

/**
 * Sockets pass a connection through: a port takes the cable from the wall and the cord to a device
 * (two cable ends), and it gets the tag (VLAN) of the switch port the wall cable comes from.
 */
export const isPassThrough = (item: FurnitureItem) => ['LAN socket', 'LAN socket double'].includes(item.name ?? nameByPath.get(item.path) ?? '');

/** Printers: network devices without video outputs */
const PRINTER_NAMES = new Set(['Printer Kyocera', 'Printer Kyocera with scanner', 'Zebra ZT411', 'Zebra ZT410', 'Zebra ZT230']);
export const isPrinter = (item: FurnitureItem) => PRINTER_NAMES.has(item.name ?? nameByPath.get(item.path) ?? '');

/** Computers and printers: they have a host name, video outputs (computers) and network ports with MAC / IP */
const DEVICE_NAMES = new Set(['PC Dell SFF', 'Laptop closed', ...PRINTER_NAMES]);
export const isDevice = (item: FurnitureItem) => !!item.device || DEVICE_NAMES.has(item.name ?? nameByPath.get(item.path) ?? '');

/** Network ports of a computer (at least one) */
export const deviceNics = (item: FurnitureItem) => (item.device?.nics?.length ? item.device.nics : [{}]);

/** Whether the item is drawn in two halves that can have their own colours (double socket) */
export const isTwoPart = (item: FurnitureItem) => (item.name ?? nameByPath.get(item.path)) === 'LAN socket double';

/** Number of ports of an item: its own setting, or from a catalog name like "Switch 24"; 0 = none */
export function portCount(item: FurnitureItem): number {
  if (item.ports !== undefined) return item.ports;
  const name = item.name ?? nameByPath.get(item.path) ?? '';
  if (PORTS_BY_NAME[name]) return PORTS_BY_NAME[name];
  if (isDevice(item)) return deviceNics(item).length;
  const m = /^Switch (\d+)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * Corner where the item's size is shown, or 'off'.
 * sizeMode: missing = global corner from the toolbar, 'on' = always (toolbar corner, bottom-right if that is off), 'off' = never.
 */
export function sizesCorner(item: FurnitureItem, global: SizesPos): SizesPos {
  if (item.sizeMode === 'off') return 'off';
  if (item.sizeMode === 'on') return global === 'off' ? 'br' : global;
  return global;
}
