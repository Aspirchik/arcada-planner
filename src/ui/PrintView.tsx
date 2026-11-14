import { Stage, Layer, Rect, Line, Text, Image as KImage, Circle, Group } from 'react-konva';
import { useStore } from '../store';
import { WALL_THICKNESS } from '../constants';
import { sortByZ } from '../helpers';
import { computeWallGeometry } from '../geometry/walls';
import { usePrefs } from '../prefs';
import { LIGHT } from '../theme';
import { WallsLayerContent } from './WallsLayer';
import { getSprite, spriteSettled } from './images';
import { DimensionsLayerContent } from './DimensionsLayer';
import { CablesLayerContent, TraysLayerContent } from './CablesLayer';
import { layerPasses, styleCables, type LayerView } from '../layers';
import { spriteKey } from '../color';
import { itemNamer } from '../labels';
import { labelObstacles } from '../geometry/cable';
import { FurnitureLabels, TextNotes, SimpleFurniture, measureNote } from './AnnotationsLayer';
import { useT } from '../i18n';
import type { FloorState } from '../types';
import { useEffect, useMemo, useState } from 'react';

const PAGE_W = 794;  // A4 at 96dpi
const PAGE_H = 1123;
const PAD = 60;

/** True once every sprite on the floor has loaded (or failed — those print as grey boxes) */
function useFloorImages(floor: FloorState): boolean {
  const [, bump] = useState(0);
  const items = [...new Map(floor.furniture.filter(f => !f.simple).map(f => [spriteKey(f), f] as const)).values()];
  for (const f of items) getSprite(f.path, false, () => bump(c => c + 1), f.color);
  return items.every(f => spriteSettled(f.path, false, f.color));
}

function floorBounds(floor: FloorState): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (floor.nodes.length === 0 && floor.furniture.length === 0 && floor.dimensions.length === 0 && floor.texts.length === 0 && floor.cables.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const n of floor.nodes) {
    minX = Math.min(minX, n.x - WALL_THICKNESS);
    minY = Math.min(minY, n.y - WALL_THICKNESS);
    maxX = Math.max(maxX, n.x + WALL_THICKNESS);
    maxY = Math.max(maxY, n.y + WALL_THICKNESS);
  }

  for (const f of floor.furniture) {
    const rad = f.rot * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const corners = [
      { x: f.x, y: f.y },
      { x: f.x + f.w * cos, y: f.y + f.w * sin },
      { x: f.x - f.h * sin, y: f.y + f.h * cos },
      { x: f.x + f.w * cos - f.h * sin, y: f.y + f.w * sin + f.h * cos },
    ];
    for (const c of corners) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y);
    }
  }

  for (const n of floor.texts) {
    const { w, h } = measureNote(n);
    const r = Math.hypot(w, h);
    minX = Math.min(minX, n.x - r); minY = Math.min(minY, n.y - r);
    maxX = Math.max(maxX, n.x + r); maxY = Math.max(maxY, n.y + r);
  }

  for (const c of floor.cables) for (const p of c.points) {
    minX = Math.min(minX, p.x - 20); minY = Math.min(minY, p.y - 20);
    maxX = Math.max(maxX, p.x + 20); maxY = Math.max(maxY, p.y + 20);
  }

  const DIM_MARGIN = 30; // room for the dimension label
  for (const d of floor.dimensions) {
    minX = Math.min(minX, d.x1 - DIM_MARGIN, d.x2 - DIM_MARGIN); minY = Math.min(minY, d.y1 - DIM_MARGIN, d.y2 - DIM_MARGIN);
    maxX = Math.max(maxX, d.x1 + DIM_MARGIN, d.x2 + DIM_MARGIN); maxY = Math.max(maxY, d.y1 + DIM_MARGIN, d.y2 + DIM_MARGIN);
  }

  return { minX, minY, maxX, maxY };
}

function PrintFloor({ floor, index }: { floor: FloorState; index: number }) {
  const ready = useFloorImages(floor);
  const bounds = floorBounds(floor);
  const wallLabels = usePrefs(s => s.wallLabels);
  const showNames = usePrefs(s => s.showNames);
  const lang = usePrefs(s => s.lang);
  const sizesPos = usePrefs(s => s.sizesPos);
  const t = useT();
  const geom = useMemo(() => computeWallGeometry(floor.nodes, floor.walls), [floor.nodes, floor.walls]);
  const wiring = useStore(s => s.mode) === 'wiring';
  const ws = useStore(s => s.wiring);
  const commonGroups = useStore(s => s.commonGroups);
  const groupOrder = [...floor.groups, ...commonGroups].map(g => g.id);

  if (!bounds) {
    return (
      <div className="print-page">
        <h2>{t('floor.title', { n: index })}</h2>
        <p style={{ color: '#999' }}>{t('floor.empty')}</p>
      </div>
    );
  }

  const passes = layerPasses(floor, wiring ? 'wiring' : 'plan');
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const drawW = PAGE_W - PAD * 2;
  const drawH = PAGE_H - PAD * 2 - 40; // 40px for title
  const scaleVal = Math.min(drawW / contentW, drawH / contentH, 1);
  const offsetX = PAD + (drawW - contentW * scaleVal) / 2 - bounds.minX * scaleVal;
  const offsetY = PAD + 40 + (drawH - contentH * scaleVal) / 2 - bounds.minY * scaleVal;

  const layerContent = (v: LayerView) => (
    <Group>
      {ready && sortByZ(v.furniture).map(f => {
        if (f.simple) return <SimpleFurniture key={f.id} item={f} palette={LIGHT} />;
        const img = getSprite(f.path, false, () => {}, f.color);
        return (
          <Group key={f.id} x={f.x} y={f.y} rotation={f.rot}>
            {img ? <KImage image={img} width={f.w} height={f.h}
              x={f.flipX ? f.w : 0} y={f.flipY ? f.h : 0} scaleX={f.flipX ? -1 : 1} scaleY={f.flipY ? -1 : 1} /> : <Rect width={f.w} height={f.h} fill="#eee" stroke="#ccc" strokeWidth={1} />}
          </Group>
        );
      })}
      <CablesLayerContent cables={styleCables(v.cables, ws, itemNamer(floor.furniture, lang))} palette={LIGHT} unitM={t('unit.m')} avoid={labelObstacles(geom, wallLabels, floor.furniture)}
        labelSize={ws.cableText} showLabels={ws.cableLabels} groupOrder={groupOrder} />
      {ready && <FurnitureLabels furniture={v.furniture} palette={LIGHT} showNames={showNames} lang={lang} sizesPos={sizesPos} />}
      <TextNotes texts={v.texts} palette={LIGHT} />
      <DimensionsLayerContent dims={v.dimensions} palette={LIGHT} unit={t('unit.m')} px={1 / scaleVal} />
    </Group>
  );


  return (
    <div className="print-page">
      <h2 style={{ textAlign: 'center', fontSize: 16, fontWeight: 600, padding: '12px 0 4px', margin: 0 }}>
        {t('floor.title', { n: index })}
      </h2>
      <Stage width={PAGE_W} height={PAGE_H - 40} x={offsetX} y={offsetY - 40} scaleX={scaleVal} scaleY={scaleVal}>
        <Layer listening={false}>
          {/* Walls and the main plan (print is always light; dimmed when printing in Wiring mode), then the wiring layer */}
          <Group opacity={passes.dim ? ws.planDim / 100 : 1}>
            <WallsLayerContent geom={geom} palette={LIGHT} labels={wallLabels} unit={t('unit.m')} />
            <TraysLayerContent trays={passes.main.trays} palette={LIGHT} textSize={ws.trayText} />
          </Group>
          {/* All trays before any furniture: sockets often sit in a tray */}
          {passes.wiring && <TraysLayerContent trays={passes.wiring.trays} palette={LIGHT} textSize={ws.trayText} />}
          <Group opacity={passes.dim ? ws.planDim / 100 : 1}>{layerContent(passes.main)}</Group>
          {passes.wiring && layerContent(passes.wiring)}
        </Layer>
      </Stage>
    </div>
  );
}

export function PrintView() {
  const floors = useStore(s => s.floors);

  return (
    <div className="print-view">
      {floors.map((floor, i) => (
        <PrintFloor key={i} floor={floor} index={i} />
      ))}
    </div>
  );
}
