import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPathForConversation } from '../src/lib/project-chats';

test('a chat belongs to the deepest matching project', () => {
  const projects = [{ path: '/work' }, { path: '/work/game' }, { path: '/other' }];
  assert.equal(projectPathForConversation('/work/game', projects), '/work/game');
  assert.equal(projectPathForConversation('/work/game/src', projects), '/work/game');
  assert.equal(projectPathForConversation('/work/other', projects), '/work');
  assert.equal(projectPathForConversation('/workspace', projects), '');
});
