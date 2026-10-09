import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packArchive, unpackArchive, inspectArchive, safeArchivePath } from '../src/archives.mjs';
for (const format of ['zip', '7z', 'gz', 'bz2', 'xz']) test(`${format} round trip with integrity verification and no overwrite`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cdc-format-')); const connection = { root, writable: true, protocol: 'local' };
  const destination = { connection, path: '/out' };
  try {
    await mkdir(path.join(root, 'out')); await writeFile(path.join(root, 'one.txt'), 'archive round trip');
    await packArchive(connection, '/', { names: ['one.txt'], archive: `packed.${format}` }, { connection, path: '/' });
    const entries = await inspectArchive(path.join(root, `packed.${format}`)); assert.equal(entries.length, 1); assert.ok(entries[0].supported);
    await unpackArchive(connection, '/', { name: `packed.${format}` }, destination);
    assert.equal(await readFile(path.join(root, 'out', entries[0].name), 'utf8'), 'archive round trip');
    await assert.rejects(unpackArchive(connection, '/', { name: `packed.${format}` }, destination), /already exists/);
    await assert.rejects(packArchive(connection, '/', { names: ['one.txt'], archive: `packed.${format}` }, { connection, path: '/' }), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('ZIP directory recursion, selected unpack and destination symlink rejection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cdc-zip-')); const connection = { root, writable: true, protocol: 'local' };
  try {
    await mkdir(path.join(root, 'docs')); await mkdir(path.join(root, 'out')); await writeFile(path.join(root, 'docs', 'one.txt'), 'one'); await writeFile(path.join(root, 'docs', 'two.txt'), 'two');
    await symlink('/etc/passwd', path.join(root, 'docs', 'link'));
    await packArchive(connection, '/', { names: ['docs'], archive: 'docs.zip' }, { connection, path: '/' });
    assert.ok(!(await inspectArchive(path.join(root, 'docs.zip'))).some(e => e.name.includes('link')));
    await unpackArchive(connection, '/', { name: 'docs.zip', only: ['docs/one.txt'] }, { connection, path: '/out' });
    assert.equal(await readFile(path.join(root, 'out/docs/one.txt'), 'utf8'), 'one');
    await rm(path.join(root, 'out/docs'), { recursive: true }); await symlink(path.join(root, 'docs'), path.join(root, 'out/docs'));
    await assert.rejects(unpackArchive(connection, '/', { name: 'docs.zip' }, { connection, path: '/out' }), /Symlink|already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('unsafe archive paths and RAR creation are rejected', async () => {
  for (const name of ['../escape', '/absolute', 'C:/drive', 'a\\b', 'a/../b', 'a\nPath = fake']) assert.throws(() => safeArchivePath(name));
  await assert.rejects(packArchive({ writable: true, protocol: 'local' }, '/', { names: ['one'], archive: 'out.rar' }, { connection: { writable: true, protocol: 'local' } }), /creation is not supported/);
});

// BSD-licensed libarchive fixture: https://github.com/libarchive/libarchive/blob/master/libarchive/test/test_read_format_rar.rar.uu
// Retain libarchive's license with the fixture.
test('RAR extraction skips links and reads regular files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cdc-rar-')); const connection = { root, writable: true, protocol: 'local' };
  try {
    const encoded = await readFile(new URL('./fixtures/sample.rar.uu', import.meta.url), 'utf8'); const chunks = [];
    for (const line of encoded.split(/\r?\n/).slice(1)) {
      if (line === 'end' || !line) continue; const length = (line.charCodeAt(0) - 32) & 63; const bytes = [];
      for (let i = 1; i < line.length; i += 4) { const n = [0, 1, 2, 3].map(j => ((line.charCodeAt(i + j) || 32) - 32) & 63); bytes.push((n[0] << 2) | (n[1] >> 4), ((n[1] & 15) << 4) | (n[2] >> 2), ((n[2] & 3) << 6) | n[3]); }
      chunks.push(Buffer.from(bytes.slice(0, length)));
    }
    await writeFile(path.join(root, 'sample.rar'), Buffer.concat(chunks)); await mkdir(path.join(root, 'out'));
    const entries = await inspectArchive(path.join(root, 'sample.rar')); assert.equal(entries.find(e => e.name === 'testlink')?.supported, false);
    await unpackArchive(connection, '/', { name: 'sample.rar' }, { connection, path: '/out' });
    assert.match(await readFile(path.join(root, 'out/test.txt'), 'utf8'), /test text document/);
    await assert.rejects(readFile(path.join(root, 'out/testlink')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
