/** Furniture labels and free text notes, shared by the editor and the print view */
import { Text, Group, Rect } from 'react-konva';
import type { FurnitureItem, TextNote } from '../types';
import type { Palette } from '../theme';
import type { Lang } from '../prefs';
import { catalogName } from '../i18n';
import { localToWorld } from '../helpers';
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

export function FurnitureLabels({ furniture, palette, showNames, lang }: {
  furniture: FurnitureItem[];
  palette: Palette;
  showNames: boolean;
  lang: Lang;
}) {
  return (
    <Group>
      {furniture.map(item => {
        const text = furnitureLabel(item, showNames, lang);
        if (!text) return null;
        const c = localToWorld(item.w / 2, item.h / 2, item.x, item.y, item.rot);
        // Fit the label inside the item where possible (long names get smaller), within readable limits
        const probe = measureNote({ text, size: 10, bold: false }).w / 10; // width per 1 unit of font size
        const size = Math.max(7, Math.min(14, Math.min(item.w, item.h) * 0.3, (item.w * 0.92) / Math.max(probe, 0.01)));
        const W = 400;
        return (
          <Text key={item.id} x={c.x} y={c.y} text={text} fontSize={size} fontFamily={TEXT_FONT}
            fill={palette.text} stroke={palette.textHalo} strokeWidth={size / 4} fillAfterStrokeEnabled lineJoin="round"
            width={W} align="center" offsetX={W / 2} offsetY={size / 2} />
        );
      })}
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
