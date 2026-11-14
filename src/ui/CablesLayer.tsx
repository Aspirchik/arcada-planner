/** Cable runs: coloured polylines with a label along the middle (editor and print) */
import { useMemo } from 'react';
import { Line, Group, Circle } from 'react-konva';
import type { Cable, Tray } from '../types';
import type { Palette } from '../theme';
import type { Pt } from '../geometry/hit';
import { midAlong, cableLabel, layoutCables, placeCableLabels, type Box } from '../geometry/cable';
import { DEFAULT_CABLE_WIDTH } from '../store';
import { AlongText } from './WallsLayer';

const LABEL_SIZE = 11;

export function CableLine({ points, color, width = DEFAULT_CABLE_WIDTH, label, labelAt, palette, dashed = false }: {
  points: Pt[]; color: string; width?: number; label?: string; labelAt?: { p: Pt; angle: number }; palette: Palette; dashed?: boolean;
}) {
  if (points.length < 2) return null;
  let at = labelAt;
  if (!at && label) {
    const mid = midAlong(points);
    const off = width / 2 + LABEL_SIZE / 2 + 2;
    const rad = mid.angle * Math.PI / 180;
    const nx = -Math.sin(rad), ny = Math.cos(rad);
    const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
    at = { p: { x: mid.p.x + nx * off * side, y: mid.p.y + ny * off * side }, angle: mid.angle };
  }
  return (
    <Group>
      <Line points={points.flatMap(p => [p.x, p.y])} stroke={color} strokeWidth={width}
        lineCap="round" lineJoin="round" dash={dashed ? [width * 3, width * 2] : undefined} />
      {label && at && <AlongText p={at.p} angleDeg={at.angle} text={label} color={color} size={LABEL_SIZE} halo={palette.paper} />}
    </Group>
  );
}

/** All cables: shared runs drawn side by side, labels placed so they don't cover each other */
export function CablesLayerContent({ cables, palette, unitM, avoid, highlight }: {
  cables: Cable[]; palette: Palette; unitM: string; avoid?: Box[];
  /** When set (hovering a tray), only these cables are shown at full strength */
  highlight?: Set<number>;
}) {
  const { paths, places, labels } = useMemo(() => {
    const paths = layoutCables(cables);
    const labels = new Map(cables.map(c => [c.id, cableLabel(c, unitM)] as [number, string]).filter(([, l]) => !!l));
    const places = placeCableLabels(cables, paths, labels, LABEL_SIZE, t => t.length * LABEL_SIZE * 0.55, avoid);
    return { paths, places, labels };
  }, [cables, unitM, avoid]);
  return (
    <Group>
      {cables.map(c => (
        <Group key={c.id} opacity={highlight && !highlight.has(c.id) ? 0.15 : 1}>
          <CableLine points={paths.get(c.id) ?? c.points} color={c.color} width={c.width}
            label={labels.get(c.id)} labelAt={places.get(c.id)} palette={palette} />
        </Group>
      ))}
    </Group>
  );
}

/** Vertex handles of the selected cable */
export function CableHandles({ cable, shown, palette, px }: { cable: Pick<Cable, 'id' | 'points' | 'color'>; shown?: Pt[]; palette: Palette; px: number }) {
  return (
    <Group>
      <Line points={(shown ?? cable.points).flatMap(p => [p.x, p.y])} stroke={palette.accent}
        strokeWidth={1.5 * px} dash={[6 * px, 3 * px]} />
      {cable.points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={5 * px} fill={palette.paper} stroke={palette.accent} strokeWidth={1.5 * px} />
      ))}
    </Group>
  );
}

/** Cable trays: a band with outlined edges, optional label */
export function TraysLayerContent({ trays, palette, highlightId }: { trays: Tray[]; palette: Palette; highlightId?: number }) {
  return (
    <Group>
      {trays.map(t => {
        const pts = t.points.flatMap(p => [p.x, p.y]);
        const hl = t.id === highlightId;
        return (
          <Group key={t.id}>
            <Line points={pts} stroke={hl ? palette.accent : palette.trayStroke} strokeWidth={t.width + 2} lineCap="butt" lineJoin="miter" />
            <Line points={pts} stroke={palette.trayFill} strokeWidth={t.width} lineCap="butt" lineJoin="miter" />
            {t.label && (() => {
              const mid = midAlong(t.points);
              return <AlongText p={mid.p} angleDeg={mid.angle} text={t.label} color={palette.trayStroke} size={Math.min(10, t.width * 0.8)} />;
            })()}
          </Group>
        );
      })}
    </Group>
  );
}
