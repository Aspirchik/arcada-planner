/** Ceiling layer: suspended ceiling panels over the plan, with lamps, AC units, vents… in their panels */
import { memo } from 'react';
import { Group, Rect, Line, Circle, Shape, Text } from 'react-konva';
import type { CeilingGrid, CeilingMarkKind } from '../types';
import { ceilingEdges, shownMarks } from '../geometry/ceiling';

/** Colours of the ceiling layer (readable over light and dark plans) */
export const CEILING_COLOR = { light: '#6a4fc4', dark: '#a993ff' };
export const MARK_COLORS: Record<CeilingMarkKind, { fill: string; stroke: string }> = {
  lamp: { fill: '#ffd54f', stroke: '#e08e00' },
  ac: { fill: '#81d4fa', stroke: '#0277bd' },
  vent: { fill: '#a5d6a7', stroke: '#2e7d32' },
  cable: { fill: '#ffab91', stroke: '#d84315' },
  hatch: { fill: '#e0e0e0', stroke: '#616161' },
};

const fmt = (v: number) => String(Math.round(v * 10) / 10);

/** One mark drawn inside its panel */
export function CeilingMark({ kind, x, y, w, h, px }: { kind: CeilingMarkKind; x: number; y: number; w: number; h: number; px: number }) {
  const c = MARK_COLORS[kind];
  const s = Math.min(w, h);
  const cx = x + w / 2, cy = y + h / 2;
  const sw = 1.5 * px;
  if (kind === 'lamp') {
    const i = Math.min(4, s * 0.08);
    return (
      <Group>
        <Rect x={x + i} y={y + i} width={w - 2 * i} height={h - 2 * i} fill={c.fill} opacity={0.55} />
        <Rect x={x + i} y={y + i} width={w - 2 * i} height={h - 2 * i} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[x + i, y + i, x + w - i, y + h - i]} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[x + w - i, y + i, x + i, y + h - i]} stroke={c.stroke} strokeWidth={sw} />
      </Group>
    );
  }
  if (kind === 'ac') {
    const i = Math.min(5, s * 0.1), j = s * 0.3;
    return (
      <Group>
        <Rect x={x + i} y={y + i} width={w - 2 * i} height={h - 2 * i} fill={c.fill} opacity={0.55} />
        <Rect x={x + i} y={y + i} width={w - 2 * i} height={h - 2 * i} stroke={c.stroke} strokeWidth={sw} />
        <Rect x={cx - (w / 2 - j)} y={cy - (h / 2 - j)} width={w - 2 * j} height={h - 2 * j} stroke={c.stroke} strokeWidth={sw} />
        {/* four air outlets */}
        <Line points={[x + j, y + i * 2, x + w - j, y + i * 2]} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[x + j, y + h - i * 2, x + w - j, y + h - i * 2]} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[x + i * 2, y + j, x + i * 2, y + h - j]} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[x + w - i * 2, y + j, x + w - i * 2, y + h - j]} stroke={c.stroke} strokeWidth={sw} />
      </Group>
    );
  }
  if (kind === 'vent') {
    const r = s * 0.34;
    return (
      <Group>
        <Circle x={cx} y={cy} radius={r} fill={c.fill} opacity={0.6} />
        <Circle x={cx} y={cy} radius={r} stroke={c.stroke} strokeWidth={sw} />
        <Circle x={cx} y={cy} radius={r * 0.55} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[cx - r, cy, cx + r, cy]} stroke={c.stroke} strokeWidth={sw} />
        <Line points={[cx, cy - r, cx, cy + r]} stroke={c.stroke} strokeWidth={sw} />
      </Group>
    );
  }
  if (kind === 'cable') {
    const r = s * 0.14;
    return (
      <Group>
        <Circle x={cx} y={cy} radius={r} fill={c.fill} stroke={c.stroke} strokeWidth={sw} />
        <Circle x={cx} y={cy} radius={r * 0.35} fill={c.stroke} />
      </Group>
    );
  }
  const i = Math.min(6, s * 0.12);
  return (
    <Group>
      <Rect x={x + i} y={y + i} width={w - 2 * i} height={h - 2 * i} fill={c.fill} opacity={0.4} />
      <Rect x={x + i} y={y + i} width={w - 2 * i} height={h - 2 * i} stroke={c.stroke} strokeWidth={sw} dash={[5 * px, 3 * px]} />
    </Group>
  );
}

/** Sizes of the panels along the top and the left side: first, standard, last */
function SideSizes({ edges, along, at, color, bg, px }: { edges: number[]; along: 'x' | 'y'; at: number; color: string; bg: string; px: number }) {
  const n = edges.length - 1;
  const show = [...new Set(n > 2 ? [0, 1, n - 1] : [...Array(n).keys()])];
  const size = 10 * px;
  return (
    <>
      {show.map(i => {
        const mid = (edges[i] + edges[i + 1]) / 2;
        const text = fmt(edges[i + 1] - edges[i]);
        const w = text.length * size * 0.6;
        return along === 'x'
          ? <Text key={i} x={mid - w / 2} y={at - size - 3 * px} width={w} align="center" text={text} fontSize={size} fill={color}
              stroke={bg} strokeWidth={3 * px} fillAfterStrokeEnabled />
          : <Text key={i} x={at - w - 4 * px} y={mid - size / 2} width={w} align="right" text={text} fontSize={size} fill={color}
              stroke={bg} strokeWidth={3 * px} fillAfterStrokeEnabled />;
      })}
    </>
  );
}

function CeilingGridView({ g, selected, px, dark, bg, hover }: {
  g: CeilingGrid; selected: boolean; px: number; dark: boolean; bg: string; hover?: { c: number; r: number } | null;
}) {
  const color = dark ? CEILING_COLOR.dark : CEILING_COLOR.light;
  const { xs, ys } = ceilingEdges(g);
  const nx = xs.length - 1, ny = ys.length - 1;
  const edge = (x0: number, x1: number, y0: number, y1: number, k: string) =>
    <Rect key={k} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={color} opacity={0.08} />;
  return (
    <Group>
      {/* edge panels (cut to size) are tinted */}
      {edge(xs[0], xs[1], g.y, g.y + g.h, 'l')}
      {nx > 1 && edge(xs[nx - 1], xs[nx], g.y, g.y + g.h, 'r')}
      {edge(g.x, g.x + g.w, ys[0], ys[1], 't')}
      {ny > 1 && edge(g.x, g.x + g.w, ys[ny - 1], ys[ny], 'b')}
      {shownMarks(g).map(m => (
        <CeilingMark key={`${m.c},${m.r}`} kind={m.kind} x={xs[m.c]} y={ys[m.r]} w={xs[m.c + 1] - xs[m.c]} h={ys[m.r + 1] - ys[m.r]} px={px} />
      ))}
      <Shape perfectDrawEnabled={false} sceneFunc={ctx => {
        ctx.beginPath();
        for (let i = 1; i < nx; i++) { ctx.moveTo(xs[i], g.y); ctx.lineTo(xs[i], g.y + g.h); }
        for (let j = 1; j < ny; j++) { ctx.moveTo(g.x, ys[j]); ctx.lineTo(g.x + g.w, ys[j]); }
        ctx.strokeStyle = color;
        ctx.lineWidth = px;
        ctx.globalAlpha = 0.75;
        ctx.stroke();
      }} />
      <Rect x={g.x} y={g.y} width={g.w} height={g.h} stroke={color} strokeWidth={(selected ? 2.5 : 1.5) * px}
        dash={selected ? [8 * px, 4 * px] : undefined} />
      {hover && hover.c < nx && hover.r < ny && (
        <Rect x={xs[hover.c]} y={ys[hover.r]} width={xs[hover.c + 1] - xs[hover.c]} height={ys[hover.r + 1] - ys[hover.r]}
          stroke={color} strokeWidth={2.5 * px} />
      )}
      <SideSizes edges={xs} along="x" at={g.y} color={color} bg={bg} px={px} />
      <SideSizes edges={ys} along="y" at={g.x} color={color} bg={bg} px={px} />
    </Group>
  );
}

export const CeilingLayerContent = memo(function CeilingLayerContent({ grids, selectedId, px, dark, bg, hover }: {
  grids: CeilingGrid[]; selectedId?: number | null; px: number; dark: boolean; bg: string;
  /** Panel under the pointer with the Ceiling tool */
  hover?: { id: number; c: number; r: number } | null;
}) {
  return (
    <Group>
      {grids.map(g => (
        <CeilingGridView key={g.id} g={g} selected={g.id === selectedId} px={px} dark={dark} bg={bg} hover={hover?.id === g.id ? hover : null} />
      ))}
    </Group>
  );
});
