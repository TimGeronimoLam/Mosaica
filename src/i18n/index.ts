import { useSyncExternalStore } from 'react';
import { en, type Messages } from './en';
import { de } from './de';

export type { Messages };
export type Lang = 'en' | 'de';

export const LANGS: { value: Lang; label: string; name: string }[] = [
  { value: 'en', label: 'EN', name: 'English' },
  { value: 'de', label: 'DE', name: 'Deutsch' },
];

const CATALOG: Record<Lang, Messages> = { en, de };
const KEY = 'mosaica.lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'de') return saved;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let current: Lang = typeof window === 'undefined' ? 'en' : initial();
const listeners = new Set<() => void>();

function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.title = CATALOG[current].appTitle;
}
apply();

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  apply();
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return current;
}

/** Messages in the current language, for code outside React (errors, progress reports). */
export function tr(): Messages {
  return CATALOG[current];
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The current language and its messages; re-renders when the language changes. */
export function useI18n(): { lang: Lang; t: Messages; setLang: (l: Lang) => void } {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, t: CATALOG[lang], setLang };
}

export function useT(): Messages {
  return useI18n().t;
}
