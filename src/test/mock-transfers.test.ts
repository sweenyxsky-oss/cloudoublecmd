import { describe, expect, it } from 'vitest';
import { createFilesystem } from '@/lib/mock-filesystem';
import { transferBytes } from '@/lib/mock-transfers';

describe('recursive sample transfer totals', () => {
  it('counts file bytes through all selected subtrees', () => {
    const fs = createFilesystem();
    expect(transferBytes(fs, '/mnt/tank/media', ['Downloads'])).toBe(5368709120);
    expect(transferBytes(fs, '/mnt/tank/media', ['Photos', 'README.md'])).toBe(5242880 + 4194304 + 6291456 + 2048);
  });
  it('rejects stale selections and counts empty folders as zero', () => {
    const fs = createFilesystem();
    expect(transferBytes(fs, '/mnt/fast', ['scratch'])).toBe(0);
    expect(() => transferBytes(fs, '/mnt/fast', ['missing'])).toThrow('no longer exists');
  });
});