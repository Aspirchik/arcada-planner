import { mixHex, isGrey, lightness } from '../color';

/**
 * Furniture sprite loading with a shared cache.
 * In the dark theme the SVG source is recoloured (light lines on a dark fill)
 * and loaded from a blob URL, so sprites stay vector-sharp at any zoom.
 */

export function spriteUrl(path: string): string {
  return `${import.meta.env.BASE_URL}assets/2d/${path}.svg`;
}

const cache = new Map<string, HTMLImageElement>();
const failed = new Set<string>();
const loading = new Map<string, Array<() => void>>();

// Dark variant: white → dark fill, black → light lines; greys in between keep their order reversed
const DARK_LO = 0x2c;
const DARK_HI = 0xe0;

function darkChannel(v: number): number {
  return Math.round(DARK_LO + (255 - v) * (DARK_HI - DARK_LO) / 255);
}

function hex2(n: number) { return n.toString(16).padStart(2, '0'); }

function darkHex(hex: string): string {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // Only greys are inverted; real colours (e.g. a red emergency socket) keep their meaning
  if (Math.max(r, g, b) - Math.min(r, g, b) > 48) return hex;
  return '#' + hex2(darkChannel(r)) + hex2(darkChannel(g)) + hex2(darkChannel(b));
}

/** Replaces every colour of an SVG document (hex, white, black) through `map` */
function recolor(svg: string, map: (hex: string) => string): string {
  // Unstyled shapes default to black fill: make that explicit on the root so it gets recoloured too
  let out = svg.replace(/<svg\b([^>]*)>/i, (m, attrs: string) => (/\sfill\s*=/.test(attrs) ? m : `<svg${attrs} fill="#000000">`));
  // Colours only — not element references such as href="#id" or url(#id)
  out = out.replace(/(?<!href=["'])(?<!url\()#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_-])/gi, m => map(m));
  out = out.replace(/(["':\s])(white|black)(?=[\s"';}])/gi, (_m, pre: string, name: string) => pre + map(name.toLowerCase() === 'white' ? '#ffffff' : '#000000'));
  return out;
}

/** Embedded raster pictures can't be recoloured by text: invert them with a filter (white → ~#2b, black → ~#d4) */
const invertImages = (svg: string) => (/<image\b/i.test(svg) ? svg.replace(/<\/svg>\s*$/i, '<style>image{filter:invert(0.83)}</style></svg>') : svg);

/** Recolours an SVG document for the dark theme */
export function darkSvg(svg: string): string {
  return invertImages(recolor(svg, darkHex));
}

/**
 * Paints a sprite in the object colour: dark lines become the colour, white fills a light tint of it
 * (a dark tint in the dark theme). Real colours (e.g. a red emergency socket) stay as they are.
 */
export function colorSvg(svg: string, color: string, dark: boolean): string {
  const fill = mixHex(color, dark ? '#2c2c2c' : '#ffffff', 0.14);
  const out = recolor(svg, hex => (isGrey(hex) ? mixHex(color, fill, 1 - lightness(hex)) : hex));
  return dark ? invertImages(out) : out;
}

/** Greys that mark the second half of a two-part sprite (double socket): lines and fill */
const HALF2 = new Set(['#010101', '#fefefe']);

/**
 * Sprite source for the theme and object colour. `color` may be "c1/c2": the second half of a two-part sprite
 * (drawn with the marker greys) gets c2, the rest c1 (or stays as drawn when c1 is empty).
 */
export function spriteSvg(svg: string, dark: boolean, color?: string): string {
  if (color?.includes('/')) {
    const [c1, c2] = color.split('/');
    const paint = (hex: string, c: string) => {
      if (!isGrey(hex)) return hex;
      const fill = mixHex(c, dark ? '#2c2c2c' : '#ffffff', 0.14);
      return mixHex(c, fill, 1 - lightness(hex));
    };
    const out = recolor(svg, hex => (HALF2.has(hex.toLowerCase()) ? paint(hex, c2) : c1 ? paint(hex, c1) : dark ? darkHex(hex) : hex));
    return dark ? invertImages(out) : out;
  }
  return color ? colorSvg(svg, color, dark) : dark ? darkSvg(svg) : svg;
}

async function loadRecolored(src: string, dark: boolean, color?: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(String(res.status));
  const text = spriteSvg(await res.text(), dark, color);
  return URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
}

/**
 * Returns the loaded image, or null while loading / if it failed (callers draw a placeholder).
 * `onLoad` is called once the image becomes available.
 */
export function getSprite(path: string, dark: boolean, onLoad: () => void, color?: string): HTMLImageElement | null {
  const src = spriteUrl(path);
  const key = (dark ? 'dark:' : 'light:') + src + (color ? '|' + color : '');
  const hit = cache.get(key);
  if (hit) return hit;
  if (failed.has(key)) return null;

  const waiting = loading.get(key);
  if (waiting) { waiting.push(onLoad); return null; }
  loading.set(key, [onLoad]);

  const finish = (img: HTMLImageElement | null) => {
    if (img) cache.set(key, img); else failed.add(key);
    const cbs = loading.get(key) ?? [];
    loading.delete(key);
    cbs.forEach(cb => cb());
  };
  const start = (url: string) => {
    const el = new window.Image();
    el.onload = () => finish(el);
    el.onerror = () => finish(null);
    el.src = url;
  };
  if (dark || color) loadRecolored(src, dark, color).then(start, () => finish(null));
  else start(src);
  return null;
}

/** Whether the sprite has finished loading (successfully or not) */
export function spriteSettled(path: string, dark: boolean, color?: string): boolean {
  const key = (dark ? 'dark:' : 'light:') + spriteUrl(path) + (color ? '|' + color : '');
  return cache.has(key) || failed.has(key);
}
