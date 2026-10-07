import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { displayTranscriptMessages } from '../src/lib/native-transcript';
import { messagesFromCodexSession } from '../src/lib/codex-session';
import { CodexDesktopLink, CodexDesktopUnavailable } from '../src-electron/codex-desktop-link';
import { CodexSessionFollow, findCodexSessionFile } from '../src-electron/codex-session-follow';

test('a Codex chat hides harness page context and keeps the conversation', () => {
  const transcript = { messages: [
    { role: 'user', content: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>' },
    { role: 'user', content: 'say "welcome to berlin"' },
    { role: 'assistant', content: 'welcome to berlin' },
  ] };
  assert.deepEqual(displayTranscriptMessages(transcript).map((item) => item.content), ['say "welcome to berlin"', 'welcome to berlin']);
});

test('Codex session text keeps both sides of the conversation and drops harness context', () => {
  const session = [
    record('user', '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>'),
    record('user', 'Hello from Codex'),
    record('assistant', 'Hello from the app'),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
  ].join('\n');
  const parsed = messagesFromCodexSession(session);
  assert.deepEqual(parsed.messages.map((item) => item.content), ['Hello from Codex', 'Hello from the app']);
  assert.equal(parsed.settled, true);
});

test('a message from the app is delivered to the open Codex thread and its reply is read back', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-link-'));
  const sessionFile = path.join(root, 'session.jsonl');
  writeFileSync(sessionFile, `${record('user', 'Hello from Codex')}\n${record('assistant', 'Hello!')}\n`);
  const socketPath = path.join(root, 'ipc.sock');
  const received: unknown[] = [];
  const server = await listen(socketPath, (message, socket) => {
    if (message.method === 'initialize') {
      writeFrame(socket, { type: 'response', requestId: message.requestId, resultType: 'success', method: 'initialize', result: { clientId: 'desktop-client' } });
      return;
    }
    received.push(message);
    writeFrame(socket, { type: 'response', requestId: message.requestId, resultType: 'success', method: message.method, result: {} });
    writeFileSync(sessionFile, `${readFileSync(sessionFile, 'utf8')}${record('user', 'Hello from the app')}\n${record('assistant', 'welcome back')}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } })}\n`);
  });
  const link = new CodexDesktopLink({ socketPath, sessionFile, acceptTimeoutMs: 1000 });
  try {
    const reply = await link.startTurn({ threadId: 'thread-1', text: 'Hello from the app', cwd: '/work/game' });
    assert.deepEqual(reply.map((item) => item.content), ['Hello from Codex', 'Hello!', 'Hello from the app', 'welcome back']);
    const request = received[0] as { method?: string; version?: number; params?: { conversationId?: string; turnStart?: { request?: { threadId?: string; cwd?: string; input?: { text?: string }[] } } } };
    assert.equal(request.method, 'thread-follower-start-turn');
    assert.equal(request.version, 2);
    assert.equal(request.params?.conversationId, 'thread-1');
    assert.equal(request.params?.turnStart?.request?.threadId, 'thread-1');
    assert.equal(request.params?.turnStart?.request?.cwd, '/work/game');
    assert.equal(request.params?.turnStart?.request?.input?.[0]?.text, 'Hello from the app');
  } finally {
    link.close();
    server.close();
  }
});

test('a desktop thread without an owner stays on the local Codex adapter', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-link-'));
  const socketPath = path.join(root, 'ipc.sock');
  const server = await listen(socketPath, (message, socket) => {
    if (message.method === 'initialize') {
      writeFrame(socket, { type: 'response', requestId: message.requestId, resultType: 'success', method: 'initialize', result: { clientId: 'desktop-client' } });
      return;
    }
    writeFrame(socket, { type: 'response', requestId: message.requestId, resultType: 'error', error: 'no-client-found: thread stream owner became unavailable' });
  });
  const link = new CodexDesktopLink({ socketPath, sessionFile: path.join(root, 'missing.jsonl'), acceptTimeoutMs: 1000 });
  try {
    await assert.rejects(link.startTurn({ threadId: 'thread-1', text: 'Hello', cwd: '/work/game' }), CodexDesktopUnavailable);
  } finally {
    link.close();
    server.close();
  }
});

test('the desktop link answers discovery without claiming the thread', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-link-'));
  const socketPath = path.join(root, 'ipc.sock');
  let discovery: { type?: string; response?: { canHandle?: boolean } } | null = null;
  const server = await listen(socketPath, (message, socket) => {
    if (message.type === 'client-discovery-response') discovery = message;
    if (message.method === 'initialize') {
      writeFrame(socket, { type: 'response', requestId: message.requestId, resultType: 'success', method: 'initialize', result: { clientId: 'desktop-client' } });
      writeFrame(socket, { type: 'client-discovery-request', requestId: 'discover-1', request: { method: 'thread-owner-discovery', params: { conversationId: 'thread-1' } } });
    }
  });
  const link = new CodexDesktopLink({ socketPath, sessionFile: null, acceptTimeoutMs: 500 });
  try {
    await link.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(discovery?.type, 'client-discovery-response');
    assert.equal(discovery?.response?.canHandle, false);
  } finally {
    link.close();
    server.close();
  }
});

test('Codex session follow reports a new desktop reply from the same session file', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-follow-'));
  const directory = path.join(root, '2026', '10', '06');
  mkdirSync(directory, { recursive: true });
  const sessionFile = path.join(directory, 'rollout-2026-10-06T11-00-00-thread-1.jsonl');
  writeFileSync(sessionFile, `${record('user', 'Hello from Codex')}\n`);
  assert.equal(findCodexSessionFile('thread-1', root), sessionFile);
  const follow = new CodexSessionFollow(sessionFile);
  const updates: string[][] = [];
  follow.on('update', (view: { messages: { content: string }[] }) => updates.push(view.messages.map((item) => item.content)));
  follow.start();
  try {
    assert.deepEqual(updates[0], ['Hello from Codex']);
    writeFileSync(sessionFile, `${readFileSync(sessionFile, 'utf8')}${record('assistant', 'Hello from the desktop')}\n`);
    const started = Date.now();
    while (updates.length < 2 && Date.now() - started < 2000) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(updates.at(-1), ['Hello from Codex', 'Hello from the desktop']);
  } finally {
    follow.close();
  }
});

function record(role: 'user' | 'assistant', text: string): string {
  return JSON.stringify({ timestamp: '2026-10-06T09:00:00.000Z', type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
}

function writeFrame(socket: Socket, message: unknown): void {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function listen(socketPath: string, onMessage: (message: Record<string, any>, socket: Socket) => void): Promise<Server> {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) return;
        const message = JSON.parse(buffer.subarray(4, 4 + length).toString()) as Record<string, any>;
        buffer = buffer.subarray(4 + length);
        onMessage(message, socket);
      }
    });
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
}
