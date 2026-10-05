import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveSheepExecutable } from '../src-electron/sheep-path';

test('development finds the bundled helper beside the project, not inside Quasar output', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sf-sheep-'));
  try {
    const appPath = path.join(root, '.quasar', 'dev-electron');
    const helper = path.join(
      root,
      'resources',
      'bin',
      process.platform === 'win32' ? 'sheep.exe' : 'sheep',
    );
    mkdirSync(appPath, { recursive: true });
    mkdirSync(path.dirname(helper), { recursive: true });
    writeFileSync(helper, 'fixture');
    assert.equal(
      resolveSheepExecutable(false, appPath, root, path.join(root, 'packaged-resources')),
      helper,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packaged builds use their bundled resources directory', () => {
  const filename = process.platform === 'win32' ? 'sheep.exe' : 'sheep';
  assert.equal(
    resolveSheepExecutable(true, '/unused', '/unused', '/product/resources'),
    path.join('/product/resources', 'bin', filename),
  );
});
