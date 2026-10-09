import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccessServer } from '../src/app.mjs';
import { createSessions } from '../src/session.mjs';
import { staticFile } from '../src/ui.mjs';

const token = 'test-only-'.repeat(5);
const password = 'correct horse battery';

async function start(publicDir) {
  const sessions = createSessions(password, { maxAttempts: 3 });
  const server = createAccessServer({ token, sessions, publicDir, connections: [{ id: 'test', label: 'Test', protocol: 'local', root: '/data' }], list: async () => ({ entries: [{ name: 'a.txt', directory: false, size: 1 }], space: null }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}
const login = (base, value) => fetch(`${base}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: value }) });

test('web UI requires a session, rate-limits logins and rejects tampering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cdc-ui-'));
  await writeFile(path.join(dir, 'index.html'), '<html>app</html>');
  const { server, base } = await start(dir);
  try {
    assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/login');
    assert.equal((await fetch(`${base}/api/connections`)).status, 401);
    assert.equal((await fetch(`${base}/login`)).status, 200);
    const bad = await login(base, 'wrong');
    assert.equal(bad.headers.get('location'), '/login?error=1');
    const good = await login(base, password);
    const cookie = good.headers.get('set-cookie').split(';')[0];
    assert.match(good.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const page = await fetch(`${base}/`, { headers: { cookie } });
    assert.equal(await page.text(), '<html>app</html>');
    assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const api = await (await fetch(`${base}/api/entries?connection=test&path=/`, { headers: { cookie } })).json();
    assert.equal(api.entries[0].name, 'a.txt');
    assert.equal((await fetch(`${base}/api/entries?connection=test&path=/../x`, { headers: { cookie } })).status, 400);
    assert.equal((await fetch(`${base}/api/connections`, { headers: { cookie, origin: 'http://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/connections`, { method: 'POST', headers: { cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/connections`, { headers: { cookie: cookie.slice(0, -2) + 'xx' } })).status, 401);
    assert.equal((await fetch(`${base}/v1/health`, { headers: { cookie } })).status, 401);
    assert.equal((await fetch(`${base}/v1/health`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await login(base, 'wrong'); await login(base, 'wrong'); await login(base, 'wrong');
    assert.equal((await login(base, password)).headers.get('location'), '/login?error=limited');
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('static files reject traversal, hidden files and unknown types', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cdc-static-'));
  try {
    await mkdir(path.join(dir, 'assets')); await writeFile(path.join(dir, 'assets', 'app.js'), 'x'); await writeFile(path.join(dir, '.env'), 'secret');
    assert.equal((await staticFile(dir, '/assets/app.js')).type.startsWith('text/javascript'), true);
    for (const bad of ['/../etc/passwd', '/%2e%2e/etc/passwd', '/.env', '/assets', '/assets/app.exe']) assert.equal(await staticFile(dir, bad), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('short UI passwords are refused', () => {
  assert.throws(() => createSessions('short'));
});
