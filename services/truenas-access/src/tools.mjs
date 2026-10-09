import { formatOf, inspectArchive, packArchive, unpackArchive } from './archives.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { confined } from './providers.mjs';
import { child, exists, MAX_TEXT, requireWritable, validName } from './operations.mjs';

// Content tools for host-mounted connections. Reads work on any mounted root; anything that creates
// files requires a writable destination, never overwrites, and never follows or extracts links.

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const ALGORITHMS = { md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512' };
const temp = dir => path.join(dir, `.cdc-${randomBytes(6).toString('hex')}.tmp`);

/** Publishes a finished temporary file under its final name, refusing to replace anything. */
async function publish(tmp, target) {
  try { await link(tmp, target); }
  catch (error) { if (error.code === 'EEXIST') throw fail(`${path.basename(target)} already exists`); throw error; }
  finally { await rm(tmp, { force: true }); }
}
async function writeNew(dir, name, data) {
  const tmp = temp(dir); const handle = await open(tmp, 'wx', 0o644);
  try { await handle.writeFile(data); } finally { await handle.close(); }
  await publish(tmp, path.join(dir, validName(name)));
}
async function hashFile(file, algorithm) {
  const hash = createHash(algorithm); await pipeline(createReadStream(file), hash); return hash.digest('hex');
}
async function files(connection, dir, names) {
  if (!Array.isArray(names) || !names.length || names.length > 10000) throw fail('Select a file first', 400);
  const result = [];
  for (const name of names) { const item = await child(connection, dir, name); if (item.info.isFile()) result.push({ name, ...item }); }
  if (!result.length) throw fail('Select files, not folders', 400);
  return result;
}

export async function checksums(connection, dir, { names, algorithm, output }) {
  const algo = ALGORITHMS[algorithm]; if (!algo) throw fail('Unsupported checksum type', 400);
  const lines = [];
  for (const item of await files(connection, dir, names)) lines.push(`${await hashFile(item.target, algo)} *${item.name}`);
  const text = lines.join('\n') + '\n';
  if (output) { requireWritable(connection); await writeNew(await confined(connection.root, dir), output, text); }
  return { text, count: lines.length };
}

export async function verifyChecksums(connection, dir, { name }) {
  const { target, info, parent } = await child(connection, dir, name);
  if (!info.isFile() || info.size > MAX_TEXT) throw fail('Not a checksum file', 400);
  const ext = path.extname(name).slice(1).toLowerCase(); const lengths = { 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' };
  const results = [];
  for (const line of (await open(target, 'r').then(async h => { try { return await h.readFile('utf8'); } finally { await h.close(); } })).split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{32,128})\s+\*?(.+)$/.exec(line.trim()); if (!match) continue;
    const algo = ALGORITHMS[ext] ?? lengths[match[1].length]; const file = match[2];
    let state = 'missing';
    try { validName(file); const item = await lstat(path.join(parent, file)); if (item.isFile() && !item.isSymbolicLink()) state = (await hashFile(path.join(parent, file), algo)) === match[1].toLowerCase() ? 'ok' : 'failed'; } catch { state = 'missing'; }
    results.push({ name: file, state });
  }
  if (!results.length) throw fail('No checksums found in this file', 400);
  return { results };
}

export async function occupied(connection, dir, { names }) {
  let bytes = 0, fileCount = 0, folders = 0;
  async function walk(target) {
    const info = await lstat(target);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) { bytes += info.size; fileCount++; return; }
    if (!info.isDirectory()) return;
    folders++; for (const entry of await readdir(target)) await walk(path.join(target, entry));
  }
  for (const name of Array.isArray(names) ? names : []) await walk((await child(connection, dir, name)).target);
  return { bytes, files: fileCount, folders };
}

export async function compare(left, right) {
  const a = await child(left.connection, left.path, left.name); const b = await child(right.connection, right.path, right.name);
  if (!a.info.isFile() || !b.info.isFile()) throw fail('Compare two files, not folders', 400);
  let identical = a.info.size === b.info.size;
  if (identical) identical = (await hashFile(a.target, 'sha256')) === (await hashFile(b.target, 'sha256'));
  const text = async item => { if (item.info.size > MAX_TEXT) return null; const h = await open(item.target, 'r'); try { const buf = await h.readFile(); return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8'); } finally { await h.close(); } };
  return { identical, sizes: [a.info.size, b.info.size], left: identical ? null : await text(a), right: identical ? null : await text(b) };
}

export async function split(connection, dir, { name, partSize }, destination) {
  requireWritable(destination.connection);
  const size = Number(partSize); if (!Number.isInteger(size) || size < 1024 || size > 2 ** 40) throw fail('Part size must be at least 1 KB', 400);
  const { target, info } = await child(connection, dir, name); if (!info.isFile()) throw fail('Select a file first', 400);
  const parts = Math.max(1, Math.ceil(info.size / size)); if (parts > 999) throw fail('That would create more than 999 parts', 400);
  const out = await confined(destination.connection.root, destination.path);
  const names = Array.from({ length: parts }, (_, i) => `${name}.${String(i + 1).padStart(3, '0')}`);
  for (const part of names) { validName(part); if (await exists(path.join(out, part))) throw fail(`${part} already exists`); }
  for (let i = 0; i < parts; i++) {
    const tmp = temp(out);
    await pipeline(createReadStream(target, { start: i * size, end: Math.min(info.size, (i + 1) * size) - 1 }), createWriteStream(tmp, { flags: 'wx', mode: 0o644 }));
    await publish(tmp, path.join(out, names[i]));
  }
  return { parts: names };
}

export async function combine(connection, dir, { name, output }, destination) {
  requireWritable(destination.connection);
  const match = /^(.*)\.(\d{3})$/.exec(name); if (!match) throw fail('Select the first part (name.001)', 400);
  const parent = await confined(connection.root, dir); const parts = [];
  for (let i = 1; i < 1000; i++) {
    const part = `${match[1]}.${String(i).padStart(3, '0')}`; const info = await lstat(path.join(parent, part)).catch(() => null);
    if (!info) break; if (!info.isFile() || info.isSymbolicLink()) throw fail(`${part} is not a regular file`, 400); parts.push(path.join(parent, part));
  }
  if (!parts.length) throw fail('Part .001 not found', 404);
  const out = await confined(destination.connection.root, destination.path); const final = validName(output || match[1]);
  if (await exists(path.join(out, final))) throw fail(`${final} already exists`);
  const tmp = temp(out); const stream = createWriteStream(tmp, { flags: 'wx', mode: 0o644 });
  try {
    for (const part of parts) await new Promise((done, failed) => { const input = createReadStream(part); input.on('error', failed); stream.once('error', failed); input.on('end', done); input.pipe(stream, { end: false }); });
    await new Promise((done, failed) => { stream.once('error', failed); stream.end(done); });
  } catch (error) { stream.destroy(); await rm(tmp, { force: true }); throw error; }
  await publish(tmp, path.join(out, final));
  return { parts: parts.length, name: final };
}

const archiveKind = name => /\.(tar\.gz|tgz)$/i.test(name) ? 'gzip' : /\.tar$/i.test(name) ? 'tar' : null;
const safeEntry = entryPath => { const clean = entryPath.replace(/\/+$/, ''); return clean && !clean.startsWith('/') && !clean.includes('\\') && !clean.split('/').some(s => s === '..' || s === '.' || !s) && !/[\u0000-\u001f]/.test(clean) ? clean : null; };

export async function pack(connection, dir, { names, archive }, destination) {
  if (formatOf(archive ?? '') && !archiveKind(archive)) return packArchive(connection, dir, { names, archive }, destination);
  requireWritable(destination.connection);
  const kind = archiveKind(validName(archive ?? '')); if (!kind) throw fail('Archive name must end in .tar, .tar.gz or .tgz', 400);
  const source = await confined(connection.root, dir);
  for (const name of names ?? []) await child(connection, dir, name);
  if (!Array.isArray(names) || !names.length) throw fail('Select files to pack', 400);
  const out = await confined(destination.connection.root, destination.path);
  if (await exists(path.join(out, archive))) throw fail(`${archive} already exists`);
  const tmp = temp(out);
  try { await tar.c({ gzip: kind === 'gzip', cwd: source, file: tmp, portable: true, follow: false, filter: (_p, stat) => stat.isFile() || stat.isDirectory() }, names); }
  catch (error) { await rm(tmp, { force: true }); throw error; }
  await publish(tmp, path.join(out, archive));
  return { name: archive };
}

async function entriesOf(file) {
  const entries = [];
  await tar.t({ file, onReadEntry: entry => { entries.push({ name: entry.path, type: entry.type, size: entry.size ?? 0 }); entry.resume(); } });
  return entries;
}

export async function listArchive(connection, dir, { name }) {
  const { target, info } = await child(connection, dir, name);
  if (!info.isFile()) throw fail('Select an archive', 400);
  if (!archiveKind(name)) { if (!formatOf(name)) throw fail('Unsupported archive format', 400); return { entries: await inspectArchive(target) }; }
  try {
    const entries = await entriesOf(target);
    return { entries: entries.map(e => ({ name: e.name, directory: e.type === 'Directory', size: e.size, supported: (e.type === 'File' || e.type === 'Directory') && !!safeEntry(e.name) })) };
  } catch { throw fail('The archive is damaged or not a tar archive', 422); }
}

export async function unpack(connection, dir, { name, only }, destination) {
  requireWritable(destination.connection);
  const { target, info } = await child(connection, dir, name);
  if (!info.isFile()) throw fail('Select an archive', 400);
  if (!archiveKind(name)) { if (!formatOf(name)) throw fail('Unsupported archive format', 400); return unpackArchive(connection, dir, { name, only }, destination); }
  const out = await confined(destination.connection.root, destination.path);
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  const entries = (await entriesOf(target).catch(() => { throw fail('The archive is damaged or not a tar archive', 422); }))
    .filter(e => (e.type === 'File' || e.type === 'Directory') && safeEntry(e.name) && (!wanted || wanted.has(e.name)));
  if (!entries.length) throw fail('Nothing to unpack', 400);
  for (const entry of entries) if (entry.type === 'File' && await exists(path.join(out, safeEntry(entry.name)))) throw fail(`${safeEntry(entry.name)} already exists in the target folder`);
  const allowed = new Set(entries.map(e => e.name));
  // Only plain files/folders with clean relative paths; no links, devices, owners or absolute paths.
  await tar.x({ file: target, cwd: out, keep: true, preservePaths: false, preserveOwner: false, noChmod: false, strict: true,
    filter: (entryPath, entry) => allowed.has(entryPath) && (entry.type === 'File' || entry.type === 'Directory') });
  return { files: entries.filter(e => e.type === 'File').length };
}
