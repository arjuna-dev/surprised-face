import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { configureAppProfile, resolveAppDataPath } from '../src-electron/app-data-path';

test('development and installed apps use the same dedicated profile instead of Electron settings', () => {
  const appData = '/user/Library/Application Support';
  const expected = path.join(appData, 'surprised-face');
  assert.equal(resolveAppDataPath(appData, false), expected);
  assert.equal(resolveAppDataPath(appData, true), expected);
});

test('isolated development profiles are explicit and never affect the installed app', () => {
  assert.equal(resolveAppDataPath('/app-data', false, '/tmp/chat-check'), '/tmp/chat-check');
  assert.equal(resolveAppDataPath('/app-data', true, '/tmp/chat-check'), path.join('/app-data', 'surprised-face'));
});

test('app identity is set before opening the shared profile and its encrypted credentials', () => {
  const calls: string[] = [];
  configureAppProfile({
    isPackaged: false,
    setName: (name) => { calls.push(`name:${name}`); },
    getPath: () => '/app-data',
    setPath: (name, value) => { calls.push(`${name}:${value}`); },
  });
  assert.deepEqual(calls, ['name:surprised-face', `userData:${path.join('/app-data', 'surprised-face')}`]);
});
