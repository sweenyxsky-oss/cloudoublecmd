import { joinPath, transferEntries, type ConflictChoice, type FileEntry, type FileSystem } from './mock-filesystem';

// Snapshot operations are the prototype boundary, not a remote filesystem API.
export type FilesystemOperation =
  | { type: 'copy'; source: string; destination: string; names: string[]; decisions?: Record<string, ConflictChoice> }
  | { type: 'move'; source: string; destination: string; names: string[]; decisions?: Record<string, ConflictChoice> }
  | { type: 'mkdir'; path: string; name: string }
  | { type: 'delete'; path: string; names: string[] }
  | { type: 'write'; path: string; name: string; content: string }
  | { type: 'rename'; path: string; names: string[]; pattern: string }
  | { type: 'synchronize'; source: string; destination: string }
  | { type: 'create'; path: string; files: FileEntry[] }
  | { type: 'attributes'; path: string; names: string[]; attr?: string; date?: string };

function directory(fs: FileSystem, path: string): FileEntry[] {
  const entries = fs[path];
  if (!entries) throw new Error(`Directory does not exist: ${path}`);
  return entries;
}

function validateName(name: string) {
  if (!name.trim() || name === '.' || name === '..' || /[\/\\\u0000]/.test(name)) {
    throw new Error('Enter a valid name without slashes.');
  }
}

function selected(entries: FileEntry[], names: string[]) {
  if (!names.length) throw new Error('Select a file or folder first.');
  if (new Set(names).size !== names.length) throw new Error('Duplicate selection.');
  for (const name of names) {
    validateName(name);
    if (!entries.some(entry => entry.name === name)) throw new Error(`Item no longer exists: ${name}`);
  }
}

export function executeFilesystemOperation(fs: FileSystem, operation: FilesystemOperation): FileSystem {
  if (operation.type === 'copy' || operation.type === 'move') {
    selected(directory(fs, operation.source), operation.names);
    directory(fs, operation.destination);
    return transferEntries(fs, operation.source, operation.destination, operation.names, operation.type === 'move', operation.decisions);
  }
  if (operation.type === 'synchronize') {
    const source = directory(fs, operation.source);
    const destination = directory(fs, operation.destination);
    const names = source.filter(entry => !destination.some(item => item.name === entry.name)).map(entry => entry.name);
    return transferEntries(fs, operation.source, operation.destination, names, false);
  }
  const entries = directory(fs, operation.path);
  if (operation.type === 'create') {
    if (!operation.files.length) throw new Error('Nothing to create.');
    const names = operation.files.map(file => file.name);
    names.forEach(validateName);
    if (operation.files.some(file => file.directory)) throw new Error('Only files can be created this way.');
    if (new Set(names).size !== names.length || entries.some(entry => names.includes(entry.name))) throw new Error('An item with this name already exists.');
    return { ...fs, [operation.path]: [...entries, ...operation.files.map(file => ({ ...file }))] };
  }
  if (operation.type === 'attributes') {
    selected(entries, operation.names);
    if (operation.attr !== undefined && !/^[d-][r-][w-][x-][r-][w-][x-][r-][w-][x-]$/.test(operation.attr.replace(/^./, 'd'))) throw new Error('Invalid permissions.');
    if (operation.date !== undefined && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(operation.date)) throw new Error('Date must look like 2026-10-09 14:30.');
    return { ...fs, [operation.path]: entries.map(entry => operation.names.includes(entry.name) ? { ...entry, ...(operation.attr ? { attr: (entry.directory ? 'd' : '-') + operation.attr.slice(1) } : {}), ...(operation.date ? { date: operation.date } : {}) } : entry) };
  }
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (operation.type === 'mkdir') {
    validateName(operation.name);
    if (entries.some(entry => entry.name === operation.name)) throw new Error('An item with this name already exists.');
    return { ...fs, [operation.path]: [...entries, { name: operation.name, directory: true, size: 0, date, attr: 'drwxr-xr-x' }], [joinPath(operation.path, operation.name)]: [] };
  }
  if (operation.type === 'write') {
    selected(entries, [operation.name]);
    if (entries.find(entry => entry.name === operation.name)?.directory) throw new Error('Cannot edit a directory.');
    return { ...fs, [operation.path]: entries.map(entry => entry.name === operation.name ? { ...entry, content: operation.content, size: new TextEncoder().encode(operation.content).length, date } : entry) };
  }
  selected(entries, operation.names);
  if (operation.type === 'delete') {
    const next = { ...fs, [operation.path]: entries.filter(entry => !operation.names.includes(entry.name)) };
    for (const name of operation.names) {
      const prefix = joinPath(operation.path, name);
      for (const key of Object.keys(fs)) if (key === prefix || key.startsWith(`${prefix}/`)) delete next[key];
    }
    return next;
  }
  const mapping = operation.names.map((name, index) => ({ old: name, next: operation.pattern.replaceAll('{name}', name).replaceAll('{n}', String(index + 1)) }));
  for (const item of mapping) validateName(item.next);
  if (new Set(mapping.map(item => item.next)).size !== mapping.length || mapping.some(item => entries.some(entry => !operation.names.includes(entry.name) && entry.name === item.next))) {
    throw new Error('The pattern produces duplicate filenames.');
  }
  const next = { ...fs, [operation.path]: entries.map(entry => ({ ...entry, name: mapping.find(item => item.old === entry.name)?.next ?? entry.name })) };
  // Remove all old subtrees before installing renamed trees, so swaps are atomic.
  const subtrees = mapping.map(item => ({ item, keys: Object.keys(fs).filter(key => key === joinPath(operation.path, item.old) || key.startsWith(`${joinPath(operation.path, item.old)}/`)) }));
  for (const { keys } of subtrees) for (const key of keys) delete next[key];
  for (const { item, keys } of subtrees) for (const key of keys) {
    next[joinPath(operation.path, item.next) + key.slice(joinPath(operation.path, item.old).length)] = (fs[key] ?? []).map(entry => ({ ...entry }));
  }
  return next;
}