import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterLocalConversations } from '../src/lib/catalog-filters';

const conversations = [
  { id: 'a', title: 'Design notes', harness: 'codex', agentId: 'design-agent', path: '/work/game' },
  { id: 'b', title: 'Bug review', harness: 'hermes', agentId: 'review-agent', path: '/work/game' },
  { id: 'c', title: 'Design notes', harness: 'codex', agentId: 'design-agent', path: '/work/site' },
];

test('local chat search combines project, harness, agent, and text filters', () => {
  assert.deepEqual(
    filterLocalConversations(conversations, {
      query: 'design',
      harness: 'codex',
      agent: 'design-agent',
      projectPath: '/work/game',
    }).map((item) => item.id),
    ['a'],
  );
  assert.deepEqual(
    filterLocalConversations(conversations, {
      query: '',
      harness: 'hermes',
      agent: '',
      projectPath: '',
    }).map((item) => item.id),
    ['b'],
  );
  assert.deepEqual(
    filterLocalConversations(conversations, {
      query: '',
      harness: '',
      agent: 'unknown',
      projectPath: '',
    }),
    [],
  );
});

test('project filtering tolerates local chats without a working folder', () => {
  const rows = [
    { id: 'unknown', title: 'Imported chat', harness: 'codex' },
    { id: 'match', title: 'Game chat', harness: 'codex', path: '/work/game' },
  ];
  assert.deepEqual(
    filterLocalConversations(rows, {
      query: '',
      harness: '',
      agent: '',
      projectPath: '/work/game',
    }).map((item) => item.id),
    ['match'],
  );
});
