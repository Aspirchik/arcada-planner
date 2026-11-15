/** Cable runs: coloured polylines with a label along the middle (editor and print) */
import { useMemo } from 'react';
import { Line, Group, Circle, Text, Rect } from 'react-konva';
import type { Cable, Tray } from '../types';
import type { Palette } from '../theme';
import type { Pt } from '../geometry/hit';
import { midAlong, cableLabel, layoutCables, placeCableLabels, cableJoints, jointSize, type Box } from '../geometry/cable';
import { DEFAULT_CABLE_WIDTH } from '../store';
import { mixHex } from '../color';
import { AlongText } from './WallsLayer';

const LABEL_SIZE = 11;

export function CableLine({ points, color, width = DEFAULT_CABLE_WIDTH, label, labelAt, palette, dashed = false, labelSize = LABEL_SIZE }: {
  points: Pt[]; color: string; width?: number; label?: string; labelAt?: { p: Pt; angle: number }; palette: Palette; dashed?: boolean; labelSize?: number;
}) {
  if (points.length < 2) return null;
  let at = labelAt;
  if (!at && label) {
    const mid = midAlong(points);
    const off = width / 2 + labelSize / 2 + 2;
    const rad = mid.angle * Math.PI / 180;
    const nx = -Math.sin(rad), ny = Math.cos(rad);
    const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
    at = { p: { x: mid.p.x + nx * off * side, y: mid.p.y + ny * off * side }, angle: mid.angle };
  }
  return (
    <Group>
      <Line points={points.flatMap(p => [p.x, p.y])} stroke={color} strokeWidth={width}
        lineCap="round" lineJoin="round" dash={dashed ? [width * 3, width * 2] : undefined} />
      {label && at && <AlongText p={at.p} angleDeg={at.angle} text={label} color={color} size={labelSize} halo={palette.paper} />}
    </Group>
  );
}

/** All cables: shared runs drawn side by side, labels placed so they don't cover each other */
export function CablesLayerContent({ cables, palette, unitM, avoid, highlight, labelSize = LABEL_SIZE, showLabels = true, groupOrder }: {
  cables: Cable[]; palette: Palette; unitM: string; avoid?: Box[];
  /** Cable groups in lane order (first = outer side of a bundle) */
  groupOrder?: number[];
  /** Letter height of the labels and whether they are shown (global wiring settings) */
  labelSize?: number; showLabels?: boolean;
  /** When set (hovering a tray), only these cables are shown at full strength */
  highlight?: Set<number>;
}) {
  const { paths, places, labels } = useMemo(() => {
    const paths = layoutCables(cables, groupOrder);
    const labels = new Map(showLabels ? cables.map(c => [c.id, cableLabel(c, unitM)] as [number, string]).filter(([, l]) => !!l) : []);
    const places = placeCableLabels(cables, paths, labels, labelSize, t => t.length * labelSize * 0.55, avoid);
    return { paths, places, labels };
  }, [cables, unitM, avoid, labelSize, showLabels, groupOrder]);
  return (
    <Group>
      {cables.map(c => (
        <Group key={c.id} opacity={highlight && !highlight.has(c.id) ? 0.15 : 1}>
          <CableLine points={paths.get(c.id) ?? c.points} color={c.color} width={c.width}
            label={labels.get(c.id)} labelAt={places.get(c.id)} palette={palette} labelSize={labelSize} />
          {cableJoints(c, paths.get(c.id) ?? c.points).map((j, i) => <CableJoint key={i} at={j} color={c.color} width={c.width} palette={palette} />)}
        </Group>
      ))}
    </Group>
  );
}

/** Connector: a sleeve across the cable, so a joined (extended) cable stands out */
export function CableJoint({ at, color, width = DEFAULT_CABLE_WIDTH, palette }: { at: { p: Pt; angle: number }; color: string; width?: number; palette: Palette }) {
  const s = jointSize(width);
  return (
    <Group x={at.p.x} y={at.p.y} rotation={at.angle}>
      <Rect x={-s.len / 2} y={-s.thick / 2} width={s.len} height={s.thick} cornerRadius={s.thick * 0.25}
        fill={palette.paper} stroke={color} strokeWidth={s.stroke} />
      <Line points={[0, -s.thick / 2, 0, s.thick / 2]} stroke={color} strokeWidth={s.stroke} />
    </Group>
  );
}

/** Vertex handles of the selected cable */
export function CableHandles({ cable, shown, palette, px, heights }: {
  cable: Pick<Cable, 'id' | 'points' | 'color'>; shown?: Pt[]; palette: Palette; px: number;
  /** Heights of the points (cm): each point gets its number and height in metres (bold = its own height) */
  heights?: number[] | null;
}) {
  const pts = cable.points as { x: number; y: number; z?: number }[];
  return (
    <Group>
      <Line points={(shown ?? cable.points).flatMap(p => [p.x, p.y])} stroke={palette.accent}
        strokeWidth={1.5 * px} dash={[6 * px, 3 * px]} />
      {cable.points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={5 * px} fill={palette.paper} stroke={palette.accent} strokeWidth={1.5 * px} />
      ))}
      {heights && pts.map((p, i) => (
        <Text key={`h${i}`} x={p.x + 7 * px} y={p.y - 16 * px} text={`${i + 1}: ${(heights[i] / 100).toFixed(2)}`}
          fontSize={11 * px} fill={palette.accent} stroke={palette.paper} strokeWidth={3 * px} fillAfterStrokeEnabled listening={false}
          fontStyle={p.z !== undefined ? 'bold' : 'normal'} />
      ))}
    </Group>
  );
}

/** Cable trays: a band with outlined edges, optional label */
export function TraysLayerContent({ trays, palette, highlightId, textSize = 10 }: { trays: Tray[]; palette: Palette; highlightId?: number; textSize?: number }) {
  return (
    <Group>
      {trays.map(t => {
        const pts = t.points.flatMap(p => [p.x, p.y]);
        const hl = t.id === highlightId;
        const edge = t.color ?? palette.trayStroke;
        const fill = t.color ? mixHex(t.color, palette.paper, 0.18) : palette.trayFill;
        return (
          <Group key={t.id}>
            <Line points={pts} stroke={hl ? palette.accent : edge} strokeWidth={t.width + 2} lineCap="butt" lineJoin="miter" />
            <Line points={pts} stroke={fill} strokeWidth={t.width} lineCap="butt" lineJoin="miter" />
            {t.label && (() => {
              const mid = midAlong(t.points);
              return <AlongText p={mid.p} angleDeg={mid.angle} text={t.label} color={edge} size={textSize} halo={palette.paper} />;
            })()}
          </Group>
        );
      })}
    </Group>
  );
}
