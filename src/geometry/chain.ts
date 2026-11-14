/**
 * Cable chains: a cable continued from a point of another one (`parent`) is part of the same run.
 * The chain is labelled once — from the start through every consumer in order along the run. (pure)
 */
import type { Cable } from '../types';
import { pathLength, projectOnPath } from './cable';

export { projectOnPath };

/** Root of every cable's chain (a cable without a known parent is its own root; cycles are cut) */
export function chainRoots(cables: Cable[]): Map<number, number> {
  const byId = new Map(cables.map(c => [c.id, c]));
  const roots = new Map<number, number>();
  for (const c of cables) {
    let cur = c;
    const seen = new Set<number>([c.id]);
    while (cur.parent !== undefined) {
      const up = byId.get(cur.parent);
      if (!up || seen.has(up.id)) break;
      seen.add(up.id);
      cur = up;
    }
    roots.set(c.id, cur.id);
  }
  return roots;
}

/** Ids of every cable in the same chain as `id` */
export function chainMembers(cables: Cable[], id: number): number[] {
  const roots = chainRoots(cables);
  const r = roots.get(id);
  return r === undefined ? [id] : cables.filter(c => roots.get(c.id) === r).map(c => c.id);
}

/** Cable `id` and all cables continued from it (directly or further down) */
export function subtree(cables: Cable[], id: number): Set<number> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of cables) if (c.parent !== undefined && out.has(c.parent) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}

export interface ChainInfo {
  /** Members, root first */
  members: number[];
  /** Start, then every consumer in order along the run */
  stops: string[];
  /** Total length of all members, cm */
  length: number;
}

/**
 * Chains of several cables, keyed by root id. Stop names: `from` / `to` of the cables,
 * or (when empty) `nameOf` the item the end is connected to.
 */
export function chainInfos(cables: Cable[], nameOf?: (id: number) => string | undefined): Map<number, ChainInfo> {
  const roots = chainRoots(cables);
  const children = new Map<number, Cable[]>();
  for (const c of cables) {
    if (c.parent === undefined || roots.get(c.id) === c.id) continue;
    const list = children.get(c.parent) ?? [];
    list.push(c);
    children.set(c.parent, list);
  }
  const out = new Map<number, ChainInfo>();
  for (const root of cables) {
    if (roots.get(root.id) !== root.id || !children.has(root.id)) continue;
    const members: number[] = [];
    const ends: { d: number; name: string }[] = [];
    let length = 0;
    // Walk down from the root: each member starts at its offset along the run
    const walk = (c: Cable, start: number) => {
      members.push(c.id);
      const len = pathLength(c.points);
      length += len;
      const name = (c.to || (c.toLink && nameOf?.(c.toLink.id)) || '').trim();
      if (name) ends.push({ d: start + len, name });
      for (const k of children.get(c.id) ?? []) walk(k, start + projectOnPath(c.points, k.points[0]).along);
    };
    walk(root, 0);
    ends.sort((a, b) => a.d - b.d);
    const from = (root.from || (root.fromLink && nameOf?.(root.fromLink.id)) || '').trim();
    out.set(root.id, { members, stops: [from, ...ends.map(e => e.name)], length });
  }
  return out;
}

/**
 * Cables to list for a set of hit cables: one entry per chain (its first cable, which carries the chain
 * route and length), plus the ids of every cable of those chains (for highlighting).
 */
export function collapseToChains(hits: Cable[], all: Cable[]): { shown: Cable[]; ids: Set<number> } {
  const roots = chainRoots(all);
  const byId = new Map(all.map(c => [c.id, c]));
  const rootIds = [...new Set(hits.map(c => roots.get(c.id) ?? c.id))];
  const ids = new Set(all.filter(c => rootIds.includes(roots.get(c.id) ?? c.id)).map(c => c.id));
  return { shown: rootIds.map(r => byId.get(r)!).filter(Boolean), ids };
}

/** "A → B → C" of a chain (an empty start shows as "→ B → C") */
export function chainRoute(info: ChainInfo): string {
  const [from, ...rest] = info.stops;
  if (rest.length === 0) return from;
  return (from ? from + ' → ' : '→ ') + rest.join(' → ');
}
