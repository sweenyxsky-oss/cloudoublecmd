import { describe, expect, it } from 'vitest';
import { createFilesystem, transferEntries } from '@/lib/mock-filesystem';

describe('Mock filesystem operations', () => {
  it('copies directories recursively without changing the source', () => {
    const fs = createFilesystem();
    const next = transferEntries(fs, '/mnt/tank/media', '/mnt/tank/data', ['Movies'], false);
    expect(next['/mnt/tank/data/Movies/Action']).toEqual(fs['/mnt/tank/media/Movies/Action']);
    expect(next['/mnt/tank/media/Movies']).toEqual(fs['/mnt/tank/media/Movies']);
  });
  it('moves a directory and removes all old child paths', () => {
    const next = transferEntries(createFilesystem(), '/mnt/tank/media', '/mnt/tank/data', ['Movies'], true);
    expect(next['/mnt/tank/media/Movies']).toBeUndefined();
    expect(next['/mnt/tank/media/Movies/Action']).toBeUndefined();
    expect(next['/mnt/tank/data/Movies/Action']).toHaveLength(1);
  });
  it('rejects duplicates and recursive self-transfers', () => {
    const fs = createFilesystem();
    expect(() => transferEntries(fs, '/mnt/tank/media', '/mnt/tank/media', ['Movies'], false)).toThrow();
    expect(() => transferEntries(fs, '/mnt/tank/media', '/mnt/tank/media/Movies/Action', ['Movies'], true)).toThrow();
    const next = transferEntries(fs, '/mnt/tank/media', '/mnt/tank/data', ['Movies'], false);
    expect(() => transferEntries(next, '/mnt/tank/media', '/mnt/tank/data', ['Movies'], false)).toThrow('already exists');
  });
});