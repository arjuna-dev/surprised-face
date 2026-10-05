import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { projectsForUi, sortProjectsByRecent } from '../src-electron/local-projects';

test('project list skips stale and internal discovered folders', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sf-project-'));
  try {
    const oneOff = path.join(root, 'Documents', 'Codex', '2026-09-26', 's');
    mkdirSync(oneOff, { recursive: true });
    const rows = [
      { name: 'real', path: root, discovered: true },
      { name: '0900', path: path.join(root, 'deleted', '0900'), discovered: true, pinned: true },
      { name: 'scheduled', path: '/Users/example/Library/Application Support/declaw/support/runs/recurring/2026-09-18/0900', discovered: true },
      { name: 'scratch', path: oneOff, discovered: true },
      { name: 'ignored', path: root, discovered: true, ignored: true },
      { name: 'manual-offline', path: path.join(root, 'offline'), discovered: false },
    ];
    assert.deepEqual(projectsForUi(rows).map((item) => item.name), ['real', 'manual-offline']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects sort by the latest chat activity rather than alphabetically', () => {
  const projects = [
    { name: 'Alpha', path: '/work/alpha', updatedAt: '2026-09-01T00:00:00Z' },
    { name: 'Beta', path: '/work/beta', updatedAt: '2026-10-02T00:00:00Z' },
    { name: 'Gamma', path: '/work/gamma' },
  ];
  const conversations = [
    { path: '/work/alpha', updatedAt: '2026-10-04T00:00:00Z' },
    { path: '/work/gamma', updatedAt: '2026-08-01T00:00:00Z' },
  ];
  assert.deepEqual(sortProjectsByRecent(projects, conversations).map((item) => item.name), ['Alpha', 'Beta', 'Gamma']);
});

test('a nested project owns its chats and activity instead of its parent', () => {
  const projects = [
    { name: 'Parent', path: '/work', updatedAt: '2026-09-01T00:00:00Z' },
    { name: 'Other', path: '/other', updatedAt: '2026-10-02T00:00:00Z' },
    { name: 'Child', path: '/work/game', updatedAt: '2026-09-01T00:00:00Z' },
  ];
  const conversations = [{ path: '/work/game', updatedAt: '2026-10-04T00:00:00Z' }];
  assert.deepEqual(sortProjectsByRecent(projects, conversations).map((item) => item.name), ['Child', 'Other', 'Parent']);
});
