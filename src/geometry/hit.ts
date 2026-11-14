export interface Pt { x: number; y: number }

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function pointInRotatedRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number, rotDeg: number): boolean {
  const rad = -rotDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - rx;
  const dy = py - ry;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return localX >= 0 && localX <= rw && localY >= 0 && localY <= rh;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

/** Corners of a rect rotated around its origin (x, y), in order: top-left, top-right, bottom-right, bottom-left */
export function rectCorners(x: number, y: number, w: number, h: number, rotDeg: number): Pt[] {
  const rad = rotDeg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return [
    { x, y },
    { x: x + w * cos, y: y + w * sin },
    { x: x + w * cos - h * sin, y: y + w * sin + h * cos },
    { x: x - h * sin, y: y + h * cos },
  ];
}
