import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertMentionAtCursor, mentionAtCursor } from '../src/lib/mentions';

test('mention suggestions follow the cursor before existing text', () => {
  assert.deepEqual(mentionAtCursor('@ original text', 1), { start: 0, end: 1, search: '' });
  assert.deepEqual(mentionAtCursor('@ original text', 2), { start: 0, end: 2, search: '' });
  assert.deepEqual(mentionAtCursor('Please @cod review', 11), { start: 7, end: 11, search: 'cod' });
  assert.deepEqual(mentionAtCursor('Please @', 8), { start: 7, end: 8, search: '' });
  assert.equal(mentionAtCursor('mail@example.com', 16), null);
});

test('inserting a mention keeps the text after the cursor', () => {
  assert.deepEqual(insertMentionAtCursor('@ original text', 2, 'codex'), { text: '@codex original text', cursor: 7 });
  assert.deepEqual(insertMentionAtCursor('Please @cod review', 11, 'codex'), { text: 'Please @codex review', cursor: 13 });
});
