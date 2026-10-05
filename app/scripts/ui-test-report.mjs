import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], { cwd: appRoot, stdio: 'inherit', env: process.env });
  child.on('error', reject);
  child.on('close', (code) => resolve(code ?? 1));
});
const resultPath = path.join(appRoot, '../output/playwright/results.json');
const data = JSON.parse(readFileSync(resultPath, 'utf8'));
const specs = [];
function collect(suites) {
  for (const suite of suites || []) {
    specs.push(...suite.specs || []);
    collect(suite.suites);
  }
}
collect(data.suites);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rows = specs.map((spec) => `<tr><th scope="row">${escape(spec.title)}</th><td>${spec.ok ? 'Pass' : 'Fail'}</td></tr>`).join('\n');
const images = [
  ['chat-header-actions.png', 'Invite friend and Join a chat in the chat header'],
  ['project-composer.png', 'Project selected, composer ready'],
  ['new-chat-reply.png', 'New Hermes chat with fixture reply'],
  ['invite-copied.png', 'Invite modal with code and explicit Copy button'],
  ['join-modal-mint-charcoal.png', 'Join dialog in Mint + charcoal'],
  ['join-modal-cobalt-red.png', 'Join dialog in Cobalt + red'],
  ['join-modal-classic.png', 'Join dialog in Classic'],
  ['small-project-composer.png', 'Composer at 1000 x 680'],
  ['settings-join-connected.png', 'Join a chat from Settings while connected'],
  ['settings-join-new.png', 'Join a chat from Settings on a new account'],
  ['settings-codex-account.png', 'Codex account status, Check status feedback, and Sign out'],
].filter(([file]) => existsSync(path.join(appRoot, '../output/playwright', file)))
  .map(([file, title]) => `<figure><img src="output/playwright/${file}" alt="${title}" style="width:100%;height:auto"><figcaption>${title}. Real Vue view with synthetic project, harness, and chat-service fixtures.</figcaption></figure>`).join('\n');
const generated = `<h2>Chat interface</h2><p class="run-meta">${escape(data.stats.startTime)} · npm run test:ui · ${data.stats.expected} passed · ${data.stats.unexpected} failed</p>
<p>The actual Vue interface runs in Chromium with mocked Electron IPC. Project names, messages, agent replies, account identity, and invite codes are synthetic. window.prompt throws as it does in Electron. Assertions cover the rendered controls and API calls; hardware clipboard and live model calls are checked separately.</p>
<table class="route-table"><thead><tr><th scope="col">Workflow</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table>
<details><summary>Before the fixes</summary><p>The first UI run reproduced the phantom empty invite field and the New chat recovery screen from Electron's unsupported prompt. Five of six checks failed; the viewport-only check passed. Native session creation and catalog persistence also failed before implementation.</p><a href="output/playwright/red-results.json">Original UI results</a><figure><img src="output/playwright/red-empty-invite.png" alt="Empty invite panel before the fix" style="width:100%;height:auto"></figure><figure><img src="output/playwright/red-new-chat.png" alt="New chat crash before the fix" style="width:100%;height:auto"></figure></details>
<details><summary>Chat actions before this change</summary><p>Four UI assertions failed before the labeled header buttons and detailed confirmation were implemented. The Join action was beside Projects, and both actions used a person-plus icon. A placement check then caught a larger notification covering the header buttons. The intermediate implementation placed a large confirmation below the header. That banner has now been replaced by the invite dialog.</p><a href="output/playwright/red-chat-actions-results.json">Failing action checks</a> · <a href="output/playwright/red-confirmation-overlay-results.json">Failing placement check</a><figure><img src="output/playwright/red-chat-actions.png" alt="Icon-only invitation and sidebar join action before the change" style="width:100%;height:auto"></figure></details>
<details><summary>Settings before automatic saving and account controls</summary><p>Seven new interface checks failed before this change. Appearance required Save settings, account status was not loaded on opening Settings, and no sign-out action or status-check feedback was shown. The current tests exercise debounced serial saving, leaving Settings immediately, retaining preferences after a reload, error and retry feedback, existing and absent Codex accounts, login completion, account changes, and successful and failed sign-out. The synthetic Codex response follows the installed app-server protocol: account identity determines sign-in state; requiresOpenaiAuth describes whether authentication is required.</p><a href="output/playwright/red-settings-account-results.json">Failing settings and account checks</a><figure><img src="output/playwright/red-settings-account.png" alt="Manual Save settings and unchecked Codex status before the fix" style="width:100%;height:auto"></figure></details>
<details><summary>Sharing dialogs before this change</summary><p>The targeted red run failed in all three themes: Join chat inherited a 60px heading instead of the expected size of at most 20px. The initial invite checks also found no dialog and automatic clipboard copying. The current checks assert code presentation before copying, explicit Copy calls, errors without false confirmation, loading and retry, dismiss and reopen, focus restoration after importing a native chat, keyboard focus containment, a new account joining, 24px padding, and regular headings in every theme.</p><a href="output/playwright/red-sharing-dialog-results.json">Failing dialog typography checks</a> · <a href="output/playwright/red-dialog-focus-results.json">Failing keyboard focus check</a><figure><img src="output/playwright/red-invite-banner.png" alt="Large invite confirmation before the modal" style="width:100%;height:auto"><figcaption>Previous rendered invite banner, with synthetic chat data.</figcaption></figure><figure><img src="output/playwright/red-join-modal.png" alt="Oversized join heading and missing form padding before the fix" style="width:100%;height:auto"><figcaption>Previous rendered join form, with synthetic chat data.</figcaption></figure></details>
${images}<details><summary>Current structured results</summary><a href="output/playwright/results.json">Playwright results</a></details>`;
const reportPath = path.join(appRoot, '../tests.html');
let report = readFileSync(reportPath, 'utf8');
const startMarker = '<!-- UI_TEST_REPORT_START -->';
const endMarker = '<!-- UI_TEST_REPORT_END -->';
if (!report.includes(startMarker)) report = report.replace('<!-- TEST_REPORT_END -->', `<!-- TEST_REPORT_END -->\n${startMarker}${endMarker}`);
const start = report.indexOf(startMarker);
const end = report.indexOf(endMarker);
writeFileSync(reportPath, report.slice(0, start + startMarker.length) + generated + report.slice(end));
console.log('Updated tests.html with actual interface results and screenshots.');
process.exitCode = code;
