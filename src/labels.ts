/** What is written inside a furniture item — shared by the canvas, print and export (pure) */
import type { FurnitureItem } from './types';
import type { Lang, SizesPos } from './prefs';
import { catalogName } from './i18n';
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
  const own = item.label?.trim();
  if (own) return own;
  if (!showNames && item.textMode !== 'on') return '';
  const name = item.name ?? nameByPath.get(item.path);
  return name ? catalogName(lang, 'item', name) : '';
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
