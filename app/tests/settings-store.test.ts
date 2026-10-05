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
