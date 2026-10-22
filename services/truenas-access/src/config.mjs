import { readFile } from 'node:fs/promises';

/** Load app configuration from private catalog fields, while retaining file-based deployment compatibility. */
export async function loadConfig(env = process.env, read = readFile) {
  const tokenValue = env.ACCESS_TOKEN !== undefined
    ? env.ACCESS_TOKEN
    : (await read(env.ACCESS_TOKEN_FILE ?? '/run/secrets/access_token', 'utf8')).trim();
  const token = tokenValue.trim();
  if (Buffer.byteLength(token) < 32) throw new Error('Service token must contain at least 32 bytes');

  const rawConnections = env.CONNECTIONS_JSON !== undefined
    ? env.CONNECTIONS_JSON
    : await read(env.CONNECTIONS_FILE ?? '/run/secrets/connections.json', 'utf8');
  let connections;
  try { connections = JSON.parse(rawConnections); }
  catch { throw new Error('Connections configuration must be valid JSON'); }

  let password = null;
  if (env.UI_PASSWORD !== undefined) password = env.UI_PASSWORD.replace(/\r?\n$/, '');
  else if (env.UI_PASSWORD_FILE) password = (await read(env.UI_PASSWORD_FILE, 'utf8')).replace(/\r?\n$/, '');
  return { token, connections, password };
}
