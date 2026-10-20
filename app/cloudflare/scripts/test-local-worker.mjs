import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign as signJwt } from 'node:crypto';
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
const googleClientId = 'local-test-client.apps.googleusercontent.com';
const googleClientSecret = randomBytes(32).toString('base64url');
const googleCodes = new Map();
const googleKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const googleKeyId = randomBytes(8).toString('hex');
const googleJwk = { ...googleKeys.publicKey.export({ format: 'jwk' }), kid: googleKeyId, use: 'sig', alg: 'RS256' };
const jwksServer = createHttpServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
  response.end(JSON.stringify({ keys: [googleJwk] }));
});
const jwksPort = await listenServer(jwksServer);
const tokenServer = createHttpServer(async (request, response) => {
  let text = '';
  for await (const chunk of request) text += chunk.toString();
  const form = new URLSearchParams(text);
  const pending = googleCodes.get(form.get('code'));
  const valid = request.method === 'POST'
    && form.get('client_id') === googleClientId
    && form.get('client_secret') === googleClientSecret
    && form.get('grant_type') === 'authorization_code'
    && pending
    && !pending.used
    && form.get('code_verifier') === pending.codeVerifier
    && form.get('redirect_uri') === pending.redirectUri;
  if (!valid) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid_grant', error_description: 'The test authorization code or PKCE exchange is invalid.' }));
    return;
  }
  pending.used = true;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ id_token: pending.idToken }));
});
const tokenPort = await listenServer(tokenServer);
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
    '--var', `GOOGLE_CLIENT_ID:${googleClientId}`, '--var', `GOOGLE_CLIENT_SECRET:${googleClientSecret}`,
    '--var', `GOOGLE_JWKS_URL:http://127.0.0.1:${jwksPort}/certs`, '--var', `GOOGLE_TOKEN_URL:http://127.0.0.1:${tokenPort}/token`,
  ], { cwd: cloudflareRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  worker.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });

  await waitForWorker();
  const health = await api('/health');
  assert.equal(health.body.ok, true, 'local Worker serves health checks');

  const boot = await api('/v1/admin/bootstrap', { admin: adminSecret, body: { name: 'Maya' } });
  assert.equal(boot.status, 200, 'owner can initialize the workspace');
  const owner = boot.body.member;
  const legacyOwnerToken = makeLegacyToken(owner);
  assert.equal((await api('/v1/me', { token: legacyOwnerToken })).status, 401, 'legacy sessions cannot access chat data before Google linking');
  const badAudienceCompletion = await googleAuthorization('google-sub-maya', 'Maya', 'other-client.apps.googleusercontent.com');
  const badAudience = await api('/v1/auth/google/complete', { body: badAudienceCompletion });
  assert.equal(badAudience.status, 401, 'the Worker rejects an ID token minted for a different OAuth client');
  const ownerLogin = await googleLogin('google-sub-maya', 'Maya', legacyOwnerToken);
  assert.equal(ownerLogin.member.id, owner.id, 'a verified Google sign-in links the existing member only with its valid legacy session');
  const conflictCompletion = await googleAuthorization('google-sub-other', 'Maya');
  const conflictingLink = await api('/v1/auth/google/complete', { token: legacyOwnerToken, body: conflictCompletion });
  assert.equal(conflictingLink.status, 409, 'an existing account cannot be linked to a second Google identity');
  const ownerToken = ownerLogin.token;
  const unauthenticatedProjects = await api('/v1/rooms');
  assert.equal(unauthenticatedProjects.status, 401, 'unauthenticated requests cannot read chat data');
  assert.equal((await api('/v1/register', { body: { name: 'Nia' } })).status, 401, 'public name-only registration is disabled');
  assert.equal((await api('/v1/join', { body: { code: 'invite-code', name: 'Nia' } })).status, 401, 'invite codes cannot create unauthenticated accounts');
  const niaLogin = await googleLogin('google-sub-nia', 'Nia');
  assert.deepEqual((await api('/v1/rooms', { token: niaLogin.token })).body.rooms, [], 'a new Google account has no access to existing chats');
  assert.equal((await googleLogin('google-sub-nia', 'Nia')).member.id, niaLogin.member.id, 'signing in again returns the existing Google-linked account');
  const repeatedNonce = await googleAuthorization('google-sub-maya', 'Maya', googleClientId, ownerLogin.completion.challenge);
  const nonceReplay = await api('/v1/auth/google/complete', { body: repeatedNonce });
  assert.equal(nonceReplay.status, 409, 'a signed challenge nonce cannot be reused with a second Google authorization code');
  const codeReplay = await api('/v1/auth/google/complete', { body: ownerLogin.completion });
  assert.equal(codeReplay.status, 400, 'a consumed Google authorization code cannot be replayed');
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
  const joLogin = await googleLogin('google-sub-jo', 'Jo');
  const leeLogin = await googleLogin('google-sub-lee', 'Lee');
  const joJoin = await api('/v1/rooms/join', { token: joLogin.token, body: { code: inviteResult.body.invites[0].code } });
  const leeJoin = await api('/v1/rooms/join', { token: leeLogin.token, body: { code: inviteResult.body.invites[1].code } });
  assert.equal(joJoin.status, 200, 'Google-authenticated collaborator can join a chat');
  assert.equal(leeJoin.status, 200, 'another authenticated collaborator can join a chat');
  assert.equal((await api('/v1/rooms/join', { token: joLogin.token, body: { code: inviteResult.body.invites[0].code } })).status, 403, 'an invite cannot be used twice');
  const jo = { member: joLogin.member, token: joLogin.token };
  const lee = { member: leeLogin.member, token: leeLogin.token };

  const joRooms = await api('/v1/rooms', { token: jo.token });
  assert.deepEqual(joRooms.body.rooms.map((room) => room.id), [roomId], 'a code grants access to its chat');
  assert.equal(joRooms.body.rooms[0].createdBy, owner.id, 'room owner is the chat creator');
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
  assert.equal(members.body.members.find((member) => member.id === owner.id)?.role, 'owner', 'chat creator is marked owner');
  const joCreatedRoom = await api('/v1/rooms', { token: jo.token, body: { name: 'Jo room' } });
  const joCreatedInvite = await api(`/v1/rooms/${joCreatedRoom.body.id}/invites`, { token: jo.token, body: { count: 1 } });
  await api('/v1/rooms/join', { token: ownerToken, body: { code: joCreatedInvite.body.invites[0].code } });
  const joRoomMembers = await api(`/v1/rooms/${joCreatedRoom.body.id}/members`, { token: ownerToken });
  assert.equal(joRoomMembers.body.members.find((member) => member.id === jo.member.id)?.role, 'owner', 'member who created the chat owns it');
  assert.equal(joRoomMembers.body.members.find((member) => member.id === owner.id)?.role, 'member', 'workspace owner is not owner of someone else\'s chat');
  assert.equal((await api(`/v1/rooms/${joCreatedRoom.body.id}`, { token: ownerToken, method: 'PATCH', body: { name: 'Taken over' } })).status, 403, 'other chat members cannot rename it');
  assert.equal((await api(`/v1/rooms/${joCreatedRoom.body.id}`, { token: jo.token, method: 'PATCH', body: { name: '  New name  ' } })).body.name, 'New name', 'chat creator can rename it');
  assert.equal((await api('/v1/rooms', { token: ownerToken })).body.rooms.find((room) => room.id === joCreatedRoom.body.id)?.name, 'New name', 'renamed title reaches other members');
  assert.ok((await api(`/v1/rooms/${joCreatedRoom.body.id}/events?after=0`, { token: ownerToken })).body.events.some((event) => event.type === 'room.renamed' && event.name === 'New name'), 'rename reaches connected members as a room event');
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

  // Reproduce two owners declining cross-owner mentions, followed by an own-agent request.
  const queueRoom = await api('/v1/rooms', { token: ownerToken, body: { name: 'Permission queue regression' } });
  const queueId = queueRoom.body.id;
  const queueInvite = await api(`/v1/rooms/${queueId}/invites`, { token: ownerToken, body: { count: 1 } });
  await api('/v1/rooms/join', { token: jo.token, body: { code: queueInvite.body.invites[0].code } });
  const remoteJo = await api(`/v1/rooms/${queueId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: '@jo-codex hello', agentIds: ['jo-codex'] } });
  await api(`/v1/rooms/${queueId}/messages`, { token: jo.token, body: { clientId: randomUUID(), text: '@maya-codex hello', agentIds: ['maya-codex'] } });
  const ownRequest = await api(`/v1/rooms/${queueId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: '@maya-codex answer me', agentIds: ['maya-codex'] } });
  for (let retry = 0; retry < 2; retry++) {
    await api(`/v1/rooms/${queueId}/turns/claim`, { token: ownerToken, body: { agentIds: ['maya-codex'], allowRemote: false } });
  }
  const wakeEvents = (await api(`/v1/rooms/${queueId}/events?after=0`, { token: ownerToken })).body.events;
  assert.equal(wakeEvents.filter(event => event.type === 'turn.queued' && event.recheck === true && event.turnId === remoteJo.body.turnIds[0]).length, 1, 'retrying a blocked claim wakes an older desktop once without an event loop');
  await api(`/v1/rooms/${queueId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  const ownClaim = await api(`/v1/rooms/${queueId}/turns/claim`, { token: ownerToken, body: { agentIds: ['maya-codex'], allowRemote: false } });
  assert.equal(ownClaim.body.turn?.turnId, ownRequest.body.turnIds[0], 'disabled cross-owner mentions must not deadlock later own-agent requests');
  await api(`/v1/rooms/${queueId}/turns/${ownClaim.body.turn.turnId}/finish`, { token: ownerToken, body: { state: 'complete' } });
  const resumedRemote = await api(`/v1/rooms/${queueId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: true } });
  assert.equal(resumedRemote.body.turn?.turnId, remoteJo.body.turnIds[0], 'opting in restores the original pending mention');
  const simultaneous = await api(`/v1/rooms/${queueId}/turns/claim`, { token: ownerToken, body: { agentIds: ['maya-codex'], allowRemote: true } });
  assert.equal(simultaneous.status, 409, 'restoring mentions still permits only one active agent');
  const permissionEvents = (await api(`/v1/rooms/${queueId}/events?after=0`, { token: ownerToken })).body.events;
  assert.ok(permissionEvents.some(event => event.type === 'turn.availability'), 'permission changes wake connected owners to retry eligible turns');
  assert.ok(permissionEvents.some(event => event.type === 'turn.queued' && event.recheck === true), 'already installed desktops are also woken through their existing queue event handler');
  const finished = (await api(`/v1/rooms/${roomId}/events?after=0`, { token: jo.token })).body.events.find((event) => event.type === 'turn.finished' && event.turnId === firstTurn.body.turn.turnId);
  assert.equal(finished?.agentId, 'jo-codex', 'a finished turn includes the harness id');
  assert.equal(finished?.harness, 'codex', 'a finished turn includes the harness name');

  const promptRoom = await api('/v1/rooms', { token: ownerToken, body: { name: 'Mention prompt' } });
  const promptId = promptRoom.body.id;
  const promptInvite = await api(`/v1/rooms/${promptId}/invites`, { token: ownerToken, body: { count: 1 } });
  await api('/v1/rooms/join', { token: jo.token, body: { code: promptInvite.body.invites[0].code } });
  const firstPrompt = await api(`/v1/rooms/${promptId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: '@jo-codex first', agentIds: ['jo-codex'] } });
  const parked = await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal(parked.body.reason, 'remote_requests_disabled', 'the first mention from another person waits');
  const promptEvents = (await api(`/v1/rooms/${promptId}/events?after=0`, { token: jo.token })).body.events;
  assert.ok(promptEvents.some((event) => event.type === 'turn.permission_needed' && event.turnId === firstPrompt.body.turnIds[0] && event.agentId === 'jo-codex' && event.harness === 'codex'), 'the owner is asked once for that mention');
  assert.equal((await api(`/v1/rooms/${promptId}/turns/${firstPrompt.body.turnIds[0]}/permission`, { token: jo.token, body: { decision: 'once' } })).status, 200, 'allow once releases that mention');
  const allowedOnce = await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal(allowedOnce.body.turn?.turnId, firstPrompt.body.turnIds[0], 'allow once runs that mention without the global switch');
  await api(`/v1/rooms/${promptId}/turns/${allowedOnce.body.turn.turnId}/finish`, { token: jo.token, body: { state: 'complete' } });
  const secondPrompt = await api(`/v1/rooms/${promptId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: '@jo-codex second', agentIds: ['jo-codex'] } });
  await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal((await api(`/v1/rooms/${promptId}/turns/${secondPrompt.body.turnIds[0]}/permission`, { token: jo.token, body: { decision: 'decline' } })).status, 200, 'decline records the refusal');
  const ownAfterDecline = await api(`/v1/rooms/${promptId}/messages`, { token: jo.token, body: { clientId: randomUUID(), text: '@jo-codex mine', agentIds: ['jo-codex'] } });
  const ownAfter = await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal(ownAfter.body.turn?.turnId, ownAfterDecline.body.turnIds[0], 'a declined mention does not block a later own mention');
  await api(`/v1/rooms/${promptId}/turns/${ownAfter.body.turn.turnId}/finish`, { token: jo.token, body: { state: 'complete' } });
  await api(`/v1/rooms/${promptId}/messages`, { token: ownerToken, body: { clientId: randomUUID(), text: '@jo-codex third', agentIds: ['jo-codex'] } });
  const declinedClaim = await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal(declinedClaim.body.turn, null, 'a remembered decline does not run that person\'s later mention');
  await api('/v1/rooms/join', { token: lee.token, body: { code: (await api(`/v1/rooms/${promptId}/invites`, { token: ownerToken, body: { count: 1 } })).body.invites[0].code } });
  const fourthPrompt = await api(`/v1/rooms/${promptId}/messages`, { token: lee.token, body: { clientId: randomUUID(), text: '@jo-codex from lee', agentIds: ['jo-codex'] } });
  await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal((await api(`/v1/rooms/${promptId}/turns/${fourthPrompt.body.turnIds[0]}/permission`, { token: jo.token, body: { decision: 'always' } })).status, 200, 'allow always remembers this person and harness');
  const alwaysClaim = await api(`/v1/rooms/${promptId}/turns/claim`, { token: jo.token, body: { agentIds: ['jo-codex'], allowRemote: false } });
  assert.equal(alwaysClaim.body.turn?.turnId, fourthPrompt.body.turnIds[0], 'an allowed person can call the harness again without another prompt');

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

  const abandonedQuotaId = randomUUID();
  assert.equal((await api('/v1/chat-creations', { token: niaLogin.token, body: { requestId: abandonedQuotaId } })).status, 201, 'a native chat start reserves quota before launching the harness');
  const releaseQuota = await api('/v1/chat-creations/release', { token: niaLogin.token, body: { requestId: abandonedQuotaId } });
  assert.equal(releaseQuota.status, 200, 'a failed native start can release its reservation');
  assert.equal(releaseQuota.body.released, true, 'only the reservation created by this account is released');
  const firstQuotaId = randomUUID();
  const firstQuota = await api('/v1/chat-creations', { token: niaLogin.token, body: { requestId: firstQuotaId } });
  assert.equal(firstQuota.status, 201, 'an authenticated account can reserve its first new chat');
  assert.equal(firstQuota.body.used, 1, 'releasing a failed launch restores the quota count');
  const duplicateQuota = await api('/v1/chat-creations', { token: niaLogin.token, body: { requestId: firstQuotaId } });
  assert.equal(duplicateQuota.body.used, 1, 'retries of one chat reservation do not consume extra quota');
  const concurrentQuota = await Promise.all(Array.from({ length: 100 }, () => api('/v1/chat-creations', { token: niaLogin.token, body: { requestId: randomUUID() } })));
  assert.equal(concurrentQuota.filter((item) => item.status === 201).length, 99, 'concurrent requests cannot exceed 100 new chats for one account in a UTC day');
  assert.equal(concurrentQuota.filter((item) => item.status === 429).length, 1, 'the 101st concurrent new chat is rejected by the server');
  assert.equal((await api('/v1/rooms', { token: niaLogin.token, body: { name: 'Over quota' } })).status, 429, 'shared chat creation uses the same account-wide daily limit');
  assert.equal((await api('/v1/chat-creations', { token: ownerToken, body: { requestId: randomUUID() } })).status, 201, 'daily quota is scoped to the authenticated account');
  assert.equal((await api('/v1/logout', { token: niaLogin.token, body: {} })).status, 200, 'sign-out revokes the app session');
  assert.equal((await api('/v1/me', { token: niaLogin.token })).status, 401, 'revoked sessions cannot be reused');

  const checks = [
    ['Google sign-in', 'A Google authorization code is exchanged by the Worker with its server-side client secret; the verified ID token creates or reuses an account and an existing member links only with its valid legacy session.', 'Pass'],
    ['OAuth code replay protection', 'The local Google token endpoint rejects a second exchange of a consumed authorization code.', 'Pass'],
    ['OAuth token verification', 'Wrong audiences and conflicting account links are rejected after server-side code exchange; one-time OIDC nonces remain bound to their sign-in challenge.', 'Pass'],
    ['Opaque session lifecycle', 'The Worker stores a hash of the app session, denies old sessions, and revokes a session at sign-out.', 'Pass'],
    ['Authentication required', 'Name-only registration and invite-based account creation are disabled; chat data requires a verified account session.', 'Pass'],
    ['Daily chat limit', 'Concurrent local reservations and shared room creation stop at 100 per account per UTC day; request retries do not double count.', 'Pass'],
    ['Failed local chat start', 'A failed native launch releases only its own reservation so it does not consume the user’s daily limit.', 'Pass'],
    ['Chat invite access', 'Codes admit people to one chat; new chats stay private until invited.', 'Pass'],
    ['Chat ownership and rename', 'The chat creator is its owner, and only that person can rename the chat for every member.', 'Pass'],
    ['Solo and group agent routing', 'Solo chats call their owner agent automatically; group chats require a mention.', 'Pass'],
    ['Existing chat history', 'An imported Codex conversation is visible to invitees and retries do not duplicate messages.', 'Pass'],
    ['Permission queue regression', 'Disabled cross-owner requests do not block own-agent turns; opt-in restores pending mentions and preserves one active turn.', 'Pass'],
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
  await new Promise((resolve) => tokenServer.close(resolve));
  await new Promise((resolve) => jwksServer.close(resolve));
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

async function api(route, { token, admin, body, method } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers.authorization = `Bearer ${admin}`;
  const targetBody = route === '/v1/rooms' && body && typeof body === 'object' && !body.requestId
    ? { ...body, requestId: randomUUID() }
    : body;
  const response = await fetch(new URL(route, baseUrl), {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers,
    ...(targetBody === undefined ? {} : { body: JSON.stringify(targetBody) }),
  });
  const result = await response.json().catch(() => ({}));
  return { status: response.status, body: result };
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port: chosenPort } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return chosenPort;
}

async function listenServer(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function googleLogin(sub, name, legacyToken) {
  const completion = await googleAuthorization(sub, name);
  const result = await api('/v1/auth/google/complete', { token: legacyToken, body: completion });
  assert.equal(result.status, 200, `Google sign-in should complete for ${name}: ${JSON.stringify(result.body)}`);
  assert.equal('email' in result.body.member, false, 'the sign-in response does not expose an email address');
  return { ...result.body, completion };
}

async function googleAuthorization(sub, name, audience = googleClientId, challengeValue) {
  const challenge = challengeValue ? { challenge: challengeValue } : (await api('/v1/auth/google/challenge', { body: {} })).body;
  const claims = JSON.parse(Buffer.from(challenge.challenge.split('.')[0], 'base64url').toString('utf8'));
  const authorizationCode = randomUUID();
  const codeVerifier = randomBytes(32).toString('base64url');
  const redirectUri = 'http://127.0.0.1:49152';
  googleCodes.set(authorizationCode, {
    codeVerifier,
    redirectUri,
    idToken: makeGoogleToken(sub, name, claims.nonce, audience),
    used: false,
  });
  return { authorizationCode, codeVerifier, redirectUri, challenge: challenge.challenge };
}

function makeGoogleToken(sub, name, nonce, audience = googleClientId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', kid: googleKeyId, typ: 'JWT' });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = encode({
    iss: 'https://accounts.google.com', aud: audience, sub, name, email: `${sub}@example.test`,
    nonce, iat: nowSeconds, exp: nowSeconds + 300,
  });
  const content = `${header}.${claims}`;
  return `${content}.${signJwt('RSA-SHA256', Buffer.from(content), googleKeys.privateKey).toString('base64url')}`;
}

function makeLegacyToken(member) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: member.id, name: member.name, role: member.role, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 })}`;
  return `${content}.${createHmac('sha256', sessionSecret).update(content).digest('base64url')}`;
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function safeLogs() {
  return `${output.stdout}\n${output.stderr}`.replaceAll(sessionSecret, '[redacted]').replaceAll(adminSecret, '[redacted]').trim().slice(-1_200);
}

async function updateReport(checks, logs) {
  let report = await readFile(reportPath, 'utf8');
  const startMarker = '<!-- WORKER_TEST_REPORT_START -->';
  const endMarker = '<!-- WORKER_TEST_REPORT_END -->';
  if (!report.includes(startMarker) || !report.includes(endMarker)) {
    const mainClose = report.lastIndexOf('</main>');
    if (mainClose < 0) throw new Error('The Tests page is missing its main content area.');
    const section = `\n      <section><h2>Cloudflare Worker</h2>${startMarker}${endMarker}</section>\n      `;
    report = `${report.slice(0, mainClose)}${section}${report.slice(mainClose)}`;
  }
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
