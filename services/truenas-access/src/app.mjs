import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { validateConnections, virtualPath } from './providers.mjs';
import { CSP, loginPage, staticFile } from './ui.mjs';
import { checksums, combine, compare, listArchive, occupied, pack, split, unpack, verifyChecksums } from './tools.mjs';
import { ftpMakeDirectory, ftpReadText, ftpRemove, ftpRename, ftpWriteText } from './ftp.mjs';
import { MAX_TEXT, createJobs, makeDirectory, readText, remove, renameMany, setAttributes, writeText } from './operations.mjs';

const VERSION = '0.5.0';
const mounted = connection => ['local', 'smb', 'nfs'].includes(connection.protocol);
function problem(error) {
  if (error?.status) return [error.status, error.message];
  if (error?.code === 'ENOENT') return [404, 'Item no longer exists'];
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return [403, 'Permission denied on the NAS'];
  if (error?.code === 'ENOSPC') return [507, 'Not enough free space on the NAS'];
  if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST') return [409, 'An item with this name already exists'];
  if (error?.message === 'Invalid path') return [400, 'Invalid path'];
  return [403, 'Operation not permitted'];
}

function readBody(request, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    request.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Body too large')); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function createAccessServer({ token, connections, list, sessions = null, publicDir = null, ftpFactory = null }) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('Service token must contain at least 32 bytes');
  validateConnections(connections);
  const expected = Buffer.from(`Bearer ${token}`);
  const discovery = () => connections.map(({ id, label, protocol, writable }) => ({ id, label, protocol, capabilities: ['list', ...(mounted({ protocol }) || (protocol === 'ftp' && ftpFactory) ? ['read'] : []), ...((mounted({ protocol }) || (protocol === 'ftp' && ftpFactory)) && writable === true ? ['write'] : []), ...(mounted({ protocol }) ? ['tools', 'transfer'] : [])] }));
  const find = id => connections.find(item => item.id === id);
  const jobs = createJobs({ resolve: find });
  const anyWritable = connections.some(item => item.writable === true);

  async function listing(id, rawPath, send) {
    const connection = connections.find(item => item.id === id);
    if (!connection) return send(404, { error: 'Connection not found' });
    let requested;
    try { requested = virtualPath(rawPath ?? '/'); }
    catch { return send(400, { error: 'Invalid directory path' }); }
    try { return send(200, { path: requested, ...await list(connection, requested) }); }
    catch { return send(403, { error: 'Directory unavailable or access denied' }); }
  }

  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    const send = (status, body, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(body)); };
    const redirect = (location, headers = {}) => { response.writeHead(303, { Location: location, ...headers }); response.end(); };
    let url;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { return send(400, { error: 'Invalid request URL' }); }

    // Script/automation API: bearer token, unchanged.
    if (url.pathname.startsWith('/v1/') || !sessions) {
      const provided = Buffer.from(request.headers.authorization ?? '');
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(401, { error: 'Authentication required' });
      if (request.method !== 'GET') return send(405, { error: 'Read-only service' });
      if (url.pathname === '/v1/health') return send(200, { status: 'ok', mode: anyWritable ? 'read-write' : 'read-only', version: VERSION });
      if (url.pathname === '/v1/connections') return send(200, { connections: discovery() });
      const match = /^\/v1\/connections\/([a-zA-Z0-9_-]+)\/entries$/.exec(url.pathname);
      if (!match) return send(404, { error: 'Not found' });
      return listing(match[1], url.searchParams.get('path'), send);
    }

    // Browser UI: password session cookie.
    const origin = request.headers.origin;
    const sameOrigin = !origin || origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`;
    const signedIn = sessions.valid(request.headers.cookie);

    if (url.pathname === '/auth/login') {
      if (request.method !== 'POST') return send(405, { error: 'Method not allowed' });
      if (!sameOrigin) return send(403, { error: 'Cross-origin request rejected' });
      let password = '';
      try { password = new URLSearchParams(await readBody(request)).get('password') ?? ''; }
      catch { return send(413, { error: 'Request too large' }); }
      const result = sessions.login(request.socket.remoteAddress ?? 'unknown', password);
      if (!result.ok) return redirect(`/login?error=${result.limited ? 'limited' : '1'}`);
      return redirect('/', { 'Set-Cookie': result.cookie });
    }
    if (url.pathname === '/auth/logout') {
      if (request.method !== 'POST') return send(405, { error: 'Method not allowed' });
      if (!sameOrigin) return send(403, { error: 'Cross-origin request rejected' });
      return redirect('/login', { 'Set-Cookie': sessions.clearCookie });
    }
    // File changes: session + an explicit same-origin Origin header + JSON body (CSRF defence).
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (!signedIn) return send(401, { error: 'Sign in required' });
      if (!origin || !sameOrigin) return send(403, { error: 'Cross-origin request rejected' });
      if (!(request.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON required' });
      let body;
      try { body = JSON.parse(await readBody(request, MAX_TEXT * 4 + 4096)); } catch { return send(400, { error: 'Invalid request' }); }
      if (!body || typeof body !== 'object') return send(400, { error: 'Invalid request' });
      try {
        const control = /^\/api\/jobs\/(\d+)\/(pause|resume|cancel|resolve)$/.exec(url.pathname);
        if (control) return send(200, { job: jobs.control(Number(control[1]), control[2], body.choice) });
        if (url.pathname === '/api/jobs') return send(202, { job: await jobs.start(body) });
        const connection = find(body.connection);
        if (!connection) return send(404, { error: 'Connection not found' });
        const dir = virtualPath(body.path ?? '/');
        const tool = /^\/api\/tools\/([a-z-]+)$/.exec(url.pathname)?.[1];
        if (tool) {
          if (!mounted(connection)) return send(403, { error: 'This tool needs a mounted SMB/NFS/local connection' });
          const target = () => { const to = find(body.destination?.connection); if (!to || !mounted(to)) throw Object.assign(new Error('Target connection not found'), { status: 404 }); return { connection: to, path: virtualPath(body.destination.path ?? '/') }; };
          const other = () => { const c = find(body.other?.connection); if (!c || !mounted(c)) throw Object.assign(new Error('Second file not found'), { status: 404 }); return { connection: c, path: virtualPath(body.other.path ?? '/'), name: body.other.name }; };
          const tools = {
            checksum: () => checksums(connection, dir, body), verify: () => verifyChecksums(connection, dir, body), occupied: () => occupied(connection, dir, body),
            compare: () => compare({ connection, path: dir, name: body.name }, other()), split: () => split(connection, dir, body, target()), combine: () => combine(connection, dir, body, target()),
            pack: () => pack(connection, dir, body, target()), 'list-archive': () => listArchive(connection, dir, body), unpack: () => unpack(connection, dir, body, target()),
          };
          if (!tools[tool]) return send(404, { error: 'Not found' });
          return send(200, await tools[tool]());
        }
        if (connection.protocol === 'ftp') {
          if (!ftpFactory) return send(403, { error: 'FTP changes are not available' });
          if (url.pathname === '/api/write') await ftpWriteText(connection, dir, body.name, body.content, ftpFactory);
          else if (url.pathname === '/api/mkdir') await ftpMakeDirectory(connection, dir, body.name, ftpFactory);
          else if (url.pathname === '/api/delete') await ftpRemove(connection, dir, body.names, ftpFactory);
          else if (url.pathname === '/api/rename') await ftpRename(connection, dir, body.mapping, ftpFactory);
          else return send(403, { error: 'This action needs a mounted SMB/NFS/local connection' });
          return send(200, { ok: true });
        }
        if (url.pathname === '/api/write') await writeText(connection, dir, body.name, body.content);
        else if (url.pathname === '/api/mkdir') await makeDirectory(connection, dir, body.name);
        else if (url.pathname === '/api/delete') await remove(connection, dir, body.names);
        else if (url.pathname === '/api/rename') await renameMany(connection, dir, body.mapping);
        else if (url.pathname === '/api/attributes') await setAttributes(connection, dir, Array.isArray(body.names) ? body.names : [], body.mode, body.date);
        else return send(404, { error: 'Not found' });
        return send(200, { ok: true });
      } catch (error) { const [status, message] = problem(error); return send(status, { error: message }); }
    }
    if (request.method !== 'GET') return send(405, { error: 'Method not allowed' });
    if (url.pathname === '/login') {
      if (signedIn) return redirect('/');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP.replace("style-src 'self' 'unsafe-inline'", "style-src 'unsafe-inline'") });
      return response.end(loginPage(url.searchParams.get('error')));
    }
    if (url.pathname.startsWith('/api/')) {
      if (!signedIn) return send(401, { error: 'Sign in required' });
      if (!sameOrigin) return send(403, { error: 'Cross-origin request rejected' });
      if (url.pathname === '/api/connections') return send(200, { connections: discovery() });
      if (url.pathname === '/api/entries') return listing(url.searchParams.get('connection') ?? '', url.searchParams.get('path'), send);
      if (url.pathname === '/api/jobs') return send(200, { jobs: jobs.list() });
      if (url.pathname === '/api/file') {
        const connection = find(url.searchParams.get('connection') ?? '');
        if (!connection || !(mounted(connection) || (connection.protocol === 'ftp' && ftpFactory))) return send(404, { error: 'File preview is not available for this connection' });
        if (connection.protocol === 'ftp') { try { return send(200, await ftpReadText(connection, virtualPath(url.searchParams.get('path') ?? '/'), url.searchParams.get('name'), ftpFactory)); } catch (error) { const [status, message] = problem(error); return send(status, { error: message }); } }
        try { return send(200, await readText(connection, virtualPath(url.searchParams.get('path') ?? '/'), url.searchParams.get('name'))); }
        catch (error) { const [status, message] = problem(error); return send(status, { error: message }); }
      }
      return send(404, { error: 'Not found' });
    }
    if (!signedIn) return redirect('/login');
    const file = publicDir ? await staticFile(publicDir, url.pathname) ?? (url.pathname.includes('.') ? null : await staticFile(publicDir, '/')) : null;
    if (!file) return send(404, { error: 'Not found' });
    response.writeHead(200, { 'Content-Type': file.type, 'Content-Security-Policy': CSP });
    return response.end(file.body);
  });
}
