import { Readable, Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { virtualPath } from './providers.mjs';
import { MAX_TEXT, validName } from './operations.mjs';

// FTPS file changes. TLS is always required; every directory is entered one verified segment at a time.
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

async function openAt(connection, dir, factory) {
  const client = factory();
  try {
    await client.access({ host: connection.host, port: connection.port ?? 21, user: connection.user, password: connection.password, secure: true });
    const root = virtualPath(connection.root); const relative = virtualPath(dir);
    await client.cd(root);
    for (const segment of relative.split('/').filter(Boolean)) {
      const entry = (await client.list()).find(item => item.name === segment);
      if (!entry || !entry.isDirectory || entry.isSymbolicLink) throw fail('Directory access denied', 403);
      await client.cd(segment);
    }
    if (virtualPath(await client.pwd()) !== path.posix.join(root, relative.slice(1))) throw fail('FTP path outside root', 403);
    return client;
  } catch (error) { client.close(); throw error; }
}
const entryOf = async (client, name) => (await client.list()).find(item => item.name === validName(name)) ?? null;
function requireFtpWritable(connection) { if (connection.protocol !== 'ftp' || connection.writable !== true) throw fail('This connection is read-only', 403); }
async function withDir(connection, dir, factory, work) { const client = await openAt(connection, dir, factory); try { return await work(client); } finally { client.close(); } }

export async function ftpReadText(connection, dir, name, factory) {
  return withDir(connection, dir, factory, async client => {
    const entry = await entryOf(client, name);
    if (!entry) throw fail(`Item no longer exists: ${name}`, 404);
    if (!entry.isFile || entry.isSymbolicLink) throw fail('Not a file', 400);
    const chunks = []; let size = 0;
    const sink = new Writable({ write(chunk, _e, done) { if (size < MAX_TEXT) { chunks.push(chunk); size += chunk.length; } done(); } });
    await client.downloadTo(sink, entry.name);
    const buffer = Buffer.concat(chunks).subarray(0, MAX_TEXT);
    const binary = buffer.subarray(0, 8000).includes(0);
    return { content: binary ? '' : buffer.toString('utf8'), binary, truncated: entry.size > MAX_TEXT, size: entry.size };
  });
}

export async function ftpWriteText(connection, dir, name, content, factory) {
  requireFtpWritable(connection);
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_TEXT) throw fail('File content too large', 413);
  return withDir(connection, dir, factory, async client => {
    const entry = await entryOf(client, name);
    if (!entry) throw fail(`Item no longer exists: ${name}`, 404);
    if (!entry.isFile || entry.isSymbolicLink) throw fail('Cannot edit a directory', 400);
    // Upload to a temporary name first, then replace, so a dropped connection never truncates the original.
    const temp = `.cdc-${randomBytes(6).toString('hex')}.tmp`;
    await client.uploadFrom(Readable.from([Buffer.from(content, 'utf8')]), temp);
    try { await client.remove(entry.name); await client.rename(temp, entry.name); }
    catch (error) { await client.remove(temp).catch(() => undefined); throw error; }
  });
}

export async function ftpMakeDirectory(connection, dir, name, factory) {
  requireFtpWritable(connection);
  return withDir(connection, dir, factory, async client => {
    if (await entryOf(client, name)) throw fail('An item with this name already exists');
    await client.send(`MKD ${name}`);
  });
}

export async function ftpRemove(connection, dir, names, factory) {
  requireFtpWritable(connection);
  if (!Array.isArray(names) || !names.length || names.length > 10000) throw fail('Select a file or folder first', 400);
  return withDir(connection, dir, factory, async client => {
    const list = await client.list();
    const entries = names.map(name => { const entry = list.find(item => item.name === validName(name)); if (!entry) throw fail(`Item no longer exists: ${name}`, 404); return entry; });
    for (const entry of entries) {
      if (entry.isSymbolicLink) throw fail('Links are not supported', 403);
      if (entry.isDirectory) await client.removeDir(entry.name);
      else await client.remove(entry.name);
    }
  });
}

export async function ftpRename(connection, dir, mapping, factory) {
  requireFtpWritable(connection);
  if (!Array.isArray(mapping) || !mapping.length || mapping.length > 10000) throw fail('Nothing to rename', 400);
  const olds = mapping.map(item => validName(item?.from)); const news = mapping.map(item => validName(item?.to));
  if (new Set(olds).size !== olds.length || new Set(news).size !== news.length) throw fail('The pattern produces duplicate filenames');
  return withDir(connection, dir, factory, async client => {
    const present = new Set((await client.list()).map(item => item.name));
    for (const name of olds) if (!present.has(name)) throw fail(`Item no longer exists: ${name}`, 404);
    for (const name of news) if (!olds.includes(name) && present.has(name)) throw fail(`An item named ${name} already exists`);
    const temps = olds.map(() => `.cdc-${randomBytes(6).toString('hex')}.rename`);
    for (let i = 0; i < olds.length; i++) await client.rename(olds[i], temps[i]);
    for (let i = 0; i < olds.length; i++) await client.rename(temps[i], news[i]);
  });
}
