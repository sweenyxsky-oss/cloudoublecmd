import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { FilesystemOperation } from '@/lib/filesystem-operations';
import { attributeString, checksumExtension, checksumFile, combineFiles, directoryTree, fileText, lineDiff, occupiedSpace, splitFile, verifyChecksums, type ChecksumAlgorithm } from '@/lib/commander-tools';
import { extension, formatSize, joinPath, type FileEntry, type FileSystem } from '@/lib/mock-filesystem';
import type { TransferJob } from '@/lib/mock-transfers';

export type ToolName = 'Change Attributes' | 'Unpack Specific Files' | 'Test Archive' | 'Compare By Content' | 'Properties' | 'Calculate Occupied Space' | 'Edit Comment' | 'Split File' | 'Combine Files' | 'Create Checksum' | 'Verify Checksums' | 'Select Group' | 'Unselect Group' | 'CD Tree' | 'System Information' | 'Background Transfer Manager' | 'Custom Filter';

type Props = {
  tool: ToolName | null; close: () => void; dark: boolean; fs: FileSystem; path: string; destination: string; targets: string[]; entry: FileEntry | undefined;
  otherEntry: FileEntry | undefined; comments: Record<string, string>; setComment: (fullPath: string, text: string) => void;
  apply: (operation: FilesystemOperation, status: string) => void; group: (pattern: string, add: boolean) => void; navigate: (path: string) => void; setFilter: (pattern: string) => void;
  jobs: TransferJob[]; togglePause: (id: number) => void; cancel: (id: number) => void; restore: (id: number) => void; info: [string, string][];
};

const now = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const readArchive = (entry: FileEntry | undefined): FileEntry[] => {
  if (!entry || entry.directory || !['zip', 'tar', 'gz'].includes(extension(entry))) throw new Error('Select an archive (.zip, .tar, .gz) first.');
  let parsed: unknown;
  try { parsed = JSON.parse(entry.content ?? ''); } catch { throw new Error('Only archives packed in this sample session can be opened.'); }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.name !== 'string')) throw new Error('Archive is damaged.');
  return parsed as FileEntry[];
};

export function ToolDialog(props: Props) {
  const { tool, close, dark, fs, path, destination, targets, entry, otherEntry, comments } = props;
  const [value, setValue] = useState('');
  const [second, setSecond] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm>('md5');
  const [error, setError] = useState('');
  const folder = fs[path] ?? [];
  const chosen = folder.filter(item => targets.includes(item.name));
  useEffect(() => {
    if (!tool) return;
    setError(''); setPicked([]); setSecond('');
    const first = chosen[0];
    if (tool === 'Change Attributes') { setValue(first?.attr.slice(1) ?? 'rw-r--r--'); setSecond(first?.date ?? now()); }
    else if (tool === 'Edit Comment') setValue(entry ? comments[joinPath(path, entry.name)] ?? '' : '');
    else if (tool === 'Split File') setValue('1024');
    else if (tool === 'Create Checksum') setValue(`${chosen.length === 1 ? first!.name : 'checksums'}.md5`);
    else if (tool === 'Select Group' || tool === 'Unselect Group' || tool === 'Custom Filter') setValue(entry && !entry.directory && extension(entry) ? `*.${extension(entry)}` : '*.*');
    else setValue('');
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  function run(fn: () => void) { try { setError(''); fn(); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Operation failed.'); } }
  let body: React.ReactNode = null; let confirm: (() => void) | null = null; let confirmText = 'OK';
  let description = path;

  if (tool === 'Change Attributes') {
    body = <><div className="dialog-path">{targets.join(', ') || 'Nothing selected'}</div><label className="text-xs">Permissions (owner, group, others)<input className="dialog-input mt-2 font-mono" value={value} onChange={event => setValue(event.target.value)} /></label><div className="flex gap-3 text-xs">{['Owner', 'Group', 'Others'].map((who, index) => <span key={who} className="flex gap-1 items-center">{who}:{['r', 'w', 'x'].map((flag, bit) => { const at = index * 3 + bit; return <label key={flag} className="flex items-center gap-0.5"><input type="checkbox" checked={value[at] === flag} onChange={event => setValue(old => old.padEnd(9, '-').split('').map((c, i) => i === at ? (event.target.checked ? flag : '-') : c).join(''))} />{flag}</label>; })}</span>)}</div><label className="text-xs">Modified date<input className="dialog-input mt-2" value={second} onChange={event => setSecond(event.target.value)} /></label></>;
    confirm = () => run(() => { const attr = attributeString(false, value); props.apply({ type: 'attributes', path, names: targets, attr, date: second }, `Attributes changed for ${targets.length} item(s)`); close(); });
  } else if (tool === 'Unpack Specific Files' || tool === 'Test Archive') {
    let items: FileEntry[] = []; let problem = '';
    try { items = readArchive(entry); } catch (failure) { problem = (failure as Error).message; }
    description = tool === 'Test Archive' ? entry?.name ?? path : `${entry?.name ?? ''} → ${destination}`;
    body = problem ? <p className="text-sm text-destructive">{problem}</p> : tool === 'Test Archive' ? <p className="text-sm">Archive OK: {items.length} entries, {formatSize(items.reduce((sum, item) => sum + item.size, 0))}. No errors found.</p> : <div className="favorite-list">{items.map(item => <label key={item.name} className="option-row"><input type="checkbox" disabled={item.directory} checked={picked.includes(item.name)} onChange={event => setPicked(old => event.target.checked ? [...old, item.name] : old.filter(name => name !== item.name))} />{item.directory ? `[${item.name}] (folders not supported in sample archives)` : item.name}</label>)}</div>;
    if (tool === 'Unpack Specific Files' && !problem) { confirmText = 'Unpack'; confirm = () => run(() => { if (!picked.length) throw new Error('Tick the files to unpack.'); props.apply({ type: 'create', path: destination, files: items.filter(item => picked.includes(item.name)) }, `Unpacked ${picked.length} file(s) to ${destination}`); close(); }); }
  } else if (tool === 'Compare By Content') {
    const left = chosen.length === 2 ? chosen[0] : entry; const right = chosen.length === 2 ? chosen[1] : otherEntry;
    description = `${left?.name ?? '?'} ↔ ${right?.name ?? '?'}`;
    body = !left || !right || left.directory || right.directory ? <p className="text-sm text-muted-foreground">Put the cursor on a file in each panel, or mark two files in this panel.</p> : (() => { const diff = lineDiff(fileText(left), fileText(right)); const changes = diff.filter(line => line.kind !== 'same').length; return <><p className="text-xs">{changes ? `${changes} differing line(s)` : 'The files are identical.'}</p><pre className="diff-view">{diff.map((line, index) => <div key={index} className={`diff-${line.kind}`}>{line.kind === 'left' ? '− ' : line.kind === 'right' ? '+ ' : '  '}{line.text}</div>)}</pre></>; })();
  } else if (tool === 'Properties' || tool === 'Calculate Occupied Space') {
    const names = targets.length ? targets : [];
    const space = occupiedSpace(fs, path, names);
    body = names.length ? <dl className="properties-list">{tool === 'Properties' && chosen.length === 1 && <><dt>Name</dt><dd>{chosen[0]!.name}</dd><dt>Location</dt><dd>{path}</dd><dt>Type</dt><dd>{chosen[0]!.directory ? 'Folder' : `${extension(chosen[0]!).toUpperCase() || 'File'} file`}</dd><dt>Modified</dt><dd>{chosen[0]!.date}</dd><dt>Permissions</dt><dd className="font-mono">{chosen[0]!.attr}</dd>{comments[joinPath(path, chosen[0]!.name)] && <><dt>Comment</dt><dd>{comments[joinPath(path, chosen[0]!.name)]}</dd></>}</>}<dt>Size</dt><dd>{formatSize(space.bytes)} ({space.bytes.toLocaleString('en-US')} bytes)</dd><dt>Contains</dt><dd>{space.files} files, {space.dirs} folders</dd></dl> : <p className="text-sm text-muted-foreground">Select a file or folder first.</p>;
  } else if (tool === 'Edit Comment') {
    description = entry ? joinPath(path, entry.name) : path;
    body = entry && entry.name !== '..' ? <textarea autoFocus className="editor comment-editor" aria-label="Comment" value={value} onChange={event => setValue(event.target.value)} /> : <p className="text-sm text-muted-foreground">Put the cursor on a file first.</p>;
    if (entry && entry.name !== '..') confirm = () => { props.setComment(joinPath(path, entry.name), value.trim()); close(); };
  } else if (tool === 'Split File') {
    body = <><div className="dialog-path">{entry?.name} · {entry ? `${new TextEncoder().encode(fileText(entry)).length} bytes of sample content` : ''}</div><label className="text-xs">Part size in bytes<input autoFocus className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label><p className="text-xs text-muted-foreground">Parts are written to {destination}.</p></>;
    confirm = () => run(() => { if (!entry) throw new Error('Put the cursor on a file.'); const parts = splitFile(entry, Number(value), now()); props.apply({ type: 'create', path: destination, files: parts }, `Split into ${parts.length} parts`); close(); });
  } else if (tool === 'Combine Files') {
    body = <><div className="dialog-path">{targets.join('\n') || 'Mark the .001, .002 … parts'}</div><p className="text-xs text-muted-foreground">The combined file is written to {destination}.</p></>;
    confirm = () => run(() => { const result = combineFiles(chosen, now()); props.apply({ type: 'create', path: destination, files: [result] }, `Combined into ${result.name}`); close(); });
  } else if (tool === 'Create Checksum') {
    body = <><div className="dialog-path">{targets.join(', ') || 'Select files first'}</div><div className="flex gap-2">{(['crc32', 'md5', 'sha1'] as const).map(item => <Button key={item} variant={algorithm === item ? 'default' : 'outline'} onClick={() => { setAlgorithm(item); setValue(old => old.replace(/\.[^.]+$/, '') + '.' + checksumExtension[item]); }}>{item.toUpperCase()}</Button>)}</div><label className="text-xs">Checksum file name<input className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label></>;
    confirm = () => run(() => { const files = chosen.filter(item => !item.directory); if (!files.length) throw new Error('Select one or more files.'); const content = checksumFile(files, algorithm); props.apply({ type: 'create', path, files: [{ name: value.trim(), directory: false, size: new TextEncoder().encode(content).length, date: now(), attr: '-rw-r--r--', content }] }, `Checksum file created: ${value.trim()}`); close(); });
  } else if (tool === 'Verify Checksums') {
    let rows: ReturnType<typeof verifyChecksums> = []; let problem = '';
    try { if (!entry) throw new Error('Put the cursor on a checksum file.'); rows = verifyChecksums(entry, folder); } catch (failure) { problem = (failure as Error).message; }
    body = problem ? <p className="text-sm text-destructive">{problem}</p> : <><p className="text-xs">{rows.filter(row => row.status === 'ok').length} OK · {rows.filter(row => row.status === 'failed').length} failed · {rows.filter(row => row.status === 'missing').length} missing</p><div className="favorite-list">{rows.map(row => <div key={row.name} className="option-row justify-between"><span>{row.name}</span><span className={row.status === 'ok' ? 'text-success' : 'text-destructive'}>{row.status.toUpperCase()}</span></div>)}</div></>;
  } else if (tool === 'Select Group' || tool === 'Unselect Group' || tool === 'Custom Filter') {
    description = tool === 'Custom Filter' ? 'Show only files matching these patterns (separate with ;)' : 'Patterns like *.mkv or report?.txt; separate several with ;';
    body = <input autoFocus className="dialog-input" aria-label="File pattern" value={value} onChange={event => setValue(event.target.value)} />;
    confirm = () => { if (tool === 'Custom Filter') props.setFilter(value.trim() || '*.*'); else props.group(value.trim() || '*.*', tool === 'Select Group'); close(); };
  } else if (tool === 'CD Tree') {
    const tree = directoryTree(fs).filter(item => !value || item.name.toLowerCase().includes(value.toLowerCase()));
    description = 'Choose a folder, or type to filter';
    body = <><input autoFocus className="dialog-input" aria-label="Filter folders" value={value} onChange={event => setValue(event.target.value)} /><div className="tree-list">{tree.map(item => <Button key={item.path} variant="ghost" className={`tree-item ${item.path === path ? 'current' : ''}`} style={{ paddingLeft: 6 + (value ? 0 : item.depth * 14) }} onClick={() => { props.navigate(item.path); close(); }}>[{item.name}]</Button>)}</div></>;
  } else if (tool === 'System Information') {
    description = 'What this session can see';
    body = <dl className="properties-list">{props.info.map(([key, text]) => <div key={key} className="contents"><dt>{key}</dt><dd>{text}</dd></div>)}</dl>;
  } else if (tool === 'Background Transfer Manager') {
    description = 'Sample-file transfers in this session';
    body = props.jobs.length ? <div className="favorite-list">{props.jobs.map(job => <div key={job.id} className="option-row justify-between gap-2"><span className="truncate">{job.operation.type === 'copy' ? 'Copy' : 'Move'} {job.operation.names.length} item(s) → {job.operation.destination}</span><span className="flex items-center gap-1 shrink-0"><span className="text-xs">{job.state} {job.total ? Math.round(job.processed / job.total * 100) : 100}%</span>{(job.state === 'running' || job.state === 'paused') && <><Button variant="outline" className="h-6 px-2 text-xs" onClick={() => props.togglePause(job.id)}>{job.state === 'paused' ? 'Resume' : 'Pause'}</Button><Button variant="outline" className="h-6 px-2 text-xs" onClick={() => props.cancel(job.id)}>Cancel</Button></>}<Button variant="ghost" className="h-6 px-2 text-xs" onClick={() => { props.restore(job.id); close(); }}>Show</Button></span></div>)}</div> : <p className="text-sm text-muted-foreground">No transfers in this session.</p>;
  }

  return <Dialog open={tool !== null} onOpenChange={open => { if (!open) close(); }}><DialogContent onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLButtonElement) && confirm) { event.preventDefault(); event.stopPropagation(); confirm(); } }} className={`${dark ? 'dark' : ''} bg-background text-foreground ${tool === 'Compare By Content' ? 'max-w-3xl' : ''}`}>
    <DialogHeader><DialogTitle>{tool}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {body}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={close}>{confirm ? 'Cancel' : 'Close'}</Button>{confirm && <Button onClick={confirm}>{confirmText}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
