import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ftpMakeDirectory, ftpReadText, ftpRemove, ftpRename, ftpWriteText } from '../src/ftp.mjs';

// In-memory FTPS double: a flat tree under /srv, tracking the TLS flag.
function fakeFactory(tree) {
  return () => { let cwd = '/'; const at = () => tree[cwd] ??= {};
    return {
      async access(o) { assert.equal(o.secure, true); }, close() {},
      async cd(p) { cwd = p.startsWith('/') ? p : (cwd === '/' ? '' : cwd) + '/' + p; if (!tree[cwd]) throw new Error('no dir'); },
      async pwd() { return cwd; },
      async list() { return Object.entries(at()).map(([name, v]) => ({ name, isDirectory: typeof v === 'object', isFile: typeof v === 'string', isSymbolicLink: false, size: typeof v === 'string' ? v.length : 0 })); },
      async downloadTo(sink, name) { sink.write(Buffer.from(at()[name])); sink.end(); },
      async uploadFrom(stream, name) { let s = ''; for await (const c of stream) s += c; at()[name] = s; },
      async remove(name) { delete at()[name]; }, async removeDir(name) { delete at()[name]; delete tree[cwd + '/' + name]; },
      async rename(a, b) { at()[b] = at()[a]; delete at()[a]; },
      async send(cmd) { const name = cmd.slice(4); at()[name] = {}; tree[cwd + '/' + name] = {}; },
    }; };
}
const conn = { id: 'f', protocol: 'ftp', root: '/srv', host: 'h', user: 'u', password: 'p', writable: true };

test('FTPS read, edit, mkdir, rename and delete with refusals', async () => {
  const tree = { '/srv': { 'a.txt': 'hello', 'b.txt': 'x' } }; const f = fakeFactory(tree);
  assert.equal((await ftpReadText(conn, '/', 'a.txt', f)).content, 'hello');
  await ftpWriteText(conn, '/', 'a.txt', 'changed', f); assert.equal(tree['/srv']['a.txt'], 'changed');
  assert.deepEqual(Object.keys(tree['/srv']).sort(), ['a.txt', 'b.txt']);
  await ftpMakeDirectory(conn, '/', 'docs', f); await assert.rejects(ftpMakeDirectory(conn, '/', 'docs', f), /already exists/);
  await assert.rejects(ftpRename(conn, '/', [{ from: 'a.txt', to: 'b.txt' }], f), /already exists/);
  await ftpRename(conn, '/', [{ from: 'a.txt', to: 'b.txt' }, { from: 'b.txt', to: 'a.txt' }], f);
  assert.equal(tree['/srv']['b.txt'], 'changed');
  await ftpRemove(conn, '/', ['docs', 'a.txt'], f); assert.deepEqual(Object.keys(tree['/srv']), ['b.txt']);
  await assert.rejects(ftpReadText(conn, '/../etc', 'x', f), /Invalid path/);
  await assert.rejects(ftpWriteText({ ...conn, writable: false }, '/', 'b.txt', 'y', f), /read-only/);
  await assert.rejects(ftpMakeDirectory(conn, '/', '../x', f), /Invalid name/);
});
