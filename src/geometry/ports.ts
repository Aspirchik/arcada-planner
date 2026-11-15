/**
 * Ports across cables (pure): what is at the other end of a cable plugged into a port, and the tag (VLAN…)
 * a port gets through its cables — a socket port fed from switch port 3 tagged "VLAN 10" is on VLAN 10.
 */
import type { Cable } from '../types';

/** Item and port at the other end of a cable end; for the end of a continuation — the start of its chain */
export function otherEnd(c: Cable, end: 'from' | 'to', byId: Map<number, Cable>): { id: number; port?: number } | undefined {
  if (end === 'from') return c.toLink ? { id: c.toLink.id, port: c.toPort } : undefined;
  let r = c;
  const seen = new Set([c.id]);
  while (r.parent !== undefined) {
    const up = byId.get(r.parent);
    if (!up || seen.has(up.id)) break;
    seen.add(up.id);
    r = up;
  }
  return r.fromLink ? { id: r.fromLink.id, port: r.fromPort } : undefined;
}

/**
 * Tag a port gets through its cables: the own tag of the port at the other end of a cable plugged into it
 * (or, further on, that port's tag through its other cables). `exclude` skips one cable (the one being named).
 */
export function derivedTag(
  itemId: number, port: number, cables: Cable[], tagOf: (id: number, port: number) => string,
  exclude?: number, depth = 4,
): string {
  const byId = new Map(cables.map(c => [c.id, c]));
  for (const c of cables) {
    if (c.id === exclude) continue;
    const end = c.toLink?.id === itemId && c.toPort === port ? 'to' : c.fromLink?.id === itemId && c.fromPort === port ? 'from' : null;
    if (!end) continue;
    const o = otherEnd(c, end, byId);
    if (!o?.port) continue;
    const own = tagOf(o.id, o.port);
    if (own) return own;
    if (depth > 1) {
      const d = derivedTag(o.id, o.port, cables, tagOf, c.id, depth - 1);
      if (d) return d;
    }
  }
  return '';
}
