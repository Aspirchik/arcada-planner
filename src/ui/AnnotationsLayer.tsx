/** Furniture labels and free text notes, shared by the editor and the print view */
import { Text, Group, Rect } from 'react-konva';
import type { FurnitureItem, TextNote, LabelPos } from '../types';
import type { Palette } from '../theme';
import type { Lang, SizesPos } from '../prefs';
import { catalogName } from '../i18n';
import catalog from '../catalog.json';

export const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const TEXT_LINE_HEIGHT = 1.2;

let measureCtx: CanvasRenderingContext2D | null = null;

/** Size of a text note in world units (unrotated) */
export function measureNote(note: Pick<TextNote, 'text' | 'size' | 'bold'>): { w: number; h: number } {
  const lines = (note.text || ' ').split('\n');
  if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  let w = 0;
  if (measureCtx) {
    measureCtx.font = `${note.bold ? 'bold ' : ''}${note.size}px ${TEXT_FONT}`;
    for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  } else {
    w = Math.max(...lines.map(l => l.length)) * note.size * 0.6;
  }
  return { w: Math.max(w, note.size * 0.5), h: lines.length * note.size * TEXT_LINE_HEIGHT };
}

/** English catalog name for items saved before names were stored */
const nameByPath = new Map<string, string>();
for (const c of catalog.categories) for (const it of c.items) if (!nameByPath.has(it.imagePath)) nameByPath.set(it.imagePath, it.name);

export function furnitureLabel(item: FurnitureItem, showNames: boolean, lang: Lang): string {
  const own = item.label?.trim();
  if (own) return own;
  if (!showNames) return '';
  const name = item.name ?? nameByPath.get(item.path);
  return name ? catalogName(lang, 'item', name) : '';
}

const MIRROR: Record<LabelPos, LabelPos> = { c: 'c', t: 'b', b: 't', l: 'r', r: 'l', tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
const H_ALIGN = (p: LabelPos) => (p === 'l' || p === 'tl' || p === 'bl' ? 'left' : p === 'r' || p === 'tr' || p === 'br' ? 'right' : 'center');
const V_ALIGN = (p: LabelPos) => (p === 't' || p === 'tl' || p === 'tr' ? 'top' : p === 'b' || p === 'bl' || p === 'br' ? 'bottom' : 'middle');

/**
 * Labels and sizes drawn inside each item, in the item's own frame (they turn with it).
 * Items turned upside down get their text flipped back, keeping the chosen visual position.
 */
export function FurnitureLabels({ furniture, palette, showNames, lang, sizesPos = 'off' }: {
  furniture: FurnitureItem[];
  palette: Palette;
  showNames: boolean;
  lang: Lang;
  sizesPos?: SizesPos;
}) {
  return (
    <Group>
      {furniture.map(item => {
        const text = furnitureLabel(item, showNames, lang);
        if (!text && sizesPos === 'off') return null;
        const rot = ((item.rot % 360) + 360) % 360;
        const flip = rot > 90 && rot <= 270;
        const pos = (p: LabelPos) => (flip ? MIRROR[p] : p);
        const pad = Math.min(4, item.w * 0.05, item.h * 0.05);
        const boxW = Math.max(1, item.w - pad * 2), boxH = Math.max(1, item.h - pad * 2);

        let size = item.labelSize;
        if (!size && text) {
          // Fit the label inside the item where possible (long names get smaller), within readable limits
          const perUnit = measureNote({ text, size: 10, bold: !!item.labelBold }).w / 10;
          size = Math.max(7, Math.min(14, Math.min(item.w, item.h) * 0.3, (item.w * 0.92) / Math.max(perUnit, 0.01)));
        }
        const sizeFont = Math.max(6, Math.min(11, Math.min(item.w, item.h) * 0.16));
        const labelPos = item.labelPos ?? 'c';

        return (
          <Group key={item.id} x={item.x} y={item.y} rotation={item.rot}>
            <Group x={flip ? item.w : 0} y={flip ? item.h : 0} rotation={flip ? 180 : 0}>
              {text && (
                <Text x={pad} y={pad} width={boxW} height={boxH} text={text} wrap="word"
                  fontSize={size} fontFamily={TEXT_FONT} fontStyle={item.labelBold ? 'bold' : 'normal'}
                  align={H_ALIGN(pos(labelPos))} verticalAlign={V_ALIGN(pos(labelPos))}
                  fill={item.labelColor ?? palette.text} stroke={palette.textHalo} strokeWidth={(size ?? 10) / 4}
                  fillAfterStrokeEnabled lineJoin="round" />
              )}
              {sizesPos !== 'off' && (
                <Text x={pad} y={pad} width={boxW} height={boxH}
                  text={`${Math.round(item.w)}×${Math.round(item.h)}`}
                  fontSize={sizeFont} fontFamily={TEXT_FONT}
                  align={H_ALIGN(pos(sizesPos))} verticalAlign={V_ALIGN(pos(sizesPos))}
                  fill={palette.wallLabel} stroke={palette.textHalo} strokeWidth={sizeFont / 4}
                  fillAfterStrokeEnabled lineJoin="round" />
              )}
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}

/** Dashed outline around an item that is part of a multi-selection */
export function ItemOutline({ x, y, w, h, rot, palette, px }: { x: number; y: number; w: number; h: number; rot: number; palette: Palette; px: number }) {
  return (
    <Group x={x} y={y} rotation={rot}>
      <Rect x={-2 * px} y={-2 * px} width={w + 4 * px} height={h + 4 * px}
        stroke={palette.accent} strokeWidth={1.5 * px} dash={[6 * px, 3 * px]} />
    </Group>
  );
}

export function TextNotes({ texts, palette, hideId }: { texts: TextNote[]; palette: Palette; hideId?: number | null }) {
  return (
    <Group>
      {texts.map(n => n.id === hideId ? null : (
        <Text key={n.id} x={n.x} y={n.y} rotation={n.rot} text={n.text} fontSize={n.size}
          fontFamily={TEXT_FONT} fontStyle={n.bold ? 'bold' : 'normal'} lineHeight={TEXT_LINE_HEIGHT}
          fill={n.color ?? palette.text} />
      ))}
    </Group>
  );
}

/** Dashed outline around the selected text note */
export function TextSelection({ note, palette, px }: { note: TextNote; palette: Palette; px: number }) {
  const { w, h } = measureNote(note);
  const pad = 3 * px;
  return (
    <Group x={note.x} y={note.y} rotation={note.rot}>
      <Rect x={-pad} y={-pad} width={w + pad * 2} height={h + pad * 2}
        stroke={palette.accent} strokeWidth={1.5 * px} dash={[6 * px, 3 * px]} />
    </Group>
  );
}
