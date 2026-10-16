import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LocalStore } from '../src-electron/local-store';

test('new app chats remain in the local catalog after restarting', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'surprised-face-new-chat-'));
  const file = path.join(directory, 'chat.sqlite');
  const first = new LocalStore(file);
  const chat = { id: 'new-thread', harness: 'codex', title: 'Hello', path: '/work/game' };
  first.cache('app-conversation', chat.id, chat.harness, chat);
  first.close();
  const reopened = new LocalStore(file);
  try { assert.deepEqual(reopened.catalog('app-conversation'), [chat]); }
  finally { reopened.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('stores the human participant name with the committed message', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'surprised-face-store-'));
  const store = new LocalStore(path.join(directory, 'room.sqlite'));
  try {
    const event = {
      eventSeq: 1,
      type: 'message.created',
      messageId: 'message-1',
      messageSeq: 1,
      participantId: 'member-1',
      participantName: 'Maya',
      role: 'user',
      text: 'Hello',
      createdAt: '2026-10-04T10:00:00.000Z',
    };

    assert.equal(store.applyEvent('room-1', event), true);
    assert.equal(store.applyEvent('room-1', event), false);
    assert.equal(store.messages('room-1')[0]?.participantName, 'Maya');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('imported agent history keeps its author and original time in the local copy', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'surprised-face-import-'));
  const store = new LocalStore(path.join(directory, 'room.sqlite'));
  try {
    store.applyEvent('room-1', {
      eventSeq: 1, type: 'message.created', messageId: 'history-1', messageSeq: 1,
      participantId: 'agent-1', participantName: 'Maya Codex', role: 'assistant', text: 'Earlier answer',
      agentId: 'agent-1', agentName: 'Maya Codex', ownerId: 'member-1', harness: 'codex', model: 'default',
      sourceAt: '2026-10-01T12:00:00.000Z', createdAt: '2026-10-05T12:00:00.000Z',
    });
    const message = store.messages('room-1')[0];
    assert.equal(message?.agentName, 'Maya Codex');
    assert.equal(message?.createdAt, '2026-10-01T12:00:00.000Z');
    store.saveNativeRoomLink('codex', 'thread-1', 'room-1', 'agent-1');
    assert.deepEqual(store.nativeRoomLink('codex', 'thread-1'), { roomId: 'room-1', agentId: 'agent-1' });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test('catalog replacement removes deleted discovery entries and preserves owned chats and native records', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'surprised-face-catalog-'));
  const file = path.join(directory, 'catalog.sqlite');
  const store = new LocalStore(file);
  try {
    store.cache('app-conversation', 'owned', 'codex', { id: 'owned', harness: 'codex' });
    store.cache('conversation', 'deleted', 'pi', { id: 'deleted', harness: 'pi' });
    store.saveNativePage({ harness: 'pi', sessionId: 'deleted', format: 'jsonl', complete: true, records: [{ index: 0, raw: { tool: 'preserve' } }] });
    const fresh = [{ id: 'fresh', harness: 'pi', title: 'Fresh title' }];
    store.replaceCatalog('conversation', fresh);
    assert.deepEqual(store.catalog('conversation'), fresh);
    assert.equal(store.catalog('app-conversation')[0]?.id, 'owned');
    assert.deepEqual(store.nativeRecords('pi', 'deleted'), [{ index: 0, kind: '', at: null, raw: { tool: 'preserve' } }]);
    store.close();
    const reopened = new LocalStore(file);
    try { assert.deepEqual(reopened.catalog('conversation'), fresh); }
    finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('partial discovery preserves cached harness entries until a complete refresh', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'surprised-face-partial-catalog-'));
  const store = new LocalStore(path.join(directory, 'catalog.sqlite'));
  try {
    store.replaceCatalog('conversation', [{ id: 'claude-old', harness: 'claude' }]);
    store.replaceCatalog('conversation', [{ id: 'codex-new', harness: 'codex' }], false);
    assert.deepEqual(new Set(store.catalog('conversation').map((chat) => chat.id)), new Set(['claude-old', 'codex-new']));
    store.replaceCatalog('conversation', []);
    assert.deepEqual(store.catalog('conversation'), []);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
