/** Plan layers: the main plan and the wiring layer (pure) */
import type { FloorState, FurnitureItem, TextNote, Dimension, Cable, Tray, WiringSettings } from './types';

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
 * Objects of one layer: 'main' = the plan, 'wiring' = the wiring layer (trays always live there).
 * `own` leaves out objects shown on both layers (when the other layer is drawn too, so they are drawn once).
 */
export function layerView(floor: FloorState, layer: 'main' | 'wiring', own = false): LayerView {
  const inLayer = (o: { layer?: string }) => onLayer(o, layer) && !(own && o.layer === 'both');
  return {
    furniture: floor.furniture.filter(inLayer),
    texts: floor.texts.filter(inLayer),
    dimensions: floor.dimensions.filter(inLayer),
    cables: floor.cables.filter(inLayer),
    trays: layer === 'wiring' ? floor.trays : [],
  };
}

/** Cables with the global settings applied: default width, length shown on all */
export function styleCables(cables: Cable[], ws: WiringSettings): Cable[] {
  return cables.map(c => ({ ...c, width: c.width ?? ws.cableWidth, ...(ws.cableLengths ? { showLength: true } : {}) }));
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
