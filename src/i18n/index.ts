/**
 * Translations. Language files: en.json, pl.json, ru.json, ua.json — flat "key": "text" maps.
 * Placeholders look like {name}. Missing keys fall back to English, then to the key itself.
 */
import { useCallback } from 'react';
import { usePrefs, type Lang } from '../prefs';
import en from './en.json';
import pl from './pl.json';
import ru from './ru.json';
import ua from './ua.json';

export type TKey = keyof typeof en;
type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = { en, pl, ru, ua };

export const LANG_NAMES: Record<Lang, string> = { en: 'EN', pl: 'PL', ru: 'RU', ua: 'UA' };
/** Value for the <html lang> attribute */
export const HTML_LANG: Record<Lang, string> = { en: 'en', pl: 'pl', ru: 'ru', ua: 'uk' };

export type TParams = Record<string, string | number>;
export type TFunc = (key: TKey, params?: TParams) => string;

export function translate(lang: Lang, key: string, params?: TParams): string {
  const s = dicts[lang][key] ?? (dicts.en as Dict)[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}

/** Translate outside React components (alerts, confirms) using the current language */
export function t(key: TKey, params?: TParams): string {
  return translate(usePrefs.getState().lang, key, params);
}

/** Hook: re-renders the component when the language changes */
export function useT(): TFunc {
  const lang = usePrefs(s => s.lang);
  return useCallback((key: TKey, params?: TParams) => translate(lang, key, params), [lang]);
}

/** Translated catalog category / item name (falls back to the English catalog name) */
export function catalogName(lang: Lang, kind: 'cat' | 'item', name: string): string {
  return dicts[lang][`${kind}.${name}`] ?? (dicts.en as Dict)[`${kind}.${name}`] ?? name;
}
