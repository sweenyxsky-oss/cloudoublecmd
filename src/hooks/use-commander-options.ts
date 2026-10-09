import { useEffect, useState } from 'react';

const optionsKey = 'cloudoublecmd.options';

export type CommandKey = 'View' | 'Edit' | 'Copy' | 'Move' | 'New Folder' | 'Delete';
export type CommanderOptions = {
  // Layout
  showToolbar: boolean; showDrives: boolean; showTabs: boolean; showCenterToolbar: boolean; showCommandLine: boolean; showFunctionKeys: boolean; showStatusBar: boolean;
  // Display
  showHidden: boolean; foldersFirst: boolean; sizeFormat: 'bytes' | 'dynamic' | 'kilobytes'; dateFormat: 'iso' | 'local'; squareBrackets: boolean;
  // Colors and fonts
  fontSize: 'small' | 'normal' | 'large'; rowHeight: 'compact' | 'normal' | 'roomy'; markColor: 'red' | 'blue' | 'green'; cursorStyle: 'filled' | 'frame';
  // Columns
  columns: { ext: boolean; size: boolean; date: boolean; attr: boolean };
  // Tabs
  restoreTabs: boolean; tabsOnTop: boolean; openTabNextToCurrent: boolean; confirmCloseAllTabs: boolean;
  // Operations
  confirmDelete: boolean; confirmCopy: boolean; transferDialog: boolean; selectFoldersWithGroup: boolean;
  // Quick search and keys
  quickSearch: 'letters' | 'alt-letters' | 'off'; quickSearchMatch: 'start' | 'anywhere'; keys: Record<CommandKey, string>;
  // Viewer and editor
  viewerWrap: boolean; viewerMonospace: boolean; enterOpensFile: 'viewer' | 'editor'; tabSize: number;
};

export const defaultOptions: CommanderOptions = {
  showToolbar: true, showDrives: true, showTabs: false, showCenterToolbar: true, showCommandLine: true, showFunctionKeys: true, showStatusBar: true,
  showHidden: true, foldersFirst: true, sizeFormat: 'bytes', dateFormat: 'iso', squareBrackets: true,
  fontSize: 'normal', rowHeight: 'compact', markColor: 'red', cursorStyle: 'filled',
  columns: { ext: true, size: true, date: true, attr: true },
  restoreTabs: false, tabsOnTop: true, openTabNextToCurrent: false, confirmCloseAllTabs: true,
  confirmDelete: true, confirmCopy: true, transferDialog: true, selectFoldersWithGroup: false,
  quickSearch: 'letters', quickSearchMatch: 'start', keys: { View: 'F3', Edit: 'F4', Copy: 'F5', Move: 'F6', 'New Folder': 'F7', Delete: 'F8' },
  viewerWrap: true, viewerMonospace: true, enterOpensFile: 'viewer', tabSize: 4,
};

/** Merges only known keys with matching types, so stale or tampered storage cannot break the app. */
export function sanitizeOptions(raw: unknown): CommanderOptions {
  const result: CommanderOptions = { ...defaultOptions, columns: { ...defaultOptions.columns }, keys: { ...defaultOptions.keys } };
  if (!raw || typeof raw !== 'object') return result;
  const input = raw as Record<string, unknown>;
  const target = result as unknown as Record<string, unknown>;
  for (const key of Object.keys(defaultOptions) as (keyof CommanderOptions)[]) {
    const value = input[key]; const fallback = defaultOptions[key];
    if (key === 'columns' || key === 'keys') {
      if (value && typeof value === 'object') for (const sub of Object.keys(fallback)) {
        const item = (value as Record<string, unknown>)[sub];
        if (typeof item === typeof (fallback as Record<string, unknown>)[sub] && (key !== 'keys' || /^(?:(?:Ctrl|Alt|Shift)\+)*(?:F\d{1,2}|[A-Z0-9])$/.test(String(item)))) (target[key] as Record<string, unknown>)[sub] = item;
      }
    } else if (typeof value === typeof fallback && (typeof value !== 'number' || (Number.isInteger(value) && value >= 1 && value <= 8))) target[key] = value;
  }
  return result;
}

export function keyName(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey'>) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return `${event.ctrlKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${key}`;
}

export function useCommanderOptions() {
  const [options, setState] = useState<CommanderOptions>(defaultOptions);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(optionsKey);
      if (stored) {
        const raw = JSON.parse(stored);
        const next = sanitizeOptions(raw);
        if (raw?.driveBarVersion !== 1) next.showDrives = true;
        setState(next);
        window.localStorage.setItem(optionsKey, JSON.stringify({ ...next, driveBarVersion: 1 }));
      }
    } catch { /* Defaults stay active. */ }
  }, []);
  function setOptions(next: CommanderOptions) {
    setState(next);
    try { window.localStorage.setItem(optionsKey, JSON.stringify({ ...next, driveBarVersion: 1 })); } catch { /* Kept for this session. */ }
  }
  const update = <K extends keyof CommanderOptions>(key: K, value: CommanderOptions[K]) => setOptions({ ...options, [key]: value });
  return { options, setOptions, update };
}
