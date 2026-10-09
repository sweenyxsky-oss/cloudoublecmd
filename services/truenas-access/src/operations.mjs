import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, utimes, chmod, link } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { confined, virtualPath } from './providers.mjs';

// Write operations for host-mounted connections that are explicitly marked "writable".
// Every path is re-confined at the moment of use; symlinks are never followed or created.

export const MAX_TEXT = 1024 * 1024;

export function validName(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || name === '.' || name === '..' || /[\/\\\u0000-\u001f\u007f]/.test(name)) throw Object.assign(new Error('Invalid name'), { status: 400 });
  return name;
}
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
export async function exists(target) { try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

/** Resolves an existing, non-symlink child of a confined directory. */
export async function child(connection, dir, name) {
  const parent = await confined(connection.root, dir);
  const target = path.join(parent, validName(name));
  const info = await lstat(target).catch(() => null);
  if (!info) throw fail(`Item no longer exists: ${name}`, 404);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw fail('Links and special files are not supported', 403);
  return { parent, target, info };
}

export function requireWritable(connection) {
  if (!connection) throw fail('Connection not found', 404);
  if (!['local', 'smb', 'nfs'].includes(connection.protocol) || connection.writable !== true) throw fail('This connection is read-only', 403);
}

export async function readText(connection, dir, name) {
  const { target, info } = await child(connection, dir, name);
  if (!info.isFile()) throw fail('Not a file', 400);
  const handle = await open(target, 'r');
  try {
    const length = Math.min(info.size, MAX_TEXT);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    const binary = buffer.subarray(0, 8000).includes(0);
    return { content: binary ? '' : buffer.toString('utf8'), binary, truncated: info.size > MAX_TEXT, size: info.size };
  } finally { await handle.close(); }
}

export async function writeText(connection, dir, name, content) {
  requireWritable(connection);
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_TEXT) throw fail('File content too large', 413);
  const { parent, target, info } = await child(connection, dir, name);
  if (!info.isFile()) throw fail('Cannot edit a directory', 400);
  if (info.size > MAX_TEXT) throw fail('File is too large to edit in the browser', 413);
  // Atomic replace: write a temporary sibling, keep permissions, then rename over the original.
  const temp = path.join(parent, `.cdc-${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', info.mode & 0o777);
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, target); } catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function makeDirectory(connection, dir, name) {
  requireWritable(connection);
  const parent = await confined(connection.root, dir);
  const target = path.join(parent, validName(name));
  try { await mkdir(target); } catch (error) { if (error.code === 'EEXIST') throw fail('An item with this name already exists'); throw error; }
}

export async function remove(connection, dir, names) {
  requireWritable(connection);
  if (!Array.isArray(names) || !names.length || names.length > 10000) throw fail('Select a file or folder first', 400);
  const targets = [];
  for (const name of names) targets.push((await child(connection, dir, name)).target);
  // fs.rm never follows symlinks inside the tree; it removes the link itself.
  for (const target of targets) await rm(target, { recursive: true, force: false });
}

export async function renameMany(connection, dir, mapping) {
  requireWritable(connection);
  if (!Array.isArray(mapping) || !mapping.length || mapping.length > 10000) throw fail('Nothing to rename', 400);
  const parent = await confined(connection.root, dir);
  const olds = mapping.map(item => validName(item?.from)); const news = mapping.map(item => validName(item?.to));
  if (new Set(olds).size !== olds.length || new Set(news).size !== news.length) throw fail('The pattern produces duplicate filenames');
  for (const name of olds) await child(connection, dir, name);
  for (const name of news) if (!olds.includes(name) && await exists(path.join(parent, name))) throw fail(`An item named ${name} already exists`);
  // Two phases through unique temporary names so swaps (a↔b) are safe.
  const temps = olds.map(() => path.join(parent, `.cdc-${randomBytes(6).toString('hex')}.rename`));
  for (let i = 0; i < olds.length; i++) await rename(path.join(parent, olds[i]), temps[i]);
  for (let i = 0; i < olds.length; i++) await rename(temps[i], path.join(parent, news[i]));
}

export async function setAttributes(connection, dir, names, mode, date) {
  requireWritable(connection);
  if (mode !== undefined && !/^[0-7]{3}$/.test(String(mode))) throw fail('Invalid permissions', 400);
  const when = date === undefined ? null : new Date(date);
  if (when && Number.isNaN(when.getTime())) throw fail('Invalid date', 400);
  for (const name of names) {
    const { target } = await child(connection, dir, name);
    if (mode !== undefined) await chmod(target, parseInt(mode, 8));
    if (when) await utimes(target, when, when);
  }
}

async function measure(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) return { bytes: 0, files: 0 };
  if (info.isFile()) return { bytes: info.size, files: 1 };
  if (!info.isDirectory()) return { bytes: 0, files: 0 };
  let bytes = 0; let files = 0;
  for (const entry of await readdir(target)) { const sub = await measure(path.join(target, entry)); bytes += sub.bytes; files += sub.files; }
  return { bytes, files };
}

/** Background copy/move jobs with byte progress, pause and cancel. Kept in memory; a restart cancels them. */
export function createJobs({ resolve }) {
  const jobs = new Map(); let nextId = 1;

  const metadata = (name, info) => ({ name, directory: info.isDirectory(), size: info.size, date: info.mtime.toISOString(), attr: '' });
  async function checkpoint(job) {
    while (job.state === 'paused') await new Promise(resolve => setTimeout(resolve, 30));
    if (job.state === 'cancelled') throw fail('Cancelled', 499);
  }
  async function copyTree(job, source, target, relative) {
    await checkpoint(job);
    // Re-confine every recursive parent, not just the initial job request.
    await confined(job.fromRoot, '/' + path.relative(job.fromRoot, path.dirname(source)).split(path.sep).join('/'));
    await confined(job.toRoot, '/' + path.relative(job.toRoot, path.dirname(target)).split(path.sep).join('/'));
    const info = await lstat(source);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) return false;
    let existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing?.isSymbolicLink() || (existing && !existing.isFile() && !existing.isDirectory())) throw fail('Links and special files are not supported', 403);
    let overwrite = false;
    if (existing && !(info.isDirectory() && existing.isDirectory())) {
      let choice = job.policy;
      if (!choice) {
        job.conflict = { name: relative, source: metadata(relative, info), destination: metadata(relative, existing) };
        job.state = 'paused';
        choice = await new Promise(resolve => { job.resolveConflict = resolve; });
        job.conflict = null; job.resolveConflict = null;
        await checkpoint(job);
      }
      if (choice === 'skip') { job.total -= (await measure(source)).bytes; return false; }
      if (info.isDirectory() || !existing.isFile()) throw fail('A file cannot replace a folder. Skip this item.');
      overwrite = true;
    }
    if (info.isDirectory()) {
      if (!existing) await mkdir(target, { mode: info.mode & 0o777 });
      let all = true;
      for (const entry of await readdir(source)) if (!await copyTree(job, path.join(source, entry), path.join(target, entry), relative + '/' + entry)) all = false;
      await utimes(target, info.atime, info.mtime).catch(() => {});
      if (job.type === 'move' && all) await rm(source, { recursive: true });
      return all;
    }
    job.current = relative;
    const temporary = path.join(path.dirname(target), `.cdc-${randomBytes(12).toString('hex')}.transfer`);
    try {
      await new Promise((done, failed) => {
        const input = createReadStream(source, { highWaterMark: 1024 * 1024 });
        const output = createWriteStream(temporary, { flags: 'wx', mode: info.mode & 0o777 });
        let stopped = false;
        const stop = error => { if (stopped) return; stopped = true; input.destroy(); output.destroy(); failed(error); };
        job.abort = () => stop(fail('Cancelled', 499));
        input.on('data', chunk => {
          job.processed += chunk.length;
          if (job.state === 'paused') { input.pause(); job.resume = () => input.resume(); }
        });
        input.on('error', stop); output.on('error', stop); output.on('finish', done); input.pipe(output);
      });
      job.abort = null;
      await checkpoint(job);
      await confined(job.toRoot, '/' + path.relative(job.toRoot, path.dirname(target)).split(path.sep).join('/'));
      await utimes(temporary, info.atime, info.mtime);
      // Recheck before publication. Never truncate the existing destination during transfer.
      const current = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (overwrite) {
        if (!current?.isFile() || current.isSymbolicLink() || current.ino !== existing.ino || current.dev !== existing.dev || current.size !== existing.size || current.mtimeMs !== existing.mtimeMs) throw fail('Destination changed while copying; retry the transfer');
        await rename(temporary, target);
      } else await link(temporary, target);
      if (job.type === 'move') await rm(source);
      return true;
    } finally { job.abort = null; await rm(temporary, { force: true }); }
  }
  async function run(job, plan) {
    try {
      for (const { source, target, name } of plan) await copyTree(job, source, target, name);
      if (job.state !== 'cancelled') job.state = 'completed';
    } catch (error) {
      if (job.state !== 'cancelled') { job.state = 'failed'; job.error = error.status && error.status < 500 ? error.message : 'Transfer failed: check permissions and free space'; }
    }
    job.conflict = null; job.finished = Date.now();
  }

  return {
    async start({ type, source, destination, names, interactive = false }) {
      if (type !== 'copy' && type !== 'move') throw fail('Invalid operation', 400);
      const from = resolve(source?.connection); const to = resolve(destination?.connection);
      requireWritable(to); if (type === 'move') requireWritable(from); else if (!from || !['local', 'smb', 'nfs'].includes(from.protocol)) throw fail('Copying from this connection is not supported yet', 403);
      if (!Array.isArray(names) || !names.length || names.length > 10000) throw fail('Select a file or folder first', 400);
      const sourceDir = virtualPath(source.path); const targetDir = await confined(to.root, destination.path);
      const plan = []; let total = 0;
      for (const name of names) {
        const { target: src, info } = await child(from, sourceDir, name);
        const dst = path.join(targetDir, name);
        if (dst === src || dst.startsWith(src + path.sep)) throw fail('Cannot copy a folder into itself', 400);
        if (!interactive && await exists(dst)) throw fail(`The destination already contains ${name}`);
        await lstat(targetDir);
        plan.push({ source: src, target: dst, name });
        total += (await measure(src)).bytes;
      }
      const job = { id: nextId++, type, source: { connection: from.id, path: sourceDir }, destination: { connection: to.id, path: virtualPath(destination.path) }, names, total, processed: 0, state: 'running', error: null, current: null, abort: null, resume: null, finished: null, started: Date.now(), policy: null, conflict: null, resolveConflict: null, fromRoot: await confined(from.root, '/'), toRoot: await confined(to.root, '/') };
      jobs.set(job.id, job);
      for (const [id, old] of jobs) if (old.finished && Date.now() - old.finished > 3_600_000) jobs.delete(id);
      void run(job, plan);
      return view(job);
    },
    list: () => [...jobs.values()].map(view),
    control(id, action, choice) {
      const job = jobs.get(id);
      if (!job) throw fail('Transfer not found', 404);
      if (job.state !== 'running' && job.state !== 'paused') return view(job);
      if (action === 'resolve') {
        if (!job.conflict || !['overwrite', 'skip', 'overwrite-all', 'skip-all'].includes(choice)) throw fail('Invalid conflict decision', 400);
        if (choice.startsWith('overwrite') && (job.conflict.source.directory || job.conflict.destination.directory)) throw fail('A file cannot replace a folder. Skip this item.');
        const decision = choice.startsWith('overwrite') ? 'overwrite' : 'skip';
        if (choice.endsWith('-all')) job.policy = decision;
        job.state = 'running'; job.resolveConflict?.(decision);
      } else if (job.conflict && action !== 'cancel') throw fail('Choose how to handle the duplicate first');
      else if (action === 'pause') job.state = 'paused';
      else if (action === 'resume') { job.state = 'running'; job.resume?.(); job.resume = null; }
      else if (action === 'cancel') { job.state = 'cancelled'; job.resolveConflict?.('skip'); job.resume?.(); job.abort?.(); }
      else throw fail('Invalid action', 400);
      return view(job);
    },
  };
}
const view = job => ({ id: job.id, type: job.type, source: job.source, destination: job.destination, names: job.names, total: job.total, processed: Math.min(job.processed, job.total), state: job.state, error: job.error, current: job.current, conflict: job.conflict, rate: job.state === 'running' ? Math.round(job.processed / Math.max(0.001, ((job.finished ?? Date.now()) - job.started) / 1000)) : 0 });
