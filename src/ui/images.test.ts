import { describe, it, expect } from 'vitest';
import { darkSvg } from './images';

describe('darkSvg', () => {
  it('turns white fill dark and black lines light, keeping other content', () => {
    const src = '<svg viewBox="0 0 10 10"><style>.s0 { fill: #ffffff;stroke: #000000 }</style><path class="s0" fill="white" stroke="#000" d="M0 0"/><use href="#abc"/></svg>';
    const out = darkSvg(src);
    expect(out).toContain('fill: #2c2c2c');
    expect(out).toContain('stroke: #e0e0e0');
    expect(out).toContain('fill="#2c2c2c"');
    expect(out).toContain('stroke="#e0e0e0"');
    expect(out).toContain('href="#abc"');
  });

  it('keeps real colours (only greys are inverted)', () => {
    expect(darkSvg('<svg fill="none"><path fill="#d0021b" stroke="#888888"/></svg>')).toContain('fill="#d0021b"');
  });

  it('adds a recoloured default fill to the root element', () => {
    expect(darkSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toContain('<svg viewBox="0 0 1 1" fill="#e0e0e0">');
    expect(darkSvg('<svg fill="none"><path/></svg>')).toContain('<svg fill="none">');
  });

  it('inverts embedded raster images with a filter', () => {
    expect(darkSvg('<svg><image href="data:x"/></svg>')).toContain('<style>image{filter:invert(0.83)}</style></svg>');
    expect(darkSvg('<svg><path/></svg>')).not.toContain('filter');
  });
});
