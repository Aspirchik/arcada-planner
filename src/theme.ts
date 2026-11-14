/** Canvas colours (Konva can't read CSS variables). UI colours live in App.css. */
import { useEffect, useState } from 'react';
import { usePrefs } from './prefs';

export interface Palette {
  dark: boolean;
  paper: string;
  outside: string;
  gridMinor: string;
  gridMajor: string;
  wallExterior: string;
  wallInterior: string;
  wallStroke: string;
  wallLabel: string;
  node: string;
  nodeStroke: string;
  accent: string;
  placeholderFill: string;
  placeholderStroke: string;
  text: string;
  textHalo: string;
  dimension: string;
  gap: string;
  gapWarn: string;
  trayFill: string;
  trayStroke: string;
}

export const LIGHT: Palette = {
  dark: false,
  paper: '#ffffff',
  outside: '#ebebeb',
  gridMinor: '#ebebeb',
  gridMajor: '#d0d0d0',
  wallExterior: '#b8a89a',
  wallInterior: '#d4c4b8',
  wallStroke: '#1a1a1a',
  wallLabel: '#555555',
  node: '#444444',
  nodeStroke: '#222222',
  accent: '#1a73e8',
  placeholderFill: '#f0f0f0',
  placeholderStroke: '#cccccc',
  text: '#222222',
  textHalo: '#ffffff',
  dimension: '#d0021b',
  gap: '#1a73e8',
  gapWarn: '#e8710a',
  trayFill: '#e6ebf2',
  trayStroke: '#7a8594',
};

export const DARK: Palette = {
  dark: true,
  paper: '#1f2124',
  outside: '#141517',
  gridMinor: '#2a2c30',
  gridMajor: '#3a3d42',
  wallExterior: '#6b6159',
  wallInterior: '#524b45',
  wallStroke: '#c8c8c8',
  wallLabel: '#b0b3b8',
  node: '#9aa0a6',
  nodeStroke: '#dadce0',
  accent: '#8ab4f8',
  placeholderFill: '#2d2f33',
  placeholderStroke: '#55585e',
  text: '#e8eaed',
  textHalo: '#1f2124',
  dimension: '#ff6b6b',
  gap: '#8ab4f8',
  gapWarn: '#fbbc04',
  trayFill: '#2c333d',
  trayStroke: '#8a96a8',
};

function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Resolved dark/light state; follows the OS setting when the preference is "system" */
export function useIsDark(): boolean {
  const pref = usePrefs(s => s.theme);
  const [sys, setSys] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const fn = () => setSys(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return pref === 'dark' || (pref === 'system' && sys);
}

export function usePalette(): Palette {
  return useIsDark() ? DARK : LIGHT;
}
