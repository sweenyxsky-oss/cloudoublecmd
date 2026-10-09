import { describe, expect, it } from 'vitest';
import { checksumFile, combineFiles, compareDirectories, crc32, globToRegExp, lineDiff, md5, occupiedSpace, sha1, splitFile, verifyChecksums } from '@/lib/commander-tools';
import { executeFilesystemOperation } from '@/lib/filesystem-operations';
import { sanitizeOptions, defaultOptions } from '@/hooks/use-commander-options';
import { createFilesystem, type FileEntry } from '@/lib/mock-filesystem';

const file = (name: string, content: string, date = '2026-10-09 10:00'): FileEntry => ({ name, directory: false, size: content.length, date, attr: '-rw-r--r--', content });

describe('menu tools', () => {
  it('computes standard checksums', () => {
    expect(crc32('hello')).toBe('3610a686');
    expect(md5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(sha1('hello')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
  it('creates and verifies checksum files, flagging changes and missing files', () => {
    const files = [file('a.txt', 'one'), file('b.txt', 'two')];
    const sums = file('x.md5', checksumFile(files, 'md5'));
    expect(verifyChecksums(sums, files).every(row => row.status === 'ok')).toBe(true);
    const result = verifyChecksums(sums, [file('a.txt', 'changed')]);
    expect(result.map(row => row.status)).toEqual(['failed', 'missing']);
    const sfv = file('x.sfv', checksumFile(files, 'crc32'));
    expect(verifyChecksums(sfv, files).every(row => row.status === 'ok')).toBe(true);
  });
  it('matches group patterns case-insensitively and safely', () => {
    expect(globToRegExp('*.MKV;*.mp4').test('film.mkv')).toBe(true);
    expect(globToRegExp('a?c.txt').test('abc.txt')).toBe(true);
    expect(globToRegExp('(x).txt').test('(x).txt')).toBe(true);
  });
  it('splits and recombines content exactly', () => {
    const parts = splitFile(file('big.txt', 'héllo world'), 4, '2026-10-09 10:00');
    expect(parts.map(part => part.name)).toEqual(['big.txt.001', 'big.txt.002', 'big.txt.003']);
    expect(combineFiles(parts.reverse(), '2026-10-09 10:00')).toMatchObject({ name: 'big.txt', content: 'héllo world' });
  });
  it('compares directories and hides identical files', () => {
    const result = compareDirectories([file('same', 'x'), file('new', 'x', '2026-10-10 00:00'), file('only', 'x')], [file('same', 'x'), file('new', 'x')], true);
    expect(result).toEqual({ left: ['new', 'only'], right: [], same: ['same'] });
  });
  it('diffs lines and counts occupied space recursively', () => {
    expect(lineDiff('a\nb', 'a\nc').map(line => line.kind)).toEqual(['same', 'left', 'right']);
    expect(occupiedSpace(createFilesystem(), '/mnt/tank/media', ['Movies'])).toMatchObject({ files: 5, dirs: 3 });
  });
  it('creates files and changes attributes through the operation boundary', () => {
    const fs = createFilesystem();
    const next = executeFilesystemOperation(fs, { type: 'create', path: '/etc', files: [file('new.txt', 'x')] });
    expect(next['/etc']?.some(entry => entry.name === 'new.txt')).toBe(true);
    expect(() => executeFilesystemOperation(next, { type: 'create', path: '/etc', files: [file('new.txt', 'x')] })).toThrow('exists');
    const changed = executeFilesystemOperation(fs, { type: 'attributes', path: '/etc', names: ['hosts'], attr: '-rwx------', date: '2026-01-02 03:04' });
    expect(changed['/etc']?.find(entry => entry.name === 'hosts')).toMatchObject({ attr: '-rwx------', date: '2026-01-02 03:04' });
    expect(() => executeFilesystemOperation(fs, { type: 'attributes', path: '/etc', names: ['hosts'], date: 'soon' })).toThrow();
  });
  it('ignores unknown or invalid saved options', () => {
    const options = sanitizeOptions({ showHidden: false, fontSize: 3, keys: { View: 'F2', Edit: '<script>' }, evil: true });
    expect(options.showHidden).toBe(false);
    expect(options.fontSize).toBe(defaultOptions.fontSize);
    expect(options.keys.View).toBe('F2');
    expect(options.keys.Edit).toBe('F4');
    expect('evil' in options).toBe(false);
  });
});
