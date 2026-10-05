import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSafeAppNavigation } from '../src-electron/navigation-policy';

test('desktop navigation stays on the app document or its hash routes', () => {
  assert.equal(
    isSafeAppNavigation(
      'file:///Applications/surprised-face.app/index.html#/',
      'file:///Applications/surprised-face.app/index.html#/settings',
    ),
    true,
  );
  assert.equal(
    isSafeAppNavigation(
      'file:///Applications/surprised-face.app/index.html#/',
      'file:///Users/example/private.txt',
    ),
    false,
  );
  assert.equal(
    isSafeAppNavigation('http://localhost:9300/#/', 'http://localhost:9300/#/settings'),
    true,
  );
  assert.equal(isSafeAppNavigation('http://localhost:9300/#/', 'https://example.com/'), false);
});
