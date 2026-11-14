/** User interface preferences, remembered in this browser (not part of the project file) */
import { create } from 'zustand';

export type Lang = 'en' | 'pl' | 'ru' | 'ua';
export type ThemePref = 'light' | 'dark' | 'system';
/** Which wall lengths to show: off, inner faces (room side), both faces, centerline */
export type WallLabelMode = 'off' | 'interior' | 'both' | 'axis';

export const LANGS: Lang[] = ['en', 'pl', 'ru', 'ua'];
const PREFS_KEY = 'arcada-prefs';

interface Prefs {
  lang: Lang;
  theme: ThemePref;
  wallLabels: WallLabelMode;
  /** Show catalog names on furniture that has no custom label */
  showNames: boolean;
  /** Show clearance to nearby obstacles for the selected item */
  gaps: boolean;
  /** Clearances smaller than this (cm) are highlighted */
  gapWarn: number;
}

interface PrefsStore extends Prefs {
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
}

function detectLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  if (l.startsWith('ru')) return 'ru';
  if (l.startsWith('uk')) return 'ua';
  if (l.startsWith('pl')) return 'pl';
  return 'en';
}

const defaults: Prefs = {
  lang: detectLang(),
  theme: 'system',
  wallLabels: 'interior',
  showNames: false,
  gaps: true,
  gapWarn: 60,
};

function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      lang: LANGS.includes(p.lang as Lang) ? p.lang as Lang : defaults.lang,
      theme: p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? p.theme : defaults.theme,
      wallLabels: ['off', 'interior', 'both', 'axis'].includes(p.wallLabels as string) ? p.wallLabels as WallLabelMode : defaults.wallLabels,
      showNames: typeof p.showNames === 'boolean' ? p.showNames : defaults.showNames,
      gaps: typeof p.gaps === 'boolean' ? p.gaps : defaults.gaps,
      gapWarn: typeof p.gapWarn === 'number' && p.gapWarn >= 0 ? p.gapWarn : defaults.gapWarn,
    };
  } catch {
    return defaults;
  }
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...loadPrefs(),
  set(key, value) {
    set({ [key]: value } as Partial<Prefs>);
    const { set: _omit, ...prefs } = get();
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  },
}));
