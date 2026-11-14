/** Wall drawing shared by the editor and the print view: mitred outlines + length labels */
import { Line, Text, Group } from 'react-konva';
import type { FloorWallGeom, WallGeom, WallFace } from '../geometry/walls';
import type { WallLabelMode } from '../prefs';
import type { Palette } from '../theme';
import type { Pt } from '../geometry/hit';
import { METER } from '../constants';

const LABEL_SIZE = 11;
const LABEL_GAP = 4;
const MIN_LABEL_LEN = 30;

const flat = (pts: Pt[]) => pts.flatMap(p => [p.x, p.y]);

export function formatMeters(len: number, unit: string): string {
  return `${Math.max(0, len / METER).toFixed(2)} ${unit}`;
}

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

function faceLabel(g: WallGeom, face: WallFace, side: 1 | -1, unit: string, color: string) {
  if (face.length < MIN_LABEL_LEN) return null;
  const off = LABEL_GAP + LABEL_SIZE / 2;
  const mid = { x: (face.a.x + face.b.x) / 2 + g.normal.x * off * side, y: (face.a.y + face.b.y) / 2 + g.normal.y * off * side };
  const angle = Math.atan2(g.dir.y, g.dir.x) * 180 / Math.PI;
  return <AlongText p={mid} angleDeg={angle} text={formatMeters(face.length, unit)} color={color} />;
}

function WallLabels({ g, mode, unit, color }: { g: WallGeom; mode: WallLabelMode; unit: string; color: string }) {
  if (mode === 'off') return null;
  if (mode === 'axis') {
    if (g.length < MIN_LABEL_LEN) return null;
    const off = g.thickness / 2 + LABEL_GAP + LABEL_SIZE / 2;
    const mid = { x: (g.a.x + g.b.x) / 2 + g.normal.x * off, y: (g.a.y + g.b.y) / 2 + g.normal.y * off };
    return <AlongText p={mid} angleDeg={Math.atan2(g.dir.y, g.dir.x) * 180 / Math.PI} text={formatMeters(g.length, unit)} color={color} />;
  }
  let showLeft: boolean, showRight: boolean;
  if (mode === 'both' || (!g.left.room && !g.right.room)) {
    // Not part of a room yet (e.g. while drawing): show both faces, once if they are equal
    showLeft = true;
    showRight = Math.abs(g.left.length - g.right.length) >= 0.5;
  } else {
    showLeft = g.left.room;
    showRight = g.right.room;
  }
  return (
    <>
      {showLeft && faceLabel(g, g.left, 1, unit, color)}
      {showRight && faceLabel(g, g.right, -1, unit, color)}
    </>
  );
}

export function WallsLayerContent({ geom, palette, labels, unit }: {
  geom: FloorWallGeom;
  palette: Palette;
  labels: WallLabelMode;
  unit: string;
}) {
  return (
    <Group>
      {/* Fills (no stroke, so joints stay clean) */}
      {geom.walls.map(g => (
        <Line key={`f${g.wall.id}`} points={flat(g.polygon)} closed
          fill={g.wall.exterior ? palette.wallExterior : palette.wallInterior} strokeEnabled={false} />
      ))}
      {geom.hubs.map((h, i) => (
        <Line key={`h${i}`} points={flat(h.polygon)} closed
          fill={h.exterior ? palette.wallExterior : palette.wallInterior} strokeEnabled={false} />
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
