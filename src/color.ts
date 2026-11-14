/** Colour helpers (pure) */

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

function rgb(h: string): number[] {
  let x = h.slice(1);
  if (x.length === 3) x = x.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
}

/** Mixes a #rrggbb colour towards `to` (amount = how much of the original stays) */
export function mixHex(hex: string, to: string, amount: number): string {
  if (!HEX.test(hex) || !HEX.test(to)) return hex;
  const a = rgb(hex), b = rgb(to);
  return '#' + a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, '0')).join('');
}

/** Whether a colour is a grey (no hue), so it can be recoloured without losing meaning */
export function isGrey(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) <= 48;
}

/** Brightness 0…1 of a #rrggbb colour */
export function lightness(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (r + g + b) / 765;
}

/** Sprite cache / export key of an item: the picture plus its colour */
export const spriteKey = (it: { path: string; color?: string }) => (it.color ? `${it.path}|${it.color}` : it.path);
