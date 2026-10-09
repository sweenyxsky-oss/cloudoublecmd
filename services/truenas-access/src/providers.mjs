import { readdir, realpath, lstat, statfs } from 'node:fs/promises';
import path from 'node:path';

export function virtualPath(value = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) || value.split('/').includes('..')) throw new Error('Invalid path');
  return path.posix.normalize(value).replace(/\/+$/, '') || '/';
}

export async function confined(root, requested) {
  const relative = virtualPath(requested).slice(1);
  const canonical = await realpath(root);
  let candidate = canonical;
  // Reject every symlink, even one resolving back into the allowlisted root.
  for (const segment of relative.split('/').filter(Boolean)) {
    candidate = path.join(candidate, segment);
    if ((await lstat(candidate)).isSymbolicLink()) throw new Error('Symlink access denied');
  }
  const resolved = await realpath(candidate);
  if (resolved !== canonical && !resolved.startsWith(canonical + path.sep)) throw new Error('Path outside root');
  if (!(await lstat(resolved)).isDirectory()) throw new Error('Not a directory');
  return resolved;
}

export async function listMounted(connection, requested) {
  const directory = await confined(connection.root, requested);
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
    const info = await lstat(path.join(directory, entry.name));
    if (info.isSymbolicLink()) continue;
    result.push({ name: entry.name, directory: info.isDirectory(), size: info.size, date: info.mtime.toISOString(), attr: (info.mode & 0o777).toString(8) });
  }
  const space = await statfs(directory);
  return { entries: result, space: { available: space.bavail * space.bsize, total: space.blocks * space.bsize } };
}

export async function listFtp(connection, requested, factory) {
  const relative = virtualPath(requested);
  const root = virtualPath(connection.root);
  const client = factory();
  try {
    await client.access({ host: connection.host, port: connection.port ?? 21, user: connection.user, password: connection.password, secure: true });
    await client.cd(root);
    for (const segment of relative.split('/').filter(Boolean)) {
      const entries = await client.list();
      const entry = entries.find(item => item.name === segment);
      if (!entry || !entry.isDirectory || entry.isSymbolicLink) throw new Error('Directory access denied');
      await client.cd(segment);
    }
    const expected = path.posix.join(root, relative.slice(1));
    if (virtualPath(await client.pwd()) !== expected) throw new Error('FTP path outside root');
    const entries = (await client.list()).filter(entry => !entry.isSymbolicLink && (entry.isFile || entry.isDirectory) && entry.name !== '.' && entry.name !== '..' && !/[\/\\\u0000-\u001f]/.test(entry.name)).map(entry => ({ name: entry.name, directory: entry.isDirectory, size: entry.size, date: entry.modifiedAt?.toISOString() ?? '', attr: '' }));
    return { entries, space: null };
  } finally { client.close(); }
}

export function validateConnections(connections) {
  if (!Array.isArray(connections) || !connections.length) throw new Error('Configure at least one connection');
  const ids = new Set();
  for (const connection of connections) {
    if (!connection || !/^[a-zA-Z0-9_-]+$/.test(connection.id) || ids.has(connection.id)) throw new Error('Invalid connection ID');
    ids.add(connection.id);
    if (!['local', 'smb', 'nfs', 'ftp'].includes(connection.protocol) || typeof connection.label !== 'string' || !connection.label.trim()) throw new Error('Invalid connection');
    virtualPath(connection.root);
    if (connection.writable !== undefined && typeof connection.writable !== 'boolean') throw new Error('Invalid writable flag');
    if (connection.protocol === 'ftp') {
      if (typeof connection.host !== 'string' || !connection.host || /[\s/\\]/.test(connection.host) || typeof connection.user !== 'string' || typeof connection.password !== 'string') throw new Error('Invalid FTP configuration');
      if (connection.port !== undefined && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535)) throw new Error('Invalid FTP port');
    }
  }
  return connections;
}