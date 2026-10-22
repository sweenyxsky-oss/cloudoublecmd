import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

const token = 'catalog-test-token-'.repeat(3);
const connections = JSON.stringify([{ id: 'pool', label: 'Pool', protocol: 'local', root: '/data/pool', writable: true }]);

test('loads catalog credentials and connection settings from private environment fields', async () => {
  const config = await loadConfig({ ACCESS_TOKEN: token, UI_PASSWORD: 'test-password-123', CONNECTIONS_JSON: connections });
  assert.equal(config.token, token);
  assert.equal(config.password, 'test-password-123');
  assert.deepEqual(config.connections, JSON.parse(connections));
});

test('preserves file-based configuration for the standalone compose deployment', async () => {
  const files = new Map([['token', `${token}\n`], ['connections', connections], ['password', 'standalone-password\n']]);
  const read = async (path) => files.get(path);
  const config = await loadConfig({ ACCESS_TOKEN_FILE: 'token', CONNECTIONS_FILE: 'connections', UI_PASSWORD_FILE: 'password' }, read);
  assert.equal(config.token, token);
  assert.equal(config.password, 'standalone-password');
  assert.deepEqual(config.connections, JSON.parse(connections));
});

test('rejects short tokens and malformed connection JSON', async () => {
  await assert.rejects(loadConfig({ ACCESS_TOKEN: 'short', CONNECTIONS_JSON: connections }), /32 bytes/);
  await assert.rejects(loadConfig({ ACCESS_TOKEN: token, CONNECTIONS_JSON: '{' }), /valid JSON/);
});
