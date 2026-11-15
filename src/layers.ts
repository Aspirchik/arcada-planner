/** Plan layers: the main plan and the wiring layer (pure) */
import type { FloorState, FurnitureItem, TextNote, Dimension, Cable, Tray, WiringSettings, Layer } from './types';
import { chainInfos, chainRoots, chainRoute } from './geometry/chain';
import { cableHeights, length3d, itemElevation, type HeightCtx } from './geometry/heights';
import { patchLength } from './geometry/cable';

export interface LayerView {
  furniture: FurnitureItem[];
  texts: TextNote[];
  dimensions: Dimension[];
  cables: Cable[];
  trays: Tray[];
}

export const DEFAULT_WIRING: WiringSettings = {
  cableWidth: 3, cableText: 11, cableLabels: true, cableLengths: false, trayWidth: 10, trayText: 10, planDim: 30,
};

/** Whether an object is shown on the given layer ('both' objects are on each of them) */
export function onLayer(o: { layer?: string }, layer: 'main' | 'wiring'): boolean {
  if (o.layer === 'both') return true;
  return layer === 'wiring' ? o.layer === 'wiring' : !o.layer;
}

/**
 * Objects of one layer: 'main' = the plan, 'wiring' = the wiring layer (trays live there unless set otherwise).
 * `own` leaves out objects shown on both layers (when the other layer is drawn too, so they are drawn once).
 */
export function layerView(floor: FloorState, layer: 'main' | 'wiring', own = false): LayerView {
  const inLayer = (o: { layer?: string }) => onLayer(o, layer) && !(own && o.layer === 'both');
  return {
    furniture: floor.furniture.filter(inLayer),
    texts: floor.texts.filter(inLayer),
    dimensions: floor.dimensions.filter(inLayer),
    cables: floor.cables.filter(inLayer),
    trays: floor.trays.filter(t => (t.layer === 'both' ? !own : layer === 'wiring' ? t.layer !== 'plan' : t.layer === 'plan')),
  };
}

/** Tray layer as an object layer: trays keep 'wiring' as their default, so missing means wiring */
export function trayLayer(t: { layer?: 'plan' | 'both' }): Layer | undefined {
  return t.layer === 'plan' ? undefined : t.layer === 'both' ? 'both' : 'wiring';
}

/**
 * Cables ready to draw: global settings applied (default width, length shown on all) and,
 * when From / To is empty, the name of the item the end is connected to.
 */
export function styleCables(cables: Cable[], ws: WiringSettings, nameOf?: (id: number, port?: number, via?: number) => string | undefined, heights?: HeightCtx): Cable[] {
  // Lengths count the vertical runs when heights are known
  const zs = heights ? cableHeights(cables, heights) : null;
  const lengthOf = (c: Cable) => length3d(c.points, zs?.get(c.id));
  // Chains: the first cable carries the route through all consumers and the total length; the others only their own label
  const infos = chainInfos(cables, nameOf, lengthOf);
  const roots = chainRoots(cables);
  return cables.map(c => (c.kind === 'patch' ? { ...style(c), patchLen: patchLength(lengthOf(c)) } : style(c)));
  function style(c: Cable): Cable {
    const info = infos.get(c.id);
    if (info) return { ...c, width: c.width ?? ws.cableWidth, ...(ws.cableLengths ? { showLength: true } : {}), route: chainRoute(info), totalLength: info.length };
    const root = roots.get(c.id);
    if (root !== undefined && root !== c.id) return { ...c, width: c.width ?? ws.cableWidth, showLength: false, route: '', ...(zs ? { totalLength: lengthOf(c) } : {}) };
    const from = c.from || (c.fromLink && nameOf?.(c.fromLink.id, c.fromPort, c.id));
    const to = c.to || (c.toLink && nameOf?.(c.toLink.id, c.toPort, c.id));
    return {
      ...c, width: c.width ?? ws.cableWidth,
      ...(ws.cableLengths ? { showLength: true } : {}),
      ...(from ? { from } : {}), ...(to ? { to } : {}),
      ...(zs ? { totalLength: lengthOf(c) } : {}),
    };
  }
}

/** Heights of a floor for cable lengths: item mounting heights (own, or of the tray the item stands in) and tray heights */
export function heightCtx(floor: FloorState): HeightCtx {
  const elev = new Map<number, number>();
  for (const f of floor.furniture) { const e = itemElevation(f, floor.trays); if (e) elev.set(f.id, e.z); }
  return { elevOf: id => elev.get(id), trays: floor.trays };
}

/** Ids of cables in any of the given groups */
export function cablesInGroups(cables: Cable[], groups: number[]): Set<number> {
  return new Set(cables.filter(c => c.groups?.some(g => groups.includes(g))).map(c => c.id));
}

/** Which layers to output: plan only, plan + wiring (both full), or wiring over a dimmed plan */
export type LayerChoice = 'plan' | 'all' | 'wiring';

/**
 * Layer passes to draw for an output: the main plan (dimmed or not), then the wiring layer.
 * Objects on both layers are drawn once — with the main plan, or at full strength over a dimmed plan.
 */
export function layerPasses(floor: FloorState, choice: LayerChoice): { main: LayerView; dim: boolean; wiring: LayerView | null } {
  if (choice === 'plan') return { main: layerView(floor, 'main'), dim: false, wiring: null };
  if (choice === 'all') return { main: layerView(floor, 'main'), dim: false, wiring: layerView(floor, 'wiring', true) };
  return { main: layerView(floor, 'main', true), dim: true, wiring: layerView(floor, 'wiring') };
}
