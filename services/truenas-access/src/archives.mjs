// Node NAS service only. Extract one regular entry to stdout, never let an archiver write paths.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, lstat, readdir, copyFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { confined } from './providers.mjs';
import { child, requireWritable, validName, exists } from './operations.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_BYTES = 20 * 1024 ** 3, MAX_ENTRIES = 100000;
const binary = process.env.ARCHIVER_BIN || '7z';
export const formatOf = name => ({ zip: 'zip', '7z': '7z', rar: 'rar', gz: 'gzip', bz2: 'bzip2', xz: 'xz', cab: 'cab', iso: 'iso', arj: 'arj' })[path.extname(name).slice(1).toLowerCase()];
export function safeArchivePath(name) {
  const clean = name.replace(/\/+$/, '');
  if (!clean || clean.startsWith('/') || /[\\:\u0000-\u001f\u007f]/.test(clean) || clean.split('/').some(s => !s || s === '.' || s === '..')) throw fail('Archive contains an unsafe path');
  return clean;
}
async function command(args, { cwd, output, maxBytes = MAX_BYTES } = {}) {
  const proc = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: { ...process.env, LANG: 'C.UTF-8' } });
  let diagnostic = '', text = '', total = 0;
  proc.stderr.on('data', chunk => { if (diagnostic.length < 4096) diagnostic += chunk; });
  const timer = setTimeout(() => proc.kill('SIGKILL'), 30 * 60 * 1000);
  const finished = new Promise((resolve, reject) => {
    proc.on('error', () => reject(fail('Archive utility is unavailable. Install the current container image.', 503)));
    proc.on('close', code => code === 0 ? resolve() : reject(fail('Archive operation failed: damaged, encrypted or unsupported archive.', 422)));
  });
  // Attach immediately; a stream error can precede process completion.
  finished.catch(() => {});
  try {
    if (output) {
      const limit = new Transform({ transform(chunk, _encoding, cb) { total += chunk.length; cb(total > maxBytes ? fail('Archive exceeds the extraction size limit', 413) : null, chunk); } });
      await pipeline(proc.stdout, limit, createWriteStream(output, { flags: 'wx', mode: 0o600 }));
    } else {
      for await (const chunk of proc.stdout) { text += chunk; if (text.length > 32 * 1024 ** 2) throw fail('Archive listing is too large', 413); }
    }
    await finished; return { text, bytes: total };
  } catch (error) { proc.kill('SIGKILL'); throw error; }
  finally { clearTimeout(timer); }
}
export async function inspectArchive(file) {
  if (['bzip2', 'xz'].includes(formatOf(file))) {
    const stage = await mkdtemp(path.join(tmpdir(), 'cdc-stream-'));
    try {
      const result = await command(['x', '-so', '-bd', '--', file], { output: path.join(stage, 'data') });
      return [{ name: safeArchivePath(path.basename(file).replace(/\.(bz2|xz)$/i, '')), directory: false, size: result.bytes, supported: true }];
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  const { text } = await command(['l', '-slt', '-ba', '-sccUTF-8', '--', file]);
  const entries = [], seen = new Set(); let bytes = 0;
  for (const block of text.trim().split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const match = /^([^=]+) = ?(.*)$/.exec(line);
      if (!match || Object.hasOwn(fields, match[1].trim())) throw fail('Ambiguous archive metadata', 422);
      fields[match[1].trim()] = match[2];
    }
    const name = safeArchivePath(fields.Path ?? '');
    if (seen.has(name)) throw fail('Archive contains duplicate paths', 422); seen.add(name);
    const directory = fields.Folder === '+' || /^D/.test(fields.Attributes ?? '');
    const size = Number(fields.Size ?? 0);
    if (!Number.isSafeInteger(size) || size < 0) throw fail('Invalid archive size', 422);
    const attributes = fields.Attributes ?? '';
    const supported = (!fields['Symbolic Link'] || fields['Symbolic Link'] === '-') && (!fields['Hard Link'] || fields['Hard Link'] === '-') && !/(?:^|\s)[lbcps][rwx-]{9}/.test(attributes) && fields.Encrypted !== '+';
    bytes += size;
    if (entries.length >= MAX_ENTRIES || bytes > MAX_BYTES) throw fail('Archive exceeds the entry or size limit', 413);
    entries.push({ name, directory, size, supported });
  }
  // CRC/data verification, not just a directory listing. No interactive password prompt.
  await command(['t', '-bd', '--', file]);
  return entries;
}
export async function packArchive(connection, dir, { names, archive }, destination) {
  requireWritable(destination.connection); validName(archive);
  const kind = formatOf(archive);
  if (['rar', 'cab', 'iso', 'arj'].includes(kind)) throw fail(`${kind.toUpperCase()} creation is not supported; choose ZIP or 7z.`);
  if (!kind) throw fail('Choose .7z, .zip, .gz, .bz2 or .xz');
  if (!Array.isArray(names) || !names.length || names.length > MAX_ENTRIES) throw fail('Select items to pack');
  if (['gzip', 'bzip2', 'xz'].includes(kind) && (names.length !== 1 || !(await child(connection, dir, names[0])).info.isFile())) throw fail('Single-stream compression needs exactly one file. Use .tar.gz or .zip for folders.');
  const stage = await mkdtemp(path.join(tmpdir(), 'cdc-pack-'));
  let bytes = 0, count = 0;
  async function snapshot(source, target) {
    const info = await lstat(source); if (info.isSymbolicLink()) return;
    if (++count > MAX_ENTRIES || (bytes += info.isFile() ? info.size : 0) > MAX_BYTES) throw fail('Selection exceeds archive limits', 413);
    if (info.isDirectory()) { await mkdir(target); for (const name of await readdir(source)) await snapshot(path.join(source, name), path.join(target, name)); }
    else if (info.isFile()) await copyFile(source, target);
  }
  let temporary;
  try {
    for (const name of names) { validName(name); await snapshot((await child(connection, dir, name)).target, path.join(stage, name)); }
    const out = await confined(destination.connection.root, destination.path);
    if (await exists(path.join(out, archive))) throw fail(`${archive} already exists`, 409);
    temporary = path.join(out, `.cdc-${randomBytes(8).toString('hex')}.archive`);
    await command(['a', `-t${kind}`, '-bd', '-y', temporary, '--', ...names.map(n => `./${n}`)], { cwd: stage });
    if (await confined(destination.connection.root, destination.path) !== out) throw fail('Destination changed', 409);
    await link(temporary, path.join(out, archive)); return { name: archive };
  } finally { if (temporary) await rm(temporary, { force: true }); await rm(stage, { recursive: true, force: true }); }
}
export async function unpackArchive(connection, dir, { name, only }, destination) {
  requireWritable(destination.connection);
  const { target, info } = await child(connection, dir, name); if (!info.isFile()) throw fail('Select an archive');
  const entries = await inspectArchive(target);
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  const chosen = entries.filter(e => e.supported && (!wanted || wanted.has(e.name)));
  if (!chosen.length) throw fail('Nothing to unpack');
  const out = await confined(destination.connection.root, destination.path);
  for (const item of chosen.filter(e => !e.directory)) if (await exists(path.join(out, item.name))) throw fail(`${item.name} already exists`, 409);
  const stage = await mkdtemp(path.join(tmpdir(), 'cdc-unpack-'));
  let count = 0;
  try {
    for (const item of chosen) {
      const segments = item.name.split('/'); const leaf = segments.pop(); if (!leaf) throw fail('Invalid archive entry');
      let current = out;
      for (const segment of item.directory ? [...segments, leaf] : segments) {
        const next = path.join(current, segment); await mkdir(next).catch(error => { if (error.code !== 'EEXIST') throw error; });
        current = await confined(destination.connection.root, path.posix.join(destination.path, path.relative(out, next).split(path.sep).join('/')));
      }
      if (item.directory) continue;
      const tmp = path.join(stage, String(count));
      const result = await command(['x', '-so', '-bd', '-spd', '--', target, ...(['bzip2', 'xz'].includes(formatOf(name)) ? [] : [item.name])], { output: tmp, maxBytes: item.size });
      if (result.bytes !== item.size) throw fail('Archive entry size changed', 422);
      const relative = path.relative(out, current).split(path.sep).join('/');
      if (await confined(destination.connection.root, path.posix.join(destination.path, relative)) !== current) throw fail('Destination changed', 409);
      // Cross-device safe: stage the publication on the target filesystem.
      const publishTemp = path.join(current, `.cdc-${randomBytes(8).toString('hex')}.archive`);
      try { await pipeline(createReadStream(tmp), createWriteStream(publishTemp, { flags: 'wx', mode: 0o644 })); await link(publishTemp, path.join(current, leaf)); }
      finally { await rm(publishTemp, { force: true }); }
      count++;
    }
    return { files: count };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
