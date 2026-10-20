import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    name: 'Google sign-in request',
    test: 'Google authorization uses a system-browser code flow with PKCE and minimal scopes',
    input: 'A desktop OAuth client, loopback URI, random verifier/state, and a server-issued nonce.',
    result: 'Authorization uses openid/profile, S256 PKCE, state, and nonce. The app carries no Google client secret.',
  },
  {
    name: 'Google callback validation',
    test: 'OAuth callback accepts only a matching state and a non-empty authorization code',
    input: 'Valid, mismatched-state, and Google-denied callback URLs.',
    result: 'Only a callback with the expected state and code is accepted.',
  },
  {
    name: 'Google browser redirect',
    test: 'Google sign-in sends the code and PKCE verifier only to the HTTPS Worker',
    input: 'Simulate Google returning an authorization code to the temporary localhost callback, then send the code, verifier, redirect URI, and signed challenge to the Worker.',
    result: 'The callback is scrubbed from browser history, and the Google authorization code is exchanged only by the Worker using its server-side secret.',
  },
  {
    name: 'Waiting for the owner',
    test: 'a mention waiting on someone else names that person',
    input: 'Mukesh tags Aman\'s Codex and the turn is waiting for permission.',
    result: 'Mukesh sees waiting for Aman. Aman sees waiting for you.',
  },
  {
    name: 'One row for a shared chat',
    test: 'a local chat linked to a shared room is not listed again',
    input: 'Codex session a is already linked to a shared room. Sessions b and c are not.',
    result: 'The local list keeps b and c.',
  },
  {
    name: 'Reply label',
    test: 'a shared reply is labeled with its owner and harness',
    input: 'An assistant message belongs to mukesh and Codex.',
    result: 'The label is mukesh · Codex. A human message keeps the person name.',
  },
  {
    name: 'Harness context append',
    test: 'new shared messages are appended once to the linked harness session',
    input: 'A linked Codex session has not seen Maya and Noah, then Maya sends one more message.',
    result: 'The session receives the first two lines, then only the newer line. Nothing is written back to the room.',
  },
  {
    name: 'Mention stays a turn',
    test: 'a mention that queued a turn is left for that turn',
    input: 'A chat line is followed by a mention that already queued a turn.',
    result: 'The chat line is appended and the mention is left for the harness turn.',
  },
  {
    name: 'Context without a reply',
    test: 'shared context is saved to the desktop chat without waiting for a model reply',
    input: 'Codex desktop stores the shared line and does not write an assistant message.',
    result: 'The append finishes with only the shared line in the session.',
  },
  {
    name: 'Harness availability',
    test: 'unavailable harnesses are not advertised for turns',
    input: 'Codex is installed and Hermes is absent.',
    result: 'Only Codex is offered for shared turns.',
  },
  {
    name: 'No folder setup',
    test: 'a harness turn needs no configured working folder or instruction preamble',
    input: 'A shared Codex turn has no configured working folder and says Please help.',
    result: 'The adapter starts in the default folder and receives Please help without a generated instruction preamble.',
  },
  {
    name: 'Mention at cursor',
    test: 'mention suggestions follow the cursor before existing text',
    input: 'Insert @ or @ followed by a space before existing text.',
    result: 'The mention range is found at the cursor even when text follows it.',
  },
  {
    name: 'Streaming batches',
    test: 'streamed model deltas are delivered promptly in bounded batches',
    input: 'Codex emits Hello, a space, and world as separate deltas.',
    result: 'The room receives Hello world as one ordered chunk before turn completion.',
  },
  {
    name: 'Desktop streaming',
    test: 'desktop replies are copied as they appear before the turn finishes',
    input: 'A synthetic Codex desktop session appends two assistant messages before task_complete.',
    result: 'Both messages reach the stream callback before the desktop turn finishes.',
  },
  {
    name: 'Harness context JSON',
    test: 'every shared message updates the local context JSON for each harness',
    input: 'Maya sends Hello, then Noah sends Can you see this? to one room.',
    result: 'The app-owned Codex and Hermes context files both contain the two ordered messages and current event sequence.',
  },
  {
    name: 'Shared native Codex session',
    test: 'a shared Codex chat uses its desktop owner instead of acquiring a second writer',
    input: 'A shared chat is linked to an existing desktop session; a mocked second writer rejects resume.',
    result: 'The runner submits through the existing desktop owner and copies its assistant reply into the room.',
  },
  {
    name: 'Startup settings synchronization',
    test: 'concurrent startup settings reads wait for the saved connection and agents',
    input: 'The bridge and renderer request settings together from one synthetic saved profile.',
    result: 'Both await the same file read and receive the saved identity, connected state, and local agents.',
  },
  {
    name: 'Agent queue wakeups',
    test: 'queue wakeups received during a claim are retried after the claim completes',
    input: 'A mocked claim is in flight when another queue availability event arrives.',
    result: 'After the first empty claim finishes, the runner claims again instead of losing the wakeup.',
  },
  {
    name: 'Agent claim recovery',
    test: 'claim failures are reported and do not prevent a later queue retry',
    input: 'A mocked claim fails with Connection lost, followed by a successful empty claim.',
    result: 'The runner emits the error and releases the local room lock so the next retry can run.',
  },
  {
    name: 'Catalog reconciliation',
    test: 'catalog replacement removes deleted discovery entries and preserves owned chats and native records',
    input: 'Replace a saved catalog, reopen SQLite, and inspect app-owned chats and paged native records.',
    result: 'Deleted discovery rows disappear, new rows survive restart, and owned chats and native fields remain intact.',
  },
  {
    name: 'Partial discovery',
    test: 'partial discovery preserves cached harness entries until a complete refresh',
    input: 'A partial catalog is followed by a successful empty snapshot.',
    result: 'Partial results retain unavailable harness entries; a complete empty refresh removes the old discovery rows.',
  },
  {
    name: 'Bundled Sheep native import',
    test: 'bundled Sheep imports a synthetic Pi chat into a separate Codex session',
    input: 'Synthetic Pi user/assistant turns; disposable Codex destination; stubbed Codex CLI launch.',
    result: 'The actual bundled helper creates a separate Codex session, leaves the source byte-for-byte unchanged, discovers both chats, returns both readable turns and paged native records. The JSON bridge rejects an import operation because that operation is not implemented.',
  },
  {
    name: 'Credential identity',
    test: 'app identity is set before opening the shared profile and its encrypted credentials',
    input: 'Development startup reads credentials saved by the packaged app.',
    result: 'The app sets its surprised-face identity before its profile path and credential storage are used.',
  },
  {
    name: 'App profile',
    test: 'development and installed apps use the same dedicated profile instead of Electron settings',
    input: 'Development and packaged startup under the same operating system app-data folder.',
    result: 'Both select surprised-face. The preview does not inherit a stale local Worker connection from the generic Electron profile.',
  },
  {
    name: 'Isolated development profile',
    test: 'isolated development profiles are explicit and never affect the installed app',
    input: 'SURPRISED_FACE_DEV_DATA points to /tmp/chat-check.',
    result: 'Only a development run selects the isolated folder; the installed app keeps its dedicated profile.',
  },
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
    name: 'Codex page context',
    test: 'a Codex chat hides harness page context and keeps the conversation',
    input: 'A saved transcript contains an external_codex_apps_open_page tag, then say "welcome to berlin" and welcome to berlin.',
    result: 'The page tag is omitted. Both conversation turns remain.',
  },
  {
    name: 'Codex session text',
    test: 'Codex session text keeps both sides of the conversation and drops harness context',
    input: 'A Codex session file with the page tag, a user turn, an assistant turn, and task_complete.',
    result: 'Both conversation turns are kept and the turn is settled.',
  },
  {
    name: 'Codex desktop turn',
    test: 'a message from the app is delivered to the open Codex thread and its reply is read back',
    input: 'Synthetic desktop IPC socket and a session file. Message: Hello from the app. Folder: /work/game.',
    result: 'thread-follower-start-turn version 2 carries the conversation id, folder, and text. The session file supplies the reply.',
  },
  {
    name: 'Codex desktop unavailable',
    test: 'a desktop thread without an owner stays on the local Codex adapter',
    input: 'The synthetic desktop router returns no-client-found because the thread owner is unavailable.',
    result: 'The desktop link reports CodexDesktopUnavailable so the local adapter can resume the chat.',
  },
  {
    name: 'Codex discovery reply',
    test: 'the desktop link answers discovery without claiming the thread',
    input: 'After initialize, the router asks whether this client owns the thread.',
    result: 'The link answers canHandle false.',
  },
  {
    name: 'Codex session follow',
    test: 'Codex session follow reports a new desktop reply from the same session file',
    input: 'A nested rollout file gains an assistant turn after follow starts.',
    result: 'The follower emits the original turn, then both turns.',
  },
  {
    name: 'Open Codex desktop chat',
    test: 'an open Codex desktop chat receives the app message without starting a second app-server turn',
    input: 'Send Hello from the app to thread-1 while a desktop bridge is connected.',
    result: 'The desktop bridge receives the message. The local app-server does not resume or start a turn.',
  },
  {
    name: 'Codex desktop fallback',
    test: 'a Codex chat uses the local adapter when the desktop thread has no owner',
    input: 'The desktop bridge reports that no owner is available, then the local adapter completes the turn.',
    result: 'The local adapter resumes the session once and starts the turn.',
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
const sheepReviewPath = path.join(appRoot, '../output/sheep-review.json');
const sheepReview = existsSync(sheepReviewPath) ? JSON.parse(readFileSync(sheepReviewPath, 'utf8')) : null;
const sheepEvidence = sheepReview ? `<h2>Sheep source and bundle</h2><p>${escapeHtml(sheepReview.sourceTestTime)} · <code>go test -json ./...</code> in the Sheep checkout · ${sheepReview.sourceTests.pass} passed · ${sheepReview.sourceTests.fail} failed · ${sheepReview.sourceTests.skip} skipped.</p><p>The earlier ${escapeHtml(sheepReview.platform)} bundle audit reported revision <code>${escapeHtml(sheepReview.revision)}</code> and vcs.modified=${escapeHtml(sheepReview.modified)} in Go build metadata. It already contains the native import commit. This historical audit preceded the catalog startup changes shown above. The bundled-helper regression above executes the converter with synthetic text and disposable target roots, then checks bridge discovery and reads. Harness launch is stubbed; other native import targets and a real harness resume were not exercised.</p><p><a href="output/sheep-source-results.jsonl">Go test events</a> · <a href="output/sheep-review.json">Bundle and test metadata</a></p>` : '';
const performancePath = path.join(appRoot, '../output/startup-performance.json');
const performance = existsSync(performancePath) ? JSON.parse(readFileSync(performancePath, 'utf8')) : null;
const sourceResultsPath = path.join(appRoot, '../output/sheep-startup-test-results.jsonl');
const sourceEvents = existsSync(sourceResultsPath) ? readFileSync(sourceResultsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
const sourcePass = sourceEvents.filter((event) => event.Action === 'pass' && event.Test).length;
const sourceFail = sourceEvents.filter((event) => event.Action === 'fail' && event.Test).length;
const startupEvidence = performance ? `<h2>Catalog startup</h2><p>The real local catalog contains ${performance.conversationCount} chats. The baseline helper took ${performance.baselineSeconds.toFixed(3)}s; the changed helper took ${performance.coldSeconds.toFixed(3)}s with an empty cache and ${performance.restartSeconds.toFixed(3)}s after restarting with a populated cache. This measures the helper catalog operation, not full Electron startup. Metadata equality: ${performance.identicalCatalogs ? 'all fields matched' : 'differences observed'}.</p><p>The full Sheep suite (go test -json ./...) reports ${sourcePass} passing tests and ${sourceFail} failures. Regression coverage includes unchanged-file reuse, changed/deleted/new sessions, renamed Codex titles, source preservation, native page continuation, unknown native fields, and damaged-cache fallback. The app checks exercise catalog reconciliation, partial discovery, native import, and preservation of native records. <a href="output/startup-performance.json">Timings and method</a> · <a href="output/sheep-startup-test-results.jsonl">Go test events</a> · <a href="output/typecheck-results.json">Production typecheck and existing test fixture issues</a></p>` : '';
const livePath = path.join(appRoot, '../output/agent-mentions/live-check.json');
const live = existsSync(livePath) ? JSON.parse(readFileSync(livePath, 'utf8')) : null;
const mentionEvidence = live ? `<h2>Shared agent recovery</h2><p>${escapeHtml(live.checkedAt)}. Read-only verification of existing requests in the live chat: one assistant reply completed; the collaborator's older build reported an active writer conflict. The new shared desktop session regression above verifies the fix with a synthetic desktop owner. The collaborator must install the updated build before that path can be verified on their computer.</p><p><a href="output/agent-mentions/worker-red.html">Failing queue regression before the fix</a> · <a href="output/agent-mentions/live-check.json">Sanitized live observation</a></p>` : '';
const generated = `
      <p class="run-meta">${escapeHtml(timestamp)} UTC · ${passed} passed · ${failed} failed</p>
      <table class="route-table">
        <thead><tr><th scope="col">Check</th><th scope="col">Input</th><th scope="col">Result</th><th scope="col">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <details><summary>Runner output</summary><pre>${escapeHtml(output.trim() || `No test output. ${total} tests.`)}</pre></details>${startupEvidence}${sheepEvidence}${mentionEvidence}`;

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
