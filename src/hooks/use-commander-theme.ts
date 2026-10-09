import { useEffect, useState } from 'react';

const themeKey = 'cloudoublecmd.theme';
export type CommanderTheme = 'light' | 'dark';

/** Local appearance preference only; file data never lives in browser storage. */
export function useCommanderTheme() {
  const [theme, setThemeState] = useState<CommanderTheme>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(themeKey);
      if (stored === 'light' || stored === 'dark') setThemeState(stored);
    } catch {
      // Appearance still works when browser storage is unavailable.
    }
    const sync = (event: StorageEvent) => {
      if (event.key !== themeKey) return;
      if (event.newValue === 'light' || event.newValue === 'dark') setThemeState(event.newValue);
      else if (event.newValue === null) setThemeState('light');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function setTheme(next: CommanderTheme) {
    setThemeState(next);
    try {
      window.localStorage.setItem(themeKey, next);
    } catch {
      // The selected theme remains available for this session.
    }
  }

  return { theme, setTheme };
}