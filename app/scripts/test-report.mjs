import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testFiles = readdirSync(path.join(appRoot, 'tests'))
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join('tests', name));

const { code, stdout, stderr } = await runTests(testFiles);
const output = `${stdout}${stderr ? `\n${stderr}` : ''}`;
const total = captureCount(output, 'tests');
const passed = captureCount(output, 'pass');
const failed = captureCount(output, 'fail');
const results = new Map();
for (const match of output.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)) results.set(match[2], match[1] === 'ok');

const checks = [
  {
    name: 'Human message identity',
    test: 'stores the human participant name with the committed message',
    input: 'event 1: member-1, Maya, "Hello"',
    result: 'SQLite keeps the participant ID and name. Replaying the event adds no duplicate.',
  },
  {
    name: 'Room event order',
    test: 'applies out-of-order room events only after the missing sequence arrives',
    input: 'WebSocket event 2 arrives before event 1.',
    result: 'Local events apply in sequence 1, 2; the cursor ends at 2.',
  },
  {
    name: 'Queued sends',
    test: 'flushes pending sends once and in the outbox order',
    input: 'Two pending messages; two flush requests start together.',
    result: 'The mocked API receives each message once, in saved order, with one active send. An acknowledgement notification refreshes the UI after the pending copies are removed.',
  },
  {
    name: 'Room service default',
    test: 'new installs use the deployed room service URL',
    input: 'A new settings file has no saved room service URL.',
    result: 'Disconnected installs use the managed hosted URL; an explicit local development override can use a local Worker.',
  },
  {
    name: 'Appearance choices',
    test: 'appearance offers two reference themes and keeps the previous layout as Classic',
    input: 'Saved theme is light, green, dark, cobalt-red, or an unknown value.',
    result: 'Saved Light opens Classic; Green and Dark open Mint + charcoal; new installs use Mint + charcoal.',
  },
  {
    name: 'Development helper',
    test: 'development finds the bundled helper beside the project, not inside Quasar output',
    input: 'Quasar app path is app/.quasar/dev-electron; bundled helper is app/resources/bin/sheep.',
    result: 'The app resolves the helper in the project resources directory.',
  },
  {
    name: 'Packaged helper',
    test: 'packaged builds use their bundled resources directory',
    input: 'A packaged app with its own resources directory.',
    result: 'The app resolves resources/bin/sheep inside the package.',
  },
  {
    name: 'Catalog filters',
    test: 'local chat search combines project, harness, agent, and text filters',
    input: 'Three local chats with different project paths, harnesses, agents, and titles.',
    result: 'Combined filters return only the matching chat; an unknown agent returns none.',
  },
  {
    name: 'Missing chat path',
    test: 'project filtering tolerates local chats without a working folder',
    input: 'One local chat has no path; the user selects /work/game.',
    result: 'The pathless chat is skipped and the matching chat is shown without a render error.',
  },
  {
    name: 'Stale project',
    test: 'project list skips stale and internal discovered folders',
    input: 'A pinned discovered project points to a deleted 0900 folder; others are internal, one-off, or ignored.',
    result: 'They are absent from the project list; real folders and manually tracked offline projects remain.',
  },
  {
    name: 'Recent projects',
    test: 'projects sort by the latest chat activity rather than alphabetically',
    input: 'Alpha has a newer chat than Beta, while Gamma has an older chat.',
    result: 'Project order is Alpha, Beta, Gamma by activity time.',
  },
  {
    name: 'Nested project chats',
    test: 'a nested project owns its chats and activity instead of its parent',
    input: 'A chat in /work/game, with both /work and /work/game tracked as projects.',
    result: 'The child project owns the activity; the parent is sorted by its own activity.',
  },
  {
    name: 'Chat placement',
    test: 'a chat belongs to the deepest matching project',
    input: 'Chats under a project, a nested project, and an unrelated folder.',
    result: 'Each chat appears only under its most specific tracked project.',
  },
  {
    name: 'Readable chat',
    test: 'a chat transcript shows conversation turns while leaving harness records out of the chat',
    input: 'User and assistant turns mixed with system and tool records.',
    result: 'The chat shows only user and assistant turns; raw records stay internal.',
  },
  {
    name: 'New Codex chat',
    test: 'a new project chat creates a native session and sends its first message without resuming it',
    input: 'Create a Codex chat in /work/game with chosen-model, then send Hello.',
    result: 'The selected folder and model reach thread/start. The first message uses the new session without reopening it.',
  },
  {
    name: 'New Hermes chat',
    test: 'a new Hermes project chat keeps the selected folder and rejects a missing project',
    input: 'Create with an empty folder, then /work/game and hermes-model.',
    result: 'The empty folder is rejected. The selected folder and model reach session/new.',
  },
  {
    name: 'New chat persistence',
    test: 'new app chats remain in the local catalog after restarting',
    input: 'Save a new native chat, close SQLite, and reopen it.',
    result: 'The chat title, native ID, harness, and project folder survive restart.',
  },
  {
    name: 'Native setup context',
    test: 'reopening a new Codex chat hides injected project instructions while keeping the actual conversation',
    input: 'Native user records contain an AGENTS.md setup envelope, environment context, and an ordinary question about AGENTS.md.',
    result: 'Only the actual question and assistant reply appear. The same visible history is used for a chat invite.',
  },
  {
    name: 'Codex local chat',
    test: 'an opened Codex chat resumes its native session and streams a reply',
    input: 'Send to thread-1 twice after opening an existing Codex conversation.',
    result: 'The adapter resumes once and emits reply text and completion for both turns.',
  },
  {
    name: 'Hermes local chat',
    test: 'a Hermes local chat streams its own reply and releases the session',
    input: 'Send to session-1 through Hermes ACP.',
    result: 'The adapter emits started, reply text, and completed in that order.',
  },
  {
    name: 'Imported chat copy',
    test: 'imported agent history keeps its author and original time in the local copy',
    input: 'Imported assistant message with an original timestamp and agent owner.',
    result: 'The local copy retains its agent attribution, original time, and native room link.',
  },
  {
    name: 'Window navigation',
    test: 'desktop navigation stays on the app document or its hash routes',
    input: 'Hash route, local file, and external web URL navigation attempts.',
    result: 'Only the loaded app document and its hash routes are allowed.',
  },
];

const rows = checks.map((check) => {
  const success = results.get(check.test) === true;
  return `<tr><th scope="row">${escapeHtml(check.name)}</th><td>${escapeHtml(check.input)}</td><td>${escapeHtml(check.result)}</td><td>${success ? 'Pass' : 'Fail'}</td></tr>`;
}).join('\n');
const timestamp = new Date().toISOString();
const generated = `
      <p class="run-meta">${escapeHtml(timestamp)} UTC · ${passed} passed · ${failed} failed</p>
      <table class="route-table">
        <thead><tr><th scope="col">Check</th><th scope="col">Input</th><th scope="col">Result</th><th scope="col">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <details><summary>Runner output</summary><pre>${escapeHtml(output.trim() || `No test output. ${total} tests.`)}</pre></details>`;

const reportPath = path.join(appRoot, '..', 'tests.html');
const report = readFileSync(reportPath, 'utf8');
const startMarker = '<!-- TEST_REPORT_START -->';
const endMarker = '<!-- TEST_REPORT_END -->';
const start = report.indexOf(startMarker);
const end = report.indexOf(endMarker);
if (start < 0 || end < 0 || end < start) throw new Error(`Missing test report markers in ${reportPath}`);
writeFileSync(reportPath, `${report.slice(0, start + startMarker.length)}${generated}${report.slice(end)}`);
process.stdout.write(`Updated ${path.relative(appRoot, reportPath)} with ${passed} passing and ${failed} failing checks.\n`);
if (code !== 0 || failed > 0) process.exitCode = code || 1;

function runTests(files) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', ...files], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function captureCount(output, label) {
  const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output);
  return match ? Number(match[1]) : 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
