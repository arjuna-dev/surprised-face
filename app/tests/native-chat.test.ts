import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { NativeChatService } from '../src-electron/native-chat';

test('a new project chat creates a native session and sends its first message without resuming it', async () => {
  const created: unknown[] = [];
  const resumed: unknown[] = [];
  const codex = Object.assign(new EventEmitter(), {
    startThread: async (input: unknown) => { created.push(input); return { thread: { id: 'new-thread' } }; },
    resumeThread: async (input: unknown) => { resumed.push(input); return {}; },
    startTurn: async () => {
      queueMicrotask(() => codex.emit('event', { method: 'turn/completed', params: { threadId: 'new-thread' } }));
      return {};
    },
  });
  const hermes = Object.assign(new EventEmitter(), {
    newSession: async () => ({ sessionId: 'new-hermes' }), loadSession: async () => ({}), prompt: async () => ({}),
  });
  const service = new NativeChatService(codex, hermes);
  const chat = await service.create({ harness: 'codex', cwd: '/work/game', model: 'chosen-model' });
  assert.deepEqual(chat, { harness: 'codex', sessionId: 'new-thread', cwd: '/work/game' });
  await service.send({ ...chat, text: 'Hello' });
  assert.deepEqual(created, [{ cwd: '/work/game', model: 'chosen-model' }]);
  assert.deepEqual(resumed, []);
});

test('a new Hermes project chat keeps the selected folder and rejects a missing project', async () => {
  const created: unknown[] = [];
  const codex = Object.assign(new EventEmitter(), { startThread: async () => ({}), resumeThread: async () => ({}), startTurn: async () => ({}) });
  const hermes = Object.assign(new EventEmitter(), {
    newSession: async (model?: string, cwd?: string) => { created.push({ model, cwd }); return { sessionId: 'new-hermes' }; },
    loadSession: async () => ({}), prompt: async () => ({}),
  });
  const service = new NativeChatService(codex, hermes);
  await assert.rejects(service.create({ harness: 'hermes', cwd: '' }), /project/i);
  const chat = await service.create({ harness: 'hermes', cwd: '/work/game', model: 'hermes-model' });
  assert.equal(chat.sessionId, 'new-hermes');
  assert.deepEqual(created, [{ model: 'hermes-model', cwd: '/work/game' }]);
});

test('an opened Codex chat resumes its native session and streams a reply', async () => {
  const codex = Object.assign(new EventEmitter(), { startThread: async () => ({}) }) as EventEmitter & { startThread: () => Promise<unknown>; resumeThread: (input: unknown) => Promise<unknown>; startTurn: (input: unknown) => Promise<unknown> };
  const hermes = Object.assign(new EventEmitter(), { newSession: async () => ({ sessionId: '' }) }) as EventEmitter & { newSession: () => Promise<{ sessionId: string }>; loadSession: (id: string) => Promise<unknown>; prompt: (id: string, text: string) => Promise<unknown> };
  const resumed: unknown[] = [];
  codex.resumeThread = async (input) => { resumed.push(input); return {}; };
  codex.startTurn = async () => {
    queueMicrotask(() => {
      codex.emit('event', { method: 'item/agentMessage/delta', params: { threadId: 'thread-1', delta: 'Hello' } });
      codex.emit('event', { method: 'turn/completed', params: { threadId: 'thread-1' } });
    });
    return {};
  };
  hermes.loadSession = async () => ({});
  hermes.prompt = async () => ({});
  const service = new NativeChatService(codex, hermes);
  const events: unknown[] = [];
  service.on('event', (event) => events.push(event));
  await service.send({ harness: 'codex', sessionId: 'thread-1', cwd: '/work/game', text: 'Hi' });
  await service.send({ harness: 'codex', sessionId: 'thread-1', cwd: '/work/game', text: 'Again' });
  assert.equal(resumed.length, 1);
  assert.ok(events.some((event) => (event as { type?: string; text?: string }).type === 'delta' && (event as { text?: string }).text === 'Hello'));
  assert.equal(events.filter((event) => (event as { type?: string }).type === 'completed').length, 2);
});

test('a Hermes local chat streams its own reply and releases the session', async () => {
  const codex = Object.assign(new EventEmitter(), { startThread: async () => ({}) }) as EventEmitter & { startThread: () => Promise<unknown>; resumeThread: (input: unknown) => Promise<unknown>; startTurn: (input: unknown) => Promise<unknown> };
  const hermes = Object.assign(new EventEmitter(), { newSession: async () => ({ sessionId: '' }) }) as EventEmitter & { newSession: () => Promise<{ sessionId: string }>; loadSession: (id: string) => Promise<unknown>; prompt: (id: string, text: string) => Promise<unknown> };
  codex.resumeThread = async () => ({});
  codex.startTurn = async () => ({});
  hermes.loadSession = async () => ({});
  hermes.prompt = async (sessionId) => {
    queueMicrotask(() => {
      hermes.emit('event', { type: 'message', sessionId, text: 'Done' });
      hermes.emit('event', { type: 'prompt/completed', sessionId });
    });
    return {};
  };
  const service = new NativeChatService(codex, hermes);
  const events: { type: string; text?: string }[] = [];
  service.on('event', (event) => events.push(event));
  await service.send({ harness: 'hermes', sessionId: 'session-1', cwd: '/work/game', text: 'Do it' });
  assert.deepEqual(events.map((event) => event.type), ['started', 'delta', 'completed']);
  assert.equal(events[1]?.text, 'Done');
});
