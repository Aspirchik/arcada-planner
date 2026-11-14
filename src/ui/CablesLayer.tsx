/** Cable runs: coloured polylines with a label along the middle (editor and print) */
import { Line, Group, Circle } from 'react-konva';
import type { Cable } from '../types';
import type { Palette } from '../theme';
import type { Pt } from '../geometry/hit';
import { midAlong, cableLabel } from '../geometry/cable';
import { DEFAULT_CABLE_WIDTH } from '../store';
import { AlongText } from './WallsLayer';

const LABEL_SIZE = 11;

export function CableLine({ points, color, width = DEFAULT_CABLE_WIDTH, label, palette, dashed = false }: {
  points: Pt[]; color: string; width?: number; label?: string; palette: Palette; dashed?: boolean;
}) {
  if (points.length < 2) return null;
  const mid = midAlong(points);
  const off = width / 2 + LABEL_SIZE / 2 + 2;
  // Put the label beside the line, on the side that is "up" on screen
  const rad = mid.angle * Math.PI / 180;
  const nx = -Math.sin(rad), ny = Math.cos(rad);
  const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
  return (
    <Group>
      <Line points={points.flatMap(p => [p.x, p.y])} stroke={color} strokeWidth={width}
        lineCap="round" lineJoin="round" dash={dashed ? [width * 3, width * 2] : undefined} />
      {label && <AlongText p={{ x: mid.p.x + nx * off * side, y: mid.p.y + ny * off * side }} angleDeg={mid.angle}
        text={label} color={color} size={LABEL_SIZE} halo={palette.paper} />}
    </Group>
  );
}

export function CablesLayerContent({ cables, palette, unitM }: { cables: Cable[]; palette: Palette; unitM: string }) {
  return (
    <Group>
      {cables.map(c => (
        <CableLine key={c.id} points={c.points} color={c.color} width={c.width} label={cableLabel(c, unitM)} palette={palette} />
      ))}
    </Group>
  );
}

/** Vertex handles of the selected cable */
export function CableHandles({ cable, palette, px }: { cable: Cable; palette: Palette; px: number }) {
  return (
    <Group>
      <Line points={cable.points.flatMap(p => [p.x, p.y])} stroke={palette.accent}
        strokeWidth={1.5 * px} dash={[6 * px, 3 * px]} />
      {cable.points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={5 * px} fill={palette.paper} stroke={palette.accent} strokeWidth={1.5 * px} />
      ))}
    </Group>
  );
}
