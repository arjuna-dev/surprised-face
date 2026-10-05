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
  ['project-composer.png', 'Project selected, composer ready'],
  ['new-chat-reply.png', 'New Hermes chat with fixture reply'],
  ['invite-copied.png', 'Invite icon and copy confirmation'],
  ['small-project-composer.png', 'Composer at 1000 x 680'],
].filter(([file]) => existsSync(path.join(appRoot, '../output/playwright', file)))
  .map(([file, title]) => `<figure><img src="output/playwright/${file}" alt="${title}" style="width:100%;height:auto"><figcaption>${title}. Real Vue view with synthetic project, harness, and chat-service fixtures.</figcaption></figure>`).join('\n');
const generated = `<h2>Chat interface</h2><p class="run-meta">${escape(data.stats.startTime)} · npm run test:ui · ${data.stats.expected} passed · ${data.stats.unexpected} failed</p>
<p>The actual Vue interface runs in Chromium with mocked Electron IPC. Project names, messages, agent replies, and invite codes are synthetic. window.prompt throws as it does in Electron. Assertions cover the rendered controls and API calls; hardware clipboard and live model calls are checked separately.</p>
<table class="route-table"><thead><tr><th scope="col">Workflow</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table>
<details><summary>Before the fixes</summary><p>The first UI run reproduced the phantom empty invite field and the New chat recovery screen from Electron's unsupported prompt. Five of six checks failed; the viewport-only check passed. Native session creation and catalog persistence also failed before implementation.</p><a href="output/playwright/red-results.json">Original UI results</a><figure><img src="output/playwright/red-empty-invite.png" alt="Empty invite panel before the fix" style="width:100%;height:auto"></figure><figure><img src="output/playwright/red-new-chat.png" alt="New chat crash before the fix" style="width:100%;height:auto"></figure></details>
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
