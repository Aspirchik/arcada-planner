/** Ruler measurements (dimension lines), shared by the editor and the print view */
import { Arrow, Line, Group, Circle } from 'react-konva';
import type { Dimension } from '../types';
import type { Palette } from '../theme';
import { AlongText, formatMeters } from './WallsLayer';

/**
 * One dimension line with arrows, end ticks and its length.
 * `px` = world units per screen pixel (1 / zoom), so the line looks the same at any zoom.
 */
export function DimensionLine({ d, palette, unit, px, preview = false }: {
  d: Pick<Dimension, 'x1' | 'y1' | 'x2' | 'y2'>;
  palette: Palette;
  unit: string;
  px: number;
  preview?: boolean;
}) {
  const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  if (len < 0.5) return null;
  const ux = (d.x2 - d.x1) / len, uy = (d.y2 - d.y1) / len;
  const nx = -uy, ny = ux;
  const tick = 6 * px;
  const color = preview ? palette.accent : palette.dimension;
  const angle = Math.atan2(uy, ux) * 180 / Math.PI;
  // Label sits on the side of the normal that points "up" on screen, so it is never under the line
  const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
  const off = 11 * px;
  const mid = { x: (d.x1 + d.x2) / 2 + nx * off * side, y: (d.y1 + d.y2) / 2 + ny * off * side };
  const arrow = Math.min(8 * px, len / 3);

  return (
    <Group>
      <Arrow points={[d.x1, d.y1, d.x2, d.y2]} stroke={color} fill={color}
        strokeWidth={1.3 * px} pointerLength={arrow} pointerWidth={arrow * 0.75}
        pointerAtBeginning pointerAtEnding dash={preview ? [6 * px, 4 * px] : undefined} />
      <Line points={[d.x1 - nx * tick, d.y1 - ny * tick, d.x1 + nx * tick, d.y1 + ny * tick]} stroke={color} strokeWidth={1.3 * px} />
      <Line points={[d.x2 - nx * tick, d.y2 - ny * tick, d.x2 + nx * tick, d.y2 + ny * tick]} stroke={color} strokeWidth={1.3 * px} />
      <AlongText p={mid} angleDeg={angle} text={formatMeters(len, unit)} color={color} size={12 * px} halo={palette.paper} />
    </Group>
  );
}

export function DimensionsLayerContent({ dims, palette, unit, px }: { dims: Dimension[]; palette: Palette; unit: string; px: number }) {
  return (
    <Group>
      {dims.map(d => <DimensionLine key={d.id} d={d} palette={palette} unit={unit} px={px} />)}
    </Group>
  );
}

/** Ring showing where the ruler end will snap */
export function SnapMarker({ x, y, palette, px }: { x: number; y: number; palette: Palette; px: number }) {
  return <Circle x={x} y={y} radius={5 * px} stroke={palette.accent} strokeWidth={1.5 * px} />;
}
