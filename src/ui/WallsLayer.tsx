import { memo } from 'react';
/** Wall drawing shared by the editor and the print view: mitred outlines + length labels */
import { Line, Text, Group } from 'react-konva';
import type { FloorWallGeom, WallGeom } from '../geometry/walls';
import type { WallLabelMode } from '../prefs';
import type { Palette } from '../theme';
import type { Pt } from '../geometry/hit';
import { formatMeters, wallLabelSpecs, LABEL_SIZE } from '../geometry/wallLabels';

export { formatMeters, wallLabelSpecs };


const flat = (pts: Pt[]) => pts.flatMap(p => [p.x, p.y]);


/** Text centred on point p, rotated along the wall but never upside down */
function AlongText({ p, angleDeg, text, color, size = LABEL_SIZE, halo }: { p: Pt; angleDeg: number; text: string; color: string; size?: number; halo?: string }) {
  let a = angleDeg;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  const W = 200;
  return (
    <Text x={p.x} y={p.y} rotation={a} text={text} fontSize={size} fill={color}
      width={W * size / LABEL_SIZE} align="center" offsetX={W * size / LABEL_SIZE / 2} offsetY={size / 2}
      {...(halo ? { stroke: halo, strokeWidth: size / 4, fillAfterStrokeEnabled: true, lineJoin: 'round' as const } : {})} />
  );
}

function WallLabels({ g, mode, unit, color }: { g: WallGeom; mode: WallLabelMode; unit: string; color: string }) {
  return (
    <>
      {wallLabelSpecs(g, mode).map((l, i) => (
        <AlongText key={i} p={l.p} angleDeg={l.angle} text={formatMeters(l.length, unit)} color={color} />
      ))}
    </>
  );
}

function WallsLayerContentImpl({ geom, palette, labels, unit }: {
  geom: FloorWallGeom;
  palette: Palette;
  labels: WallLabelMode;
  unit: string;
}) {
  return (
    <Group>
      {/* Fills; a thin stroke in the fill colour hides anti-aliasing seams between pieces */}
      {geom.walls.map(g => (
        <Line key={`f${g.wall.id}`} points={flat(g.polygon)} closed
          fill={g.wall.exterior ? palette.wallExterior : palette.wallInterior}
          stroke={g.wall.exterior ? palette.wallExterior : palette.wallInterior} strokeWidth={0.6} />
      ))}
      {geom.hubs.map((h, i) => (
        <Line key={`h${i}`} points={flat(h.polygon)} closed
          fill={h.exterior ? palette.wallExterior : palette.wallInterior}
          stroke={h.exterior ? palette.wallExterior : palette.wallInterior} strokeWidth={0.6} />
      ))}
      {/* Outlines: both faces + square ends */}
      {geom.walls.map(g => (
        <Group key={`o${g.wall.id}`}>
          <Line points={flat([g.left.a, g.left.b])} stroke={palette.wallStroke} strokeWidth={1} />
          <Line points={flat([g.right.a, g.right.b])} stroke={palette.wallStroke} strokeWidth={1} />
          {g.freeA && <Line points={flat([g.left.a, g.right.a])} stroke={palette.wallStroke} strokeWidth={1} />}
          {g.freeB && <Line points={flat([g.left.b, g.right.b])} stroke={palette.wallStroke} strokeWidth={1} />}
        </Group>
      ))}
      {geom.walls.map(g => (
        <WallLabels key={`l${g.wall.id}`} g={g} mode={labels} unit={unit} color={palette.wallLabel} />
      ))}
    </Group>
  );
}

export { AlongText };

// Redrawn only when their own props change (not on every pan / zoom frame)
export const WallsLayerContent = memo(WallsLayerContentImpl);
