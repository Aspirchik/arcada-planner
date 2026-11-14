/** Free space around the selected item: distance to the nearest wall / furniture on each side */
import { useMemo } from 'react';
import { Line, Group } from 'react-konva';
import type { FurnitureItem } from '../types';
import type { FloorWallGeom } from '../geometry/walls';
import { obstacleSegments, itemGaps } from '../geometry/raycast';
import type { Palette } from '../theme';
import { DEFAULT_Z } from '../store';
import { AlongText } from './WallsLayer';

export function GapsLayerContent({ item, furniture, geom, palette, px, warnBelow, unit }: {
  item: FurnitureItem;
  furniture: FurnitureItem[];
  geom: FloorWallGeom;
  palette: Palette;
  /** World units per screen pixel */
  px: number;
  /** Gaps narrower than this (cm) are highlighted */
  warnBelow: number;
  unit: string;
}) {
  const gaps = useMemo(() => {
    // Rugs and mats (lower layers) don't block anything
    const others = furniture.filter(f => f.id !== item.id && f.zi >= DEFAULT_Z);
    return itemGaps(item, obstacleSegments(geom, others));
  }, [item, furniture, geom]);

  return (
    <Group>
      {gaps.filter(g => g.distance >= 0.5).map((g, i) => {
        const color = g.distance < warnBelow ? palette.gapWarn : palette.gap;
        const ux = (g.to.x - g.from.x) / g.distance, uy = (g.to.y - g.from.y) / g.distance;
        const nx = -uy, ny = ux;
        const tick = 4 * px;
        const angle = Math.atan2(uy, ux) * 180 / Math.PI;
        const label = `${Math.round(g.distance)} ${unit}`;
        // Narrow gap: the label doesn't fit along the line, so move it to the side
        const fits = g.distance / px > label.length * 11 * 0.6 + 16;
        const side = fits ? 0 : 12 * px;
        const mid = { x: (g.from.x + g.to.x) / 2 + nx * side, y: (g.from.y + g.to.y) / 2 + ny * side };
        return (
          <Group key={i}>
            <Line points={[g.from.x, g.from.y, g.to.x, g.to.y]} stroke={color} strokeWidth={1.2 * px} dash={[4 * px, 3 * px]} />
            <Line points={[g.to.x - nx * tick, g.to.y - ny * tick, g.to.x + nx * tick, g.to.y + ny * tick]} stroke={color} strokeWidth={1.5 * px} />
            <AlongText p={mid} angleDeg={angle} text={label} color={color} size={11 * px} halo={palette.paper} />
          </Group>
        );
      })}
    </Group>
  );
}
