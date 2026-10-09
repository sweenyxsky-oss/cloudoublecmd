import { describe, expect, it } from 'vitest';
import { executeFilesystemOperation as execute } from '@/lib/filesystem-operations';
import { createFilesystem } from '@/lib/mock-filesystem';

const path = '/mnt/tank/media';
describe('Filesystem operation boundary', () => {
  it('creates a folder without mutating the snapshot', () => {
    const fs = createFilesystem();
    const next = execute(fs, { type: 'mkdir', path, name: 'New' });
    expect(next[`${path}/New`]).toEqual([]);
    expect(fs[`${path}/New`]).toBeUndefined();
  });
  it.each(['.', '..', '../escape', 'a/b', 'a\\b', '', '\u0000'])('rejects unsafe names: %s', name => {
    expect(() => execute(createFilesystem(), { type: 'mkdir', path, name })).toThrow();
  });
  it('rejects missing directories and stale selections', () => {
    const fs = createFilesystem();
    expect(() => execute(fs, { type: 'copy', source: path, destination: '/missing', names: ['Movies'] })).toThrow('Directory does not exist');
    expect(() => execute(fs, { type: 'delete', path, names: ['missing'] })).toThrow('no longer exists');
  });
  it('deletes only the selected subtree', () => {
    const fs = createFilesystem();
    const next = execute(fs, { type: 'delete', path, names: ['Movies'] });
    expect(Object.keys(next).some(key => key.startsWith(`${path}/Movies`))).toBe(false);
    expect(next[`${path}/Music`]).toEqual(fs[`${path}/Music`]);
    expect(fs[`${path}/Movies/Action`]).toBeDefined();
  });
  it('renames recursive trees and rejects collisions without partial changes', () => {
    const fs = createFilesystem();
    const next = execute(fs, { type: 'rename', path, names: ['Movies'], pattern: 'Cinema' });
    expect(next[`${path}/Cinema/Action`]).toEqual(fs[`${path}/Movies/Action`]);
    expect(next[`${path}/Movies`]).toBeUndefined();
    expect(() => execute(fs, { type: 'rename', path, names: ['Movies'], pattern: 'Music' })).toThrow('duplicate');
    expect(fs[`${path}/Movies`]).toBeDefined();
  });
  it('writes UTF-8 content with correct byte length and rejects directories', () => {
    const fs = createFilesystem();
    const next = execute(fs, { type: 'write', path, name: 'README.md', content: 'é' });
    expect(next[path]?.find(entry => entry.name === 'README.md')).toMatchObject({ content: 'é', size: 2 });
    expect(() => execute(fs, { type: 'write', path, name: 'Movies', content: '' })).toThrow('directory');
  });
  it('copies then moves nested directories through the same boundary', () => {
    const fs = createFilesystem();
    const copied = execute(fs, { type: 'copy', source: path, destination: '/mnt/tank/data', names: ['Movies'] });
    expect(copied['/mnt/tank/data/Movies/Action']).toEqual(fs[`${path}/Movies/Action`]);
    const moved = execute(copied, { type: 'move', source: path, destination: '/mnt/fast', names: ['Music'] });
    expect(moved[`${path}/Music`]).toBeUndefined();
    expect(moved['/mnt/fast/Music/Albums']).toBeDefined();
  });
  it('synchronizes missing trees without overwriting existing files', () => {
    const fs = createFilesystem();
    const next = execute(fs, { type: 'synchronize', source: path, destination: '/mnt/tank/data' });
    expect(next['/mnt/tank/data/Movies/Action']).toEqual(fs[`${path}/Movies/Action`]);
    expect(fs['/mnt/tank/data/Movies']).toBeUndefined();
  });
});