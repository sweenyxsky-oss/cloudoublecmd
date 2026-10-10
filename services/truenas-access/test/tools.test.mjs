import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { createAccessServer } from '../src/app.mjs';
import { createSessions } from '../src/session.mjs';
import { listMounted } from '../src/providers.mjs';

const token = 'test-only-'.repeat(5); const password = 'correct horse battery';
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'cdc-tools-'));
  const a = path.join(root, 'a'); const ro = path.join(root, 'ro'); await mkdir(a); await mkdir(ro);
  await writeFile(path.join(a, 'one.txt'), 'line1\nline2\n'); await writeFile(path.join(a, 'two.txt'), 'line1\nchanged\n');
  await mkdir(path.join(a, 'docs')); await writeFile(path.join(a, 'docs', 'big.bin'), Buffer.alloc(5000, 7));
  await writeFile(path.join(ro, 'keep.txt'), 'keep');
  const connections = [{ id: 'a', label: 'A', protocol: 'local', root: a, writable: true }, { id: 'ro', label: 'RO', protocol: 'local', root: ro }];
  const server = createAccessServer({ token, connections, sessions: createSessions(password), list: (c, p) => listMounted(c, p) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = async (tool, body) => { const r = await fetch(`${base}/api/tools/${tool}`, { method: 'POST', headers: { cookie, origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  return { server, root, a, ro, post };
}
const here = { connection: 'a', path: '/' };

test('checksums create and verify, and detect changes', async () => {
  const { server, a, post } = await setup();
  try {
    const made = await post('checksum', { ...here, names: ['one.txt', 'two.txt'], algorithm: 'sha256', output: 'sums.sha256' });
    assert.equal(made.status, 200); assert.equal(made.body.count, 2);
    assert.equal((await post('checksum', { ...here, names: ['one.txt'], algorithm: 'md5', output: 'sums.sha256' })).status, 409);
    let v = await post('verify', { ...here, name: 'sums.sha256' }); assert.deepEqual(v.body.results.map(r => r.state), ['ok', 'ok']);
    await writeFile(path.join(a, 'two.txt'), 'tampered');
    v = await post('verify', { ...here, name: 'sums.sha256' }); assert.deepEqual(v.body.results.map(r => r.state), ['ok', 'failed']);
    assert.equal((await post('checksum', { connection: 'ro', path: '/', names: ['keep.txt'], algorithm: 'md5', output: 'x.md5' })).status, 403);
    assert.equal((await post('checksum', { connection: 'ro', path: '/', names: ['keep.txt'], algorithm: 'md5' })).status, 200);
  } finally { server.closeAllConnections(); server.close(); }
});

test('split and combine round-trip without overwriting', async () => {
  const { server, a, post } = await setup();
  try {
    const s = await post('split', { connection: 'a', path: '/docs', name: 'big.bin', partSize: 2048, destination: here });
    assert.deepEqual(s.body.parts, ['big.bin.001', 'big.bin.002', 'big.bin.003']);
    assert.equal((await post('split', { connection: 'a', path: '/docs', name: 'big.bin', partSize: 2048, destination: here })).status, 409);
    const c = await post('combine', { ...here, name: 'big.bin.001', destination: here });
    assert.equal(c.status, 200);
    assert.deepEqual(await readFile(path.join(a, 'big.bin')), Buffer.alloc(5000, 7));
    assert.equal((await post('combine', { ...here, name: 'big.bin.001', destination: here })).status, 409);
    assert.equal((await post('split', { ...here, name: 'one.txt', partSize: 2048, destination: { connection: 'ro', path: '/' } })).status, 403);
  } finally { server.closeAllConnections(); server.close(); }
});

test('compare and occupied space', async () => {
  const { server, post } = await setup();
  try {
    const diff = await post('compare', { ...here, name: 'one.txt', other: { ...here, name: 'two.txt' } });
    assert.equal(diff.body.identical, false); assert.equal(diff.body.right, 'line1\nchanged\n');
    assert.equal((await post('compare', { ...here, name: 'one.txt', other: { ...here, name: 'one.txt' } })).body.identical, true);
    const size = await post('occupied', { ...here, names: ['docs', 'one.txt'] });
    assert.deepEqual(size.body, { bytes: 5012, files: 2, folders: 1, skipped: 0 });
  } finally { server.closeAllConnections(); server.close(); }
});

test('pack, list, unpack; rejects links, traversal and overwrites', async () => {
  const { server, root, a, post } = await setup();
  try {
    assert.equal((await post('pack', { ...here, names: ['docs', 'one.txt'], archive: 'out.tar.gz', destination: here })).status, 200);
    const listed = await post('list-archive', { ...here, name: 'out.tar.gz' });
    assert.ok(listed.body.entries.some(e => e.name === 'docs/big.bin'));
    await mkdir(path.join(a, 'dest'));
    assert.equal((await post('unpack', { ...here, name: 'out.tar.gz', destination: { connection: 'a', path: '/dest' } })).status, 200);
    assert.deepEqual(await readFile(path.join(a, 'dest', 'docs', 'big.bin')), Buffer.alloc(5000, 7));
    assert.equal((await post('unpack', { ...here, name: 'out.tar.gz', destination: { connection: 'a', path: '/dest' } })).status, 409);
    // A hostile archive: symlink + traversal entries are never extracted.
    const evil = path.join(root, 'evil'); await mkdir(evil); await writeFile(path.join(evil, 'ok.txt'), 'ok'); await symlink('/etc/passwd', path.join(evil, 'link'));
    await tar.c({ file: path.join(a, 'evil.tar'), cwd: evil, portable: true }, ['ok.txt', 'link']);
    await mkdir(path.join(a, 'safe'));
    const r = await post('unpack', { ...here, name: 'evil.tar', destination: { connection: 'a', path: '/safe' } });
    assert.equal(r.status, 200); assert.deepEqual((await readdir(path.join(a, 'safe'))).sort(), ['ok.txt']);
    assert.equal((await post('pack', { ...here, names: ['one.txt'], archive: 'x.rar', destination: here })).status, 400);
  } finally { server.closeAllConnections(); server.close(); }
});
