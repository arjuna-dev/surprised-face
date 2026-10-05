import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cloudflareRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(cloudflareRoot, '../..');
const reportPath = path.join(repoRoot, 'tests.html');
const wranglerPath = path.join(cloudflareRoot, 'node_modules/wrangler/bin/wrangler.js');
const sessionSecret = randomBytes(32).toString('hex');
const adminSecret = randomBytes(32).toString('hex');
const stateDir = await mkdtemp(path.join(path.resolve('/tmp'), 'surprised-face-worker-test-'));
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = { stdout: '', stderr: '' };
let worker;
let socket;

try {
  await mkdir(path.dirname(reportPath), { recursive: true });
  worker = spawn(process.execPath, [
    wranglerPath, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', stateDir, '--show-interactive-dev-session=false',
    '--var', `SESSION_SECRET:${sessionSecret}`, '--var', `ADMIN_SECRET:${adminSecret}`,
  ], { cwd: cloudflareRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  worker.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });

  await waitForWorker();
  const health = await api('/health');
  assert.equal(health.body.ok, true, 'local Worker serves health checks');

  const boot = await api('/v1/admin/bootstrap', { admin: adminSecret, body: { name: 'Maya' } });
  assert.equal(boot.status, 200, 'owner can initialize the workspace');
  const owner = boot.body.member;
  const ownerToken = boot.body.token;
  const selfSignup = await api('/v1/register', { body: { name: 'Nia' } });
  assert.equal(selfSignup.status, 200, 'a person can create an app identity without a Cloudflare bootstrap key');
  assert.deepEqual((await api('/v1/rooms', { token: selfSignup.body.token })).body.rooms, [], 'a new identity has no access to existing chats');
  const identity = await api('/v1/me', { token: ownerToken });
  assert.equal(identity.body.id, owner.id, 'session identity exposes the member ID');

  const ownerRooms = await api('/v1/rooms', { token: ownerToken });
  assert.equal(ownerRooms.body.rooms.length, 1, 'owner sees the default chat');
  const roomId = ownerRooms.body.rooms[0].id;
  assert.equal((await api('/v1/agents', { token: ownerToken, body: { id: 'maya-codex', name: 'Maya Codex', harness: 'codex', model: '' } })).status, 200);
  const soloMessage = await api(`/v1/rooms/${roomId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: 'Help me think this through.' } });
  assert.equal(soloMessage.body.turnIds.length, 1, 'solo chat invokes its sole owner agent without a mention');
  const soloTurn = await api(`/v1/rooms/${roomId}/turns/claim`, { token: ownerToken, body: { agentIds: ['maya-codex'], allowRemote: false } });
  assert.equal(soloTurn.body.turn.agentId, 'maya-codex', 'owner can run their own agent with remote requests disabled');
  await api(`/v1/rooms/${roomId}/turns/${soloTurn.body.turn.turnId}/finish`, { token: ownerToken, body: { state: 'complete' } });
  const inviteResult = await api(`/v1/rooms/${roomId}/invites`, { token: ownerToken, body: { count: 2 } });
  assert.equal(inviteResult.status, 200, 'chat member can create codes for that chat');
  const joResult = await api('/v1/join', { body: { code: inviteResult.body.invites[0].code, name: 'Jo' } });
  const leeResult = await api('/v1/join', { body: { code: inviteResult.body.invites[1].code, name: 'Lee' } });
  assert.equal(joResult.status, 200, 'first collaborator can join');
  assert.equal(leeResult.status, 200, 'second collaborator can join');
  assert.equal((await api('/v1/join', { body: { code: inviteResult.body.invites[0].code, name: 'Again' } })).status, 403, 'an invite cannot be used twice');
  const jo = { member: joResult.body.member, token: joResult.body.token };
  const lee = { member: leeResult.body.member, token: leeResult.body.token };

  const joRooms = await api('/v1/rooms', { token: jo.token });
  assert.deepEqual(joRooms.body.rooms.map((room) => room.id), [roomId], 'a code grants access to its chat');
  assert.equal((await api('/v1/members', { token: jo.token })).status, 200, 'older desktops can still read their accessible member list');
  assert.equal((await api('/v1/agents', { token: jo.token })).status, 200, 'older desktops can still read their accessible agent list');
  assert.equal((await api(`/v1/rooms/${roomId}/events?after=0`, { token: jo.token })).body.events.filter((event) => event.type === 'member.joined').length, 2, 'joins publish room membership changes');
  const privateRoom = await api('/v1/rooms', { token: ownerToken, body: { name: 'Private notes' } });
  assert.equal(privateRoom.status, 201);
  assert.deepEqual((await api('/v1/rooms', { token: jo.token })).body.rooms.map((room) => room.id), [roomId], 'new chats do not enroll every member');
  assert.equal((await api(`/v1/rooms/${privateRoom.body.id}/events`, { token: jo.token })).status, 403, 'other members cannot read a private chat');
  assert.equal((await api(`/v1/rooms/${privateRoom.body.id}/members`, { token: jo.token })).status, 403, 'other members cannot list a private chat');
  const imported = await api(`/v1/rooms/${privateRoom.body.id}/import`, { token: ownerToken, body: {
    sourceId: 'codex:existing-session', agentId: 'maya-codex', entries: [
      { index: 0, role: 'user', text: 'Earlier request', at: '2026-10-01T12:00:00.000Z' },
      { index: 1, role: 'assistant', text: 'Earlier answer', at: '2026-10-01T12:00:01.000Z' },
    ],
  } });
  assert.equal(imported.status, 200, 'owner can import the existing chat before inviting');
  const importRetry = await api(`/v1/rooms/${privateRoom.body.id}/import`, { token: ownerToken, body: {
    sourceId: 'codex:existing-session', agentId: 'maya-codex', entries: [
      { index: 0, role: 'user', text: 'Earlier request' }, { index: 1, role: 'assistant', text: 'Earlier answer' },
    ],
  } });
  assert.equal(importRetry.body.lastMessageSeq, imported.body.lastMessageSeq, 'retry does not duplicate imported history');
  const privateInvite = await api(`/v1/rooms/${privateRoom.body.id}/invites`, { token: ownerToken, body: { count: 1 } });
  assert.equal(privateInvite.status, 200);
  assert.equal((await api('/v1/rooms/join', { token: jo.token, body: { code: privateInvite.body.invites[0].code } })).status, 200, 'an existing member can join another chat by code');
  assert.equal((await api(`/v1/rooms/${privateRoom.body.id}/import`, { token: ownerToken, body: { sourceId: 'late', agentId: 'maya-codex', entries: [] } })).status, 403, 'history import closes when another person joins');
  assert.equal((await api(`/v1/rooms/${privateRoom.body.id}/events?after=0`, { token: jo.token })).body.events.filter((event) => event.type === 'message.created').length, 2, 'invited member sees existing conversation');
  assert.deepEqual((await api('/v1/rooms', { token: lee.token })).body.rooms.map((room) => room.id), [roomId], 'a chat code never grants access to other chats');
  const members = await api(`/v1/rooms/${roomId}/members`, { token: ownerToken });
  assert.equal(members.body.members.length, 3, 'the chat lists only its participants');
  const untaggedGroupMessage = await api(`/v1/rooms/${roomId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: 'Hello everyone.' } });
  assert.equal(untaggedGroupMessage.body.turnIds.length, 0, 'group chat requires a mention for agent turns');
  const liveEvents = await connectSocket(roomId, ownerToken);

  const codexAgent = await api('/v1/agents', { token: jo.token, body: { id: 'jo-codex', name: 'Jo Codex', harness: 'codex', model: 'local-test' } });
  const hermesAgent = await api('/v1/agents', { token: lee.token, body: { id: 'lee-hermes', name: 'Lee Hermes', harness: 'hermes', model: 'local-test' } });
  assert.equal(codexAgent.status, 200, 'member can register their Codex agent');
  assert.equal(hermesAgent.status, 200, 'member can register their Hermes agent');
  assert.equal((await api(`/v1/rooms/${privateRoom.body.id}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: '@lee-hermes', agentIds: ['lee-hermes'] } })).status, 403, 'a chat cannot invoke an agent whose owner is absent');

  const firstClientId = randomUUID();
  const firstMessage = await api(`/v1/rooms/${roomId}/messages`, {
    token: ownerToken, body: { clientId: firstClientId, text: '@Jo Codex check this', agentIds: ['jo-codex'] },
  });
  assert.equal(firstMessage.status, 200, 'human message queues a named agent turn');
  const liveMessage = await liveEvents.wait('message.created', (event) => event.participantName === 'Maya');
  assert.equal(liveMessage.participantName, 'Maya', 'WebSocket broadcasts human name metadata');
  const blockedRemote = await api(`/v1/rooms/${roomId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal(blockedRemote.body.reason, 'remote_requests_disabled', 'remote requests need the agent owner to opt in');
  const firstTurn = await api(`/v1/rooms/${roomId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: true } });
  assert.equal(firstTurn.status, 200, 'agent owner can claim the queued turn');
  assert.equal(firstTurn.body.turn.agentId, 'jo-codex');
  assert.equal(firstTurn.body.turn.context[0].participantName, 'Maya');

  const laterMessage = await api(`/v1/rooms/${roomId}/messages`, {
    token: lee.token, body: { clientId: randomUUID(), text: '@Lee Hermes take the next one', agentIds: ['lee-hermes'] },
  });
  await liveEvents.wait('message.created', (event) => event.participantName === 'Lee');
  const activeClaim = await api(`/v1/rooms/${roomId}/turns/claim`, { token: lee.token, body: { agentIds: ['lee-hermes'], allowRemote: true } });
  assert.equal(activeClaim.status, 409, 'other agents wait for the active stream to finish');
  assert.equal(activeClaim.body.reason, 'another_agent_active');

  const chunkPath = `/v1/rooms/${roomId}/turns/${firstTurn.body.turn.turnId}/chunk`;
  const chunk = await api(chunkPath, { token: jo.token, body: { index: 0, text: 'Jo reply completed.' } });
  assert.equal(chunk.status, 200, 'agent stream writes a chunk');
  const finishPath = `/v1/rooms/${roomId}/turns/${firstTurn.body.turn.turnId}/finish`;
  assert.equal((await api(finishPath, { token: jo.token, body: { state: 'complete' } })).status, 200, 'agent turn completes');

  const nextTurn = await api(`/v1/rooms/${roomId}/turns/claim`, { token: lee.token, body: { agentIds: ['lee-hermes'], allowRemote: true } });
  assert.equal(nextTurn.status, 200, 'next agent claims after the previous stream ends');
  assert.ok(nextTurn.body.turn.context.some((message) => message.text === 'Jo reply completed.'), 'next agent sees the completed prior reply');
  assert.ok(nextTurn.body.turn.context.some((message) => message.participantName === 'Lee'), 'next agent sees collaborator messages in chat order');

  const duplicate = await api(`/v1/rooms/${roomId}/messages`, {
    token: ownerToken, body: { clientId: firstClientId, text: '@Jo Codex check this', agentIds: ['jo-codex'] },
  });
  assert.equal(duplicate.body.duplicate, true, 'retry with the same client ID does not duplicate a message');
  assert.equal(duplicate.body.messageSeq, firstMessage.body.messageSeq);

  const events = await api(`/v1/rooms/${roomId}/events?after=0`, { token: ownerToken });
  const sequences = events.body.events.map((event) => event.eventSeq);
  assert.deepEqual(sequences, sequences.map((_, index) => index + 1), 'room events have a contiguous canonical sequence');
  assert.ok(events.body.events.some((event) => event.type === 'message.created' && event.participantName === 'Maya'));
  assert.ok(laterMessage.body.messageSeq > firstTurn.body.turn.context.at(-1).messageSeq, 'messages sent while streaming receive later message positions');

  const checks = [
    ['Session identity', 'Owner and invited members authenticate with their participant IDs.', 'Pass'],
    ['App account creation', 'A new person can register without a Cloudflare key and cannot read existing chats.', 'Pass'],
    ['Chat invite access', 'Codes admit people to one chat; new chats stay private until invited.', 'Pass'],
    ['Solo and group agent routing', 'Solo chats call their owner agent automatically; group chats require a mention.', 'Pass'],
    ['Existing chat history', 'An imported Codex conversation is visible to invitees and retries do not duplicate messages.', 'Pass'],
    ['Agent routing', 'An @agent message creates a turn the configured owner can claim.', 'Pass'],
    ['Stream ordering', 'A second agent waits, then receives the completed reply and intervening human messages.', 'Pass'],
    ['Live updates', 'WebSocket clients receive new messages with participant names.', 'Pass'],
    ['Event order', `The room returns ${sequences.length} contiguous events with participant names.`, 'Pass'],
    ['Idempotent send', 'Retrying the same client ID returns the original message sequence.', 'Pass'],
  ];
  await updateReport(checks, output);
  process.stdout.write(`Local Worker integration passed: ${checks.length} checks, ${sequences.length} ordered events.\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await updateReport([['Local Worker integration', message, 'Fail']], output).catch(() => {});
  process.stderr.write(`Local Worker integration failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  if (worker && worker.exitCode === null) {
    worker.kill('SIGINT');
    await Promise.race([once(worker, 'close'), delay(2_000)]);
  }
  await rm(stateDir, { recursive: true, force: true });
}

async function connectSocket(roomId, token) {
  if (typeof WebSocket === 'undefined') throw new Error('This Node runtime does not provide WebSocket support.');
  socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/v1/rooms/${encodeURIComponent(roomId)}/connect?after=0`, [`bearer.${token}`, 'sf.v1']);
  const events = [];
  const waiters = new Map();
  socket.addEventListener('message', (message) => {
    let event;
    try { event = JSON.parse(String(message.data)); } catch { return; }
    events.push(event);
    const pending = waiters.get(event.type) || [];
    const matchingIndex = pending.findIndex((waiter) => waiter.predicate(event));
    if (matchingIndex >= 0) pending.splice(matchingIndex, 1)[0].resolve(event);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local Worker WebSocket did not connect.')), 5_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Local Worker WebSocket connection failed.')); }, { once: true });
  });
  return {
    wait(type, predicate = () => true) {
      const existing = events.find((event) => event.type === type && predicate(event));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebSocket ${type}.`)), 5_000);
        const pending = waiters.get(type) || [];
        pending.push({ predicate, resolve: (event) => { clearTimeout(timer); resolve(event); } });
        waiters.set(type, pending);
      });
    },
  };
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (worker.exitCode !== null) throw new Error(`Wrangler exited with ${worker.exitCode}: ${safeLogs()}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* worker is still starting */ }
    await delay(200);
  }
  throw new Error(`Wrangler did not become ready: ${safeLogs()}`);
}

async function api(route, { token, admin, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers.authorization = `Bearer ${admin}`;
  const response = await fetch(new URL(route, baseUrl), {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  return { status: response.status, body: result };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port: chosenPort } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return chosenPort;
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function safeLogs() {
  return `${output.stdout}\n${output.stderr}`.replaceAll(sessionSecret, '[redacted]').replaceAll(adminSecret, '[redacted]').trim().slice(-1_200);
}

async function updateReport(checks, logs) {
  const report = await readFile(reportPath, 'utf8');
  const startMarker = '<!-- WORKER_TEST_REPORT_START -->';
  const endMarker = '<!-- WORKER_TEST_REPORT_END -->';
  const start = report.indexOf(startMarker);
  const end = report.indexOf(endMarker);
  if (start < 0 || end < start) throw new Error('Local Worker report markers are missing from tests.html.');
  const rows = checks.map(([name, result, status]) => `<tr><th scope="row">${escapeHtml(name)}</th><td>${escapeHtml(result)}</td><td>${escapeHtml(status)}</td></tr>`).join('\n');
  const safeLogText = `${logs.stdout}\n${logs.stderr}`.replaceAll(sessionSecret, '[redacted]').replaceAll(adminSecret, '[redacted]').trim();
  const generated = `\n      <p class="run-meta">${escapeHtml(new Date().toISOString())} UTC · Local Wrangler Worker</p>\n      <table class="route-table"><thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table>\n      <details><summary>Worker output</summary><pre>${escapeHtml(safeLogText || 'Worker completed without diagnostics.')}</pre></details>\n      `;
  await writeFile(reportPath, `${report.slice(0, start + startMarker.length)}${generated}${report.slice(end)}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
