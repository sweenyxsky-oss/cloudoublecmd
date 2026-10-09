import { readFile } from 'node:fs/promises';
import { Client } from 'basic-ftp';
import { createAccessServer } from './app.mjs';
import { listFtp, listMounted } from './providers.mjs';
import { createSessions } from './session.mjs';

// External TrueNAS container only: never import this into the web app.
const token = (await readFile(process.env.ACCESS_TOKEN_FILE ?? '/run/secrets/access_token', 'utf8')).trim();
const connections = JSON.parse(await readFile(process.env.CONNECTIONS_FILE ?? '/run/secrets/connections.json', 'utf8'));
// The browser UI is enabled only when a password file is configured.
const passwordFile = process.env.UI_PASSWORD_FILE;
const sessions = passwordFile ? createSessions((await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '')) : null;
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
