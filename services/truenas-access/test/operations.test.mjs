import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccessServer } from '../src/app.mjs';
import { createSessions } from '../src/session.mjs';
import { listMounted } from '../src/providers.mjs';

const token = 'test-only-'.repeat(5);
const password = 'correct horse battery';

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'cdc-ops-'));
  const a = path.join(root, 'a'); const b = path.join(root, 'b'); const ro = path.join(root, 'ro');
  for (const dir of [a, b, ro]) await mkdir(dir);
  await writeFile(path.join(a, 'hello.txt'), 'hello');
  await mkdir(path.join(a, 'folder')); await writeFile(path.join(a, 'folder', 'big.bin'), Buffer.alloc(3 * 1024 * 1024, 1));
  await writeFile(path.join(ro, 'keep.txt'), 'keep');
  const outside = await mkdtemp(path.join(tmpdir(), 'cdc-out-')); await writeFile(path.join(outside, 'secret'), 's');
  await symlink(outside, path.join(a, 'escape'));
  const connections = [{ id: 'a', label: 'A', protocol: 'local', root: a, writable: true }, { id: 'b', label: 'B', protocol: 'local', root: b, writable: true }, { id: 'ro', label: 'RO', protocol: 'local', root: ro }];
  const server = createAccessServer({ token, connections, sessions: createSessions(password), publicDir: null, list: (c, p) => listMounted(c, p) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (route, body, extra = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { cookie, origin: base, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const get = route => fetch(`${base}${route}`, { headers: { cookie } });
  return { server, a, b, ro, outside, post, get, base, cookie };
}
const wait = async (get, id) => { for (let i = 0; i < 200; i++) { const { jobs } = await (await get('/api/jobs')).json(); const job = jobs.find(item => item.id === id); if (!['running', 'paused'].includes(job.state)) return job; await new Promise(r => setTimeout(r, 20)); } throw new Error('timeout'); };

test('edits, creates, renames and deletes only inside writable roots', async () => {
  const { server, a, ro, post, get } = await setup();
  try {
    const file = await (await get('/api/file?connection=a&path=/&name=hello.txt')).json();
    assert.equal(file.content, 'hello');
    assert.equal((await post('/api/write', { connection: 'a', path: '/', name: 'hello.txt', content: 'changed é' })).status, 200);
    assert.equal(await readFile(path.join(a, 'hello.txt'), 'utf8'), 'changed é');
    assert.equal((await post('/api/mkdir', { connection: 'a', path: '/', name: 'New' })).status, 200);
    assert.equal((await post('/api/mkdir', { connection: 'a', path: '/', name: 'New' })).status, 409);
    for (const name of ['..', 'x/y', '', '.']) assert.equal((await post('/api/mkdir', { connection: 'a', path: '/', name })).status, 400);
    assert.equal((await post('/api/mkdir', { connection: 'a', path: '/../..', name: 'x' })).status, 400);
    assert.equal((await post('/api/rename', { connection: 'a', path: '/', mapping: [{ from: 'hello.txt', to: 'New' }] })).status, 409);
    assert.equal((await post('/api/rename', { connection: 'a', path: '/', mapping: [{ from: 'hello.txt', to: 'New' }, { from: 'New', to: 'hello.txt' }] })).status, 200);
    assert.ok((await stat(path.join(a, 'hello.txt'))).isDirectory());
    assert.equal((await post('/api/delete', { connection: 'a', path: '/', names: ['escape'] })).status, 403);
    assert.equal((await post('/api/delete', { connection: 'a', path: '/escape', names: ['secret'] })).status, 403);
    assert.equal((await post('/api/delete', { connection: 'a', path: '/', names: ['hello.txt', 'New'] })).status, 200);
    assert.deepEqual((await readdir(a)).sort(), ['escape', 'folder']);
    assert.equal((await post('/api/delete', { connection: 'ro', path: '/', names: ['keep.txt'] })).status, 403);
    assert.equal(await readFile(path.join(ro, 'keep.txt'), 'utf8'), 'keep');
  } finally { server.close(); }
});

test('rejects cross-site and non-JSON writes', async () => {
  const { server, a, post, base, cookie } = await setup();
  try {
    assert.equal((await post('/api/mkdir', { connection: 'a', path: '/', name: 'x' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await fetch(`${base}/api/mkdir`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await post('/api/mkdir', { connection: 'a', path: '/', name: 'x' }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await fetch(`${base}/api/mkdir`, { method: 'POST', headers: { origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.deepEqual((await readdir(a)).sort(), ['escape', 'folder', 'hello.txt']);
  } finally { server.close(); }
});

test('copies and moves trees between connections with progress and conflict checks', async () => {
  const { server, a, b, post, get } = await setup();
  try {
    const copy = await (await post('/api/jobs', { type: 'copy', source: { connection: 'a', path: '/' }, destination: { connection: 'b', path: '/' }, names: ['folder', 'hello.txt'] })).json();
    assert.equal(copy.job.total, 3 * 1024 * 1024 + 5);
    const done = await wait(get, copy.job.id);
    assert.equal(done.state, 'completed'); assert.equal(done.processed, done.total);
    assert.equal((await stat(path.join(b, 'folder', 'big.bin'))).size, 3 * 1024 * 1024);
    assert.equal((await post('/api/jobs', { type: 'copy', source: { connection: 'a', path: '/' }, destination: { connection: 'b', path: '/' }, names: ['hello.txt'] })).status, 409);
    assert.equal((await post('/api/jobs', { type: 'copy', source: { connection: 'a', path: '/' }, destination: { connection: 'a', path: '/folder' }, names: ['folder'] })).status, 400);
    assert.equal((await post('/api/jobs', { type: 'copy', source: { connection: 'a', path: '/' }, destination: { connection: 'ro', path: '/' }, names: ['hello.txt'] })).status, 403);
    await mkdir(path.join(a, 'target'));
    const move = await (await post('/api/jobs', { type: 'move', source: { connection: 'a', path: '/' }, destination: { connection: 'a', path: '/target' }, names: ['hello.txt'] })).json();
    assert.equal((await wait(get, move.job.id)).state, 'completed');
    assert.equal(await readFile(path.join(a, 'target', 'hello.txt'), 'utf8'), 'hello');
    assert.ok(!(await readdir(a)).includes('hello.txt'));
  } finally { server.close(); }
});

test('cancels a transfer and removes the partial file', async () => {
  const { server, b, post } = await setup();
  try {
    const { job } = await (await post('/api/jobs', { type: 'copy', source: { connection: 'a', path: '/folder' }, destination: { connection: 'b', path: '/' }, names: ['big.bin'] })).json();
    const cancelled = await (await post(`/api/jobs/${job.id}/cancel`, {})).json();
    assert.equal(cancelled.job.state, 'cancelled');
    await new Promise(r => setTimeout(r, 100));
    assert.ok(!(await readdir(b)).includes('big.bin'));
  } finally { server.close(); }
});

test('interactive duplicates show metadata, skip and overwrite safely including nested files', async () => {
  const { server, a, b, post, get } = await setup();
  const untilConflict = async id => { for (let i = 0; i < 200; i++) { const { jobs } = await (await get('/api/jobs')).json(); const job = jobs.find(j => j.id === id); if (job.conflict) return job; if (job.state === 'failed') throw new Error(job.error); await new Promise(r => setTimeout(r, 10)); } throw new Error('conflict timeout'); };
  try {
    await writeFile(path.join(b, 'hello.txt'), 'original');
    const args = { type: 'copy', source: { connection: 'a', path: '/' }, destination: { connection: 'b', path: '/' }, names: ['hello.txt'], interactive: true };
    let { job } = await (await post('/api/jobs', args)).json();
    const conflict = await untilConflict(job.id);
    assert.equal(conflict.conflict.source.size, 5); assert.equal(conflict.conflict.destination.size, 8); assert.ok(conflict.conflict.destination.date);
    assert.equal(await readFile(path.join(b, 'hello.txt'), 'utf8'), 'original');
    await post(`/api/jobs/${job.id}/resolve`, { choice: 'skip' });
    assert.equal((await wait(get, job.id)).state, 'completed');
    assert.equal(await readFile(path.join(b, 'hello.txt'), 'utf8'), 'original');
    ({ job } = await (await post('/api/jobs', args)).json()); await untilConflict(job.id);
    await post(`/api/jobs/${job.id}/resolve`, { choice: 'overwrite-all' });
    assert.equal((await wait(get, job.id)).state, 'completed');
    assert.equal(await readFile(path.join(b, 'hello.txt'), 'utf8'), 'hello');
    await mkdir(path.join(b, 'folder')); await writeFile(path.join(b, 'folder', 'big.bin'), 'old');
    ({ job } = await (await post('/api/jobs', { ...args, type: 'move', names: ['folder'] })).json());
    assert.equal((await untilConflict(job.id)).conflict.name, 'folder/big.bin');
    await post(`/api/jobs/${job.id}/resolve`, { choice: 'skip-all' });
    assert.equal((await wait(get, job.id)).state, 'completed');
    assert.equal(await readFile(path.join(b, 'folder', 'big.bin'), 'utf8'), 'old');
    assert.equal((await stat(path.join(a, 'folder', 'big.bin'))).size, 3 * 1024 * 1024);
    assert.ok(!(await readdir(b)).some(name => name.endsWith('.transfer')));
  } finally { server.close(); }
});

test('duplicate cancellation and changed destination preserve existing content', async () => {
  const { server, a, b, outside, post, get } = await setup();
  try {
    await symlink(path.join(outside, 'secret'), path.join(b, 'hello.txt'));
    const args = { type: 'copy', source: { connection: 'a', path: '/' }, destination: { connection: 'b', path: '/' }, names: ['hello.txt'], interactive: true };
    const { job } = await (await post('/api/jobs', args)).json();
    assert.equal((await wait(get, job.id)).state, 'failed');
    assert.equal(await readFile(path.join(outside, 'secret'), 'utf8'), 's');
  } finally { server.close(); }
});
