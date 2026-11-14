/** Plan layers: the main plan and the wiring layer (pure) */
import type { FloorState, FurnitureItem, TextNote, Dimension, Cable, Tray } from './types';

export interface LayerView {
  furniture: FurnitureItem[];
  texts: TextNote[];
  dimensions: Dimension[];
  cables: Cable[];
  trays: Tray[];
}

/** Objects of one layer: 'main' = the plan, 'wiring' = the wiring layer (trays always live there) */
export function layerView(floor: FloorState, layer: 'main' | 'wiring'): LayerView {
  const inLayer = (o: { layer?: string }) => (layer === 'wiring' ? o.layer === 'wiring' : !o.layer);
  return {
    furniture: floor.furniture.filter(inLayer),
    texts: floor.texts.filter(inLayer),
    dimensions: floor.dimensions.filter(inLayer),
    cables: floor.cables.filter(inLayer),
    trays: layer === 'wiring' ? floor.trays : [],
  };
}

/** Which layers to output: plan only, plan + wiring (both full), or wiring over a dimmed plan */
export type LayerChoice = 'plan' | 'all' | 'wiring';
