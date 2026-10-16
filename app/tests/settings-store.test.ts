import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVAILABLE_APP_THEMES,
  DEFAULT_ROOM_SERVICE_URL,
  normalizeAppTheme,
  resolveRoomServiceUrl,
} from '../src-electron/settings-defaults';

test('new installs use the deployed room service URL', () => {
  assert.equal(DEFAULT_ROOM_SERVICE_URL, 'https://surprised-face-rooms.camus-00.workers.dev');
  assert.equal(resolveRoomServiceUrl('http://127.0.0.1:8790', false), DEFAULT_ROOM_SERVICE_URL);
  assert.equal(resolveRoomServiceUrl('http://127.0.0.1:8790', true), 'http://127.0.0.1:8790');
  assert.equal(resolveRoomServiceUrl('', false, 'http://127.0.0.1:8790'), 'http://127.0.0.1:8790');
});

test('appearance offers two reference themes and keeps the previous layout as Classic', () => {
  assert.deepEqual(AVAILABLE_APP_THEMES, ['cobalt-red', 'mint-charcoal', 'classic']);
  assert.equal(normalizeAppTheme('light'), 'classic');
  assert.equal(normalizeAppTheme('green'), 'mint-charcoal');
  assert.equal(normalizeAppTheme('dark'), 'mint-charcoal');
  assert.equal(normalizeAppTheme('cobalt-red'), 'cobalt-red');
  assert.equal(normalizeAppTheme('unexpected'), 'mint-charcoal');
});


test('concurrent startup settings reads wait for the saved connection and agents', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { SettingsStore } = await import('../src-electron/settings-store');
  const directory = await mkdtemp(join(tmpdir(), 'settings-startup-'));
  try {
    const member = { id: 'maya', name: 'Maya', role: 'member' };
    const agent = { id: 'maya-agent', name: 'Maya agent', harness: 'codex', model: '', workingDirectory: directory };
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ member, displayName: 'Maya', encryptedAccessToken: 'synthetic-not-decrypted', agents: [agent] }));
    const store = new SettingsStore(directory);
    const [bridge, renderer] = await Promise.all([store.get(), store.get()]);
    assert.deepEqual(renderer, bridge, 'the renderer must not see disconnected defaults while the bridge loads the file');
    assert.equal(renderer.connected, true);
    assert.equal(renderer.displayName, 'Maya');
    assert.deepEqual(renderer.agents, [agent]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
