import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayTranscriptMessages } from '../src/lib/native-transcript';

test('reopening a new Codex chat hides injected project instructions while keeping the actual conversation', () => {
  const transcript = { messages: [
    { role: 'user', content: '# AGENTS.md instructions for /work/game\n\n<INSTRUCTIONS>\nProject setup\n</INSTRUCTIONS>' },
    { role: 'user', content: '<environment_context>\nWorking folder: /work/game\n</environment_context>' },
    { role: 'user', content: 'Please explain AGENTS.md' },
    { role: 'assistant', content: 'It contains project instructions.' },
  ] };
  assert.deepEqual(displayTranscriptMessages(transcript).map((item) => item.content), ['Please explain AGENTS.md', 'It contains project instructions.']);
});

test('a chat transcript shows conversation turns while leaving harness records out of the chat', () => {
  const transcript = { messages: [
    { role: 'system', content: 'Internal harness instructions' },
    { role: 'user', content: 'Hello', at: '2026-10-01T12:00:00Z' },
    { role: 'tool', content: 'A command result' },
    { role: 'assistant', content: 'Hi', at: '2026-10-01T12:00:01Z' },
  ] };
  assert.deepEqual(displayTranscriptMessages(transcript), [
    { role: 'user', content: 'Hello', at: '2026-10-01T12:00:00Z' },
    { role: 'assistant', content: 'Hi', at: '2026-10-01T12:00:01Z' },
  ]);
});
