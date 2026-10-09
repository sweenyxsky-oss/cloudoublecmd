import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Folder, Info, LayoutPanelLeft, Moon, Plus, Server, ShieldCheck, Sun, X } from 'lucide-react';
import { CommanderMenuIcon } from '@/components/commander-menu-icon';
import { TransferConflictDialog, type DuplicateDecision } from '@/components/transfer-conflict-dialog';
import { CommanderIcon } from '@/components/commander-icons';
import { TransferStrip, TransferWindow } from '@/components/transfer-window';
import { ToolDialog, type ToolName } from '@/components/commander-tools';
import { OptionsDialog } from '@/components/options-dialog';
import { useMockTransfers } from '@/hooks/use-mock-transfers';
import { transferBytes, type TransferOperation } from '@/lib/mock-transfers';
import { useCommanderTheme } from '@/hooks/use-commander-theme';
import { keyName, useCommanderOptions, type CommandKey } from '@/hooks/use-commander-options';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { executeFilesystemOperation, type FilesystemOperation } from '@/lib/filesystem-operations';
import { branchEntries, clipboardText, compareDirectories, directoryTree, globToRegExp, matchesGroup, programExtensions, type ClipboardMode } from '@/lib/commander-tools';
import { createFilesystem, transferConflicts, type ConflictChoice, type TransferConflict, datasets, extension, formatSize, joinPath, parentPath, type FileEntry } from '@/lib/mock-filesystem';
import { canRead, canTransfer, canUseTools, canWrite, deleteLive, fetchConnections, fetchListing, isLive, isSignedOut, liveParent, makeLiveDirectory, nasMode, normalizeLive, readLiveFile, renameLive, setLiveAttributes, signOut, splitLive, writeLiveFile, LIVE_PREFIX, type LiveConnection, type LiveListing } from '@/lib/live-filesystem';
import { useLiveTransfers } from '@/hooks/use-live-transfers';
import { LiveToolDialog, liveTools, liveWritingTools, type LiveTool } from '@/components/live-tool-dialog';

const parentOf = (path: string) => isLive(path) ? liveParent(path) : parentPath(path);
const mutatingActions: Action[] = ['Edit', 'Copy', 'Move', 'New Folder', 'Delete', 'Pack', 'Unpack', 'Multi-rename', 'Synchronize'];
const mutatingTools: ToolName[] = ['Change Attributes', 'Unpack Specific Files', 'Edit Comment', 'Split File', 'Combine Files', 'Create Checksum'];
const contentTools: ToolName[] = ['Compare By Content', 'Verify Checksums', 'Test Archive', 'Unpack Specific Files', 'Calculate Occupied Space'];
const liveToolsAllowed: ToolName[] = ['Change Attributes', 'Properties'];
const destinationTools: LiveTool[] = ['Split File', 'Combine Files', 'Pack', 'Unpack All', 'Unpack Specific Files'];
const NAS_LATER = 'This tool does not work on NAS folders yet.';
const PHASE4 = 'Needs file changes on the NAS (Phase 4)';
const LATER = 'Planned: needs extra support on the NAS';

type PaneMode = 'list' | 'tree' | 'quick';
type PaneState = { tabs: string[]; tab: number; cursor: number; selected: string[]; sort: string; ascending: boolean; filter: string; branch: boolean; mode: PaneMode; hide: string[] };
type ViewMode = 'full' | 'brief' | 'comments' | 'custom' | 'thumbs';
type Action = 'View' | 'Edit' | 'Copy' | 'Move' | 'New Folder' | 'Delete' | 'Exit' | 'About' | 'Search' | 'Pack' | 'Unpack' | 'Multi-rename' | 'Synchronize' | 'Favorites' | 'Network' | 'Tabs';
type MenuItem = { text: string; shortcut?: string; action?: () => void; disabled?: string; checked?: boolean } | 'separator';
const initialPane = (paths: string[]): PaneState => ({ tabs: paths, tab: 0, cursor: 0, selected: [], sort: 'Name', ascending: true, filter: '*.*', branch: false, mode: 'list', hide: [] });
const functionActions: CommandKey[] = ['View', 'Edit', 'Copy', 'Move', 'New Folder', 'Delete'];
const tabsKey = 'cloudoublecmd.tabs';
function EntryIcon({ entry }: { entry: FileEntry }) {
  if (entry.directory) return <CommanderIcon name="folder" className="folder-icon" />;
  const ext = extension(entry);
  if (['jpg', 'png'].includes(ext)) return <CommanderIcon name="image" />;
  if (['mkv', 'mp4'].includes(ext)) return <CommanderIcon name="video" />;
  if (['flac', 'm3u'].includes(ext)) return <CommanderIcon name="music" />;
  if (['gz', 'tar', 'zfs', 'zip', '7z', 'rar', 'bz2', 'xz', 'tgz', 'cab', 'iso'].includes(ext)) return <CommanderIcon name="archive" />;
  if (['json', 'yml', 'conf'].includes(ext)) return <CommanderIcon name="code" />;
  return <CommanderIcon name="file" />;
}
const now = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export function Commander() {
  const [fs, setFs] = useState(() => nasMode() ? {} as ReturnType<typeof createFilesystem> : createFilesystem());
  const fsRef = useRef(fs);
  fsRef.current = fs;
  const { options, setOptions, update } = useCommanderOptions();
  const [transferId, setTransferId] = useState<number | null>(null);
  const transfers = useMockTransfers((operation: TransferOperation) => {
    const next = executeFilesystemOperation(fsRef.current, operation);
    fsRef.current = next; setFs(next); refreshPanePaths(next);
    setStatus(`${operation.names.length} items ${operation.type === 'copy' ? 'copied' : 'moved'} to ${operation.destination}`);
  });
  const liveTransfers = useLiveTransfers(nasMode(), job => {
    void Promise.all([job.operation.source, job.operation.destination].map(item => fsRef.current[item] ? loadLive(item) : Promise.resolve(false))).then(() => refreshPanePaths(fsRef.current));
    setStatus(job.state === 'completed' ? `${job.operation.names.length} item(s) ${job.operation.type === 'copy' ? 'copied' : 'moved'} on the NAS` : job.state === 'cancelled' ? 'NAS transfer cancelled; files finished before cancelling were kept' : `NAS transfer failed: ${job.error ?? 'unknown error'}`);
  });
  const drag = useRef<{ source: string; names: string[] } | null>(null);
  const rightMouse = useRef<{ pane: number; name: string; mark: boolean; visited: Set<string>; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const [mouseMenu, setMouseMenu] = useState(false);
  const [dropTransfer, setDropTransfer] = useState<{ source: string; names: string[]; target: string; kind: 'Copy' | 'Move' } | null>(null);
  useEffect(() => {
    const stop = () => { if (rightMouse.current?.timer) clearTimeout(rightMouse.current.timer); rightMouse.current = null; };
    window.addEventListener('mouseup', stop); window.addEventListener('blur', stop);
    return () => { stop(); window.removeEventListener('mouseup', stop); window.removeEventListener('blur', stop); };
  }, []);
  const [pendingTransfer, setPendingTransfer] = useState<{ operation: TransferOperation; conflicts: TransferConflict[]; decisions: Record<string, ConflictChoice> } | null>(null);
  const [conflictError, setConflictError] = useState('');
  const [conflictBusy, setConflictBusy] = useState(false);
  const allJobs = [...transfers.jobs, ...liveTransfers.jobs];
  const jobControl = (id: number) => id >= 100000 ? liveTransfers : transfers;
  const [liveTool, setLiveTool] = useState<LiveTool | null>(null);
  const [liveFile, setLiveFile] = useState<{ path: string; name: string; readOnly: boolean } | null>(null);
  const [quickText, setQuickText] = useState<{ key: string; text: string } | null>(null);
  const [favorites, setFavorites] = useState<string[]>(datasets);
  const [navigationPane, setNavigationPane] = useState(0);
  const [networkProtocol, setNetworkProtocol] = useState('FTP');
  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const brief = viewMode === 'brief';
  const [panes, setPanes] = useState<[PaneState, PaneState]>([initialPane(['/mnt/tank/media', '/mnt/tank/backups']), initialPane(['/mnt/tank/data', '/etc'])]);
  const [active, setActive] = useState(0);
  const { theme, setTheme } = useCommanderTheme();
  const dark = theme === 'dark';
  const hidden = options.showHidden;
  const [separateTree, setSeparateTree] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Action | null>(null);
  const [tool, setTool] = useState<ToolName | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [savedSelection, setSavedSelection] = useState<string[]>([]);
  const backStack = useRef<[string[], string[]]>([[], []]);
  const loadSelectionRef = useRef<HTMLInputElement | null>(null);
  const quickSearch = useRef({ text: '', at: 0 });
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Ready');
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>(datasets);
  const commandRef = useRef<HTMLInputElement | null>(null);
  const [exited, setExited] = useState(false);
  const listRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [liveConnections, setLiveConnections] = useState<LiveConnection[]>([]);
  const [liveSpace, setLiveSpace] = useState<Record<string, LiveListing['space']>>({});
  useEffect(() => {
    if (!nasMode()) return;
    fetchConnections().then(connections => { setLiveConnections(connections); if (connections.length) { const first = LIVE_PREFIX + connections[0]?.id; const second = LIVE_PREFIX + (connections[1]?.id ?? connections[0]?.id); setPanes([initialPane([first]), initialPane([second])]); setFavorites(connections.map(connection => LIVE_PREFIX + connection.id)); void Promise.all([first, second].map(loadLive)); } else setStatus('No NAS folders configured.'); }).catch(problem => {
      if (isSignedOut(problem)) window.location.assign('/login'); else setStatus('NAS connections unavailable');
    });
  }, []);
  // Restore saved sample-folder tabs after hydration when the option is enabled.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !options.restoreTabs) return;
    restored.current = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(tabsKey) ?? 'null');
      if (!nasMode() && Array.isArray(saved) && saved.length === 2) setPanes(old => old.map((pane, i) => { const tabs = Array.isArray(saved[i]) ? saved[i].filter((tab: unknown) => typeof tab === 'string' && !isLive(tab) && fsRef.current[tab]) : []; return tabs.length ? { ...pane, tabs, tab: 0 } : pane; }) as [PaneState, PaneState]);
    } catch { /* Ignore unreadable saved tabs. */ }
  }, [options.restoreTabs]);
  useEffect(() => {
    if (!options.restoreTabs) return;
    try { window.localStorage.setItem(tabsKey, JSON.stringify(panes.map(pane => pane.tabs.filter(tab => !isLive(tab))))); } catch { /* Session only. */ }
  }, [panes, options.restoreTabs]);

  async function loadLive(livePath: string) {
    setStatus(`Loading ${livePath}…`);
    try {
      const listing = await fetchListing(livePath);
      const next = { ...fsRef.current, [livePath]: listing.entries };
      fsRef.current = next; setFs(next);
      setLiveSpace(old => ({ ...old, [livePath.slice(0, (livePath + '/').indexOf('/', LIVE_PREFIX.length))]: listing.space }));
      return true;
    } catch (problem) {
      if (isSignedOut(problem)) window.location.assign('/login');
      else setStatus(problem instanceof Error ? problem.message : 'Directory unavailable');
      return false;
    }
  }
  const getPane = (index: number) => panes[index] ?? panes[0];
  const getPath = (pane: PaneState) => pane.tabs[pane.tab] ?? '/';
  const current = getPane(active);
  const path = getPath(current);
  const destination = getPath(getPane(1 - active));

  function rowsFor(pane: PaneState): FileEntry[] {
    const folderPath = getPath(pane);
    const source = pane.branch ? branchEntries(fs, folderPath) : fs[folderPath] ?? [];
    const pattern = pane.filter === '*.*' || pane.filter === 'selected' || pane.filter === 'programs' ? null : globToRegExp(pane.filter);
    const entries = source.filter(entry => (hidden || !(entry.name.split('/').pop() ?? '').startsWith('.')) && !pane.hide.includes(entry.name)
      && (pane.filter === 'selected' ? pane.selected.includes(entry.name) : entry.directory || (pane.filter === 'programs' ? programExtensions.includes(extension(entry)) || /x/.test(entry.attr) : !pattern || pattern.test(entry.name))));
    const sorted = pane.sort === 'Unsorted' ? (pane.ascending ? entries : [...entries].reverse()) : [...entries].sort((a, b) => {
      if (options.foldersFirst && a.directory !== b.directory) return a.directory ? -1 : 1;
      let compare = 0;
      if (pane.sort === 'Size') compare = a.size - b.size;
      else if (pane.sort === 'Ext') compare = extension(a).localeCompare(extension(b));
      else if (pane.sort === 'Date') compare = a.date.localeCompare(b.date);
      else if (pane.sort === 'Attr') compare = a.attr.localeCompare(b.attr);
      if (!compare) compare = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return pane.ascending ? compare : -compare;
    });
    return folderPath === '/' ? sorted : [{ name: '..', directory: true, size: 0, date: '', attr: '' }, ...sorted];
  }
  const currentRows = rowsFor(current);
  const currentEntry = currentRows[current.cursor];
  const otherPane = getPane(1 - active);
  const otherEntry = rowsFor(otherPane)[otherPane.cursor];
  const targets = current.selected.length ? current.selected : currentEntry && currentEntry.name !== '..' ? [currentEntry.name] : [];

  function updatePane(index: number, update: Partial<PaneState>) {
    setPanes(old => old.map((pane, i) => i === index ? { ...pane, ...update } : pane) as [PaneState, PaneState]);
  }
  function navigate(index: number, next: string, recordBack = true) {
    if (nasMode() && !isLive(next)) { setStatus('Only configured NAS folders are available.'); return; }
    const base = getPath(getPane(index));
    let clean: string;
    try {
      const raw = next.startsWith('/') || isLive(next) ? next : isLive(base) ? `${base}/${next}` : joinPath(base, next);
      clean = isLive(raw) ? normalizeLive(raw) : normalizePath(raw);
    } catch { setStatus('Invalid path'); return; }
    if (isLive(clean) && !fsRef.current[clean]) { void loadLive(clean).then(ok => { if (ok) navigate(index, clean, recordBack); }); return; }
    if (!fsRef.current[clean]) { setStatus(`Directory not found: ${clean}`); return; }
    const pane = getPane(index);
    if (recordBack && clean !== base) backStack.current[index as 0 | 1] = [base, ...backStack.current[index as 0 | 1]].slice(0, 50);
    updatePane(index, { tabs: pane.tabs.map((tab, i) => i === pane.tab ? clean : tab), cursor: 0, selected: [], branch: false, hide: [] });
    setHistory(old => [clean, ...old.filter(item => item !== clean)].slice(0, 20));
    setStatus('Ready');
  }
  function goBack() { setMenu(null); const stack = backStack.current[active as 0 | 1]; const previous = stack.shift(); if (previous) navigate(active, previous, false); else setStatus('No previous directory'); }
  function openEntry(index: number, entry: FileEntry) {
    setActive(index);
    const source = getPath(getPane(index));
    if (entry.directory) navigate(index, entry.name === '..' ? parentOf(source) : joinPath(source, entry.name));
    else if (getPane(index).branch) setStatus('Branch view: leave branch view to open files');
    else runAction(options.enterOpensFile === 'editor' ? 'Edit' : 'View');
  }
  function toggleSelection(index: number, entry: FileEntry, advance = false) {
    if (entry.name === '..') return;
    const pane = getPane(index);
    updatePane(index, { selected: pane.selected.includes(entry.name) ? pane.selected.filter(name => name !== entry.name) : [...pane.selected, entry.name], cursor: advance ? Math.min(pane.cursor + 1, rowsFor(pane).length - 1) : pane.cursor });
  }
  function runAction(action: Action) {
    setMenu(null); setError('');
    if (mutatingActions.includes(action) && current.branch) { setStatus('Branch view is view-only. Turn it off first (Commands menu).'); return; }
    const liveHere = isLive(path); const liveThere = isLive(destination);
    if (liveHere || (liveThere && ['Copy', 'Move', 'Pack', 'Unpack', 'Synchronize'].includes(action))) {
      if (action === 'Pack' || action === 'Unpack') { if (liveHere && liveThere) openLiveTool(action === 'Pack' ? 'Pack' : 'Unpack All'); else setStatus('Open NAS folders in both panels to pack or unpack.'); return; }
      if (action === 'Synchronize') {
        if (!(liveHere && liveThere)) { setStatus('Open NAS folders in both panels to synchronize them.'); return; }
        if (!canWrite(connectionOf(destination))) { setStatus('The target NAS folder is read-only.'); return; }
        if (!canTransfer(connectionOf(path)) || !canTransfer(connectionOf(destination))) { setStatus('Synchronize needs SMB, NFS or mounted folders on both sides.'); return; }
        setDialog('Synchronize'); return;
      }
      if ((action === 'Copy' || action === 'Move') && liveHere !== liveThere) { setStatus('Copying between sample files and the NAS is not possible. Open NAS folders in both panels.'); return; }
      if ((action === 'Copy' || action === 'Move') && !canWrite(connectionOf(destination))) { setStatus('The target NAS folder is read-only.'); return; }
      if ((action === 'Copy' || action === 'Move') && (!canTransfer(connectionOf(path)) || !canTransfer(connectionOf(destination)))) { setStatus('Copy and move work between SMB, NFS or mounted folders; FTP folders support view, edit, new folder, rename and delete.'); return; }
      if (['Move', 'Edit', 'New Folder', 'Delete', 'Multi-rename'].includes(action) && !canWrite(connectionOf(path))) { setStatus(action === 'Edit' ? 'This NAS folder is read-only; opening the file in the viewer instead.' : 'Read-only connection: this NAS folder does not allow changes.'); if (action !== 'Edit') return; }
      if ((action === 'View' || action === 'Edit') && !canRead(connectionOf(path))) { setStatus('File preview is not available for this connection.'); return; }
    }
    if (['Copy', 'Move', 'Delete'].includes(action) && !targets.length) { setStatus('Select a file or folder first.'); return; }
    if (action === 'View' || action === 'Edit') {
      if (!currentEntry || currentEntry.directory) { setStatus('Select a file to ' + action.toLowerCase() + '.'); return; }
      if (liveHere) { void openLiveFile(action, currentEntry.name); return; }
      setLiveFile(null); setValue(currentEntry.content ?? '');
    } else setValue(action === 'Copy' || action === 'Move' ? destination : action === 'Pack' ? 'archive.zip' : action === 'Multi-rename' ? '{name}' : '');
    if (action === 'Delete' && !options.confirmDelete && liveHere) { void liveChange(() => deleteLive(path, targets), `${targets.length} item(s) deleted on the NAS`).catch(() => undefined); return; }
    if (action === 'Delete' && !options.confirmDelete) { applyOperation({ type: 'delete', path, names: targets }, `${targets.length} item${targets.length === 1 ? '' : 's'} deleted`); return; }
    if ((action === 'Copy' || action === 'Move') && !options.confirmCopy) { startTransfer(action, destination); return; }
    setDialog(action);
  }
  function connectionOf(livePath: string) { try { const { id } = splitLive(livePath); return liveConnections.find(connection => connection.id === id); } catch { return undefined; } }
  async function openLiveFile(action: 'View' | 'Edit', name: string) {
    setStatus(`Opening ${name}…`);
    try {
      const file = await readLiveFile(path, name);
      if (file.binary) { setStatus(`${name} is not a text file; it cannot be shown here.`); return; }
      const readOnly = action === 'View' || file.truncated || !canWrite(connectionOf(path));
      setLiveFile({ path, name, readOnly }); setValue(file.content); setError('');
      setDialog(readOnly ? 'View' : 'Edit');
      setStatus(file.truncated ? 'Showing the first 1 MB only; large files open read-only.' : 'Ready');
    } catch (problem) { if (isSignedOut(problem)) window.location.assign('/login'); else setStatus(problem instanceof Error ? problem.message : 'File unavailable'); }
  }
  async function liveChange(work: () => Promise<unknown>, message: string, folders: string[] = [path]) {
    setStatus('Working on the NAS…');
    try { await work(); for (const folder of new Set(folders)) await loadLive(folder); refreshPanePaths(fsRef.current); setStatus(message); }
    catch (problem) { if (isSignedOut(problem)) window.location.assign('/login'); else { setStatus(problem instanceof Error ? problem.message : 'Operation failed'); throw problem; } }
  }
  function openTool(name: ToolName) {
    setMenu(null);
    if (isLive(path) && (liveTools as string[]).includes(name)) { openLiveTool(name as LiveTool); return; }
    if (isLive(path) && !liveToolsAllowed.includes(name) && (mutatingTools.includes(name) || contentTools.includes(name))) { setStatus(NAS_LATER); return; }
    if (isLive(path) && name === 'Change Attributes' && (!canWrite(connectionOf(path)) || !canUseTools(connectionOf(path)))) { setStatus('Read-only connection: this NAS folder does not allow changes.'); return; }
    if (current.branch && mutatingTools.includes(name)) { setStatus('Branch view is view-only. Turn it off first (Commands menu).'); return; }
    if (mutatingTools.includes(name) && isLive(destination) && ['Split File', 'Combine Files', 'Unpack Specific Files'].includes(name)) { setStatus('Read-only connection: the target panel is on the NAS.'); return; }
    setTool(name);
  }
  function openLiveTool(name: LiveTool) {
    setMenu(null);
    if (!canUseTools(connectionOf(path))) { setStatus('This tool needs an SMB, NFS or mounted NAS connection.'); return; }
    if (current.branch && liveWritingTools.includes(name)) { setStatus('Branch view is view-only. Turn it off first (Commands menu).'); return; }
    if (destinationTools.includes(name)) {
      if (!isLive(destination)) { setStatus('Open a NAS folder in the other panel as the target.'); return; }
      if (!canWrite(connectionOf(destination))) { setStatus('The target NAS folder is read-only.'); return; }
    }
    const needsFile: LiveTool[] = ['Verify Checksums', 'Split File', 'Combine Files', 'Test Archive', 'Unpack Specific Files', 'Unpack All'];
    if (needsFile.includes(name) && (!currentEntry || currentEntry.directory || currentEntry.name === '..')) { setStatus('Put the cursor on a file first.'); return; }
    if (['Create Checksum', 'Calculate Occupied Space', 'Pack'].includes(name) && !targets.length) { setStatus('Select a file or folder first.'); return; }
    setLiveTool(name);
  }
  function refreshPanePaths(nextFs: typeof fs) {
    const refresh = (pane: PaneState): PaneState => ({ ...pane, tabs: pane.tabs.map(tab => {
      let valid = tab; while (!nextFs[valid] && valid !== '/') { const parent = parentOf(valid); if (parent === valid) break; valid = parent; } return valid;
    }), cursor: 0, selected: [] });
    setPanes(old => [refresh(old[0]), refresh(old[1])]);
  }
  function applyOperation(operation: FilesystemOperation, message: string) {
    if (operation.type === 'attributes' && isLive(operation.path)) {
      const mode = operation.attr ? (operation.attr.slice(1).match(/.../g) ?? []).map(part => (part[0] === 'r' ? 4 : 0) + (part[1] === 'w' ? 2 : 0) + (part[2] === 'x' ? 1 : 0)).join('') : '644';
      void liveChange(() => setLiveAttributes(operation.path, operation.names, mode, operation.date ? new Date(operation.date.replace(' ', 'T')).toISOString() : undefined), message).catch(() => undefined);
      return;
    }
    try {
      const next = executeFilesystemOperation(fsRef.current, operation);
      fsRef.current = next; setFs(next);
      if (operation.type === 'delete' || operation.type === 'rename') refreshPanePaths(next);
      setStatus(message);
    } catch (problem) { setStatus(problem instanceof Error ? problem.message : 'Operation failed.'); throw problem; }
  }
  function startTransfer(kind: 'Copy' | 'Move', target: string, source = path, names = targets) {
    if (isLive(source) !== isLive(target)) throw new Error('Open folders from the same session on both sides.');
    if (source === target) throw new Error('Source and destination are the same folder.');
    if (isLive(source)) {
      if (!canTransfer(connectionOf(source)) || !canTransfer(connectionOf(target))) throw new Error('Transfers need mounted SMB, NFS or local folders.');
      if (kind === 'Move' && !canWrite(connectionOf(source))) throw new Error('The source folder is read-only.');
      let clean: string;
      try { clean = normalizeLive(target.trim()); } catch { throw new Error('Enter a NAS destination such as nas://test/folder'); }
      if (!canWrite(connectionOf(clean))) throw new Error('The target NAS folder is read-only.');
      setStatus('Starting NAS transfer…');
      void liveTransfers.start(kind === 'Move' ? 'move' : 'copy', source, clean, [...names]).then(id => { setTransferId(options.transferDialog ? id : null); setStatus('NAS transfer started'); }).catch(problem => { if (isSignedOut(problem)) window.location.assign('/login'); else setStatus(problem instanceof Error ? problem.message : 'Transfer failed'); });
      return;
    }
    const operation: TransferOperation = { type: kind === 'Move' ? 'move' : 'copy', source, destination: normalizePath(target.replace(/\/+$/, '') || '/'), names: [...names] };
    try {
      const conflicts = transferConflicts(fs, operation.source, operation.destination, operation.names);
      if (conflicts.length && operation.source !== operation.destination) { setConflictError(''); setPendingTransfer({ operation, conflicts, decisions: {} }); return; }
      executeFilesystemOperation(fs, operation); // Preflight without changing files.
      const id = transfers.start(operation, transferBytes(fs, source, names));
      setTransferId(options.transferDialog ? id : null);
      setStatus('Sample-file transfer started');
    } catch (problem) { setStatus(problem instanceof Error ? problem.message : 'Operation failed.'); throw problem; }
  }
  function receiveDrop(event: React.DragEvent, target: string) {
    event.preventDefault(); event.stopPropagation();
    const captured = drag.current; drag.current = null;
    if (!captured) { setStatus('Only files dragged from this workspace can be transferred.'); return; }
    if (captured.source === target) { setStatus('Source and destination are the same folder.'); return; }
    setError(''); setDropTransfer({ ...captured, target, kind: event.ctrlKey ? 'Copy' : event.shiftKey || event.altKey ? 'Move' : 'Copy' });
  }
  function allowDrop(event: React.DragEvent) {
    if (!drag.current) return;
    event.preventDefault(); event.dataTransfer.dropEffect = !event.ctrlKey && (event.shiftKey || event.altKey) ? 'move' : 'copy';
  }
  function mouseHandlers(index: number, entry: FileEntry, rowIndex: number) {
    return {
      draggable: entry.name !== '..' && !getPane(index).branch,
      onDragStart: (event: React.DragEvent) => {
        const pane = getPane(index); const names = pane.selected.includes(entry.name) ? [...pane.selected] : [entry.name];
        drag.current = { source: getPath(pane), names }; setActive(index); updatePane(index, { cursor: rowIndex });
        event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('application/x-cloudoublecmd', 'internal');
      },
      onDragEnd: () => { drag.current = null; },
      onDragOver: entry.directory ? allowDrop : undefined,
      onDrop: entry.directory ? (event: React.DragEvent) => receiveDrop(event, entry.name === '..' ? parentOf(getPath(getPane(index))) : joinPath(getPath(getPane(index)), entry.name)) : undefined,
      onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); },
      onMouseDown: (event: React.MouseEvent) => {
        if (event.button !== 2) return;
        event.preventDefault(); setActive(index); const pane = getPane(index);
        const mark = !pane.selected.includes(entry.name);
        updatePane(index, { cursor: rowIndex, selected: entry.name === '..' ? pane.selected : mark ? [...pane.selected, entry.name] : pane.selected.filter(name => name !== entry.name) });
        const state = { pane: index, name: entry.name, mark, visited: new Set([entry.name]), timer: null as ReturnType<typeof setTimeout> | null };
        state.timer = setTimeout(() => { if (rightMouse.current === state) { rightMouse.current = null; updatePane(index, { cursor: rowIndex, selected: pane.selected.includes(entry.name) ? pane.selected : entry.name === '..' ? [] : [entry.name] }); setMouseMenu(true); } }, 1000);
        rightMouse.current = state;
      },
      onMouseEnter: (event: React.MouseEvent) => {
        const state = rightMouse.current;
        if (!state || state.pane !== index || !(event.buttons & 2) || state.visited.has(entry.name)) return;
        if (state.timer) clearTimeout(state.timer); state.timer = null; state.visited.add(entry.name);
        setPanes(old => old.map((pane, i) => i !== index ? pane : { ...pane, cursor: rowIndex, selected: entry.name === '..' ? pane.selected : state.mark ? [...new Set([...pane.selected, entry.name])] : pane.selected.filter(name => name !== entry.name) }) as [PaneState, PaneState]);
      },
      onMouseMove: (event: React.MouseEvent) => { if (rightMouse.current?.timer && (Math.abs(event.movementX) > 4 || Math.abs(event.movementY) > 4)) { clearTimeout(rightMouse.current.timer); rightMouse.current.timer = null; } },
    };
  }
  const liveConflictJob = allJobs.find(job => job.conflict);
  async function chooseDuplicate(choice: DuplicateDecision) {
    setConflictError(''); setConflictBusy(true);
    try {
      if (liveConflictJob) { await liveTransfers.resolve(liveConflictJob.id, choice); return; }
      if (!pendingTransfer) return;
      const { operation, conflicts, decisions } = pendingTransfer;
      const first = conflicts[0]; if (!first) return;
      const decision: ConflictChoice = choice.startsWith('overwrite') ? 'overwrite' : 'skip';
      const nextDecisions = { ...decisions };
      const answered = choice.endsWith('-all') ? conflicts : [first];
      for (const conflict of answered) nextDecisions[conflict.name] = decision === 'overwrite' && (conflict.source.directory || conflict.destination.directory) ? 'skip' : decision;
      const remaining = choice.endsWith('-all') ? [] : conflicts.slice(1);
      if (remaining.length) { setPendingTransfer({ operation, conflicts: remaining, decisions: nextDecisions }); return; }
      const resolved = { ...operation, decisions: nextDecisions };
      executeFilesystemOperation(fsRef.current, resolved);
      const id = transfers.start(resolved, transferBytes(fsRef.current, operation.source, operation.names));
      setPendingTransfer(null); setTransferId(options.transferDialog ? id : null);
    } catch (problem) { setConflictError(problem instanceof Error ? problem.message : 'Transfer failed'); }
    finally { setConflictBusy(false); }
  }
  async function confirmLive() {
    try {
      if (dialog === 'Multi-rename') {
        const mapping = targets.map((name, i) => ({ from: name, to: value.replaceAll('{name}', name).replaceAll('{n}', String(i + 1)) }));
        await liveChange(() => renameLive(path, mapping), `Renamed ${targets.length} item(s) on the NAS`);
      } else if (dialog === 'New Folder') await liveChange(() => makeLiveDirectory(path, value.trim()), `Folder created: ${value.trim()}`);
      else if (dialog === 'Delete') await liveChange(() => deleteLive(path, targets), `${targets.length} item(s) deleted on the NAS`);
      else if (dialog === 'Edit' && liveFile && !liveFile.readOnly) await liveChange(() => writeLiveFile(liveFile.path, liveFile.name, value), `Saved ${liveFile.name} on the NAS`, [liveFile.path]);
      else if (dialog === 'Copy' || dialog === 'Move') startTransfer(dialog, value);
      else if (dialog === 'Synchronize') {
        const [source, target] = await Promise.all([fetchListing(path), fetchListing(destination)]);
        const present = new Set(target.entries.map(entry => entry.name));
        const missing = source.entries.map(entry => entry.name).filter(name => !present.has(name));
        if (!missing.length) setStatus('Folders are already in sync: nothing is missing in the target.');
        else { const id = await liveTransfers.start('copy', path, destination, missing); setTransferId(options.transferDialog ? id : null); setStatus(`Synchronizing ${missing.length} missing item(s) to ${destination}`); }
      }
      setDialog(null);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operation failed.'); }
  }
  function confirmAction() {
    if (isLive(path) && dialog && ['Multi-rename', 'New Folder', 'Delete', 'Edit', 'Copy', 'Move', 'Synchronize'].includes(dialog)) { void confirmLive(); return; }
    try {
      if (dialog === 'Pack') {
        if (!targets.length) throw new Error('Select items to pack.');
        if (!value.trim() || value.includes('/')) throw new Error('Enter a valid archive name.');
        const archive: FileEntry = { name: value, directory: false, size: (fs[path] ?? []).filter(entry => targets.includes(entry.name)).reduce((sum, entry) => sum + entry.size, 0), date: now(), attr: '-rw-r--r--', content: JSON.stringify((fs[path] ?? []).filter(entry => targets.includes(entry.name))) };
        applyOperation({ type: 'create', path: destination, files: [archive] }, `Packed ${targets.length} items into ${value}`);
      } else if (dialog === 'Unpack') {
        if (!currentEntry || !['zip', 'tar', 'gz'].includes(extension(currentEntry))) throw new Error('Select an archive to unpack.');
        let unpacked: FileEntry[];
        try { unpacked = JSON.parse(currentEntry.content ?? ''); } catch { throw new Error('Only archives created in this sample session can be unpacked.'); }
        if (!Array.isArray(unpacked)) throw new Error('Invalid sample archive.');
        if (unpacked.some(entry => (fs[destination] ?? []).some(item => item.name === entry.name))) throw new Error('Destination already contains one or more archived items.');
        const next = { ...fs, [destination]: [...(fs[destination] ?? []), ...unpacked] };
        unpacked.filter(entry => entry.directory).forEach(entry => { next[joinPath(destination, entry.name)] = []; });
        setFs(next); setStatus(`Archive unpacked to ${destination}`);
      } else if (dialog === 'Multi-rename') {
        applyOperation({ type: 'rename', path, names: targets, pattern: value }, `Renamed ${targets.length} items`);
      } else if (dialog === 'Synchronize') {
        const missing = (fs[path] ?? []).filter(entry => !(fs[destination] ?? []).some(item => item.name === entry.name)).map(entry => entry.name);
        applyOperation({ type: 'synchronize', source: path, destination }, `Synchronized ${missing.length} missing items to ${destination}`);
      } else if (dialog === 'Copy' || dialog === 'Move') {
        startTransfer(dialog, value);
      } else if (dialog === 'New Folder') {
        applyOperation({ type: 'mkdir', path, name: value.trim() }, `Folder created: ${value.trim()}`);
      } else if (dialog === 'Delete') {
        applyOperation({ type: 'delete', path, names: targets }, `${targets.length} item${targets.length === 1 ? '' : 's'} deleted`);
      } else if (dialog === 'Edit' && currentEntry) {
        applyOperation({ type: 'write', path, name: currentEntry.name, content: value }, `Saved ${currentEntry.name}`);
      } else if (dialog === 'Exit') setExited(true);
      setDialog(null);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operation failed.'); }
  }
  const markable = () => currentRows.filter(entry => entry.name !== '..');
  function markAll(mode: 'all' | 'none' | 'invert') {
    const names = markable().map(entry => entry.name);
    updatePane(active, { selected: mode === 'all' ? names : mode === 'none' ? [] : names.filter(name => !current.selected.includes(name)) }); setMenu(null);
  }
  function group(pattern: string, add: boolean) {
    const names = markable().filter(entry => (options.selectFoldersWithGroup || !entry.directory) && matchesGroup(entry, pattern)).map(entry => entry.name);
    updatePane(active, { selected: add ? [...new Set([...current.selected, ...names])] : current.selected.filter(name => !names.includes(name)) });
    setStatus(`${names.length} item(s) ${add ? 'selected' : 'unselected'} by ${pattern}`);
  }
  function sameExtension() {
    setMenu(null);
    if (!currentEntry || currentEntry.directory) { setStatus('Put the cursor on a file first.'); return; }
    const ext = extension(currentEntry);
    group(ext ? `*.${ext}` : '*', true);
  }
  async function copyNames(mode: ClipboardMode) {
    setMenu(null);
    const entries = (fs[path] ?? []).filter(entry => targets.includes(entry.name));
    if (!entries.length) { setStatus('Select a file or folder first.'); return; }
    try { await navigator.clipboard.writeText(clipboardText(entries, path, mode)); setStatus(`Copied ${entries.length} name(s) to the clipboard`); }
    catch { setStatus('The browser blocked clipboard access.'); }
  }
  function saveSelectionToFile() {
    setMenu(null);
    if (!current.selected.length) { setStatus('Nothing is selected.'); return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([current.selected.join('\n') + '\n'], { type: 'text/plain' }));
    link.download = 'selection.txt'; link.click(); URL.revokeObjectURL(link.href);
    setStatus(`Saved ${current.selected.length} name(s) to selection.txt`);
  }
  async function loadSelectionFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) { setStatus('Selection file is too large.'); return; }
    const names = (await file.text()).split(/\r?\n/).map(line => line.trim().split('/').pop() ?? '').filter(Boolean);
    const present = markable().filter(entry => names.includes(entry.name)).map(entry => entry.name);
    updatePane(active, { selected: present }); setStatus(`Selected ${present.length} of ${names.length} name(s) from ${file.name}`);
  }
  function compareDirs(newer: boolean) {
    setMenu(null);
    const left = fs[getPath(panes[0])] ?? []; const right = fs[getPath(panes[1])] ?? [];
    const result = compareDirectories(left, right, newer);
    setPanes(old => [{ ...old[0], selected: result.left, hide: newer ? result.same : [] }, { ...old[1], selected: result.right, hide: newer ? result.same : [] }]);
    setStatus(`${result.left.length} file(s) marked left, ${result.right.length} right${newer ? `, ${result.same.length} identical hidden` : ''}`);
  }
  function printList() {
    setMenu(null);
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) { setStatus('The browser blocked the print window.'); return; }
    const doc = win.document;
    doc.title = `ClouDouble Commander — ${path}`;
    const heading = doc.createElement('h3'); heading.textContent = path; doc.body.append(heading);
    const table = doc.createElement('table'); table.style.cssText = 'font: 12px monospace; border-collapse: collapse';
    for (const entry of markable()) {
      const row = table.insertRow();
      for (const text of [entry.directory ? `[${entry.name}]` : entry.name, entry.directory ? '<DIR>' : String(entry.size), entry.date, entry.attr]) { const cell = row.insertCell(); cell.textContent = text; cell.style.padding = '1px 12px 1px 0'; }
    }
    doc.body.append(table); win.focus(); win.print();
  }
  function disconnect(protocol?: string) {
    setMenu(null);
    const live = liveConnections.filter(connection => !protocol || connection.protocol === protocol.toLowerCase()).map(connection => LIVE_PREFIX + connection.id);
    setPanes(old => old.map((pane, i) => ({ ...pane, tabs: pane.tabs.map(tab => live.some(prefix => tab === prefix || tab.startsWith(prefix + '/')) ? liveConnections.find(connection => !live.includes(LIVE_PREFIX + connection.id)) ? LIVE_PREFIX + liveConnections.find(connection => !live.includes(LIVE_PREFIX + connection.id))?.id : tab : tab), cursor: 0, selected: [] as string[] })) as unknown as [PaneState, PaneState]);
    setStatus(live.length ? 'Disconnected panels from the NAS connection' : `No ${protocol ?? 'network'} connection is open`);
  }
  function setFilter(filter: string) { updatePane(active, { filter, cursor: 0 }); setMenu(null); setStatus(filter === '*.*' ? 'Showing all files' : `Filter: ${filter === 'programs' ? 'programs and scripts' : filter === 'selected' ? 'only selected files' : filter}`); }
  function setSort(sort: string) { updatePane(active, { sort, ascending: true, cursor: 0 }); setMenu(null); }
  function setPanelMode(index: number, mode: PaneMode) { const pane = getPane(index); updatePane(index, { mode: pane.mode === mode ? 'list' : mode }); setMenu(null); }
  function showFavorites(index: number) { setNavigationPane(index); setDialog('Favorites'); setMenu(null); }
  function showTabActions(index: number) { setNavigationPane(index); setDialog('Tabs'); }
  function refresh() { setMenu(null); const live = panes.map(getPath).filter(isLive); if (live.length) { void Promise.all([...new Set(live)].map(loadLive)).then(() => setStatus('NAS directory refreshed')); return; } refreshPanePaths(fs); setStatus('Directory reread'); }
  function addTab(index: number) { const pane = getPane(index); const at = options.openTabNextToCurrent ? pane.tab + 1 : pane.tabs.length; const tabs = [...pane.tabs]; tabs.splice(at, 0, getPath(pane)); updatePane(index, { tabs, tab: at, cursor: 0, selected: [] }); }
  function closeTab(index: number, tab: number) { const pane = getPane(index); if (pane.tabs.length < 2) return; updatePane(index, { tabs: pane.tabs.filter((_, i) => i !== tab), tab: Math.min(pane.tab > tab ? pane.tab - 1 : pane.tab, pane.tabs.length - 2), cursor: 0, selected: [] }); }
  function swapPanes() { setPanes([panes[1], panes[0]]); setActive(1 - active); setMenu(null); }
  function targetEqualsSource() { setMenu(null); navigate(1 - active, path); }
  function toggleBranch() { setMenu(null); if (isLive(path)) { setStatus('Branch view needs every subfolder from the NAS; not available yet.'); return; } updatePane(active, { branch: !current.branch, cursor: 0, selected: [] }); }

  const quickKey = otherPane.mode === 'quick' && isLive(path) && currentEntry && !currentEntry.directory && canRead(connectionOf(path)) ? `${path}/${currentEntry.name}` : null;
  useEffect(() => {
    if (!quickKey || !currentEntry) return;
    let alive = true;
    const timer = window.setTimeout(() => { readLiveFile(path, currentEntry.name).then(file => { if (alive) setQuickText({ key: quickKey, text: file.binary ? '(not a text file)' : file.content + (file.truncated ? '\n… (first 1 MB shown)' : '') }); }).catch(() => { if (alive) setQuickText({ key: quickKey, text: '(preview unavailable)' }); }); }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [quickKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (mouseMenu || dropTransfer || dialog || tool || liveTool || pendingTransfer || liveConflictJob || optionsOpen || transferId !== null || exited) return;
      const element = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
      const combo = keyName(event);
      const bound = functionActions.find(action => options.keys[action] === combo);
      if (bound) { event.preventDefault(); runAction(bound); return; }
      const shortcuts: Record<string, () => void> = {
        'Alt+F4': () => runAction('Exit'), F10: () => runAction('Exit'), F9: () => setMenu(menu ? null : 'Files'),
        'Alt+Enter': () => openTool('Properties'), 'Alt+F5': () => runAction('Pack'), 'Alt+F9': () => runAction('Unpack'), 'Alt+Shift+F9': () => openTool('Test Archive'),
        'Ctrl+M': () => runAction('Multi-rename'), 'Ctrl+Z': () => openTool('Edit Comment'), 'Ctrl+L': () => openTool('Calculate Occupied Space'),
        'Alt+F7': () => runAction('Search'), 'Alt+F10': () => openTool('CD Tree'), 'Ctrl+D': () => showFavorites(active), 'Ctrl+U': swapPanes, 'Ctrl+R': refresh,
        'Ctrl+B': toggleBranch, 'Ctrl+Q': () => setPanelMode(1 - active, 'quick'), 'Ctrl+F1': () => setViewMode('brief'), 'Ctrl+F2': () => setViewMode('full'),
        'Ctrl+F3': () => setSort('Name'), 'Ctrl+F4': () => setSort('Ext'), 'Ctrl+F5': () => setSort('Date'), 'Ctrl+F6': () => setSort('Size'), 'Ctrl+F7': () => setSort('Unsorted'),
        'Ctrl+F8': () => setPanelMode(active, 'tree'), 'Ctrl+F10': () => setFilter('*.*'), 'Ctrl+F12': () => setFilter('selected'),
        'Alt+ArrowLeft': goBack, 'Ctrl+A': () => markAll('all'), 'Shift+F10': () => setMouseMenu(true), ContextMenu: () => setMouseMenu(true), Escape: () => { setMenu(null); updatePane(active, { selected: [] }); },
      };
      const shortcut = shortcuts[combo];
      if (shortcut) { event.preventDefault(); shortcut(); return; }
      if (event.ctrlKey && combo === 'Ctrl+T') { event.preventDefault(); update('showTabs', true); addTab(active); return; }
      if (combo === 'Ctrl+W') { event.preventDefault(); closeTab(active, current.tab); return; }
      if (event.ctrlKey && (event.key === 'PageUp' || event.key === 'PageDown')) { event.preventDefault(); updatePane(active, { tab: (current.tab + current.tabs.length + (event.key === 'PageUp' ? -1 : 1)) % current.tabs.length, cursor: 0, selected: [] }); return; }
      if (event.key === 'Tab') { event.preventDefault(); setActive(1 - active); listRefs.current[1 - active]?.focus(); return; }
      if (current.mode !== 'list') return;
      if (event.code === 'NumpadAdd') { event.preventDefault(); openTool('Select Group'); return; }
      if (event.code === 'NumpadSubtract') { event.preventDefault(); openTool('Unselect Group'); return; }
      if (event.code === 'NumpadMultiply') { event.preventDefault(); markAll('invert'); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const cursor = Math.max(0, Math.min(currentRows.length - 1, current.cursor + (event.key === 'ArrowDown' ? 1 : -1)));
        // Commander marks/unmarks the row being left, rather than a browser range.
        if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && currentEntry && currentEntry.name !== '..') {
          updatePane(active, { cursor, selected: current.selected.includes(currentEntry.name) ? current.selected.filter(name => name !== currentEntry.name) : [...current.selected, currentEntry.name] });
        } else updatePane(active, { cursor });
        return;
      }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); updatePane(active, { cursor: event.key === 'Home' ? 0 : currentRows.length - 1 }); return; }
      if (event.key === 'Insert' || event.key === ' ') { event.preventDefault(); if (currentEntry) toggleSelection(active, currentEntry, event.key === 'Insert'); return; }
      if (event.key === 'Enter') { event.preventDefault(); if (currentEntry) openEntry(active, currentEntry); return; }
      if (event.key === 'Backspace') { event.preventDefault(); navigate(active, parentOf(path)); return; }
      // Quick search: jump to the first name matching the typed letters.
      const letters = options.quickSearch === 'letters' ? !event.ctrlKey && !event.altKey && !event.metaKey : options.quickSearch === 'alt-letters' ? event.altKey && !event.ctrlKey : false;
      if (letters && event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault();
        const search = quickSearch.current;
        search.text = (Date.now() - search.at < 1000 ? search.text : '') + event.key.toLowerCase(); search.at = Date.now();
        const found = currentRows.findIndex(entry => entry.name !== '..' && (options.quickSearchMatch === 'start' ? entry.name.toLowerCase().startsWith(search.text) : entry.name.toLowerCase().includes(search.text)));
        if (found >= 0) updatePane(active, { cursor: found }); setStatus(`Quick search: ${search.text}${found < 0 ? ' (not found)' : ''}`);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  useEffect(() => { listRefs.current[active]?.querySelector('.focused')?.scrollIntoView({ block: 'nearest' }); }, [active, current.cursor]);

  const close = () => setMenu(null);
  const item = (text: string, action: () => void, shortcut?: string, checked?: boolean): MenuItem => ({ text, action: () => { action(); close(); }, ...(shortcut ? { shortcut } : {}), ...(checked !== undefined ? { checked } : {}) });
  const off = (text: string, reason: string, shortcut?: string): MenuItem => ({ text, disabled: reason, ...(shortcut ? { shortcut } : {}) });
  const net = (protocol: string) => () => { setNetworkProtocol(protocol); setDialog('Network'); setError(''); };
  const menuItems: Record<string, MenuItem[]> = {
    Files: [
      item('Change Attributes…', () => openTool('Change Attributes')),
      item('Pack…', () => runAction('Pack'), 'Alt+F5'), item('Unpack All…', () => runAction('Unpack'), 'Alt+F9'), item('Unpack Specific Files…', () => openTool('Unpack Specific Files')), item('Test Archive(s)', () => openTool('Test Archive'), 'Alt+Shift+F9'),
      'separator',
      item('Compare By Content…', () => openTool('Compare By Content')), item('Properties…', () => openTool('Properties'), 'Alt+Enter'), item('Calculate Occupied Space…', () => openTool('Calculate Occupied Space'), 'Ctrl+L'),
      item('Multi-Rename Tool…', () => runAction('Multi-rename'), 'Ctrl+M'), item('Edit Comment…', () => openTool('Edit Comment'), 'Ctrl+Z'),
      'separator',
      item('Print…', printList), item('Split File…', () => openTool('Split File')), item('Combine Files…', () => openTool('Combine Files')),
      item('Create Checksum File(s) (CRC32, MD5, SHA1)…', () => openTool('Create Checksum')), item('Verify Checksums (from checksum files)', () => openTool('Verify Checksums')),
      'separator',
      ...functionActions.map(action => item(action === 'Move' ? 'Rename/Move' : action, () => runAction(action), options.keys[action])), item('Quit', () => runAction('Exit'), 'Alt+F4'),
    ],
    Mark: [
      item('Select Group…', () => openTool('Select Group'), 'Num +'), item('Unselect Group…', () => openTool('Unselect Group'), 'Num −'), item('Select All', () => markAll('all'), 'Ctrl+A'), item('Unselect All', () => markAll('none'), 'Esc'), item('Invert Selection', () => markAll('invert'), 'Num *'),
      item('Select All With Same Extension', sameExtension),
      'separator',
      item('Save Selection', () => { setSavedSelection(current.selected); setStatus(`Saved ${current.selected.length} selected name(s)`); }), item('Restore Selection', () => { const names = markable().map(entry => entry.name).filter(name => savedSelection.includes(name)); updatePane(active, { selected: names }); setStatus(`Restored ${names.length} name(s)`); }),
      item('Save Selection To File…', saveSelectionToFile), item('Load Selection From File…', () => loadSelectionRef.current?.click()),
      'separator',
      item('Copy Selected Names To Clipboard', () => void copyNames('names')), item('Copy Names With Path To Clipboard', () => void copyNames('paths')), item('Copy To Clipboard With All Details', () => void copyNames('details')), item('Copy To Clipboard With Path+Details', () => void copyNames('path-details')),
      'separator',
      item('Compare Directories', () => compareDirs(false), 'Shift+F2'), item('Mark Newer, Hide Same Files', () => compareDirs(true)),
    ],
    Commands: [
      item('CD Tree…', () => openTool('CD Tree'), 'Alt+F10'), item('Search…', () => runAction('Search'), 'Alt+F7'), off('Volume Label…', LATER), item('System Information…', () => openTool('System Information')),
      'separator',
      item('Synchronize Dirs…', () => runAction('Synchronize')), item('Directory Hotlist', () => showFavorites(active), 'Ctrl+D'), item('Go Back', goBack, 'Alt+←'), item('Branch View (With Subdirs)', toggleBranch, 'Ctrl+B', current.branch),
      item('Background Transfer Manager…', () => openTool('Background Transfer Manager')),
      'separator',
      item('Source ↔ Target', swapPanes, 'Ctrl+U'), item('Target = Source', targetEqualsSource), item('Reread Source', refresh, 'Ctrl+R'),
    ],
    Net: [
      item('Network Connections…', net('SMB')), item('Disconnect Network Drives…', () => disconnect()), off('Share Current Directory…', LATER), off('Unshare Directory…', LATER),
      'separator',
      item('FTP Connect…', net('FTP')), off('FTP New Connection…', LATER), item('FTP Disconnect', () => disconnect('FTP')), item('FTP Show Hidden Files', () => update('showHidden', !hidden), undefined, hidden), off('FTP Download From List…', PHASE4),
      'separator',
      item('SMB Connections…', net('SMB')), item('NFS Connections…', net('NFS')), item('TrueNAS Pools', () => navigate(active, '/mnt')),
    ],
    Show: [
      item('Brief', () => setViewMode('brief'), 'Ctrl+F1', viewMode === 'brief'), item('Full', () => setViewMode('full'), 'Ctrl+F2', viewMode === 'full'), item('Comments', () => setViewMode('comments'), undefined, viewMode === 'comments'),
      item('Custom Columns Mode', () => setViewMode('custom'), undefined, viewMode === 'custom'), item('Custom View Modes…', () => setOptionsOpen(true)),
      item('Tree', () => setPanelMode(active, 'tree'), 'Ctrl+F8', current.mode === 'tree'), item('Separate Tree', () => setSeparateTree(!separateTree), undefined, separateTree),
      item('Thumbnail View', () => setViewMode('thumbs'), undefined, viewMode === 'thumbs'), item('Quick View Panel', () => setPanelMode(1 - active, 'quick'), 'Ctrl+Q', otherPane.mode === 'quick'), item('Vertical Arrangement', () => setVertical(!vertical), undefined, vertical),
      'separator',
      item('New Folder Tab', () => { update('showTabs', true); addTab(active); }, 'Ctrl+T'), item('Folder Tabs', () => update('showTabs', !options.showTabs), undefined, options.showTabs), item('Drive Button Bar', () => update('showDrives', !options.showDrives), undefined, options.showDrives),
      'separator',
      item('All Files', () => setFilter('*.*'), 'Ctrl+F10', current.filter === '*.*'), item('Programs/Scripts', () => setFilter('programs'), undefined, current.filter === 'programs'), item('*.*', () => setFilter('*.*')), item('Custom…', () => openTool('Custom Filter'), undefined, !['*.*', 'programs', 'selected'].includes(current.filter)), item('Only Selected Files', () => setFilter('selected'), 'Ctrl+F12', current.filter === 'selected'),
      'separator',
      item('Name', () => setSort('Name'), 'Ctrl+F3', current.sort === 'Name'), item('Extension', () => setSort('Ext'), 'Ctrl+F4', current.sort === 'Ext'), item('Time', () => setSort('Date'), 'Ctrl+F5', current.sort === 'Date'), item('Size', () => setSort('Size'), 'Ctrl+F6', current.sort === 'Size'), item('Unsorted', () => setSort('Unsorted'), 'Ctrl+F7', current.sort === 'Unsorted'),
      item('Reversed Order', () => updatePane(active, { ascending: !current.ascending }), undefined, !current.ascending),
      'separator',
      item('Show Hidden Files', () => update('showHidden', !hidden), undefined, hidden), item('Reread Source', refresh, 'Ctrl+R'),
    ],
    Configuration: [
      item('Options…', () => setOptionsOpen(true)),
      'separator',
      item('Light theme', () => setTheme('light'), undefined, !dark), item('Dark theme', () => setTheme('dark'), undefined, dark),
      ...(nasMode() ? ['separator' as const, item('Sign out', () => void signOut())] : []),
    ],
    Start: [item('Terminal', () => commandRef.current?.focus()), item('Synchronize directories', () => runAction('Synchronize'))],
    Help: [item('About ClouDouble Commander', () => runAction('About'))],
  };
  const searchResults = dialog === 'Search' && value.trim() ? Object.entries(fs).filter(([folderPath]) => !nasMode() || isLive(folderPath)).flatMap(([folderPath, entries]) => entries.filter(entry => entry.name.toLowerCase().includes(value.toLowerCase())).map(entry => ({ folderPath, entry }))).slice(0, 30) : [];
  const visibleColumns = viewMode === 'comments' ? ['Name', 'Comment'] : ['Name', ...(viewMode === 'custom' || Object.values(options.columns).some(shown => !shown) ? (['Ext', 'Size', 'Date', 'Attr'] as const).filter(column => options.columns[column.toLowerCase() as 'ext']) : ['Ext', 'Size', 'Date', 'Attr'])];
  const customGrid = viewMode === 'comments' ? { gridTemplateColumns: 'minmax(100px, 1fr) minmax(80px, 1fr)' } : visibleColumns.length < 5 ? { gridTemplateColumns: ['minmax(100px, 1fr)', ...visibleColumns.slice(1).map(column => ({ Ext: '38px', Size: '72px', Date: '112px', Attr: '49px' })[column as 'Ext'])].join(' ') } : undefined;
  const sizeText = (size: number) => options.sizeFormat === 'dynamic' ? formatSize(size) : options.sizeFormat === 'kilobytes' ? `${Math.ceil(size / 1024).toLocaleString('en-US').replaceAll(',', ' ')} k` : size.toLocaleString('en-US').replaceAll(',', ' ');
  const dateText = (date: string) => { if (options.dateFormat === 'iso' || !date) return date; const parsed = new Date(date.replace(' ', 'T')); return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); };
  const displayName = (entry: FileEntry) => entry.name === '..' ? '[..]' : entry.directory ? (options.squareBrackets ? `[${entry.name}]` : entry.name) : extension(entry) && visibleColumns.includes('Ext') ? entry.name.slice(0, -(extension(entry).length + 1)) : entry.name;
  const quickEntry = currentEntry && !currentEntry.directory ? currentEntry : undefined;
  const commanderClass = `commander bg-background text-foreground font-${options.fontSize} rows-${options.rowHeight} mark-${options.markColor} cursor-${options.cursorStyle}`;

  return <div className={dark ? 'dark' : ''}><main className={commanderClass} onClick={() => { if (menu) setMenu(null); }}>
    <header className="app-header">
      <div className="app-brand"><div className="brand-icon"><CommanderIcon name="app" /></div><div className="brand-name">ClouDouble Commander <span className="title-path">— TrueNAS</span></div></div>
      <div className="header-right"><Button variant="ghost" className="theme-button" title={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={dark ? 'Switch to Total Commander Light Mode' : 'Switch to Total Commander Dark Mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={13} /> : <Moon size={13} />}</Button></div>
    </header>
    <nav className="menu-bar" aria-label="Main menu">{Object.entries(menuItems).map(([name, items]) => <div className="menu-wrap" key={name} onClick={event => event.stopPropagation()}><Button variant="ghost" className="menu-trigger" aria-expanded={menu === name} onClick={() => setMenu(menu === name ? null : name)}>{name}</Button>{menu === name && <div className="menu-dropdown" role="menu">{items.map((entry, index) => entry === 'separator' ? <div key={`s${index}`} className="menu-separator" role="separator" /> : <Button key={entry.text} role="menuitem" variant="ghost" className="menu-item" disabled={!!entry.disabled} title={entry.disabled} onClick={entry.action}><span className="menu-check">{entry.checked ? '✓' : <CommanderMenuIcon text={entry.text} />}</span><span className="menu-text">{entry.text}</span><span className="text-muted-foreground text-[10px]">{entry.disabled ? 'later' : entry.shortcut}</span></Button>)}</div>}</div>)}</nav>
    <input ref={loadSelectionRef} type="file" accept=".txt,text/plain" className="hidden" aria-label="Load selection file" onChange={event => { void loadSelectionFile(event.target.files?.[0]); event.target.value = ''; }} />
    {options.showToolbar && <div className="toolbar" role="toolbar" aria-label="Quick actions">
      <Tool title="Reread source" icon={<CommanderIcon name="refresh" />} action={refresh} />
      <span className="tool-separator" />
      <Tool title="Browse pools" icon={<CommanderIcon name="sync" />} action={() => navigate(active, '/mnt')} />
      <Tool title={brief ? 'Full view' : 'Brief view'} icon={<CommanderIcon name="details" />} action={() => setViewMode(brief ? 'full' : 'brief')} />
      <Tool title="View file · F3" icon={<CommanderIcon name="image" />} action={() => runAction('View')} />
      <Tool title="Synchronize directories" icon={<CommanderIcon name="sync" />} action={() => runAction('Synchronize')} />
      <span className="tool-separator" />
      <Tool title="Multi-rename" icon={<CommanderIcon name="rename" />} action={() => runAction('Multi-rename')} />
      <Tool title="Directory hotlist" icon={<CommanderIcon name="folder" />} action={() => showFavorites(active)} />
      <span className="tool-separator" />
      <Tool title="Go back" icon={<CommanderIcon name="back" />} action={goBack} />
      <Tool title="Target = Source" icon={<CommanderIcon name="forward" />} action={targetEqualsSource} />
      <span className="tool-separator" />
      <Tool title="Pack files" icon={<CommanderIcon name="pack" />} action={() => runAction('Pack')} />
      <Tool title="Unpack archive" icon={<CommanderIcon name="unpack" />} action={() => runAction('Unpack')} />
      <span className="tool-separator" />
      <Tool title="Search files" icon={<CommanderIcon name="search" />} action={() => runAction('Search')} />
      <Tool title="Edit file · F4" icon={<CommanderIcon name="edit" />} action={() => runAction('Edit')} />
      <Tool title="Copy · F5" icon={<CommanderIcon name="copy" />} action={() => runAction('Copy')} />
      <Tool title="New folder · F7" icon={<CommanderIcon name="new-folder" />} action={() => runAction('New Folder')} />
      <span className="tool-separator" />
      <Tool title="Terminal" icon={<CommanderIcon name="terminal" />} action={() => commandRef.current?.focus()} />
      <Tool title="Options" icon={<CommanderIcon name="settings" />} action={() => setOptionsOpen(true)} />
    </div>}
    {exited ? <div className="flex flex-1 flex-col items-center justify-center gap-4"><LayoutPanelLeft size={36} className="text-muted-foreground" /><h1 className="text-xl font-semibold">Session closed</h1><Button onClick={() => { setExited(false); setStatus('Ready'); }}>Reopen Commander</Button></div> : <>
    <div className={`panes ${vertical ? 'vertical' : ''} ${options.showCenterToolbar ? '' : 'no-divider'}`}>{panes.map((pane, index) => {
      const panePath = getPath(pane); const rows = rowsFor(pane); const entries = fs[panePath] ?? []; const selectedSize = entries.filter(entry => pane.selected.includes(entry.name)).reduce((sum, entry) => sum + entry.size, 0);
      const side = index === 0 ? 'Left' : 'Right';
      const rowClick = (entry: FileEntry, rowIndex: number) => (event: React.MouseEvent) => {
        setActive(index); const updates: Partial<PaneState> = { cursor: rowIndex };
        if (event.shiftKey) updates.selected = Array.from(new Set([...pane.selected, ...rows.slice(Math.min(pane.cursor, rowIndex), Math.max(pane.cursor, rowIndex) + 1).filter(item => item.name !== '..').map(item => item.name)]));
        else if ((event.ctrlKey || event.metaKey) && entry.name !== '..') updates.selected = pane.selected.includes(entry.name) ? pane.selected.filter(name => name !== entry.name) : [...pane.selected, entry.name];
        updatePane(index, updates); listRefs.current[index]?.focus();
      };
      return <div key={index} className="contents">{index === 1 && options.showCenterToolbar && !vertical && <div className="pane-divider" role="toolbar" aria-label="Center file actions"><Tool title="View · F3" icon={<CommanderIcon name="view" />} action={() => runAction('View')} /><Tool title="Edit · F4" icon={<CommanderIcon name="edit" />} action={() => runAction('Edit')} /><Tool title="Copy selected · F5" icon={<CommanderIcon name="copy" />} action={() => runAction('Copy')} /><Tool title="Delete · F8" icon={<CommanderIcon name="delete" />} action={() => runAction('Delete')} /><span className="center-separator" /><Tool title="Pack selected files" icon={<CommanderIcon name="pack" />} action={() => runAction('Pack')} /><Tool title="Create folder · F7" icon={<CommanderIcon name="new-folder" />} action={() => runAction('New Folder')} /></div>}<section className={`pane ${active === index ? 'active' : ''} ${brief ? 'brief' : ''}`} aria-label={`${side} file pane`} onDragOver={allowDrop} onDrop={event => receiveDrop(event, panePath)} onPointerDown={() => setActive(index)}>
        <div className="pane-top"><div className="flex items-center gap-1"><CommanderIcon name="drive" /><select aria-label={`${side} dataset`} value={isLive(panePath) ? panePath.slice(0, (panePath + '/').indexOf('/', LIVE_PREFIX.length)) : datasets.includes(panePath) ? panePath : datasets.find(dataset => panePath.startsWith(dataset)) ?? ''} onChange={event => navigate(index, event.target.value)}><option value="" disabled>Filesystem</option>{liveConnections.map(connection => <option key={connection.id} value={LIVE_PREFIX + connection.id}>{connection.label} (NAS)</option>)}{(nasMode() ? [] : datasets).map(dataset => <option key={dataset} value={dataset}>{dataset === '/etc' ? '/etc' : dataset.replace('/mnt/', '')}</option>)}</select></div><span className="disk-space">{isLive(panePath) ? (() => { const space = liveSpace[panePath.slice(0, (panePath + '/').indexOf('/', LIVE_PREFIX.length))]; const access = canWrite(connectionOf(panePath)) ? '' : ' · read-only'; return space ? `${formatSize(space.available)} free of ${formatSize(space.total)}${access}` : `NAS${access}`; })() : 'Sample volume · free space unavailable'}</span><Button variant="ghost" className="volume-root" title="Filesystem root" onClick={() => navigate(index, isLive(panePath) ? LIVE_PREFIX + splitLive(panePath).id : '/')}>\</Button><Button variant="ghost" className="volume-root" title="Parent directory" onClick={() => navigate(index, parentOf(panePath))}>..</Button></div>
        {options.showDrives && <div className="drive-strip" role="toolbar" aria-label={`${side} quick drives`}>{(nasMode() ? [] : fs['/mnt'] ?? []).filter(entry => entry.directory).map(entry => ({ label: entry.name, path: joinPath('/mnt', entry.name) })).map(drive => <Button variant="ghost" className={`drive-button ${panePath.startsWith(drive.path) ? 'drive-current' : ''}`} key={drive.label} onClick={() => navigate(index, drive.path)}><CommanderIcon name="drive" />{drive.label}</Button>)}{liveConnections.map(connection => <Button variant="ghost" className={`drive-button ${panePath.startsWith(LIVE_PREFIX + connection.id) ? 'drive-current' : ''}`} key={connection.id} title={`${connection.label}${canWrite(connection) ? '' : ' · read-only'}`} onClick={() => navigate(index, LIVE_PREFIX + connection.id)}><CommanderIcon name="drive" />{connection.label}</Button>)}<Button variant="ghost" className="drive-button" title="Filesystem root" onClick={() => navigate(index, isLive(panePath) ? LIVE_PREFIX + splitLive(panePath).id : '/')}>\</Button><Button variant="ghost" className="drive-button" title="Directory hotlist" onClick={() => showFavorites(index)}>*</Button></div>}
        {options.showTabs && <div className={`folder-tabs ${options.tabsOnTop ? '' : 'order-last'}`} role="tablist" aria-label={`${side} folder tabs`}>{pane.tabs.map((tab, tabIndex) => <div className="tab-group" key={tabIndex}><Button variant="ghost" role="tab" title={tab} aria-selected={pane.tab === tabIndex} className={`folder-tab ${pane.tab === tabIndex ? 'current' : ''}`} onContextMenu={event => { event.preventDefault(); updatePane(index, { tab: tabIndex, cursor: 0, selected: [] }); showTabActions(index); }} onAuxClick={event => { if (event.button === 1) closeTab(index, tabIndex); }} onDragOver={allowDrop} onDrop={event => receiveDrop(event, tab)} onClick={() => updatePane(index, { tab: tabIndex, cursor: 0, selected: [] })}><CommanderIcon name="folder" />{tab.split('/').pop() || '/'}</Button>{pane.tabs.length > 1 && <Button variant="ghost" size="icon" className="tab-close" title="Close tab" aria-label={`Close ${side.toLowerCase()} tab ${tabIndex + 1}`} onClick={() => closeTab(index, tabIndex)}><X size={11} /></Button>}</div>)}<Button variant="ghost" size="icon" className="tool h-7 w-7" title="New folder tab" aria-label={`New ${side.toLowerCase()} folder tab`} onClick={() => addTab(index)}><Plus size={13} /></Button></div>}
        <div className="path-bar"><Folder size={14} className="text-muted-foreground shrink-0" /><input aria-label={`${side} directory path`} key={panePath + pane.filter} defaultValue={`${panePath}/${pane.filter === 'programs' ? '*.sh;*.py' : pane.filter === 'selected' ? '(selected)' : pane.filter}${pane.branch ? ' [branch]' : ''}`} onKeyDown={event => { if (event.key === 'Enter') { navigate(index, event.currentTarget.value.replace(/\/[^/]*[*?(][^/]*$/, '')); event.currentTarget.blur(); } }} /><Button variant="ghost" className="path-favorite" title="Directory hotlist" onClick={() => showFavorites(index)}>*</Button><select className="history-select" aria-label={`${side} directory history`} value="" onChange={event => navigate(index, event.target.value)}><option value="">▾</option>{history.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
        {pane.mode === 'tree' ? <div className="file-list tree-list" aria-label={`${side} folder tree`}>{directoryTree(fs).map(node => <Button key={node.path} variant="ghost" className={`tree-item ${node.path === getPath(getPane(1 - index)) ? 'current' : ''}`} style={{ paddingLeft: 6 + node.depth * 14 }} onClick={() => navigate(1 - index, node.path)}>[{node.name}]</Button>)}</div>
        : pane.mode === 'quick' ? <div className="file-list quick-view" aria-label={`${side} quick view`}>{quickEntry ? <><div className="quick-title"><EntryIcon entry={quickEntry} />{quickEntry.name} · {formatSize(quickEntry.size)}</div><pre className={options.viewerWrap ? 'whitespace-pre-wrap' : ''} style={{ tabSize: options.tabSize }}>{isLive(path) ? quickText?.key === `${path}/${quickEntry.name}` ? quickText.text : 'Loading…' : quickEntry.content ?? ''}</pre></> : <p className="p-3 text-xs text-muted-foreground">Move the cursor to a file in the other panel to preview it.</p>}</div>
        : <div className="pane-body">
          {separateTree && <div className="side-tree" aria-label={`${side} separate tree`}>{directoryTree(fs).map(node => <Button key={node.path} variant="ghost" className={`tree-item ${node.path === panePath ? 'current' : ''}`} style={{ paddingLeft: 4 + node.depth * 10 }} onClick={() => navigate(index, node.path)}>{node.name}</Button>)}</div>}
          <div className="pane-main">
            {viewMode !== 'thumbs' && <div className="file-columns" style={customGrid}>{visibleColumns.map(column => <Button variant="ghost" key={column} className={`column-button ${column === 'Attr' ? 'attr-column' : column === 'Date' ? 'date-column' : ''}`} onClick={() => column !== 'Comment' && updatePane(index, { sort: column, ascending: pane.sort === column ? !pane.ascending : true, cursor: 0 })}>{column}{pane.sort === column && (pane.ascending ? <ArrowUp /> : <ArrowDown />)}</Button>)}</div>}
            <div className={`file-list ${viewMode === 'thumbs' ? 'thumb-grid' : ''}`} role="grid" aria-label={`${side} files`} aria-multiselectable="true" tabIndex={0} ref={element => { listRefs.current[index] = element; }} onFocus={() => setActive(index)}>{rows.map((entry, rowIndex) => {
              const className = `${active === index && pane.cursor === rowIndex ? 'focused' : ''} ${pane.selected.includes(entry.name) ? 'selected' : ''}`;
              if (viewMode === 'thumbs') return <div key={entry.name} role="row" aria-selected={pane.selected.includes(entry.name)} className={`thumb ${className}`} {...mouseHandlers(index, entry, rowIndex)} onClick={rowClick(entry, rowIndex)} onDoubleClick={() => openEntry(index, entry)}><div role="gridcell" className="thumb-cell"><EntryIcon entry={entry} /><span>{entry.name === '..' ? '[..]' : entry.name}</span></div></div>;
              return <div key={entry.name} role="row" aria-selected={pane.selected.includes(entry.name)} className={`file-row ${className}`} style={customGrid} {...mouseHandlers(index, entry, rowIndex)} onClick={rowClick(entry, rowIndex)} onDoubleClick={() => openEntry(index, entry)}><div className="filename" role="gridcell"><EntryIcon entry={entry} /><span>{displayName(entry)}</span></div>{visibleColumns.slice(1).map(column => <div key={column} className={`file-cell ${column === 'Size' ? 'file-size' : column === 'Date' ? 'date-column' : column === 'Attr' ? 'attr-column' : ''}`} role="gridcell">{column === 'Comment' ? comments[joinPath(panePath, entry.name)] ?? '' : column === 'Ext' ? extension(entry) : column === 'Size' ? entry.directory ? entry.name === '..' ? '' : '<DIR>' : sizeText(entry.size) : column === 'Date' ? dateText(entry.date) : entry.attr}</div>)}</div>;
            })}</div>
          </div>
        </div>}
        <div className="pane-footer"><span className={pane.selected.length ? 'selected-status' : ''}>{Math.round(selectedSize / 1024).toLocaleString('en-US')} k / {Math.round(entries.reduce((sum, entry) => sum + entry.size, 0) / 1024).toLocaleString('en-US')} k in {entries.filter(entry => !entry.directory && pane.selected.includes(entry.name)).length} / {entries.filter(entry => !entry.directory).length} files, {entries.filter(entry => entry.directory && pane.selected.includes(entry.name)).length} / {entries.filter(entry => entry.directory).length} dirs</span></div>
      </section></div>;
    })}</div>
    <div className="detail-line"><span className="flex items-center gap-2"><Info size={13} />{currentEntry?.name === '..' ? 'Parent directory' : currentEntry ? `${currentEntry.name} · ${currentEntry.directory ? 'Directory' : formatSize(currentEntry.size)}${comments[joinPath(path, currentEntry.name)] ? ` · ${comments[joinPath(path, currentEntry.name)]}` : ''}` : 'Empty directory'}</span><span className="font-mono text-[10px]">{currentEntry?.attr}</span></div>
    {options.showCommandLine && <form className="command-line" onSubmit={event => { event.preventDefault(); if (command.startsWith('cd ')) navigate(active, command.slice(3).startsWith('/') ? command.slice(3) : joinPath(path, command.slice(3))); else setStatus(command ? 'Only directory navigation is available in this shell.' : 'Ready'); setCommand(''); }}><span className="shell-prompt">{path}&gt;</span><input ref={commandRef} aria-label="Command line" value={command} onChange={event => setCommand(event.target.value)} /><Button variant="ghost" size="icon" className="tool" title="Run command" type="submit"><ChevronRight /></Button></form>}
    <TransferStrip jobs={allJobs.filter(job => job.state !== 'completed' && job.id !== transferId)} restore={setTransferId} dismiss={id => jobControl(id).dismiss(id)} />
    {options.showFunctionKeys && <div className="function-strip">{[...functionActions, 'Exit' as const].map(action => <Button variant="ghost" key={action} className="function-button" onClick={() => runAction(action)}><kbd>{action === 'Exit' ? 'Alt+F4' : options.keys[action]}</kbd>{action === 'Move' ? 'RenMov' : action === 'New Folder' ? 'NewFolder' : action}</Button>)}</div>}
    </>}
    {options.showStatusBar && <footer className={`app-status ${status === 'Ready' ? 'idle' : ''}`}><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-success" /><span role="status">{status}</span></span><span className="flex items-center gap-4"><span className="flex items-center gap-1"><ShieldCheck size={12} /> {nasMode() ? 'NAS session' : 'Local mock session'}</span><span>Commander / v0.1.0</span></span></footer>}
    <TransferWindow job={liveConflictJob ? undefined : allJobs.find(job => job.id === transferId)} dark={dark} minimize={() => setTransferId(null)} togglePause={id => jobControl(id).togglePause(id)} cancel={id => jobControl(id).cancel(id)} />
    <ToolDialog tool={tool} close={() => { setTool(null); requestAnimationFrame(() => listRefs.current[active]?.focus()); }} dark={dark} fs={fs} path={path} destination={destination} targets={targets} entry={currentEntry} otherEntry={otherEntry} comments={comments}
      setComment={(fullPath, text) => { setComments(old => { const next = { ...old }; if (text) next[fullPath] = text; else delete next[fullPath]; return next; }); setStatus(text ? 'Comment saved' : 'Comment removed'); }}
      apply={applyOperation} group={group} navigate={next => navigate(active, next)} setFilter={setFilter}
      jobs={allJobs} togglePause={id => jobControl(id).togglePause(id)} cancel={id => jobControl(id).cancel(id)} restore={setTransferId}
      info={[['Mode', nasMode() ? 'Running on your NAS' : 'Sample session in the browser'], ['NAS connections', liveConnections.length ? liveConnections.map(connection => `${connection.label} (${connection.protocol.toUpperCase()})`).join(', ') : 'None'], ['Active folder', path], ['Browser', typeof navigator === 'undefined' ? '' : navigator.userAgent.split(') ').pop() ?? ''], ['App version', 'Commander v0.1.0'], ['NAS details', 'Pool health and TrueNAS version will appear here in a later phase']]} />
    <LiveToolDialog tool={liveTool} close={() => { setLiveTool(null); requestAnimationFrame(() => listRefs.current[active]?.focus()); }} dark={dark} path={path} destination={destination} targets={targets} entry={currentEntry} otherEntry={otherEntry} writableHere={isLive(path) && canWrite(connectionOf(path))}
      done={(message, folders) => { void Promise.all([...new Set(folders)].map(loadLive)).then(() => { refreshPanePaths(fsRef.current); setStatus(message); }); }} />
    <TransferConflictDialog conflict={liveConflictJob?.conflict ?? pendingTransfer?.conflicts[0] ?? null} dark={dark} busy={conflictBusy} error={conflictError} choose={choice => { void chooseDuplicate(choice); }} cancel={() => { if (liveConflictJob) liveTransfers.cancel(liveConflictJob.id); setPendingTransfer(null); setConflictError(''); }} />
    <Dialog open={mouseMenu} onOpenChange={setMouseMenu}><DialogContent className={`${dark ? 'dark' : ''} bg-background text-foreground max-w-sm`}><DialogHeader><DialogTitle>File actions</DialogTitle><DialogDescription>{targets.join(', ') || currentEntry?.name || path}</DialogDescription></DialogHeader><div className="file-action-list">{(['View', 'Edit', 'Copy', 'Move', 'Pack', 'Unpack', 'Delete'] as Action[]).map(action => <Button key={action} variant="ghost" className="justify-start" onClick={() => { setMouseMenu(false); runAction(action); }}><CommanderMenuIcon text={action} />{action}</Button>)}<Button variant="ghost" className="justify-start" onClick={() => { setMouseMenu(false); openTool('Properties'); }}><CommanderMenuIcon text="Properties" />Properties</Button></div></DialogContent></Dialog>
    <Dialog open={dropTransfer !== null} onOpenChange={open => { if (!open) setDropTransfer(null); }}><DialogContent onKeyDown={event => { if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement) && dropTransfer) { event.preventDefault(); try { startTransfer(dropTransfer.kind, dropTransfer.target, dropTransfer.source, dropTransfer.names); setDropTransfer(null); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Transfer failed'); } } }} className={`${dark ? 'dark' : ''} bg-background text-foreground`}><DialogHeader><DialogTitle>{dropTransfer?.kind} {dropTransfer?.names.length} item(s)</DialogTitle><DialogDescription>{dropTransfer?.source}</DialogDescription></DialogHeader><div className="dialog-path">{dropTransfer?.names.join(', ')}</div><label className="text-xs">Destination<input autoFocus className="dialog-input mt-2" value={dropTransfer?.target ?? ''} onChange={event => { const target = event.target.value; setDropTransfer(old => old ? { ...old, target } : null); }} /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setDropTransfer(null)}>Cancel</Button><Button onClick={() => { if (!dropTransfer) return; try { startTransfer(dropTransfer.kind, dropTransfer.target, dropTransfer.source, dropTransfer.names); setDropTransfer(null); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Transfer failed'); } }}>{dropTransfer?.kind}</Button></DialogFooter></DialogContent></Dialog>
    <OptionsDialog open={optionsOpen} close={() => setOptionsOpen(false)} dark={dark} options={options} save={setOptions} theme={theme} setTheme={setTheme} />
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) { setDialog(null); requestAnimationFrame(() => listRefs.current[active]?.focus()); } }}><DialogContent onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLButtonElement) && dialog && !['View', 'About', 'Search', 'Favorites', 'Network', 'Tabs'].includes(dialog)) { event.preventDefault(); event.stopPropagation(); confirmAction(); } }} onCloseAutoFocus={event => { event.preventDefault(); listRefs.current[active]?.focus(); }} className={`${dark ? 'dark' : ''} bg-background text-foreground ${dialog === 'Edit' || dialog === 'View' ? 'max-w-2xl' : ''}`}><DialogHeader><DialogTitle>{dialog === 'Favorites' ? 'Directory hotlist' : dialog === 'Network' ? `${networkProtocol} connections` : dialog === 'Tabs' ? 'Folder tab' : dialog === 'About' ? 'ClouDouble Commander' : dialog === 'View' || dialog === 'Edit' ? `${dialog} — ${liveFile?.name ?? currentEntry?.name}` : dialog === 'Search' ? 'Search files' : dialog === 'New Folder' ? 'Create new folder' : dialog === 'Exit' ? 'Close this session?' : `${dialog} ${targets.length} item${targets.length === 1 ? '' : 's'}`}</DialogTitle><DialogDescription>{dialog === 'Network' ? liveConnections.length ? 'Connections configured on your TrueNAS' : 'Not connected · TrueNAS access service required' : dialog === 'Favorites' || dialog === 'Tabs' ? getPath(getPane(navigationPane)) : dialog === 'About' ? 'Web-native dual-pane file manager' : dialog === 'Delete' ? isLive(path) ? 'These items and everything inside them will be permanently deleted from your NAS. This cannot be undone.' : 'These items and their contents will be removed from the sample files.' : dialog === 'Exit' ? 'Your sample files will remain available until you reload the page.' : dialog === 'View' || dialog === 'Edit' ? joinPath(path, currentEntry?.name ?? '') : dialog === 'Search' ? nasMode() ? 'Search loaded NAS folders by filename.' : 'Search all sample datasets by filename.' : path}</DialogDescription></DialogHeader>
      {(dialog === 'Copy' || dialog === 'Move') && <><div className="dialog-path">{targets.join(', ')}</div><label className="text-xs">Destination<input autoFocus className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label></>}
      {(dialog === 'Pack' || dialog === 'Multi-rename') && <label className="text-xs">{dialog === 'Pack' ? 'Archive name' : 'Rename pattern ({name}, {n})'}<input autoFocus className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label>}
      {dialog === 'Pack' && <div className="dialog-path">{path} → {destination}</div>}
      {dialog === 'Multi-rename' && <div className="dialog-path rename-preview">{targets.map((name, i) => <div key={name}>{name} → {value.replaceAll('{name}', name).replaceAll('{n}', String(i + 1))}</div>)}</div>}
      {(dialog === 'Unpack' || dialog === 'Synchronize') && <div className="dialog-path">{path} → {destination}</div>}
      {dialog === 'New Folder' && <label className="text-xs">Folder name<input autoFocus className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label>}
      {dialog === 'Delete' && <div className="dialog-path">{targets.join('\n')}</div>}
      {(dialog === 'View' || dialog === 'Edit') && <textarea className={`editor ${options.viewerMonospace ? '' : 'font-sans'}`} wrap={options.viewerWrap ? 'soft' : 'off'} style={{ tabSize: options.tabSize }} aria-label="File content" readOnly={dialog === 'View'} value={value} onChange={event => setValue(event.target.value)} />}
      {dialog === 'About' && <p className="text-sm leading-6 text-muted-foreground">Double Commander-inspired browsing and file operations in your browser. {nasMode() ? 'This session operates on your configured NAS folders.' : 'This session uses sample datasets, not your server’s files.'}</p>}
      {dialog === 'Search' && <><input autoFocus className="dialog-input" aria-label="Search filename" value={value} onChange={event => setValue(event.target.value)} /><div className="max-h-72 overflow-y-auto">{searchResults.map(({ folderPath, entry }) => <Button key={joinPath(folderPath, entry.name)} variant="ghost" className="w-full justify-start text-xs" onClick={() => { navigate(active, folderPath); setDialog(null); setStatus(`Found ${entry.name} in ${folderPath}`); }}><EntryIcon entry={entry} /><span className="truncate">{joinPath(folderPath, entry.name)}</span></Button>)}{value && !searchResults.length && <p className="text-xs text-muted-foreground py-3">No matching files.</p>}</div></>}
      {dialog === 'Favorites' && <><div className="favorite-list">{favorites.map(favorite => <div key={favorite} className="flex items-center min-w-0"><Button variant="ghost" className="flex-1 truncate text-xs" onClick={() => { navigate(navigationPane, favorite); setDialog(null); }}><Folder size={14} /><span className="truncate">{favorite}</span></Button><Button variant="ghost" size="icon" title="Remove favorite" aria-label={`Remove favorite ${favorite}`} onClick={() => setFavorites(old => old.filter(item => item !== favorite))}><X size={13} /></Button></div>)}</div><Button variant="outline" disabled={favorites.includes(getPath(getPane(navigationPane)))} onClick={() => setFavorites(old => [...old, getPath(getPane(navigationPane))])}><Plus size={14} />Add current directory</Button></>}
      {dialog === 'Tabs' && <div className="favorite-list"><Button variant="outline" onClick={() => { addTab(navigationPane); setDialog(null); }}>Duplicate tab</Button><Button variant="outline" disabled={getPane(navigationPane).tabs.length < 2} onClick={() => { closeTab(navigationPane, getPane(navigationPane).tab); setDialog(null); }}>Close tab</Button><Button variant="outline" disabled={getPane(navigationPane).tabs.length < 2} onClick={() => { if (options.confirmCloseAllTabs && !window.confirm('Close all other tabs in this panel?')) return; updatePane(navigationPane, { tabs: [getPath(getPane(navigationPane))], tab: 0, cursor: 0, selected: [] }); setDialog(null); }}>Close other tabs</Button><Button variant="outline" onClick={() => { const other = 1 - navigationPane; const pane = getPane(other); updatePane(other, { tabs: [...pane.tabs, getPath(getPane(navigationPane))], tab: pane.tabs.length, cursor: 0, selected: [] }); setDialog(null); }}>Open in other pane</Button></div>}
      {dialog === 'Network' && <><div className="flex gap-2">{['FTP', 'SMB', 'NFS'].map(protocol => <Button key={protocol} variant={networkProtocol === protocol ? 'default' : 'outline'} onClick={() => setNetworkProtocol(protocol)}>{protocol}</Button>)}</div>{liveConnections.length ? <div className="favorite-list">{liveConnections.map(connection => <Button key={connection.id} variant="ghost" className="justify-start text-xs" onClick={() => { navigate(active, LIVE_PREFIX + connection.id); setDialog(null); }}><Server size={14} />{connection.label} · {connection.protocol.toUpperCase()}{canWrite(connection) ? '' : ' · read-only'}</Button>)}</div> : <p className="text-sm text-muted-foreground">No {networkProtocol} server is connected. Install and configure the file-access service on TrueNAS before browsing remote files.</p>}<p className="text-xs text-muted-foreground">Server credentials must stay on TrueNAS, not in this browser.</p></>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>{dialog && ['View', 'About', 'Search', 'Favorites', 'Network', 'Tabs'].includes(dialog) ? 'Close' : 'Cancel'}</Button>{dialog && !['View', 'About', 'Search', 'Favorites', 'Network', 'Tabs'].includes(dialog) && <Button variant={dialog === 'Delete' ? 'destructive' : 'default'} onClick={confirmAction}>{dialog === 'Edit' ? 'Save' : dialog === 'New Folder' ? 'Create folder' : dialog === 'Exit' ? 'Close session' : dialog}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  </main></div>;
}
function Tool({ title, icon, action }: { title: string; icon: React.ReactNode; action: () => void }) { return <Button variant="ghost" size="icon" className="tool" title={title} aria-label={title} onClick={action}>{icon}</Button>; }

function normalizePath(path: string) { const segments: string[] = []; for (const segment of path.split('/')) { if (segment === '..') segments.pop(); else if (segment && segment !== '.') segments.push(segment); } return '/' + segments.join('/'); }
