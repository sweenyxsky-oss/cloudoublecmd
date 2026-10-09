import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { defaultOptions, keyName, type CommandKey, type CommanderOptions } from '@/hooks/use-commander-options';
import type { CommanderTheme } from '@/hooks/use-commander-theme';

const pages = ['Layout', 'Display', 'Colors and fonts', 'Columns', 'Tabs', 'Operations', 'Quick search and keys', 'Viewer and editor'] as const;
type Page = typeof pages[number];

type Props = { open: boolean; close: () => void; dark: boolean; options: CommanderOptions; save: (next: CommanderOptions) => void; theme: CommanderTheme; setTheme: (theme: CommanderTheme) => void };

export function OptionsDialog({ open, close, dark, options, save, theme, setTheme }: Props) {
  const [page, setPage] = useState<Page>('Layout');
  const [draft, setDraft] = useState(options);
  const [draftTheme, setDraftTheme] = useState(theme);
  const [recording, setRecording] = useState<CommandKey | null>(null);
  useEffect(() => { if (open) { setDraft(options); setDraftTheme(theme); setRecording(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof CommanderOptions>(key: K, value: CommanderOptions[K]) => setDraft(old => ({ ...old, [key]: value }));
  const check = (key: keyof CommanderOptions, label: string) => <label className="option-row"><input type="checkbox" checked={draft[key] as boolean} onChange={event => set(key, event.target.checked as never)} />{label}</label>;
  function choice<K extends keyof CommanderOptions>(key: K, label: string, values: [CommanderOptions[K], string][]) {
    return <label className="option-row option-select">{label}<select value={String(draft[key])} onChange={event => set(key, values.find(([value]) => String(value) === event.target.value)![0])}>{values.map(([value, text]) => <option key={String(value)} value={String(value)}>{text}</option>)}</select></label>;
  }
  const apply = () => { save(draft); setTheme(draftTheme); };
  const duplicateKeys = Object.values(draft.keys).filter((key, index, all) => all.indexOf(key) !== index);

  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent className={`${dark ? 'dark' : ''} bg-background text-foreground options-dialog`}>
    <DialogHeader><DialogTitle>Options</DialogTitle><DialogDescription>Saved in this browser. Windows-only settings are not included.</DialogDescription></DialogHeader>
    <div className="options-body">
      <nav className="options-pages" aria-label="Options pages">{pages.map(item => <Button key={item} variant="ghost" className={`options-page ${page === item ? 'current' : ''}`} aria-current={page === item} onClick={() => setPage(item)}>{item}</Button>)}</nav>
      <section className="options-panel" aria-label={page}>
        <h3>{page}</h3>
        {page === 'Layout' && <>{check('showToolbar', 'Button bar')}{check('showDrives', 'Drive button bar')}{check('showTabs', 'Folder tabs')}{check('showCenterToolbar', 'Vertical button bar between panels')}{check('showCommandLine', 'Command line')}{check('showFunctionKeys', 'Function key buttons')}{check('showStatusBar', 'Status bar')}</>}
        {page === 'Display' && <>{check('showHidden', 'Show hidden files (starting with a dot)')}{check('foldersFirst', 'Always show folders first')}{check('squareBrackets', 'Show folder names in [brackets]')}{choice('sizeFormat', 'File sizes', [['bytes', 'Bytes (1 234 567)'], ['dynamic', 'Dynamic (1.2 MB)'], ['kilobytes', 'Kilobytes (1 206 k)']])}{choice('dateFormat', 'Date format', [['iso', '2026-10-09 14:30'], ['local', 'Browser local format']])}</>}
        {page === 'Colors and fonts' && <><label className="option-row option-select">Theme<select value={draftTheme} onChange={event => setDraftTheme(event.target.value as CommanderTheme)}><option value="light">Light</option><option value="dark">Dark</option></select></label>{choice('markColor', 'Marked files color', [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green']])}{choice('cursorStyle', 'Cursor', [['filled', 'Filled bar'], ['frame', 'Frame only']])}{choice('fontSize', 'File list font', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']])}{choice('rowHeight', 'Row height', [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']])}</>}
        {page === 'Columns' && <><p className="option-note">Columns shown in Full and Custom Columns view. Name is always shown.</p>{(['ext', 'size', 'date', 'attr'] as const).map(column => <label key={column} className="option-row"><input type="checkbox" checked={draft.columns[column]} onChange={event => set('columns', { ...draft.columns, [column]: event.target.checked })} />{{ ext: 'Extension', size: 'Size', date: 'Date', attr: 'Attributes' }[column]}</label>)}</>}
        {page === 'Tabs' && <>{check('restoreTabs', 'Restore folder tabs when the app opens')}{check('openTabNextToCurrent', 'Open new tabs next to the current tab')}{check('confirmCloseAllTabs', 'Confirm "Close other tabs"')}{check('tabsOnTop', 'Show tabs above the path bar')}</>}
        {page === 'Operations' && <>{check('confirmDelete', 'Ask before deleting')}{check('confirmCopy', 'Show copy/move dialog before starting')}{check('transferDialog', 'Open progress window for transfers (otherwise start in background)')}{check('selectFoldersWithGroup', 'Select Group also marks folders')}</>}
        {page === 'Quick search and keys' && <>{choice('quickSearch', 'Quick search', [['letters', 'Letters only'], ['alt-letters', 'Alt+Letters'], ['off', 'Off']])}{choice('quickSearchMatch', 'Match', [['start', 'Beginning of name'], ['anywhere', 'Anywhere in name']])}
          <p className="option-note">Click a shortcut, then press the new key.</p>
          {(Object.keys(draft.keys) as CommandKey[]).map(command => <div key={command} className="option-row option-select">{command}<Button variant="outline" className={`key-capture ${duplicateKeys.includes(draft.keys[command]) ? 'text-destructive' : ''}`} onClick={() => setRecording(command)} onKeyDown={event => { if (recording !== command || ['Control', 'Alt', 'Shift', 'Meta', 'Tab'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); if (event.key === 'Escape') { setRecording(null); return; } set('keys', { ...draft.keys, [command]: keyName(event.nativeEvent) }); setRecording(null); }}>{recording === command ? 'Press a key…' : draft.keys[command]}</Button></div>)}
          {duplicateKeys.length > 0 && <p role="alert" className="text-xs text-destructive">The same key is used twice.</p>}
          <Button variant="ghost" className="text-xs" onClick={() => set('keys', { ...defaultOptions.keys })}>Restore default keys</Button></>}
        {page === 'Viewer and editor' && <>{check('viewerWrap', 'Wrap long lines')}{check('viewerMonospace', 'Use fixed-width font')}{choice('enterOpensFile', 'Enter on a file opens', [['viewer', 'Viewer (F3)'], ['editor', 'Editor (F4)']])}{choice('tabSize', 'Tab width', [[2, '2 spaces'], [4, '4 spaces'], [8, '8 spaces']])}</>}
      </section>
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => { setDraft({ ...defaultOptions, columns: { ...defaultOptions.columns }, keys: { ...defaultOptions.keys } }); }}>Defaults</Button><Button variant="outline" onClick={close}>Cancel</Button><Button variant="outline" disabled={duplicateKeys.length > 0} onClick={apply}>Apply</Button><Button disabled={duplicateKeys.length > 0} onClick={() => { apply(); close(); }}>OK</Button></DialogFooter>
  </DialogContent></Dialog>;
}
