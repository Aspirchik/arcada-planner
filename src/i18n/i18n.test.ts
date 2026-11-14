import { describe, it, expect } from 'vitest';
import en from './en.json';
import pl from './pl.json';
import ru from './ru.json';
import ua from './ua.json';
import catalog from '../catalog.json';
import { translate } from './index';

const files = { pl, ru, ua } as Record<string, Record<string, string>>;

describe('language files', () => {
  it('every language has exactly the same keys as English', () => {
    const keys = Object.keys(en).sort();
    for (const [name, d] of Object.entries(files)) expect(Object.keys(d).sort(), name).toEqual(keys);
  });

  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [key, value] of Object.entries(en))
      for (const [name, d] of Object.entries(files)) expect(ph(d[key]), `${name}:${key}`).toBe(ph(value));
  });

  it('every catalog category and item has a translation', () => {
    const e = en as Record<string, string>;
    for (const c of catalog.categories) {
      expect(e[`cat.${c.name}`], c.name).toBeDefined();
      for (const it of c.items) expect(e[`item.${it.name}`], it.name).toBeDefined();
    }
  });

  it('fills placeholders and falls back to the key', () => {
    expect(translate('ru', 'floor.title', { n: 2 })).toBe('Этаж 2');
    expect(translate('pl', 'no.such.key')).toBe('no.such.key');
  });
});
