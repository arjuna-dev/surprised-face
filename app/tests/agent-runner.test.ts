import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { AgentRunner } from '../src-electron/agent-runner';

test('queue wakeups received during a claim are retried after the claim completes', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let claims = 0;
  const rooms = { claimTurn: async () => { if (++claims === 1) await pending; return null; } };
  const settings = { get: async () => ({ connected: true, agents: [], allowRemoteAgentRequests: false }) };
  const runner = new AgentRunner(rooms as never, {} as never, settings as never, new EventEmitter() as never, new EventEmitter() as never);
  const first = runner.runPending('room');
  await new Promise((resolve) => setImmediate(resolve));
  await runner.runPending('room');
  release();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(claims, 2, 'an availability event during an in-flight claim must not be lost');
});

test('claim failures are reported and do not prevent a later queue retry', async () => {
  let claims = 0;
  const rooms = { claimTurn: async () => { if (++claims === 1) throw new Error('Connection lost'); return null; } };
  const settings = { get: async () => ({ connected: true, agents: [], allowRemoteAgentRequests: false }) };
  const runner = new AgentRunner(rooms as never, {} as never, settings as never, new EventEmitter() as never, new EventEmitter() as never);
  const errors: unknown[] = [];
  runner.on('agent/error', (error) => errors.push(error));
  await runner.runPending('room');
  assert.deepEqual(errors, [{ roomId: 'room', message: 'Connection lost' }]);
  await runner.runPending('room');
  assert.equal(claims, 2);
});

test('a shared Codex chat uses its desktop owner instead of acquiring a second writer', async () => {
  const { tmpdir } = await import('node:os');
  const agent = { id: 'maya-agent', name: 'Maya agent', harness: 'codex', model: '', workingDirectory: tmpdir() };
  let claimed = false;
  const chunks: string[] = [];
  const finished: string[] = [];
  const rooms = {
    claimTurn: async () => {
      if (claimed) return null;
      claimed = true;
      return { turnId: 'turn', agentId: agent.id, ownerId: 'maya', harness: 'codex', model: '', contextThroughSeq: 2, request: { text: 'Hello', requestedBy: 'maya' }, context: [{ messageSeq: 2, participantId: 'maya', role: 'user', text: 'Hello' }] };
    },
    members: async () => [], agents: async () => [],
    appendAgentChunk: async (_room: string, _turn: string, _index: number, text: string) => { chunks.push(text); },
    finishAgentTurn: async (_room: string, _turn: string, state: string) => { finished.push(state); },
  };
  const store = { agentSession: () => ({ native_session_id: 'desktop-thread', harness: 'codex', working_directory: tmpdir(), model: '', context_through_seq: 1 }), saveAgentSession: () => {} };
  const settings = { get: async () => ({ connected: true, member: { id: 'maya' }, agents: [agent], allowRemoteAgentRequests: false }) };
  const codex = Object.assign(new EventEmitter(), {
    resumeThread: async () => { throw new Error('already has an active writer'); },
    startTurn: async () => { throw new Error('a second writer must not start'); },
  });
  const delivered: string[] = [];
  const desktop = { startTurn: async (input: { threadId: string }) => { delivered.push(input.threadId); return [{ role: 'assistant' as const, content: 'Hello from the existing desktop session' }]; } };
  const runner = new AgentRunner(rooms as never, store as never, settings as never, codex as never, new EventEmitter() as never, desktop);
  await runner.runPending('room');
  assert.deepEqual(delivered, ['desktop-thread']);
  assert.deepEqual(chunks, ['Hello from the existing desktop session']);
  assert.deepEqual(finished, ['complete']);
});
