import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { lineDiff } from '@/lib/commander-tools';
import { isSignedOut, liveLocation, runLiveTool } from '@/lib/live-filesystem';
import { formatSize, type FileEntry } from '@/lib/mock-filesystem';

export type LiveTool = 'Create Checksum' | 'Verify Checksums' | 'Split File' | 'Combine Files' | 'Compare By Content' | 'Calculate Occupied Space' | 'Test Archive' | 'Unpack Specific Files' | 'Pack' | 'Unpack All';
export const liveTools: LiveTool[] = ['Create Checksum', 'Verify Checksums', 'Split File', 'Combine Files', 'Compare By Content', 'Calculate Occupied Space', 'Test Archive', 'Unpack Specific Files', 'Pack', 'Unpack All'];
/** Tools that create files and therefore need a writable target. */
export const liveWritingTools: LiveTool[] = ['Split File', 'Combine Files', 'Pack', 'Unpack All', 'Unpack Specific Files'];

type ArchiveEntry = { name: string; directory: boolean; size: number; supported: boolean };
type Props = {
  tool: LiveTool | null; close: () => void; dark: boolean; path: string; destination: string; targets: string[]; entry: FileEntry | undefined;
  otherEntry: FileEntry | undefined; writableHere: boolean; done: (message: string, folders: string[]) => void;
};

export function LiveToolDialog({ tool, close, dark, path, destination, targets, entry, otherEntry, writableHere, done }: Props) {
  const [value, setValue] = useState('');
  const [algorithm, setAlgorithm] = useState('sha256');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<React.ReactNode>(null);
  const [archive, setArchive] = useState<ArchiveEntry[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const file = entry && !entry.directory ? entry.name : '';

  async function work(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (problem) { if (isSignedOut(problem)) window.location.assign('/login'); else setError(problem instanceof Error ? problem.message : 'Operation failed'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!tool) return;
    setError(''); setResult(null); setArchive([]); setPicked([]); setAlgorithm('sha256');
    setValue(tool === 'Create Checksum' ? `${targets.length === 1 ? targets[0] : 'checksums'}.sha256` : tool === 'Split File' ? '1024' : tool === 'Combine Files' ? file.replace(/\.\d{3}$/, '') : tool === 'Pack' ? `${targets.length === 1 ? targets[0] : 'archive'}.tar.gz` : '');
    if (tool === 'Verify Checksums') void work(async () => {
      const { results } = await runLiveTool<{ results: { name: string; state: string }[] }>('verify', path, { name: file });
      const bad = results.filter(item => item.state !== 'ok').length;
      setResult(<><p className="text-xs">{bad ? `${bad} of ${results.length} file(s) failed or missing` : `All ${results.length} file(s) OK`}</p><div className="dialog-path">{results.map(item => <div key={item.name}>{item.state === 'ok' ? 'OK      ' : item.state === 'failed' ? 'FAILED  ' : 'MISSING '}{item.name}</div>)}</div></>);
    });
    if (tool === 'Calculate Occupied Space') void work(async () => {
      const size = await runLiveTool<{ bytes: number; files: number; folders: number }>('occupied', path, { names: targets });
      setResult(<p className="text-sm">{formatSize(size.bytes)} ({size.bytes.toLocaleString()} bytes) in {size.files} file(s) and {size.folders} folder(s).</p>);
    });
    if (tool === 'Compare By Content') void work(async () => {
      const [left, right] = targets.length === 2 ? [{ dir: path, name: targets[0] }, { dir: path, name: targets[1] }] : [{ dir: path, name: file }, { dir: destination, name: otherEntry && !otherEntry.directory ? otherEntry.name : '' }];
      if (!left.name || !right.name) throw new Error('Put the cursor on a file in each panel, or mark two files in this panel.');
      const diff = await runLiveTool<{ identical: boolean; sizes: number[]; left: string | null; right: string | null }>('compare', left.dir, { name: left.name, other: { ...liveLocation(right.dir), name: right.name } });
      if (diff.identical) { setResult(<p className="text-sm">The files are identical.</p>); return; }
      if (diff.left === null || diff.right === null) { setResult(<p className="text-sm">The files differ ({formatSize(diff.sizes[0] ?? 0)} vs {formatSize(diff.sizes[1] ?? 0)}). Line comparison is only shown for text files up to 1 MB.</p>); return; }
      const lines = lineDiff(diff.left, diff.right);
      setResult(<><p className="text-xs">{lines.filter(line => line.kind !== 'same').length} differing line(s)</p><pre className="diff-view">{lines.map((line, index) => <div key={index} className={`diff-${line.kind}`}>{line.kind === 'left' ? '− ' : line.kind === 'right' ? '+ ' : '  '}{line.text}</div>)}</pre></>);
    });
    if (tool === 'Test Archive' || tool === 'Unpack Specific Files') void work(async () => {
      const { entries } = await runLiveTool<{ entries: ArchiveEntry[] }>('list-archive', path, { name: file });
      setArchive(entries);
      if (tool === 'Test Archive') { const skipped = entries.filter(item => !item.supported).length; setResult(<p className="text-sm">Archive OK: {entries.length} entries, {formatSize(entries.reduce((sum, item) => sum + item.size, 0))}.{skipped ? ` ${skipped} link/special entries will be skipped when unpacking.` : ' No errors found.'}</p>); }
    });
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  let body: React.ReactNode = null; let confirm: (() => void) | null = null; let confirmText = 'OK'; let description = path;
  if (tool === 'Create Checksum') {
    body = <><div className="dialog-path">{targets.join(', ') || 'Nothing selected'}</div>
      <label className="text-xs">Type<select className="dialog-input mt-2" value={algorithm} onChange={event => { const next = event.target.value; setAlgorithm(next); setValue(old => old.replace(/\.(md5|sha1|sha256|sha512)$/, '') + '.' + next); }}>{['md5', 'sha1', 'sha256', 'sha512'].map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
      <label className="text-xs">Save as (in this folder)<input className="dialog-input mt-2" value={value} disabled={!writableHere} onChange={event => setValue(event.target.value)} /></label>
      {!writableHere && <p className="text-xs text-muted-foreground">This folder is read-only, so the checksums are shown instead of saved.</p>}{result}</>;
    confirmText = writableHere ? 'Create' : 'Calculate';
    confirm = () => void work(async () => {
      const made = await runLiveTool<{ text: string; count: number }>('checksum', path, { names: targets, algorithm, ...(writableHere ? { output: value.trim() } : {}) });
      if (writableHere) { done(`Checksums for ${made.count} file(s) saved as ${value.trim()}`, [path]); close(); } else setResult(<pre className="dialog-path">{made.text}</pre>);
    });
  } else if (tool === 'Split File') {
    description = `${file} → ${destination}`;
    body = <label className="text-xs">Part size (KB)<input className="dialog-input mt-2" inputMode="numeric" value={value} onChange={event => setValue(event.target.value)} /></label>;
    confirmText = 'Split';
    confirm = () => void work(async () => { const { parts } = await runLiveTool<{ parts: string[] }>('split', path, { name: file, partSize: Math.round(Number(value) * 1024) }, destination); done(`Split ${file} into ${parts.length} part(s)`, [destination]); close(); });
  } else if (tool === 'Combine Files') {
    description = `${file} → ${destination}`;
    body = <label className="text-xs">Combined file name<input className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label>;
    confirmText = 'Combine';
    confirm = () => void work(async () => { const made = await runLiveTool<{ parts: number; name: string }>('combine', path, { name: file, output: value.trim() }, destination); done(`Combined ${made.parts} part(s) into ${made.name}`, [destination]); close(); });
  } else if (tool === 'Pack') {
    description = `${targets.length} item(s) → ${destination}`;
    body = <><label className="text-xs">Archive name<input autoFocus className="dialog-input mt-2" value={value} onChange={event => setValue(event.target.value)} /></label><label className="text-xs">Format<select aria-label="Archive format" className="dialog-input mt-2" value={/\.tar\.gz$/i.test(value) ? 'tar.gz' : value.split('.').pop() ?? 'zip'} onChange={event => setValue(old => old.replace(/\.(tar\.gz|tgz|tar|zip|7z|gz|bz2|xz)$/i, '') + '.' + event.target.value)}>{['zip', '7z', 'tar', 'tar.gz', 'tgz', 'gz', 'bz2', 'xz'].map(format => <option key={format} value={format}>{format}</option>)}</select></label><p className="text-xs text-muted-foreground">RAR, CAB, ISO and ARJ: extraction only. GZ/BZ2/XZ: one file. Links and special files are skipped.</p></>;
    confirmText = 'Pack';
    confirm = () => void work(async () => { await runLiveTool('pack', path, { names: targets, archive: value.trim() }, destination); done(`Packed ${targets.length} item(s) into ${value.trim()}`, [destination]); close(); });
  } else if (tool === 'Unpack All') {
    description = `${file} → ${destination}`;
    body = <p className="text-sm">Unpack every file and folder into the target panel. Existing files are never replaced; links are skipped.</p>;
    confirmText = 'Unpack';
    confirm = () => void work(async () => { const made = await runLiveTool<{ files: number }>('unpack', path, { name: file }, destination); done(`Unpacked ${made.files} file(s) to ${destination}`, [destination]); close(); });
  } else if (tool === 'Unpack Specific Files') {
    description = `${file} → ${destination}`;
    body = <div className="favorite-list">{archive.filter(item => !item.directory).map(item => <label key={item.name} className="option-row"><input type="checkbox" disabled={!item.supported} checked={picked.includes(item.name)} onChange={event => setPicked(old => event.target.checked ? [...old, item.name] : old.filter(name => name !== item.name))} />{item.name}{item.supported ? '' : ' (link, skipped)'}</label>)}</div>;
    confirmText = 'Unpack';
    confirm = () => void work(async () => { if (!picked.length) throw new Error('Tick the files to unpack.'); const made = await runLiveTool<{ files: number }>('unpack', path, { name: file, only: picked }, destination); done(`Unpacked ${made.files} file(s) to ${destination}`, [destination]); close(); });
  } else if (tool) {
    description = tool === 'Compare By Content' ? 'NAS files' : path;
    body = result;
  }

  return <Dialog open={tool !== null} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLButtonElement) && confirm && !busy) { event.preventDefault(); event.stopPropagation(); confirm(); } }} className={`${dark ? 'dark' : ''} bg-background text-foreground ${tool === 'Compare By Content' ? 'max-w-2xl' : ''}`}>
      <DialogHeader><DialogTitle>{tool}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {busy && <p className="text-xs text-muted-foreground" role="status">Working on the NAS…</p>}
      {body}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={close}>{confirm ? 'Cancel' : 'Close'}</Button>{confirm && <Button disabled={busy} onClick={confirm}>{confirmText}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
