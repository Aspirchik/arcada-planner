/** Cable connections: a cable end attached to a furniture item moves with it (pure) */
import type { Cable, CableLink, FloorState, FurnitureItem } from '../types';
import type { Pt } from './hit';

/** Items up to this size (cm, both sides) are "ports": cable ends snap to their centre */
export const PORT_MAX = 60;

export const isPort = (it: FurnitureItem) => Math.max(it.w, it.h) <= PORT_MAX;

/** Point in the item's own frame (before rotation), relative to its top-left corner */
function toLocal(it: FurnitureItem, p: Pt): Pt {
  const r = it.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - it.x, dy = p.y - it.y;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

/** Item under a point: the smallest one whose outline (plus `margin`) contains it */
export function itemAt(furniture: FurnitureItem[], p: Pt, margin = 1): FurnitureItem | null {
  let best: FurnitureItem | null = null;
  for (const it of furniture) {
    const l = toLocal(it, p);
    if (l.x < -margin || l.y < -margin || l.x > it.w + margin || l.y > it.h + margin) continue;
    if (!best || it.w * it.h < best.w * best.h) best = it;
  }
  return best;
}

/** Link of a point to an item: position as fractions of the item's width / depth */
export function linkTo(it: FurnitureItem, p: Pt): CableLink {
  const l = toLocal(it, p);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { id: it.id, u: r(l.x / it.w), v: r(l.y / it.h) };
}

/** World position of a link on its item */
export function linkPoint(it: FurnitureItem, link: CableLink): Pt {
  const lx = link.u * it.w, ly = link.v * it.h;
  const r = it.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  return { x: it.x + lx * cos - ly * sin, y: it.y + lx * sin + ly * cos };
}

const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/**
 * Links of a cable's ends after its points changed: an end that stayed on its linked spot keeps the link,
 * an end placed on an item gets linked to it, any other end is free.
 */
export function relink(c: Cable, furniture: FurnitureItem[]): Pick<Cable, 'fromLink' | 'toLink'> {
  const end = (p: Pt, old: CableLink | undefined): CableLink | undefined => {
    if (old) {
      const it = furniture.find(f => f.id === old.id);
      if (it && near(linkPoint(it, old), p)) return old;
    }
    const it = itemAt(furniture, p);
    return it ? linkTo(it, p) : undefined;
  };
  return { fromLink: end(c.points[0], c.fromLink), toLink: end(c.points[c.points.length - 1], c.toLink) };
}

/** Moves linked cable ends to their items; drops links to items that no longer exist. Returns the same floor if nothing changed. */
export function syncLinks(floor: FloorState): FloorState {
  let changed = false;
  const byId = new Map(floor.furniture.map(f => [f.id, f]));
  const cables = floor.cables.map(c => {
    if (!c.fromLink && !c.toLink) return c;
    let next = c;
    const fix = (which: 'fromLink' | 'toLink') => {
      const link = next[which];
      if (!link) return;
      const it = byId.get(link.id);
      const idx = which === 'fromLink' ? 0 : next.points.length - 1;
      if (!it) { next = { ...next, [which]: undefined }; return; }
      const p = linkPoint(it, link);
      if (near(p, next.points[idx])) return;
      next = { ...next, points: next.points.map((q, i) => (i === idx ? { ...q, x: p.x, y: p.y } : q)) };
    };
    fix('fromLink');
    fix('toLink');
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...floor, cables } : floor;
}
