import { describe, expect, it } from 'vitest';
import { executeFilesystemOperation } from '@/lib/filesystem-operations';
import { transferConflicts, type FileSystem } from '@/lib/mock-filesystem';
const file = (name: string, content: string) => ({ name, content, directory: false, size: content.length, date: '2026-10-09 10:00', attr: '-rw-r--r--' });
describe('explicit transfer duplicate decisions', () => {
  const fs: FileSystem = { '/a': [file('x', 'new'), file('y', 'other')], '/b': [file('x', 'old')] };
  it('reports both file details and preserves immutable snapshots', () => {
    expect(transferConflicts(fs, '/a', '/b', ['x'])[0]?.destination.content).toBe('old');
    const result = executeFilesystemOperation(fs, { type: 'copy', source: '/a', destination: '/b', names: ['x'], decisions: { x: 'overwrite' } });
    expect(result['/b']?.[0]?.content).toBe('new'); expect(fs['/b']?.[0]?.content).toBe('old');
  });
  it('skip on move retains original source and transfers non-conflicting items', () => {
    const result = executeFilesystemOperation(fs, { type: 'move', source: '/a', destination: '/b', names: ['x', 'y'], decisions: { x: 'skip' } });
    expect(result['/a']?.map(f => f.name)).toEqual(['x']); expect(result['/b']?.map(f => f.content)).toEqual(['old', 'other']);
  });
  it('defaults to refusal without an explicit choice', () => {
    expect(() => executeFilesystemOperation(fs, { type: 'copy', source: '/a', destination: '/b', names: ['x'] })).toThrow('already exists');
  });
});
