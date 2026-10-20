import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HarnessContextMirror } from '../src-electron/harness-context-mirror';

test('every shared message updates the local context JSON for each harness', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-context-'));
  const messages = [
    { id: 'one', roomId: 'room-1', messageSeq: 1, participantId: 'maya', participantName: 'Maya', role: 'user' as const, text: 'Hello', state: 'complete', agentId: null, agentName: null, ownerId: null, harness: null, model: null, createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z' },
  ];
  const store = { messages: () => messages, cursor: () => messages.length };
  const mirror = new HarnessContextMirror(root, store as never);
  try {
    await mirror.sync('room-1');
    messages.push({ ...messages[0]!, id: 'two', messageSeq: 2, participantId: 'noah', participantName: 'Noah', text: 'Can you see this?' });
    await mirror.sync('room-1');
    for (const harness of ['codex', 'hermes'] as const) {
      const file = mirror.pathFor('room-1', harness);
      const data = JSON.parse(await readFile(file, 'utf8'));
      assert.deepEqual(data.messages.map((item: { participantId: string; text: string }) => [item.participantId, item.text]), [
        ['maya', 'Hello'], ['noah', 'Can you see this?'],
      ]);
      assert.equal(data.throughEventSeq, 2);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
