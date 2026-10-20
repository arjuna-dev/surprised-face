import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harnessParticipants } from '../src-electron/harness-participants';

test('supported harnesses are ready without creating agents or choosing folders', () => {
  const participants = harnessParticipants({
    member: { id: 'maya', name: 'Maya', role: 'member' },
    agents: [],
  });
  assert.deepEqual(participants.map(({ name, harness, workingDirectory }) => ({ name, harness, workingDirectory })), [
    { name: 'Maya · Codex', harness: 'codex', workingDirectory: '' },
    { name: 'Maya · Hermes', harness: 'hermes', workingDirectory: '' },
  ]);
  assert.equal(new Set(participants.map((participant) => participant.id)).size, 2);
});

test('saved identities remain claimable for existing shared chats', () => {
  const legacy = { id: 'maya-agent', name: 'Maya agent', harness: 'codex' as const, model: '', workingDirectory: '/work/old' };
  const participants = harnessParticipants({ member: { id: 'maya', name: 'Maya', role: 'member' }, agents: [legacy] });
  assert.equal(participants.find((participant) => participant.id === legacy.id)?.harness, 'codex');
});

test('unavailable harnesses are not advertised for turns', () => {
  const participants = harnessParticipants({ member: { id: 'maya', name: 'Maya' }, agents: [] }, ['codex']);
  assert.deepEqual(participants.map((item) => item.harness), ['codex']);
});
