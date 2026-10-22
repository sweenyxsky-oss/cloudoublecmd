import { Client } from 'basic-ftp';
import { createAccessServer } from './app.mjs';
import { listFtp, listMounted } from './providers.mjs';
import { createSessions } from './session.mjs';
import { loadConfig } from './config.mjs';

// Environment fields support catalog-managed private settings. File-based settings
// remain available for the standalone TrueNAS Compose deployment.
const { token, connections, password } = await loadConfig(process.env);
const sessions = password === null ? null : createSessions(password);
const server = createAccessServer({
  token, connections, sessions,
  publicDir: process.env.PUBLIC_DIR ?? new URL('../public', import.meta.url).pathname,
  ftpFactory: () => new Client(15000),
  list: (connection, requested) => connection.protocol === 'ftp' ? listFtp(connection, requested, () => new Client(15000)) : listMounted(connection, requested),
});
const port = Number(process.env.PORT ?? 7070);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
server.listen(port, '0.0.0.0', () => console.log(`ClouDouble access service listening${sessions ? ' (web UI enabled)' : ''}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
