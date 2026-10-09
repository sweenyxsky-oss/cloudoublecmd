import { extension, joinPath, type FileEntry, type FileSystem } from './mock-filesystem';

// Pure helpers behind the Total Commander-style menu tools (sample files only).

export function globToRegExp(pattern: string) {
  const parts = pattern.split(/[;|]/).map(part => part.trim()).filter(Boolean);
  if (!parts.length) return /^$/;
  const body = parts.map(part => part.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')).join('|');
  return new RegExp(`^(?:${body})$`, 'i');
}
export const matchesGroup = (entry: FileEntry, pattern: string) => entry.name !== '..' && globToRegExp(pattern).test(entry.name);

export const programExtensions = ['sh', 'py', 'pl', 'rb', 'bin', 'run', 'exe', 'bat', 'cmd', 'appimage'];

export function occupiedSpace(fs: FileSystem, path: string, names: string[]) {
  let files = 0; let dirs = 0; let bytes = 0;
  const walk = (folder: string, entries: FileEntry[]) => {
    for (const entry of entries) {
      if (entry.directory) { dirs++; walk(joinPath(folder, entry.name), fs[joinPath(folder, entry.name)] ?? []); }
      else { files++; bytes += entry.size; }
    }
  };
  walk(path, (fs[path] ?? []).filter(entry => names.includes(entry.name)));
  return { files, dirs, bytes };
}

/** Recursive listing for Branch View; names are relative paths and therefore view-only. */
export function branchEntries(fs: FileSystem, path: string): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (folder: string, prefix: string) => {
    for (const entry of fs[folder] ?? []) {
      if (entry.directory) walk(joinPath(folder, entry.name), `${prefix}${entry.name}/`);
      else out.push({ ...entry, name: prefix + entry.name });
    }
  };
  walk(path, '');
  return out;
}

export function directoryTree(fs: FileSystem, root = '/') {
  const out: { path: string; depth: number; name: string }[] = [];
  const walk = (folder: string, depth: number) => {
    for (const entry of (fs[folder] ?? []).filter(item => item.directory).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = joinPath(folder, entry.name);
      out.push({ path: child, depth, name: entry.name });
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function compareDirectories(left: FileEntry[], right: FileEntry[], newerOnly = false) {
  const files = (entries: FileEntry[]) => entries.filter(entry => !entry.directory);
  const same = new Set<string>();
  const mark = (a: FileEntry[], b: FileEntry[]) => files(a).filter(entry => {
    const other = files(b).find(item => item.name === entry.name);
    if (!other) return true;
    if (entry.size === other.size && entry.date === other.date) { same.add(entry.name); return false; }
    return newerOnly ? entry.date > other.date : true;
  }).map(entry => entry.name);
  return { left: mark(left, right), right: mark(right, left), same: [...same] };
}

export type DiffLine = { kind: 'same' | 'left' | 'right'; text: string };
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n'); const y = b.split('\n');
  const table = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: DiffLine[] = []; let i = 0; let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ kind: 'same', text: x[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: 'left', text: x[i++]! });
    else out.push({ kind: 'right', text: y[j++]! });
  }
  while (i < x.length) out.push({ kind: 'left', text: x[i++]! });
  while (j < y.length) out.push({ kind: 'right', text: y[j++]! });
  return out;
}

export type ClipboardMode = 'names' | 'paths' | 'details' | 'path-details';
export function clipboardText(entries: FileEntry[], path: string, mode: ClipboardMode) {
  return entries.map(entry => {
    const name = mode === 'paths' || mode === 'path-details' ? joinPath(path, entry.name) + (entry.directory ? '/' : '') : entry.name;
    return mode === 'details' || mode === 'path-details' ? [name, entry.directory ? '<DIR>' : String(entry.size), entry.date, entry.attr].join('\t') : name;
  }).join('\n');
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

export function crc32(text: string) {
  let crc = -1;
  for (const byte of bytesOf(text)) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return hex(crc ^ -1);
}

function pad(data: Uint8Array, littleEndian: boolean) {
  const length = ((data.length + 8) >> 6) * 64 + 64;
  const out = new Uint8Array(length); out.set(data); out[data.length] = 0x80;
  const view = new DataView(out.buffer); const bits = data.length * 8;
  if (littleEndian) { view.setUint32(length - 8, bits >>> 0, true); view.setUint32(length - 4, Math.floor(bits / 2 ** 32), true); }
  else { view.setUint32(length - 8, Math.floor(bits / 2 ** 32)); view.setUint32(length - 4, bits >>> 0); }
  return view;
}

export function sha1(text: string) {
  const view = pad(bytesOf(text), false);
  let h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 80; t++) { const v = w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!; w[t] = (v << 1) | (v >>> 31); }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]!) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h = [h[0]! + a | 0, h[1]! + b | 0, h[2]! + c | 0, h[3]! + d | 0, h[4]! + e | 0];
  }
  return h.map(hex).join('');
}

const md5Shift = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const md5K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
export function md5(text: string) {
  const view = pad(bytesOf(text), true);
  let h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    const m = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let [a, b, c, d] = h as [number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const s = md5Shift[round * 4 + (i % 4)]!;
      const sum = (a + f + md5K[i]! + m[g]!) | 0;
      a = d; d = c; c = b; b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
    }
    h = [h[0]! + a | 0, h[1]! + b | 0, h[2]! + c | 0, h[3]! + d | 0];
  }
  return h.map(v => { const le = hex(v); return le.match(/../g)!.reverse().join(''); }).join('');
}

export type ChecksumAlgorithm = 'crc32' | 'md5' | 'sha1';
export const checksumExtension: Record<ChecksumAlgorithm, string> = { crc32: 'sfv', md5: 'md5', sha1: 'sha1' };
const hashers: Record<ChecksumAlgorithm, (text: string) => string> = { crc32, md5, sha1 };
export const fileText = (entry: FileEntry) => entry.content ?? '';

export function checksumFile(entries: FileEntry[], algorithm: ChecksumAlgorithm) {
  return entries.filter(entry => !entry.directory).map(entry => algorithm === 'crc32' ? `${entry.name} ${hashers.crc32(fileText(entry))}` : `${hashers[algorithm](fileText(entry))} *${entry.name}`).join('\n') + '\n';
}

export function verifyChecksums(checksumEntry: FileEntry, folder: FileEntry[]) {
  const ext = extension(checksumEntry);
  const algorithm = (Object.keys(checksumExtension) as ChecksumAlgorithm[]).find(key => checksumExtension[key] === ext);
  if (!algorithm) throw new Error('Select a .sfv, .md5 or .sha1 checksum file.');
  return fileText(checksumEntry).split('\n').map(line => line.trim()).filter(line => line && !line.startsWith(';')).map(line => {
    const [hash, name] = algorithm === 'crc32' ? [line.slice(line.lastIndexOf(' ') + 1), line.slice(0, line.lastIndexOf(' '))] : [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1).replace(/^\*/, '')];
    const entry = folder.find(item => item.name === name && !item.directory);
    return { name, status: !entry ? 'missing' as const : hashers[algorithm](fileText(entry)).toLowerCase() === hash.toLowerCase() ? 'ok' as const : 'failed' as const };
  });
}

export function splitFile(entry: FileEntry, partSize: number, date: string): FileEntry[] {
  if (entry.directory) throw new Error('Select a file to split.');
  if (!Number.isInteger(partSize) || partSize < 1) throw new Error('Enter a part size of at least 1 byte.');
  const bytes = bytesOf(fileText(entry));
  const count = Math.max(1, Math.ceil(bytes.length / partSize));
  if (count > 999) throw new Error('This would create more than 999 parts.');
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return Array.from({ length: count }, (_, index) => {
    const slice = bytes.slice(index * partSize, (index + 1) * partSize);
    return { name: `${entry.name}.${String(index + 1).padStart(3, '0')}`, directory: false, size: slice.length, date, attr: entry.attr, content: decoder.decode(slice, { stream: index < count - 1 }) };
  });
}

export function combineFiles(parts: FileEntry[], date: string): FileEntry {
  const sorted = [...parts].filter(entry => !entry.directory).sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length < 1) throw new Error('Select the parts to combine.');
  const base = sorted[0]!.name.replace(/\.\d{3}$/, '');
  if (base === sorted[0]!.name) throw new Error('Parts must end in .001, .002, …');
  const content = sorted.map(fileText).join('');
  return { name: base, directory: false, size: bytesOf(content).length, date, attr: sorted[0]!.attr, content };
}

/** Converts rwx text to an attribute string; rejects anything else. */
export function attributeString(directory: boolean, permissions: string) {
  if (!/^[r-][w-][x-][r-][w-][x-][r-][w-][x-]$/.test(permissions)) throw new Error('Permissions must look like rw-r--r--.');
  return `${directory ? 'd' : '-'}${permissions}`;
}
