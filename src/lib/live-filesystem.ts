import type { FileEntry } from './mock-filesystem';

// Live NAS paths are read-only and never pass through the mock operation boundary.
export const LIVE_PREFIX = 'nas://';
export type LiveConnection = { id: string; label: string; protocol: string; capabilities?: string[] };
export type LiveJob = { id: number; type: 'copy' | 'move'; source: { connection: string; path: string }; destination: { connection: string; path: string }; names: string[]; total: number; processed: number; state: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'; error: string | null; current: string | null; rate?: number; conflict?: import('./mock-filesystem').TransferConflict | null };
export type LiveListing = { entries: FileEntry[]; space: { available: number; total: number; used?: number } | null };

export const nasMode = () => import.meta.env['VITE_NAS_MODE'] === '1';
export const isLive = (path: string) => path.startsWith(LIVE_PREFIX);

export function splitLive(path: string): { id: string; relative: string } {
  const rest = path.slice(LIVE_PREFIX.length);
  const slash = rest.indexOf('/');
  const id = slash === -1 ? rest : rest.slice(0, slash);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid connection');
  return { id, relative: slash === -1 ? '/' : rest.slice(slash) || '/' };
}

export function liveParent(path: string) {
  const { id, relative } = splitLive(path);
  if (relative === '/') return `${LIVE_PREFIX}${id}`;
  const parent = relative.slice(0, relative.lastIndexOf('/'));
  return `${LIVE_PREFIX}${id}${parent}`;
}

export function normalizeLive(path: string) {
  const { id, relative } = splitLive(path);
  const segments: string[] = [];
  for (const segment of relative.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return `${LIVE_PREFIX}${id}${segments.length ? '/' + segments.join('/') : ''}`;
}

class SignedOut extends Error {}
export const isSignedOut = (error: unknown) => error instanceof SignedOut;

async function getJson(url: string) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (response.status === 401) throw new SignedOut('Signed out');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Directory unavailable');
  return body;
}

export async function fetchConnections(): Promise<LiveConnection[]> {
  const body = await getJson('/api/connections');
  return Array.isArray(body.connections) ? body.connections.filter((item: LiveConnection) => typeof item?.id === 'string' && typeof item.label === 'string') : [];
}

function formatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function mapEntries(raw: unknown): FileEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(item => item && typeof item.name === 'string' && item.name && !/[\/\\\u0000]/.test(item.name) && item.name !== '.' && item.name !== '..').map(item => ({
    name: item.name,
    directory: item.directory === true,
    size: Number.isFinite(item.size) ? item.size : 0,
    date: formatDate(item.date),
    attr: typeof item.attr === 'string' && /^[0-7]{3}$/.test(item.attr) ? `${item.directory ? 'd' : '-'}${item.attr.split('').map((d: string) => { const n = Number(d); return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`; }).join('')}` : '',
  }));
}

export async function fetchListing(path: string): Promise<LiveListing> {
  const { id, relative } = splitLive(path);
  const body = await getJson(`/api/entries?connection=${encodeURIComponent(id)}&path=${encodeURIComponent(relative)}`);
  const space = body.space && Number.isFinite(body.space.available) && Number.isFinite(body.space.total) ? body.space : null;
  return { entries: mapEntries(body.entries), space };
}

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  window.location.assign('/login');
}

export const canWrite = (connection: LiveConnection | undefined) => connection?.capabilities?.includes('write') === true;
export const canTransfer = (connection: LiveConnection | undefined) => connection?.capabilities?.includes('transfer') === true;
export const canUseTools = (connection: LiveConnection | undefined) => connection?.capabilities?.includes('tools') === true;
export const canRead = (connection: LiveConnection | undefined) => connection?.capabilities?.includes('read') === true;
export const liveLocation = (path: string) => { const { id, relative } = splitLive(path); return { connection: id, path: relative }; };

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 401) throw new SignedOut('Signed out');
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Operation failed');
  return result;
}

export async function readLiveFile(dir: string, name: string): Promise<{ content: string; binary: boolean; truncated: boolean; size: number }> {
  const { connection, path } = liveLocation(dir);
  return getJson(`/api/file?connection=${encodeURIComponent(connection)}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`);
}
export const writeLiveFile = (dir: string, name: string, content: string) => postJson('/api/write', { ...liveLocation(dir), name, content });
export const makeLiveDirectory = (dir: string, name: string) => postJson('/api/mkdir', { ...liveLocation(dir), name });
export const deleteLive = (dir: string, names: string[]) => postJson('/api/delete', { ...liveLocation(dir), names });
export const renameLive = (dir: string, mapping: { from: string; to: string }[]) => postJson('/api/rename', { ...liveLocation(dir), mapping });
export const setLiveAttributes = (dir: string, names: string[], mode: string, date?: string) => postJson('/api/attributes', { ...liveLocation(dir), names, mode, ...(date ? { date } : {}) });
export async function startLiveJob(type: 'copy' | 'move', source: string, destination: string, names: string[]): Promise<LiveJob> {
  return (await postJson('/api/jobs', { type, source: liveLocation(source), destination: liveLocation(destination), names, interactive: true })).job;
}
export async function listLiveJobs(): Promise<LiveJob[]> { const body = await getJson('/api/jobs'); return Array.isArray(body.jobs) ? body.jobs : []; }
export async function controlLiveJob(id: number, action: 'pause' | 'resume' | 'cancel' | 'resolve', choice?: string): Promise<LiveJob> { return (await postJson(`/api/jobs/${id}/${action}`, { choice })).job; }

// Content tools on mounted NAS connections (checksums, split/combine, compare, size, tar archives).
export type LiveToolName = 'checksum' | 'verify' | 'occupied' | 'compare' | 'split' | 'combine' | 'pack' | 'list-archive' | 'unpack';
export async function runLiveTool<T = Record<string, unknown>>(tool: LiveToolName, dir: string, args: Record<string, unknown>, destination?: string): Promise<T> {
  return postJson(`/api/tools/${tool}`, { ...liveLocation(dir), ...args, ...(destination ? { destination: liveLocation(destination) } : {}) }) as Promise<T>;
}
