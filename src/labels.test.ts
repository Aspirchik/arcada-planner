import { describe, it, expect } from 'vitest';
import { furnitureLabel, sizesCorner } from './labels';
import type { FurnitureItem } from './types';

const base: FurnitureItem = { id: 1, path: 'couch', x: 0, y: 0, w: 240, h: 100, rot: 0, zi: 100, name: 'Couch' };

describe('text inside items', () => {
  it('global: own label always, catalog name only when Names is on', () => {
    expect(furnitureLabel(base, false, 'en')).toBe('');
    expect(furnitureLabel(base, true, 'ru')).toBe('Диван');
    expect(furnitureLabel({ ...base, label: 'User 3' }, false, 'en')).toBe('User 3');
  });

  it('on: name shown even when Names is off; off: nothing, even a label', () => {
    expect(furnitureLabel({ ...base, textMode: 'on' }, false, 'pl')).toBe('Sofa');
    expect(furnitureLabel({ ...base, textMode: 'off', label: 'User 3' }, true, 'en')).toBe('');
  });
});

describe('size inside items', () => {
  it('global follows the toolbar, on forces a corner, off hides', () => {
    expect(sizesCorner(base, 'off')).toBe('off');
    expect(sizesCorner(base, 'tl')).toBe('tl');
    expect(sizesCorner({ ...base, sizeMode: 'on' }, 'off')).toBe('br');
    expect(sizesCorner({ ...base, sizeMode: 'on' }, 'tr')).toBe('tr');
    expect(sizesCorner({ ...base, sizeMode: 'off' }, 'tr')).toBe('off');
  });
});
