export type FileEntry = { name: string; directory: boolean; size: number; date: string; attr: string; content?: string };
export type FileSystem = Record<string, FileEntry[]>;
export const datasets = ['/mnt/tank/media', '/mnt/tank/data', '/mnt/tank/backups', '/mnt/fast', '/etc'];
export const parentPath = (path: string) => path.substring(0, path.lastIndexOf('/')) || '/';
export const joinPath = (path: string, name: string) => `${path === '/' ? '' : path}/${name}`;
const folder = (name: string, date = '2026-10-07 14:32'): FileEntry => ({ name, directory: true, size: 0, date, attr: 'drwxr-xr-x' });
const file = (name: string, size: number, date = '2026-10-07 09:15', content?: string): FileEntry => ({ name, directory: false, size, date, attr: '-rw-r--r--', content: content ?? `# ${name}\n\nTrueNAS dataset file\nLast updated: ${date}\n` });
export function createFilesystem(): FileSystem {
  return {
    '/': [folder('mnt'), folder('etc')],
    '/mnt': [folder('tank'), folder('fast')],
    '/mnt/fast': [folder('apps'), folder('scratch'), file('pool-info.txt', 1024)],
    '/mnt/fast/apps': [file('compose.yml', 2048)],
    '/mnt/fast/scratch': [],
    '/mnt/tank': [folder('media'), folder('data'), folder('backups')],
    '/mnt/tank/media': [folder('Movies'), folder('Music'), folder('Photos'), folder('TV Shows'), folder('Downloads'), file('library.db', 25165824), file('media-index.json', 18432), file('README.md', 2048, '2026-10-06 16:48', '# Media library\n\nMovies, music, photos and TV shows.\n\nStorage pool: tank\nCompression: lz4\n'), file('sync.log', 148480, '2026-10-08 08:30'), file('.DS_Store', 6148, '2026-10-05 11:02')],
    '/mnt/tank/media/Movies': [folder('Action'), folder('Documentaries'), file('Dune.Part.Two.2024.mkv', 8589934592), file('Interstellar.2014.mkv', 6442450944), file('The.Grand.Budapest.Hotel.mkv', 3221225472)],
    '/mnt/tank/media/Movies/Action': [file('Blade.Runner.2049.mkv', 7516192768)],
    '/mnt/tank/media/Movies/Documentaries': [file('Planet.Earth.III.mkv', 4294967296)],
    '/mnt/tank/media/Music': [folder('Albums'), folder('Playlists'), file('library.m3u', 4096)],
    '/mnt/tank/media/Music/Albums': [file('Kind.of.Blue.flac', 314572800)],
    '/mnt/tank/media/Music/Playlists': [file('favorites.m3u', 1024)],
    '/mnt/tank/media/Photos': [folder('2025'), folder('2026'), file('family.jpg', 5242880)],
    '/mnt/tank/media/Photos/2025': [file('holiday.jpg', 4194304)],
    '/mnt/tank/media/Photos/2026': [file('summer.jpg', 6291456)],
    '/mnt/tank/media/TV Shows': [folder('Severance'), file('watchlist.txt', 856)],
    '/mnt/tank/media/TV Shows/Severance': [file('S01E01.mkv', 2147483648)],
    '/mnt/tank/media/Downloads': [file('ubuntu-24.04.iso', 5368709120)],
    '/mnt/tank/data': [folder('Documents'), folder('Projects'), folder('Archives'), folder('Backups'), folder('Shared'), file('budget-2026.xlsx', 28672, '2026-10-07 15:20'), file('docker-compose.yml', 3456, '2026-10-06 10:12', 'services:\n  jellyfin:\n    image: jellyfin/jellyfin:latest\n    volumes:\n      - /mnt/tank/media:/media\n'), file('inventory.csv', 12288), file('notes.txt', 1536, '2026-10-08 08:45', 'Storage maintenance\n\n- Verify snapshots\n- Check pool health\n- Review media library\n'), file('pool-config.json', 4096), file('snapshot-report.log', 65536), file('.gitignore', 128)],
    '/mnt/tank/data/Documents': [file('network-plan.md', 3072), file('server-inventory.csv', 8192)],
    '/mnt/tank/data/Projects': [folder('homelab'), file('roadmap.md', 2048)],
    '/mnt/tank/data/Projects/homelab': [file('compose.yml', 4096)],
    '/mnt/tank/data/Archives': [file('documents-2025.tar.gz', 268435456)],
    '/mnt/tank/data/Backups': [file('config-backup.tar', 8388608)],
    '/mnt/tank/data/Shared': [file('welcome.txt', 256)],
    '/mnt/tank/backups': [folder('daily'), folder('weekly'), file('backup-manifest.json', 4096)],
    '/mnt/tank/backups/daily': [file('tank-2026-10-08.zfs', 1073741824)],
    '/mnt/tank/backups/weekly': [file('tank-2026-10-04.zfs', 4294967296)],
    '/etc': [folder('ssh'), folder('nginx'), file('fstab', 1024), file('hosts', 256, '2026-10-01 12:00', '127.0.0.1 localhost\n192.168.1.10 truenas.local\n'), file('resolv.conf', 128)],
    '/etc/ssh': [file('sshd_config', 3072)],
    '/etc/nginx': [file('nginx.conf', 2048)],
  };
}
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${units[index]}`;
}
export function extension(entry: FileEntry) { return entry.directory || !entry.name.includes('.') || entry.name.startsWith('.') ? '' : entry.name.split('.').pop() ?? ''; }
export type ConflictChoice = 'overwrite' | 'skip';
export type TransferConflict = { name: string; source: FileEntry; destination: FileEntry };
export function transferConflicts(fs: FileSystem, source: string, destination: string, names: string[]): TransferConflict[] {
  const conflicts: TransferConflict[] = [];
  function scan(from: string, to: string, selected: string[], prefix = '') {
    for (const entry of fs[from] ?? []) {
      if (!selected.includes(entry.name)) continue;
      const existing = fs[to]?.find(item => item.name === entry.name);
      const name = prefix + entry.name;
      if (entry.directory && existing?.directory) scan(joinPath(from, entry.name), joinPath(to, entry.name), (fs[joinPath(from, entry.name)] ?? []).map(item => item.name), name + '/');
      else if (existing) conflicts.push({ name, source: entry, destination: existing });
    }
  }
  scan(source, destination, names); return conflicts;
}
export function transferEntries(fs: FileSystem, source: string, destination: string, names: string[], move: boolean, decisions: Record<string, ConflictChoice> = {}): FileSystem {
  if (source === destination) throw new Error('Source and destination are the same directory.');
  let result: FileSystem = { ...fs };
  function transfer(from: string, to: string, selected: string[], prefix = '') {
    for (const entry of [...(result[from] ?? [])]) {
      if (!selected.includes(entry.name)) continue;
      const src = joinPath(from, entry.name), dst = joinPath(to, entry.name), key = prefix + entry.name;
      if (entry.directory && (to === src || to.startsWith(src + '/'))) throw new Error('A folder cannot be transferred into itself.');
      const existing = result[to]?.find(item => item.name === entry.name);
      if (existing && !(entry.directory && existing.directory)) {
        if (decisions[key] === 'skip') continue;
        if (decisions[key] !== 'overwrite') throw new Error(`“${key}” already exists at the destination.`);
        if (entry.directory || existing.directory) throw new Error('A file cannot replace a folder. Skip this item.');
      }
      result[to] = [...(result[to] ?? []).filter(item => item.name !== entry.name), { ...entry }];
      if (entry.directory) {
        result[dst] = result[dst] ?? [];
        transfer(src, dst, (result[src] ?? []).map(item => item.name), key + '/');
        if (move && !(result[src]?.length)) { delete result[src]; result[from] = (result[from] ?? []).filter(item => item.name !== entry.name); }
      } else if (move) result[from] = (result[from] ?? []).filter(item => item.name !== entry.name);
    }
  }
  transfer(source, destination, names); return result;
}
