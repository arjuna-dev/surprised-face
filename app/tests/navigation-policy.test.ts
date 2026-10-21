import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isSafeAppNavigation,
  openExternalWebLink,
  createExternalWindowHandler,
} from '../src-electron/navigation-policy';

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

test('desktop external links open HTTP and HTTPS in the system browser', async () => {
  const opened: string[] = [];
  const open = async (url: string) => {
    opened.push(url);
  };
  for (const url of [
    'https://surprised-face-rooms.camus-00.workers.dev/hordes/',
    'http://127.0.0.1:9020/report.html',
  ]) {
    assert.equal(await openExternalWebLink(url, open), true);
  }
  assert.deepEqual(opened, [
    'https://surprised-face-rooms.camus-00.workers.dev/hordes/',
    'http://127.0.0.1:9020/report.html',
  ]);
});

test('desktop external links reject non-web URLs and report browser launch failures', async () => {
  const opened: string[] = [];
  for (const url of [
    'javascript:alert(1)',
    'file:///Users/example/private.txt',
    'data:text/html,hello',
    'https://user:password@example.com',
    'not a URL',
  ]) {
    assert.equal(
      await openExternalWebLink(url, async (url) => {
        opened.push(url);
      }),
      false,
    );
  }
  assert.deepEqual(opened, []);
  await assert.rejects(
    () =>
      openExternalWebLink('https://example.com/', async () => {
        throw new Error('Browser unavailable');
      }),
    /Browser unavailable/,
  );
});

test('the Electron window handler opens web links externally while denying embedded windows', async () => {
  const opened: string[] = [];
  const failure = Promise.withResolvers<unknown>();
  const handler = createExternalWindowHandler(async (url) => {
    opened.push(url);
  }, failure.resolve);
  assert.deepEqual(handler({ url: 'https://surprised-face-rooms.camus-00.workers.dev/hordes/' }), {
    action: 'deny',
  });
  assert.deepEqual(handler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://surprised-face-rooms.camus-00.workers.dev/hordes/']);
  const failingHandler = createExternalWindowHandler(async () => {
    throw new Error('Browser unavailable');
  }, failure.resolve);
  assert.deepEqual(failingHandler({ url: 'https://example.com/' }), { action: 'deny' });
  assert.match(String(await failure.promise), /Browser unavailable/);
});
