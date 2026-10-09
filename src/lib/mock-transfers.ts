import { joinPath, type FileSystem } from './mock-filesystem';
import type { FilesystemOperation } from './filesystem-operations';

export type TransferOperation = Extract<FilesystemOperation, { type: 'copy' | 'move' }>;
export type TransferJob = { id: number; operation: TransferOperation; total: number; processed: number; state: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'; error?: string; rate?: number; conflict?: import('./mock-filesystem').TransferConflict | null };

export function transferBytes(fs: FileSystem, source: string, names: string[]): number {
  return names.reduce((total, name) => {
    const entry = fs[source]?.find(item => item.name === name);
    if (!entry) throw new Error(`Item no longer exists: ${name}`);
    if (!entry.directory) return total + entry.size;
    const root = joinPath(source, name);
    return total + Object.entries(fs).filter(([path]) => path === root || path.startsWith(`${root}/`)).reduce((sum, [, entries]) => sum + entries.filter(item => !item.directory).reduce((bytes, item) => bytes + item.size, 0), 0);
  }, 0);
}