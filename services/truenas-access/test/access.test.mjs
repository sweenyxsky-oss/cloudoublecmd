import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccessServer } from '../src/app.mjs';
import { confined, listMounted, listFtp, validateConnections, virtualPath } from '../src/providers.mjs';

test('mounted roots list real files and reject traversal and symlinks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cloudouble-'));
  try {
    await mkdir(path.join(root, 'folder')); await writeFile(path.join(root, 'notes.txt'), 'hello');
    await symlink(tmpdir(), path.join(root, 'outside'));
    const listing = await listMounted({ root }, '/');
    assert.equal(listing.entries.find(entry => entry.name === 'notes.txt').size, 5);
    assert.equal(listing.entries.some(entry => entry.name === 'outside'), false);
    assert.ok(listing.space.total > 0);
    await assert.rejects(confined(root, '/outside'), /Symlink/);
    await assert.rejects(confined(root, '/../etc'), /Invalid/);
    await assert.rejects(confined(root, '/notes.txt'), /Not a directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('API requires authentication, rejects writes and hides credentials', async () => {
  const token = 'test-only-'.repeat(5);
  const connections = [{ id: 'media', label: 'Media', protocol: 'smb', root: '/private-root', password: 'test-secret' }];
  const server = createAccessServer({ token, connections, list: async () => ({ entries: [{ name: 'actual.txt', size: 5 }], space: null }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    assert.equal((await fetch(`${base}/v1/health`)).status, 401);
    assert.equal((await fetch(`${base}/v1/health`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/v1/health`, { headers, method: 'POST' })).status, 405);
    const discovery = await (await fetch(`${base}/v1/connections`, { headers })).text();
    assert.equal(discovery.includes('private-root'), false); assert.equal(discovery.includes('test-secret'), false);
    const listing = await (await fetch(`${base}/v1/connections/media/entries?path=/`, { headers })).json();
    assert.equal(listing.entries[0].name, 'actual.txt');
    assert.equal((await fetch(`${base}/v1/connections/media/entries?path=/../etc`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/v1/connections/unknown/entries`, { headers })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('FTPS uses TLS, validates paths, excludes links, and always closes', async () => {
  let closed = false; let accessed;
  const client = { access: async value => { accessed = value; }, cd: async () => {}, pwd: async () => '/share', list: async () => [{ name: 'file.txt', isFile: true, size: 9 }, { name: 'link', isSymbolicLink: true, isDirectory: true }], close: () => { closed = true; } };
  const result = await listFtp({ host: 'nas.local', user: 'user', password: 'test', root: '/share' }, '/', () => client);
  assert.equal(accessed.secure, true); assert.equal(closed, true);
  assert.equal(result.entries.length, 1); assert.equal(result.space, null);
  closed = false; client.pwd = async () => '/elsewhere';
  await assert.rejects(listFtp({ host: 'nas.local', root: '/share' }, '/', () => client), /outside root/);
  assert.equal(closed, true);
});

test('configuration and virtual paths reject unsafe values', () => {
  for (const value of ['../etc', '/a/../b', '/a\\b', '/a\u0000b']) assert.throws(() => virtualPath(value));
  assert.equal(virtualPath('/folder//child/'), '/folder/child');
  assert.throws(() => validateConnections([{ id: 'bad/id' }]));
  assert.throws(() => createAccessServer({ token: 'short', connections: [], list: () => {} }));
});