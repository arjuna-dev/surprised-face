import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Runs the shipped helper, with imports restricted to disposable fixture roots.
// Harness execution is stubbed: no model call or real session is opened.
test('bundled Sheep imports a synthetic Pi chat into a separate Codex session', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sf-sheep-import-'));
  const helper = path.resolve('resources/bin/sheep');
  const bin = path.join(root, 'bin');
  const cwd = path.join(root, 'project');
  const piRoot = path.join(root, 'pi', 'sessions');
  const sourceId = randomUUID();
  const source = path.join(piRoot, 'fixture', `${sourceId}.jsonl`);
  const log = path.join(root, 'resume.log');
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    SHEEP_HOME: path.join(root, 'sheep'),
    SHEEP_PI_HOME: path.join(root, 'pi'),
    PI_CODING_AGENT_SESSION_DIR: piRoot,
    SHEEP_CODEX_HOME: path.join(root, 'codex'),
    SHEEP_CLAUDE_HOME: path.join(root, 'claude'),
    SHEEP_HERMES_HOME: path.join(root, 'hermes'),
    SHEEP_OPENCODE_HOME: path.join(root, 'opencode'),
    SHEEP_ANTIGRAVITY_HOME: path.join(root, 'antigravity'),
    SHEEP_TEST_RESUME: log,
  };
  const run = (args: string[], input?: string) => execFileSync(helper, args, {
    env, cwd, input, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  const bridge = (op: string, payload?: Record<string, unknown>) => {
    const output = run(['bridge', '--stdio'], `${JSON.stringify({ id: 'check', version: 'sheep.bridge.v1', op, ...(payload ? { payload } : {}) })}\n`);
    return JSON.parse(output) as { ok: boolean; error?: string; result: any };
  };
  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    mkdirSync(path.dirname(source), { recursive: true });
    for (const harness of ['codex', 'pi']) writeFileSync(path.join(bin, harness), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SHEEP_TEST_RESUME"\n', { mode: 0o700 });
    const timestamp = '2026-10-05T10:00:00Z';
    const records = [
      { type: 'session', version: 3, id: sourceId, timestamp, cwd, name: 'Synthetic import check' },
      { type: 'message', id: 'user1', parentId: null, timestamp, message: { role: 'user', content: 'Continue the synthetic design' } },
      { type: 'message', id: 'agent1', parentId: 'user1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'The synthetic design is ready' }] } },
    ].map(record => JSON.stringify(record)).join('\n') + '\n';
    writeFileSync(source, records);
    run(['checkout', 'chat', `pi:${sourceId}`, 'change-harness', 'codex']);
    const args = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(args[0], 'resume');
    const targetId = args[1];
    assert.ok(targetId && targetId !== sourceId);
    assert.equal(readFileSync(source, 'utf8'), records);
    const list = bridge('conversations.list');
    assert.equal(list.ok, true);
    const fixtures = list.result.conversations.filter((chat: { id: string }) => chat.id === sourceId || chat.id === targetId);
    assert.equal(fixtures.length, 2, 'source and target remain separate chats');
    const imported = bridge('conversations.read', { harness: 'codex', id: targetId });
    assert.equal(imported.ok, true);
    assert.deepEqual(imported.result.Messages.map((message: { role: string; content: string }) => ({ role: message.role, content: message.content })), [
      { role: 'user', content: 'Continue the synthetic design' },
      { role: 'assistant', content: 'The synthetic design is ready' },
    ]);
    const native = bridge('conversations.readNative', { harness: 'codex', id: targetId, limit: 2 });
    assert.equal(native.ok, true);
    assert.equal(native.result.records.length, 2);
    assert.ok(native.result.nextCursor);
    const missingImport = bridge('conversations.import', { harness: 'pi', id: sourceId, targetHarness: 'codex' });
    assert.equal(missingImport.ok, false);
    assert.match(missingImport.error || '', /unknown operation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
