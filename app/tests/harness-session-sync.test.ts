import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HarnessSessionSync, type SyncMessage, type SyncSession } from '../src-electron/harness-session-sync';

test('new shared messages are appended once to the linked harness session', async () => {
  const messages: SyncMessage[] = [
    { id: 'm1', messageSeq: 1, participantName: 'Maya', role: 'user', text: 'Hello' },
    { id: 'm2', messageSeq: 2, participantName: 'Noah', role: 'user', text: 'Can you see this?' },
  ];
  const session: SyncSession = {
    agent_id: 'maya-codex', harness: 'codex', native_session_id: 'thread-1',
    working_directory: '/work/game', model: '', context_through_seq: 0,
  };
  const appended: { sessionId: string; text: string }[] = [];
  const roomWrites: string[] = [];
  const store = {
    messages: () => messages,
    agentSessionsForRoom: () => [session],
    turnRequestMessageIds: () => [] as string[],
    saveAgentSession: (input: { contextThroughSeq?: number }) => { session.context_through_seq = input.contextThroughSeq || 0; },
  };
  const sync = new HarnessSessionSync(store, async (input) => {
    appended.push({ sessionId: input.sessionId, text: input.text });
  });
  await sync.push('room-1');
  messages.push({ id: 'm3', messageSeq: 3, participantName: 'Maya', role: 'user', text: 'One more' });
  await sync.push('room-1');
  assert.deepEqual(appended, [
    { sessionId: 'thread-1', text: 'Maya:\nHello\n\nNoah:\nCan you see this?' },
    { sessionId: 'thread-1', text: 'Maya:\nOne more' },
  ]);
  assert.equal(session.context_through_seq, 3);
  assert.deepEqual(roomWrites, []);
  assert.equal(appended.some((item) => item.text.includes('messageSeq') || item.text.includes('{')), false);
});

test('a mention that queued a turn is left for that turn', async () => {
  const messages: SyncMessage[] = [
    { id: 'chat', messageSeq: 4, participantName: 'Alejandro', role: 'user', text: 'hello there' },
    { id: 'mention', messageSeq: 5, participantName: 'Alejandro', role: 'user', text: '@maya-codex look' },
  ];
  const session: SyncSession = {
    agent_id: 'maya-codex', harness: 'codex', native_session_id: 'thread-1',
    working_directory: '/work/game', model: '', context_through_seq: 3,
  };
  const appended: string[] = [];
  const store = {
    messages: () => messages,
    agentSessionsForRoom: () => [session],
    turnRequestMessageIds: () => ['mention'],
    saveAgentSession: (input: { contextThroughSeq?: number }) => { session.context_through_seq = input.contextThroughSeq || 0; },
  };
  const sync = new HarnessSessionSync(store, async (input) => { appended.push(input.text); });
  await sync.push('room-1');
  assert.deepEqual(appended, ['Alejandro:\nhello there']);
  assert.equal(session.context_through_seq, 4);
});
