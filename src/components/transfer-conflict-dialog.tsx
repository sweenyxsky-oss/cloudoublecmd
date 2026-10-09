import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CommanderIcon } from '@/components/commander-icons';
import { formatSize, type TransferConflict } from '@/lib/mock-filesystem';
export type DuplicateDecision = 'overwrite' | 'skip' | 'overwrite-all' | 'skip-all';
export function TransferConflictDialog({ conflict, dark, choose, cancel, error, busy }: { conflict: TransferConflict | null; dark: boolean; choose: (choice: DuplicateDecision) => void; cancel: () => void; error?: string; busy?: boolean }) {
  const replaceable = conflict && !conflict.source.directory && !conflict.destination.directory;
  return <Dialog open={Boolean(conflict)} onOpenChange={open => { if (!open) cancel(); }}><DialogContent className={`${dark ? 'dark' : ''} bg-background text-foreground`}><DialogHeader><DialogTitle>File already exists</DialogTitle><DialogDescription>{conflict?.name}</DialogDescription></DialogHeader>
    {conflict && <div className="duplicate-details">{(['source', 'destination'] as const).map(side => <section key={side}><h3><CommanderIcon name={conflict[side].directory ? 'folder' : 'file'} />{side === 'source' ? 'Incoming file' : 'Existing file'}</h3><dl className="properties-list"><dt>Name</dt><dd>{conflict[side].name}</dd><dt>Size</dt><dd>{conflict[side].directory ? 'Folder' : `${formatSize(conflict[side].size)} (${conflict[side].size.toLocaleString()} bytes)`}</dd><dt>Modified</dt><dd>{conflict[side].date || 'Unavailable'}</dd></dl></section>)}</div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter className="duplicate-actions"><Button variant="outline" disabled={busy || !replaceable} onClick={() => choose('overwrite')}>Overwrite</Button><Button variant="outline" disabled={busy} onClick={() => choose('skip')}>Skip</Button><Button disabled={busy || !replaceable} onClick={() => choose('overwrite-all')}>Overwrite all</Button><Button variant="outline" disabled={busy} onClick={() => choose('skip-all')}>Skip all</Button><Button variant="outline" disabled={busy} onClick={cancel}>Cancel transfer</Button></DialogFooter>
  </DialogContent></Dialog>;
}
