import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harnessStatusLabel, sharedReplyLabel } from '../src/lib/reply-label';

test('a shared reply is labeled with its owner and harness', () => {
  assert.equal(sharedReplyLabel({ role: 'assistant', ownerName: 'mukesh', harnessLabel: 'Codex' }), 'mukesh · Codex');
  assert.equal(sharedReplyLabel({ role: 'assistant', harnessLabel: 'Hermes' }), 'Hermes');
  assert.equal(sharedReplyLabel({ role: 'user', participantName: 'Alejandro' }), 'Alejandro');
});

test('a mention waiting on someone else names that person', () => {
  assert.equal(harnessStatusLabel('waiting', 'Aman', false), 'waiting for Aman');
  assert.equal(harnessStatusLabel('waiting', 'Aman', true), 'waiting for you');
  assert.equal(harnessStatusLabel('queued', 'Aman', false), 'queued');
});
