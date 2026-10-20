import { HordeStore } from './hordes';
import { DurableObject } from 'cloudflare:workers';

interface Env {
  DIRECTORY: DurableObjectNamespace<WorkspaceDirectory>;
  ROOMS: DurableObjectNamespace<ChatRoom>;
  SESSION_SECRET: string;
  ADMIN_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_JWKS_URL?: string;
  APP_ORIGIN?: string;
}

interface Identity {
  id: string;
  name: string;
  role: 'owner' | 'member';
  exp?: number;
}

interface Agent {
  id: string;
  ownerId: string;
  name: string;
  harness: 'codex' | 'hermes';
  model: string;
}

type AgentRow = { id: string; ownerId: string; name: string; harness: string; model: string } & Record<string, string>;

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DAILY_CHAT_LIMIT = 100;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

    try {
      if (url.pathname === '/health' && request.method === 'GET') return response({ ok: true, service: 'surprised-face-rooms' }, 200, env);

      if (url.pathname === '/v1/auth/google/challenge' && request.method === 'POST') {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return response({ error: 'Google sign-in is not configured yet.' }, 503, env);
        const nonce = randomToken(32);
        const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
        const challenge = await signChallenge({ nonce, exp: expiresAt }, env.SESSION_SECRET);
        return response({ nonce, challenge }, 200, env);
      }

      if (url.pathname === '/v1/auth/google/complete' && request.method === 'POST') {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return response({ error: 'Google sign-in is not configured yet.' }, 503, env);
        const input = await readJson<{ authorizationCode?: string; codeVerifier?: string; redirectUri?: string; challenge?: string }>(request);
        const challenge = await verifyChallenge(input.challenge || '', env.SESSION_SECRET);
        const idToken = await exchangeGoogleAuthorizationCode(input, env);
        const googleIdentity = await verifyGoogleIdToken(idToken, challenge.nonce, env.GOOGLE_CLIENT_ID, env.GOOGLE_JWKS_URL);
        const legacyToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
        const legacyIdentity = legacyToken ? await verifyLegacySession(legacyToken, env.SESSION_SECRET) : null;
        const token = randomToken(32);
        const result = await directory(env).fetch('https://directory/auth/complete', {
          method: 'POST',
          body: JSON.stringify({
            googleSub: googleIdentity.sub,
            name: googleIdentity.name,
            nonceHash: await hashText(challenge.nonce),
            tokenHash: await hashText(token),
            legacyMemberId: legacyIdentity?.id,
            expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
          }),
        });
        const body = await result.json();
        return response(result.ok ? { member: body, token } : body, result.status, env);
      }

      if (url.pathname === '/v1/admin/bootstrap' && request.method === 'POST') {
        requireAdmin(request, env);
        const input = await readJson<{ name: string }>(request);
        const token = randomToken(32);
        const result = await directory(env).fetch('https://directory/bootstrap', {
          method: 'POST', body: JSON.stringify({ ...input, tokenHash: await hashText(token), expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString() }),
        });
        const member = await result.json<Omit<Identity, 'exp'>>();
        return response(result.ok ? { member, token } : member, result.status, env);
      }

      const protocolToken = request.headers.get('sec-websocket-protocol')?.split(',').map((value) => value.trim()).find((value) => value.startsWith('bearer.'))?.slice('bearer.'.length);
      const identity = await authenticate(request, env, protocolToken);
      if (!identity) return response({ error: 'Sign in with Google to continue.' }, 401, env);

      if (/^\/v1\/hordes(?:\/|$)/.test(url.pathname)) {
        const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? JSON.stringify(await readJson(request)) : undefined;
        const result = await directory(env).fetch(`https://directory${url.pathname.slice(3)}${url.search}`, { method: request.method, headers: { 'x-actor-id': identity.id, 'content-type': 'application/json' }, ...(body ? { body } : {}) });
        return response(await result.json(), result.status, env);
      }

      if (url.pathname === '/v1/me' && request.method === 'GET') return response(identity, 200, env);

      if (url.pathname === '/v1/logout' && request.method === 'POST') {
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || protocolToken || '';
        await directory(env).fetch(`https://directory/auth/session/${encodeURIComponent(await hashText(token))}`, { method: 'DELETE' });
        return response({ ok: true }, 200, env);
      }

      if (url.pathname === '/v1/chat-creations' && request.method === 'POST') {
        const input = await readJson<{ requestId?: string }>(request);
        const result = await directory(env).fetch('https://directory/chat-creations/reserve', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': identity.id },
          body: JSON.stringify({ requestId: input.requestId, day: new Date().toISOString().slice(0, 10) }),
        });
        return response(await result.json(), result.status, env);
      }

      if (url.pathname === '/v1/chat-creations/release' && request.method === 'POST') {
        const input = await readJson<{ requestId?: string }>(request);
        const result = await directory(env).fetch('https://directory/chat-creations/release', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': identity.id },
          body: JSON.stringify(input),
        });
        return response(await result.json(), result.status, env);
      }

      if (url.pathname === '/v1/members' && request.method === 'GET') {
        const result = await directory(env).fetch('https://directory/members-for-actor', { headers: { 'x-actor-id': identity.id } });
        return response(await result.json(), result.status, env);
      }
      if (url.pathname === '/v1/agents' && request.method === 'GET') {
        const result = await directory(env).fetch('https://directory/agents-for-actor', { headers: { 'x-actor-id': identity.id } });
        return response(await result.json(), result.status, env);
      }

      if (url.pathname === '/v1/rooms/join' && request.method === 'POST') {
        const input = await readJson<{ code: string }>(request);
        const result = await directory(env).fetch('https://directory/join-room', {
          method: 'POST', headers: { 'x-actor-id': identity.id }, body: JSON.stringify(input),
        });
        const body = await result.json<{ roomId?: string }>();
        if (result.ok && body.roomId) {
          await env.ROOMS.get(env.ROOMS.idFromName(body.roomId)).fetch('https://room/member-joined', {
            method: 'POST', body: JSON.stringify({ participantId: identity.id, participantName: identity.name }),
          });
        }
        return response(body, result.status, env);
      }

      if (url.pathname === '/v1/rooms' && request.method === 'GET') {
        const result = await directory(env).fetch(`https://directory/rooms?member=${encodeURIComponent(identity.id)}`);
        return response(await result.json(), result.status, env);
      }

      if (url.pathname === '/v1/rooms' && request.method === 'POST') {
        const input = await readJson<{ name: string; defaultAgentId?: string; requestId?: string }>(request);
        const result = await directory(env).fetch('https://directory/rooms', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': identity.id },
          body: JSON.stringify({ ...input, day: new Date().toISOString().slice(0, 10) }),
        });
        return response(await result.json(), result.status, env);
      }

      if (url.pathname === '/v1/agents' && request.method === 'POST') {
        const input = await readJson<Omit<Agent, 'ownerId'>>(request);
        const result = await directory(env).fetch('https://directory/agents', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': identity.id }, body: JSON.stringify(input),
        });
        const body = await result.json();
        if (result.ok) {
          const roomResult = await directory(env).fetch(`https://directory/rooms?member=${encodeURIComponent(identity.id)}`);
          const roomData = await roomResult.json<{ rooms: { id: string }[] }>();
          for (const room of roomData.rooms || []) {
            await env.ROOMS.get(env.ROOMS.idFromName(room.id)).fetch('https://room/agent-updated', {
              method: 'POST', body: JSON.stringify({ agentId: input.id, ownerId: identity.id }),
            });
          }
        }
        return response(body, result.status, env);
      }

      const roomMatch = /^\/v1\/rooms\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/.exec(url.pathname);
      if (roomMatch) {
        const roomId = roomMatch[1]!;
        const operation = roomMatch[2] || '';
        const roomAuth = await directory(env).fetch(`https://directory/room-access?member=${encodeURIComponent(identity.id)}&room=${encodeURIComponent(roomId)}`);
        if (!roomAuth.ok) return response({ error: 'You do not have access to this chat.' }, 403, env);
        const access = await roomAuth.json<{ creator: boolean; memberCount: number; autoAgentId: string | null }>();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        const headers = new Headers(request.headers);
        headers.set('x-surprised-face-actor', identity.id);
        if (operation === 'connect' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          return stub.fetch(new Request(`https://room/${roomId}/connect${url.search}`, { headers }));
        }
        if (operation === 'members' && request.method === 'GET') {
          const result = await directory(env).fetch(`https://directory/room-members?room=${encodeURIComponent(roomId)}`);
          return response(await result.json(), result.status, env);
        }
        if (!operation && request.method === 'PATCH') {
          if (!access.creator) return response({ error: 'Only the chat owner can rename it.' }, 403, env);
          const input = await readJson<{ name: string }>(request);
          const result = await directory(env).fetch(`https://directory/rooms/${encodeURIComponent(roomId)}`, {
            method: 'PATCH', headers: { 'content-type': 'application/json', 'x-actor-id': identity.id }, body: JSON.stringify(input),
          });
          const body = await result.json<{ id?: string; name?: string }>();
          if (result.ok) await stub.fetch(`https://room/${roomId}/renamed`, { method: 'POST', body: JSON.stringify({ name: body.name }) });
          return response(body, result.status, env);
        }
        if (operation === 'agents' && request.method === 'GET') {
          const result = await directory(env).fetch(`https://directory/room-agents?room=${encodeURIComponent(roomId)}`);
          return response(await result.json(), result.status, env);
        }
        if (operation === 'invites' && request.method === 'POST') {
          const input = await readJson<{ count?: number }>(request);
          const result = await directory(env).fetch('https://directory/invites', { method: 'POST', body: JSON.stringify({ ...input, roomId }) });
          return response(await result.json(), result.status, env);
        }
        if (operation === 'import' && request.method === 'POST') {
          if (!access.creator || access.memberCount !== 1) return response({ error: 'Import is limited to a private chat created by you.' }, 403, env);
          const input = await readJson<{ sourceId: string; agentId: string; entries: unknown[] }>(request);
          const agentResponse = await directory(env).fetch(`https://directory/agents/${encodeURIComponent(input.agentId || '')}`);
          if (!agentResponse.ok) return response({ error: 'Agent not found.' }, 404, env);
          const agent = await agentResponse.json<Agent>();
          if (agent.ownerId !== identity.id) return response({ error: 'You can only import your agent history.' }, 403, env);
          headers.set('content-type', 'application/json');
          headers.set('x-surprised-face-actor-name', identity.name);
          return stub.fetch(new Request(`https://room/${roomId}/import`, { method: 'POST', headers, body: JSON.stringify({ ...input, agent }) }));
        }
        if (operation === 'messages' && request.method === 'POST') {
          const input = await readJson<{ clientId: string; text: string; agentIds?: string[]; agentId?: string }>(request);
          const requestedIds = [...(input.agentIds || []), ...(input.agentId ? [input.agentId] : [])];
          const agentIds = [...new Set(requestedIds.length ? requestedIds : access.memberCount === 1 && access.autoAgentId ? [access.autoAgentId] : [])].slice(0, 8);
          const agents: Agent[] = [];
          for (const id of agentIds) {
            const agentResponse = await directory(env).fetch(`https://directory/agents/${encodeURIComponent(id)}`);
            if (!agentResponse.ok) return response({ error: `Agent ${id} is unavailable.` }, 404, env);
            const agent = await agentResponse.json<Agent>();
            const agentAccess = await directory(env).fetch(`https://directory/room-access?member=${encodeURIComponent(agent.ownerId)}&room=${encodeURIComponent(roomId)}`);
            if (!agentAccess.ok) return response({ error: `Agent ${id} is not in this chat.` }, 403, env);
            agents.push(agent);
          }
          headers.set('content-type', 'application/json');
          headers.set('x-surprised-face-actor-name', identity.name);
          return stub.fetch(new Request(`https://room/${roomId}/messages`, { method: 'POST', headers, body: JSON.stringify({ ...input, agents }) }));
        }
        if (operation === 'turns/claim' || /^turns\/[^/]+\/(?:chunk|finish|permission)$/.test(operation)) {
          return stub.fetch(new Request(`https://room/${roomId}/${operation}`, { method: request.method, headers, body: request.method === 'GET' ? null : request.body }));
        }
        if (operation === 'events' && request.method === 'GET') return stub.fetch(new Request(`https://room/${roomId}/events${url.search}`, { headers }));
      }

      return response({ error: 'Not found.' }, 404, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const body = { error: error instanceof Error ? error.message : 'Request failed.', ...(error instanceof HttpError ? error.details : {}) };
      return response(body, status, env);
    }
  },
};

export class WorkspaceDirectory extends DurableObject<Env> {
  private hordes: HordeStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS used_oidc_nonces (nonce_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_creations (member_id TEXT NOT NULL, request_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, room_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY(member_id, request_id));
      CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, room_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT);
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, default_agent_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_members (room_id TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY(room_id, member_id));
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    this.hordes = new HordeStore(ctx.storage.sql);
    const inviteColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(invites)').toArray();
    if (!inviteColumns.some((column) => column.name === 'room_id')) ctx.storage.sql.exec('ALTER TABLE invites ADD COLUMN room_id TEXT');
    const roomColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(rooms)').toArray();
    if (!roomColumns.some((column) => column.name === 'default_agent_id')) ctx.storage.sql.exec('ALTER TABLE rooms ADD COLUMN default_agent_id TEXT');
    const memberColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(members)').toArray();
    if (!memberColumns.some((column) => column.name === 'google_sub')) ctx.storage.sql.exec('ALTER TABLE members ADD COLUMN google_sub TEXT');
    ctx.storage.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS members_google_sub ON members(google_sub) WHERE google_sub IS NOT NULL');
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (/^\/hordes(?:\/|$)/.test(url.pathname)) return this.hordes.fetch(request);
    if (request.method === 'POST' && url.pathname === '/bootstrap') return this.bootstrap(await readJson(request));
    if (request.method === 'POST' && url.pathname === '/auth/complete') return this.completeGoogleAuth(await readJson(request));
    if (request.method === 'GET' && url.pathname === '/auth/session') return this.getSession(url.searchParams.get('hash') || '');
    if (request.method === 'DELETE' && url.pathname.startsWith('/auth/session/')) return this.deleteSession(decodeURIComponent(url.pathname.slice('/auth/session/'.length)));
    if (request.method === 'POST' && url.pathname === '/chat-creations/reserve') return this.reserveChatCreation(request, await readJson(request));
    if (request.method === 'POST' && url.pathname === '/chat-creations/release') return this.releaseChatCreation(request, await readJson(request));
    if (request.method === 'POST' && url.pathname === '/invites') return this.createInvites(await readJson(request));
    if (request.method === 'POST' && url.pathname === '/join-room') return this.joinRoom(request, await readJson(request));
    if (request.method === 'GET' && url.pathname === '/rooms') return this.rooms(url.searchParams.get('member') || '');
    if (request.method === 'GET' && url.pathname === '/room-access') return this.roomAccess(url.searchParams);
    if (request.method === 'GET' && url.pathname === '/room-members') return this.roomMembers(url.searchParams.get('room') || '');
    if (request.method === 'GET' && url.pathname === '/room-agents') return this.roomAgents(url.searchParams.get('room') || '');
    if (request.method === 'GET' && url.pathname === '/members-for-actor') return this.membersForActor(request.headers.get('x-actor-id') || '');
    if (request.method === 'GET' && url.pathname === '/agents-for-actor') return this.agentsForActor(request.headers.get('x-actor-id') || '');
    if (request.method === 'POST' && url.pathname === '/rooms') return this.createRoom(request, await readJson(request));
    if (request.method === 'PATCH' && url.pathname.startsWith('/rooms/')) return this.renameRoom(request, url.pathname.slice('/rooms/'.length), await readJson(request));
    if (request.method === 'POST' && url.pathname === '/agents') return this.registerAgent(request, await readJson(request));
    if (request.method === 'GET' && url.pathname.startsWith('/agents/')) return this.getAgent(decodeURIComponent(url.pathname.slice('/agents/'.length)));
    return json({ error: 'Not found.' }, 404);
  }

  private bootstrap(input: { name?: string; tokenHash?: string; expiresAt?: string }): Response {
    const name = cleanName(input.name);
    if (this.sql().exec('SELECT id FROM members LIMIT 1').toArray().length) return json({ error: 'The workspace is already initialized.' }, 409);
    const id = crypto.randomUUID();
    const timestamp = now();
    this.ctx.storage.transactionSync(() => {
      this.sql().exec('INSERT INTO members (id, name, role, created_at) VALUES (?, ?, ?, ?)', id, name, 'owner', timestamp);
      this.makeRoom(id, 'general');
      if (input.tokenHash && input.expiresAt) this.sql().exec('INSERT INTO auth_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)', input.tokenHash, id, timestamp, input.expiresAt);
    });
    return json({ id, name, role: 'owner' });
  }

  private completeGoogleAuth(input: { googleSub?: string; name?: string; nonceHash?: string; tokenHash?: string; legacyMemberId?: string; expiresAt?: string }): Response {
    const googleSub = typeof input.googleSub === 'string' ? input.googleSub : '';
    const nonceHash = typeof input.nonceHash === 'string' ? input.nonceHash : '';
    const tokenHash = typeof input.tokenHash === 'string' ? input.tokenHash : '';
    const expiresAt = typeof input.expiresAt === 'string' ? input.expiresAt : '';
    if (!googleSub || googleSub.length > 255 || !nonceHash || !tokenHash || !expiresAt) return json({ error: 'Google sign-in could not be completed.' }, 400);
    const name = cleanName(input.name);
    const result = this.ctx.storage.transactionSync(() => {
      if (this.sql().exec('SELECT nonce_hash FROM used_oidc_nonces WHERE nonce_hash=?', nonceHash).toArray().length)
        return { status: 409, body: { error: 'This Google sign-in has already been used. Please try again.' } };

      let member = input.legacyMemberId
        ? this.sql().exec<{ id: string; name: string; role: 'owner' | 'member'; google_sub: string | null }>('SELECT id, name, role, google_sub FROM members WHERE id=?', input.legacyMemberId).toArray()[0]
        : undefined;
      const linked = this.sql().exec<{ id: string }>('SELECT id FROM members WHERE google_sub=?', googleSub).toArray()[0];
      if (member && linked && linked.id !== member.id)
        return { status: 409, body: { error: 'This Google account is already linked to another app account.' } };
      if (member?.google_sub && member.google_sub !== googleSub)
        return { status: 409, body: { error: 'This app account is already linked to a different Google account.' } };
      if (!member && linked)
        member = this.sql().exec<{ id: string; name: string; role: 'owner' | 'member'; google_sub: string | null }>('SELECT id, name, role, google_sub FROM members WHERE id=?', linked.id).toArray()[0];
      if (!member) {
        const id = crypto.randomUUID();
        this.sql().exec('INSERT INTO members (id, name, role, created_at, google_sub) VALUES (?, ?, ?, ?, ?)', id, name, 'member', now(), googleSub);
        member = { id, name, role: 'member', google_sub: googleSub };
      } else if (!member.google_sub) {
        this.sql().exec('UPDATE members SET google_sub=?, name=? WHERE id=?', googleSub, name, member.id);
        member.name = name;
        member.google_sub = googleSub;
      }

      const timestamp = now();
      this.sql().exec('DELETE FROM used_oidc_nonces WHERE created_at < ?', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      this.sql().exec('INSERT INTO used_oidc_nonces (nonce_hash, created_at) VALUES (?, ?)', nonceHash, timestamp);
      this.sql().exec('INSERT INTO auth_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)', tokenHash, member.id, timestamp, expiresAt);
      return { status: 200, body: { id: member.id, name: member.name, role: member.role } };
    });
    return json(result.body, result.status);
  }

  private getSession(hash: string): Response {
    const row = this.sql().exec<{ id: string; name: string; role: 'owner' | 'member'; expires_at: string }>(
      'SELECT m.id, m.name, m.role, s.expires_at FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?', hash, now(),
    ).toArray()[0];
    return row ? json({ id: row.id, name: row.name, role: row.role, exp: Math.floor(Date.parse(row.expires_at) / 1000) }) : json({ error: 'Session expired.' }, 401);
  }

  private deleteSession(hash: string): Response {
    this.sql().exec('DELETE FROM auth_sessions WHERE token_hash=?', hash);
    return json({ ok: true });
  }

  private reserveChatCreation(request: Request, input: { requestId?: string; day?: string }): Response {
    const memberId = request.headers.get('x-actor-id') || '';
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    const day = typeof input.day === 'string' ? input.day : '';
    if (!memberId || !/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Could not record the new chat.' }, 400);
    const result = this.ctx.storage.transactionSync(() => this.recordChatCreation(memberId, requestId, day, 'local', null));
    return json(result.body, result.status);
  }

  private releaseChatCreation(request: Request, input: { requestId?: string }): Response {
    const memberId = request.headers.get('x-actor-id') || '';
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    if (!memberId || !/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: 'Could not release the new chat reservation.' }, 400);
    const released = this.sql().exec(
      "DELETE FROM chat_creations WHERE member_id=? AND request_id=? AND kind='local' RETURNING request_id",
      memberId, requestId,
    ).toArray().length > 0;
    return json({ released });
  }

  private async createInvites(input: { roomId?: string; count?: number }): Promise<Response> {
    const roomId = typeof input.roomId === 'string' ? input.roomId : '';
    if (!this.sql().exec('SELECT id FROM rooms WHERE id=?', roomId).toArray().length) return json({ error: 'Chat not found.' }, 404);
    const count = Math.max(1, Math.min(3, Number.isInteger(input.count) ? Number(input.count) : 1));
    const created: { code: string; expiresAt: string }[] = [];
    for (let i = 0; i < count; i++) {
      const code = randomToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      this.sql().exec('INSERT INTO invites (code_hash, room_id, created_at, expires_at) VALUES (?, ?, ?, ?)', await hashText(code), roomId, now(), expiresAt);
      created.push({ code, expiresAt });
    }
    return json({ invites: created });
  }

  private async join(input: { code?: string; name?: string }): Promise<Response> {
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const name = cleanName(input.name);
    const timestamp = now();
    const invite = this.sql().exec<{ room_id: string }>(
      'UPDATE invites SET claimed_at = ? WHERE code_hash = ? AND room_id IS NOT NULL AND claimed_at IS NULL AND expires_at >= ? RETURNING room_id',
      timestamp, await hashText(code), timestamp,
    ).toArray()[0];
    if (!invite) return json({ error: 'This invite is invalid, expired, or already used.' }, 403);
    const id = crypto.randomUUID();
    this.sql().exec('INSERT INTO members (id, name, role, created_at) VALUES (?, ?, ?, ?)', id, name, 'member', timestamp);
    this.sql().exec('INSERT INTO room_members (room_id, member_id) VALUES (?, ?)', invite.room_id, id);
    return json({ id, name, role: 'member', roomId: invite.room_id });
  }

  private async joinRoom(request: Request, input: { code?: string }): Promise<Response> {
    const actor = request.headers.get('x-actor-id') || '';
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const timestamp = now();
    const invite = this.sql().exec<{ room_id: string }>(
      'UPDATE invites SET claimed_at=? WHERE code_hash=? AND room_id IS NOT NULL AND claimed_at IS NULL AND expires_at>=? AND room_id NOT IN (SELECT room_id FROM room_members WHERE member_id=?) RETURNING room_id',
      timestamp, await hashText(code), timestamp, actor,
    ).toArray()[0];
    if (!invite) return json({ error: 'This chat invite is invalid, expired, already used, or you already joined.' }, 403);
    this.sql().exec('INSERT INTO room_members (room_id, member_id) VALUES (?, ?)', invite.room_id, actor);
    return json({ roomId: invite.room_id });
  }

  private rooms(memberId: string): Response {
    const rows = this.sql().exec<{ id: string; name: string; createdBy: string; createdAt: string; defaultAgentId: string | null }>(
      'SELECT r.id, r.name, r.created_by AS createdBy, r.created_at AS createdAt, r.default_agent_id AS defaultAgentId FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.member_id=? ORDER BY r.created_at', memberId,
    ).toArray();
    return json({ rooms: rows });
  }

  private roomMembers(roomId: string): Response {
    const members = this.sql().exec<{ id: string; name: string; role: string }>(
      "SELECT p.id, p.name, CASE WHEN p.id=r.created_by THEN 'owner' ELSE 'member' END AS role FROM members p JOIN room_members m ON m.member_id=p.id JOIN rooms r ON r.id=m.room_id WHERE m.room_id=? ORDER BY p.created_at", roomId,
    ).toArray();
    return json({ members });
  }

  private renameRoom(request: Request, roomId: string, input: { name?: string }): Response {
    const actor = request.headers.get('x-actor-id') || '';
    const name = cleanRoomName(input.name);
    const changed = this.sql().exec<{ id: string; name: string; created_by: string; created_at: string }>(
      'UPDATE rooms SET name=? WHERE id=? AND created_by=? RETURNING id,name,created_by,created_at', name, roomId, actor,
    ).toArray()[0];
    return changed ? json({ id: changed.id, name: changed.name, createdBy: changed.created_by, createdAt: changed.created_at }) : json({ error: 'Only the chat owner can rename it.' }, 403);
  }

  private roomAgents(roomId: string): Response {
    const agents = this.sql().exec<AgentRow>(
      'SELECT a.id, a.owner_id AS ownerId, a.name, a.harness, a.model FROM agents a JOIN room_members m ON m.member_id=a.owner_id WHERE m.room_id=? ORDER BY a.name', roomId,
    ).toArray();
    return json({ agents });
  }

  private membersForActor(actor: string): Response {
    const members = this.sql().exec<{ id: string; name: string; role: string }>(
      'SELECT DISTINCT p.id, p.name, p.role FROM room_members mine JOIN room_members peers ON peers.room_id=mine.room_id JOIN members p ON p.id=peers.member_id WHERE mine.member_id=? ORDER BY p.name', actor,
    ).toArray();
    return json({ members });
  }

  private agentsForActor(actor: string): Response {
    const agents = this.sql().exec<AgentRow>(
      'SELECT DISTINCT a.id, a.owner_id AS ownerId, a.name, a.harness, a.model FROM room_members mine JOIN room_members peers ON peers.room_id=mine.room_id JOIN agents a ON a.owner_id=peers.member_id WHERE mine.member_id=? ORDER BY a.name', actor,
    ).toArray();
    return json({ agents });
  }

  private roomAccess(params: URLSearchParams): Response {
    const row = this.sql().exec<{ id: string; created_by: string; default_agent_id: string | null }>(
      'SELECT r.id, r.created_by, r.default_agent_id FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE r.id=? AND m.member_id=?', params.get('room') || '', params.get('member') || '',
    ).toArray()[0];
    if (!row) return json({ error: 'Not a member.' }, 403);
    const memberCount = this.sql().exec<{ count: number }>('SELECT COUNT(*) AS count FROM room_members WHERE room_id=?', row.id).toArray()[0]?.count || 0;
    let autoAgentId = row.default_agent_id;
    if (!autoAgentId && memberCount === 1) {
      const ownAgents = this.sql().exec<{ id: string }>('SELECT id FROM agents WHERE owner_id=?', params.get('member') || '').toArray();
      if (ownAgents.length === 1) autoAgentId = ownAgents[0]!.id;
    }
    return json({ allowed: true, creator: row.created_by === params.get('member'), memberCount, autoAgentId });
  }

  private createRoom(request: Request, input: { name?: string; defaultAgentId?: string; requestId?: string; day?: string }): Response {
    const actor = request.headers.get('x-actor-id') || '';
    const member = this.sql().exec<{ id: string }>('SELECT id FROM members WHERE id=?', actor).toArray()[0];
    if (!member) return json({ error: 'Unknown member.' }, 403);
    const agentId = typeof input.defaultAgentId === 'string' ? input.defaultAgentId : '';
    if (agentId && !this.sql().exec('SELECT id FROM agents WHERE id=? AND owner_id=?', agentId, actor).toArray().length)
      return json({ error: 'Choose an agent you own for this chat.' }, 403);
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    const day = typeof input.day === 'string' ? input.day : '';
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Could not record the new chat.' }, 400);
    const name = cleanRoomName(input.name);
    const result = this.ctx.storage.transactionSync(() => {
      const existing = this.sql().exec<{ room_id: string | null }>('SELECT room_id FROM chat_creations WHERE member_id=? AND request_id=?', actor, requestId).toArray()[0];
      if (existing?.room_id) {
        const room = this.sql().exec<{ id: string; name: string; createdBy: string; createdAt: string; defaultAgentId: string | null }>('SELECT id, name, created_by AS createdBy, created_at AS createdAt, default_agent_id AS defaultAgentId FROM rooms WHERE id=?', existing.room_id).toArray()[0];
        if (room) return { status: 200, body: room };
      }
      const quota = this.recordChatCreation(actor, requestId, day, 'shared', null);
      if (quota.status !== 201) return quota;
      const room = this.makeRoom(actor, name, agentId);
      this.sql().exec('UPDATE chat_creations SET room_id=? WHERE member_id=? AND request_id=?', room.id, actor, requestId);
      return { status: 201, body: room };
    });
    return json(result.body, result.status);
  }

  private recordChatCreation(memberId: string, requestId: string, day: string, kind: 'local' | 'shared', roomId: string | null): { status: number; body: Record<string, unknown> } {
    const existing = this.sql().exec<{ day: string }>('SELECT day FROM chat_creations WHERE member_id=? AND request_id=?', memberId, requestId).toArray()[0];
    if (existing) {
      const used = this.sql().exec<{ count: number }>('SELECT COUNT(*) AS count FROM chat_creations WHERE member_id=? AND day=?', memberId, existing.day).toArray()[0]?.count || 0;
      return { status: 200, body: { limit: DAILY_CHAT_LIMIT, used, remaining: Math.max(0, DAILY_CHAT_LIMIT - used) } };
    }
    const used = this.sql().exec<{ count: number }>('SELECT COUNT(*) AS count FROM chat_creations WHERE member_id=? AND day=?', memberId, day).toArray()[0]?.count || 0;
    if (used >= DAILY_CHAT_LIMIT)
      return { status: 429, body: { error: 'You have reached the limit of 100 new chats today. Try again after midnight UTC.', limit: DAILY_CHAT_LIMIT, used, remaining: 0 } };
    this.sql().exec('INSERT INTO chat_creations (member_id, request_id, day, kind, room_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', memberId, requestId, day, kind, roomId, now());
    return { status: 201, body: { limit: DAILY_CHAT_LIMIT, used: used + 1, remaining: DAILY_CHAT_LIMIT - used - 1 } };
  }

  private registerAgent(request: Request, input: Omit<Agent, 'ownerId'>): Response {
    const ownerId = request.headers.get('x-actor-id') || '';
    const name = cleanName(input.name);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/i.test(input.id || '')) return json({ error: 'Agent ID must be 2 to 40 letters, digits, or hyphens.' }, 400);
    if (!['codex', 'hermes'].includes(input.harness)) return json({ error: 'MVP harness must be Codex or Hermes.' }, 400);
    const existing = this.sql().exec<{ owner_id: string }>('SELECT owner_id FROM agents WHERE id=?', input.id).toArray()[0];
    if (existing && existing.owner_id !== ownerId) return json({ error: 'That agent ID is already owned by another member.' }, 409);
    this.sql().exec(
      'INSERT INTO agents (id, owner_id, name, harness, model, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, name=excluded.name, harness=excluded.harness, model=excluded.model, updated_at=excluded.updated_at',
      input.id, ownerId, name, input.harness, String(input.model || '').slice(0, 160), now(),
    );
    return this.getAgent(input.id);
  }

  private getAgent(id: string): Response {
    const agent = this.sql().exec<AgentRow>('SELECT id, owner_id AS ownerId, name, harness, model FROM agents WHERE id=?', id).toArray()[0];
    return agent ? json(agent) : json({ error: 'Agent not found.' }, 404);
  }

  private makeRoom(createdBy: string, name: string, defaultAgentId = '') {
    const room = { id: crypto.randomUUID(), name, createdBy, defaultAgentId, createdAt: now() };
    this.sql().exec('INSERT INTO rooms (id, name, created_by, default_agent_id, created_at) VALUES (?, ?, ?, ?, ?)', room.id, room.name, createdBy, defaultAgentId || null, room.createdAt);
    this.sql().exec('INSERT INTO room_members (room_id, member_id) VALUES (?, ?)', room.id, createdBy);
    return room;
  }

  private sql() { return this.ctx.storage.sql; }
}

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (event_seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (message_seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, agent_id TEXT, owner_id TEXT, run_id TEXT, client_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(actor_id, client_id));
      CREATE TABLE IF NOT EXISTS turns (queue_seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_message_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, owner_id TEXT NOT NULL, requested_by TEXT NOT NULL, state TEXT NOT NULL, reply_id TEXT, context_through_seq INTEGER, next_chunk INTEGER NOT NULL DEFAULT 0, permitted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_chunks (turn_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(turn_id, chunk_index));
      CREATE TABLE IF NOT EXISTS imported_messages (source_id TEXT NOT NULL, source_index INTEGER NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(source_id, source_index));
      CREATE TABLE IF NOT EXISTS mention_grants (owner_id TEXT NOT NULL, requester_id TEXT NOT NULL, harness TEXT NOT NULL, decision TEXT NOT NULL, PRIMARY KEY(owner_id, requester_id, harness));
      CREATE INDEX IF NOT EXISTS turns_queue ON turns(state, created_at);
    `);
    const messageColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(messages)').toArray();
    if (!messageColumns.some((column) => column.name === 'actor_name')) {
      ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN actor_name TEXT NOT NULL DEFAULT ''");
    }
    const turnColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(turns)').toArray();
    if (!turnColumns.some((column) => column.name === 'permitted')) {
      ctx.storage.sql.exec('ALTER TABLE turns ADD COLUMN permitted INTEGER NOT NULL DEFAULT 0');
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const actor = request.headers.get('x-surprised-face-actor') || '';
    if (url.pathname.endsWith('/connect') && request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.acceptConnection(request, actor);
    if (url.pathname.endsWith('/events') && request.method === 'GET') return this.events(url.searchParams.get('after'));
    if (url.pathname.endsWith('/messages') && request.method === 'POST') {
      return this.createMessage(actor, request.headers.get('x-surprised-face-actor-name') || '', await readJson(request));
    }
    if (url.pathname.endsWith('/import') && request.method === 'POST') {
      return this.importMessages(actor, request.headers.get('x-surprised-face-actor-name') || '', await readJson(request));
    }
    if (url.pathname.endsWith('/member-joined') && request.method === 'POST') {
      const input = await readJson<{ participantId: string; participantName: string }>(request);
      return json({ eventSeq: this.appendEvent('member.joined', input).eventSeq });
    }
    if (url.pathname.endsWith('/agent-updated') && request.method === 'POST') {
      const input = await readJson<{ agentId: string; ownerId: string }>(request);
      return json({ eventSeq: this.appendEvent('agent.updated', input).eventSeq });
    }
    if (url.pathname.endsWith('/renamed') && request.method === 'POST') {
      const input = await readJson<{ name: string }>(request);
      return json({ eventSeq: this.appendEvent('room.renamed', { name: input.name }).eventSeq });
    }
    if (url.pathname.endsWith('/claim') && request.method === 'POST') return this.claimTurn(actor, await readJson(request));
    const match = /\/turns\/([^/]+)\/(chunk|finish|permission)$/.exec(url.pathname);
    if (match && request.method === 'POST') {
      const turnId = match[1]!;
      const action = match[2]!;
      const body = await readJson(request);
      if (action === 'chunk') return this.appendChunk(actor, turnId, body);
      if (action === 'permission') return this.decideMention(actor, turnId, body);
      return this.finishTurn(actor, turnId, body);
    }
    return json({ error: 'Not found.' }, 404);
  }

  private acceptConnection(request: Request, actor: string): Response {
    if (!actor) return json({ error: 'Missing chat identity.' }, 401);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [actor]);
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'sec-websocket-protocol': 'sf.v1' } });
  }

  override webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer): void {}

  private events(after: string | null): Response {
    const cursor = Math.max(0, Number(after) || 0);
    const records = this.ctx.storage.sql.exec<{ event_seq: number; type: string; data: string; created_at: string }>(
      'SELECT event_seq, type, data, created_at FROM events WHERE event_seq>? ORDER BY event_seq LIMIT 500', cursor,
    ).toArray().map((row) => ({ eventSeq: row.event_seq, type: row.type, ...parseObject(row.data), createdAt: row.created_at }));
    const latest = this.ctx.storage.sql.exec<{ event_seq: number }>('SELECT COALESCE(MAX(event_seq),0) AS event_seq FROM events').toArray()[0]?.event_seq || 0;
    const next = records.at(-1)?.eventSeq ?? cursor;
    return json({ events: records, cursor: next, hasMore: next < latest });
  }

  private createMessage(actor: string, actorName: string, input: { clientId?: string; text?: string; agents?: Agent[] }): Response {
    const clientId = typeof input.clientId === 'string' ? input.clientId : '';
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!actor || !clientId || !text || text.length > 32_000) return json({ error: 'Message or client ID is invalid.' }, 400);
    const sql = this.ctx.storage.sql;
    const existing = sql.exec<{ id: string; message_seq: number }>(
      'SELECT id, message_seq FROM messages WHERE actor_id=? AND client_id=?', actor, clientId,
    ).toArray()[0];
    if (existing) return json({ messageId: existing.id, messageSeq: existing.message_seq, duplicate: true });

    const messageId = crypto.randomUUID();
    const timestamp = now();
    const insert = sql.exec<{ message_seq: number }>(
      'INSERT INTO messages (id, actor_id, actor_name, role, text, state, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING message_seq',
      messageId, actor, actorName, 'user', text, 'complete', clientId, timestamp, timestamp,
    ).toArray()[0];
    if (!insert) throw new Error('Message insert did not return its sequence.');
    this.appendEvent('message.created', { messageId, messageSeq: insert.message_seq, participantId: actor, participantName: actorName, role: 'user', text, createdAt: timestamp });
    const turnIds: string[] = [];
    for (const agent of input.agents || []) {
      const turnId = crypto.randomUUID();
      turnIds.push(turnId);
      sql.exec(
        'INSERT INTO turns (id, request_message_id, agent_id, agent_name, harness, model, owner_id, requested_by, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        turnId, messageId, agent.id, agent.name, agent.harness, agent.model, agent.ownerId, actor, 'queued', timestamp, timestamp,
      );
      this.appendEvent('turn.queued', { turnId, requestMessageId: messageId, agentId: agent.id, agentName: agent.name, ownerId: agent.ownerId, requestedBy: actor });
    }
    return json({ messageId, messageSeq: insert.message_seq, turnIds });
  }

  private importMessages(actor: string, actorName: string, input: { sourceId?: string; entries?: { index?: number; role?: string; text?: string; at?: string }[]; agent?: Agent }): Response {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId.trim() : '';
    const entries = Array.isArray(input.entries) ? input.entries : [];
    const agent = input.agent;
    if (!sourceId || sourceId.length > 160 || !agent || agent.ownerId !== actor || entries.length > 100)
      return json({ error: 'Invalid history import.' }, 400);
    const sql = this.ctx.storage.sql;
    let lastMessageSeq = sql.exec<{ seq: number }>('SELECT COALESCE(MAX(message_seq),0) AS seq FROM messages').toArray()[0]?.seq || 0;
    for (const entry of entries) {
      const index = entry.index;
      const role = entry.role;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!Number.isInteger(index) || Number(index) < 0 || !['user', 'assistant'].includes(role || '') || !text || text.length > 32_000)
        return json({ error: 'Invalid history message.' }, 400);
      if (sql.exec('SELECT message_id FROM imported_messages WHERE source_id=? AND source_index=?', sourceId, index).toArray().length) continue;
      const messageId = crypto.randomUUID();
      const timestamp = entry.at && !Number.isNaN(Date.parse(entry.at)) ? new Date(entry.at).toISOString() : now();
      const assistant = role === 'assistant';
      const result = sql.exec<{ message_seq: number }>(
        'INSERT INTO messages (id, actor_id, actor_name, role, text, state, agent_id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING message_seq',
        messageId, assistant ? agent.id : actor, assistant ? agent.name : actorName, role, text, 'complete', assistant ? agent.id : null, assistant ? actor : null, timestamp, timestamp,
      ).toArray()[0];
      if (!result) throw new Error('Imported message did not receive a sequence.');
      lastMessageSeq = result.message_seq;
      sql.exec('INSERT INTO imported_messages (source_id, source_index, message_id) VALUES (?, ?, ?)', sourceId, index, messageId);
      this.appendEvent('message.created', {
        messageId, messageSeq: result.message_seq, participantId: assistant ? agent.id : actor,
        participantName: assistant ? agent.name : actorName, role, text,
        ...(assistant ? { agentId: agent.id, agentName: agent.name, ownerId: actor, harness: agent.harness, model: agent.model } : {}),
        sourceAt: timestamp,
      });
    }
    return json({ lastMessageSeq });
  }

  private claimTurn(actor: string, input: { agentIds?: string[]; allowRemote?: boolean }): Response {
    const sql = this.ctx.storage.sql;
    // Keep declined cross-owner requests pending without blocking runnable turns.
    // Only the authenticated owner can pause or restore their own requests.
    const updatedAt = now();
    const declined = sql.exec<{ id: string; agent_id: string; harness: string; requested_by: string }>(
      `UPDATE turns SET state='declined', updated_at=?
       WHERE owner_id=? AND requested_by<>? AND state IN ('queued','awaiting_permission')
       AND EXISTS (SELECT 1 FROM mention_grants WHERE owner_id=turns.owner_id AND requester_id=turns.requested_by AND harness=turns.harness AND decision='declined')
       RETURNING id, agent_id, harness, requested_by`,
      updatedAt, actor, actor,
    ).toArray();
    for (const turn of declined) {
      this.appendEvent('turn.permission_decided', { turnId: turn.id, agentId: turn.agent_id, harness: turn.harness, ownerId: actor, requestedBy: turn.requested_by, decision: 'decline' });
    }
    const allowRemote = input.allowRemote ? 1 : 0;
    if (allowRemote) {
      const restored = sql.exec<{ id: string }>(
        `UPDATE turns SET state='queued', updated_at=?
         WHERE owner_id=? AND requested_by<>? AND state='awaiting_permission'
         AND NOT EXISTS (SELECT 1 FROM mention_grants WHERE owner_id=turns.owner_id AND requester_id=turns.requested_by AND harness=turns.harness AND decision='declined')
         RETURNING id`,
        updatedAt, actor, actor,
      ).toArray();
      if (restored.length) this.appendEvent('turn.availability', { ownerId: actor, allowRemote: true });
    } else {
      const parked = sql.exec<{ id: string; agent_id: string; agent_name: string; harness: string; requested_by: string }>(
        `UPDATE turns SET state='awaiting_permission', updated_at=?
         WHERE owner_id=? AND requested_by<>? AND state='queued'
         AND permitted=0
         AND NOT EXISTS (SELECT 1 FROM mention_grants WHERE owner_id=turns.owner_id AND requester_id=turns.requested_by AND harness=turns.harness AND decision='always')
         AND NOT EXISTS (SELECT 1 FROM mention_grants WHERE owner_id=turns.owner_id AND requester_id=turns.requested_by AND harness=turns.harness AND decision='declined')
         RETURNING id, agent_id, agent_name, harness, requested_by`,
        updatedAt, actor, actor,
      ).toArray();
      if (parked.length) this.appendEvent('turn.availability', { ownerId: actor, allowRemote: false });
      for (const turn of parked) this.announcePermission(actor, turn);
    }
    const waiting = sql.exec<{ id: string; agent_id: string; agent_name: string; harness: string; requested_by: string }>(
      "SELECT id, agent_id, agent_name, harness, requested_by FROM turns WHERE state='awaiting_permission' AND owner_id=?",
      actor,
    ).toArray();
    for (const turn of waiting) this.announcePermission(actor, turn);
    const active = sql.exec('SELECT id FROM turns WHERE state=\'active\' LIMIT 1').toArray()[0];
    if (active) return json({ turn: null, reason: 'another_agent_active' }, 409);
    const turn = sql.exec<{ id: string; request_message_id: string; agent_id: string; agent_name: string; harness: string; model: string; owner_id: string; requested_by: string; permitted: number }>(
      `SELECT id, request_message_id, agent_id, agent_name, harness, model, owner_id, requested_by, permitted FROM turns
       WHERE state='queued' AND (owner_id<>? OR requested_by=? OR ?=1 OR permitted=1
         OR EXISTS (SELECT 1 FROM mention_grants WHERE owner_id=turns.owner_id AND requester_id=turns.requested_by AND harness=turns.harness AND decision='always'))
       ORDER BY queue_seq LIMIT 1`,
      actor, actor, input.allowRemote ? 1 : 0,
    ).toArray()[0];
    if (!turn) {
      const blocked = sql.exec<{ owner_id: string }>("SELECT owner_id FROM turns WHERE state='awaiting_permission' AND owner_id=? ORDER BY queue_seq LIMIT 1", actor).toArray()[0];
      return json({ turn: null, ...(blocked?.owner_id === actor ? { reason: 'remote_requests_disabled' } : {}) });
    }
    if (turn.owner_id !== actor) {
      // Installed desktops may have already consumed the original queue event.
      // Wake that owner once per pending turn, including after a server upgrade.
      const rechecked = sql.exec(
        "SELECT event_seq FROM events WHERE type='turn.queued' AND json_extract(data,'$.turnId')=? AND json_extract(data,'$.recheck')=1 LIMIT 1", turn.id,
      ).toArray()[0];
      if (!rechecked) this.appendEvent('turn.queued', { turnId: turn.id, agentId: turn.agent_id, agentName: turn.agent_name, ownerId: turn.owner_id, requestedBy: turn.requested_by, requestMessageId: turn.request_message_id, recheck: true });
      return json({ turn: null, reason: 'earlier_turn_waiting_for_owner' });
    }
    if (turn.requested_by !== actor && !input.allowRemote) {
      const grant = sql.exec<{ decision: string }>('SELECT decision FROM mention_grants WHERE owner_id=? AND requester_id=? AND harness=?', turn.owner_id, turn.requested_by, turn.harness).toArray()[0];
      if (grant?.decision !== 'always' && !turn.permitted) return json({ turn: null, reason: 'remote_requests_disabled' });
    }
    if (!(input.agentIds || []).includes(turn.agent_id)) return json({ turn: null, reason: 'agent_not_configured_here' });
    const request = sql.exec<{ message_seq: number; text: string }>('SELECT message_seq, text FROM messages WHERE id=?', turn.request_message_id).toArray()[0];
    if (!request) return json({ error: 'Agent request message is missing.' }, 409);
    const frontier = sql.exec<{ message_seq: number }>('SELECT COALESCE(MAX(message_seq),0) AS message_seq FROM messages').toArray()[0]?.message_seq || 0;
    const replyId = crypto.randomUUID();
    const timestamp = now();
    const reply = sql.exec<{ message_seq: number }>(
      'INSERT INTO messages (id, actor_id, actor_name, role, text, state, agent_id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING message_seq',
      replyId, turn.agent_id, turn.agent_name, 'assistant', '', 'streaming', turn.agent_id, actor, timestamp, timestamp,
    ).toArray()[0];
    if (!reply) throw new Error('Agent reply insert did not return its sequence.');
    sql.exec('UPDATE turns SET state=\'active\', reply_id=?, context_through_seq=?, updated_at=? WHERE id=? AND state=\'queued\'', replyId, frontier, timestamp, turn.id);
    this.appendEvent('turn.started', { turnId: turn.id, messageId: replyId, messageSeq: reply.message_seq, agentId: turn.agent_id, agentName: turn.agent_name, ownerId: actor, harness: turn.harness, model: turn.model, contextThroughSeq: frontier, startedAt: timestamp });
    const context = sql.exec<{ id: string; message_seq: number; actor_id: string; actor_name: string; role: string; text: string; agent_id: string | null }>(
      'SELECT id, message_seq, actor_id, actor_name, role, text, agent_id FROM messages WHERE message_seq<=? ORDER BY message_seq', frontier,
    ).toArray().map((message) => ({ id: message.id, messageSeq: message.message_seq, participantId: message.actor_id, participantName: message.actor_name, role: message.role, text: message.text, agentId: message.agent_id }));
    const result = { turnId: turn.id, request: { messageId: turn.request_message_id, text: request.text, requestedBy: turn.requested_by }, replyId, agentId: turn.agent_id, agentName: turn.agent_name, ownerId: actor, harness: turn.harness, model: turn.model, contextThroughSeq: frontier, context };
    return json({ turn: result });
  }

  private announcePermission(ownerId: string, turn: { id: string; agent_id: string; agent_name: string; harness: string; requested_by: string }): void {
    const announced = this.ctx.storage.sql.exec(
      "SELECT event_seq FROM events WHERE type='turn.permission_needed' AND json_extract(data,'$.turnId')=? LIMIT 1",
      turn.id,
    ).toArray()[0];
    if (announced) return;
    this.appendEvent('turn.permission_needed', {
      turnId: turn.id, agentId: turn.agent_id, agentName: turn.agent_name, harness: turn.harness, ownerId, requestedBy: turn.requested_by,
    });
  }

  private decideMention(actor: string, turnId: string, input: { decision?: string }): Response {
    const decision = input.decision;
    if (decision !== 'once' && decision !== 'always' && decision !== 'decline') return json({ error: 'Decision must be once, always, or decline.' }, 400);
    const sql = this.ctx.storage.sql;
    const turn = sql.exec<{ id: string; agent_id: string; agent_name: string; harness: string; owner_id: string; requested_by: string; state: string }>(
      'SELECT id, agent_id, agent_name, harness, owner_id, requested_by, state FROM turns WHERE id=?', turnId,
    ).toArray()[0];
    if (!turn || turn.owner_id !== actor) return json({ error: 'This turn is not available to this agent owner.' }, 409);
    if (turn.requested_by === actor) return json({ error: 'Your own mentions do not need permission.' }, 409);
    const timestamp = now();
    if (decision === 'decline') {
      sql.exec(
        'INSERT INTO mention_grants (owner_id, requester_id, harness, decision) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, requester_id, harness) DO UPDATE SET decision=excluded.decision',
        actor, turn.requested_by, turn.harness, 'declined',
      );
      const declined = sql.exec<{ id: string; agent_id: string }>(
        "UPDATE turns SET state='declined', updated_at=? WHERE owner_id=? AND requested_by=? AND harness=? AND state='awaiting_permission' RETURNING id, agent_id",
        timestamp, actor, turn.requested_by, turn.harness,
      ).toArray();
      if (!declined.length && turn.state !== 'awaiting_permission') return json({ error: 'This mention is not waiting for permission.' }, 409);
      for (const item of declined) {
        this.appendEvent('turn.permission_decided', { turnId: item.id, agentId: item.agent_id, harness: turn.harness, ownerId: actor, requestedBy: turn.requested_by, decision: 'decline' });
      }
      return json({ ok: true });
    }
    if (decision === 'always') {
      sql.exec(
        'INSERT INTO mention_grants (owner_id, requester_id, harness, decision) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, requester_id, harness) DO UPDATE SET decision=excluded.decision',
        actor, turn.requested_by, turn.harness, 'always',
      );
    }
    const restored = sql.exec<{ id: string; agent_id: string; agent_name: string; request_message_id: string }>(
      decision === 'once'
        ? "UPDATE turns SET state='queued', permitted=1, updated_at=? WHERE id=? AND owner_id=? AND state='awaiting_permission' RETURNING id, agent_id, agent_name, request_message_id"
        : "UPDATE turns SET state='queued', updated_at=? WHERE owner_id=? AND requested_by=? AND harness=? AND state='awaiting_permission' RETURNING id, agent_id, agent_name, request_message_id",
      ...(decision === 'once'
        ? [timestamp, turn.id, actor]
        : [timestamp, actor, turn.requested_by, turn.harness]),
    ).toArray();
    if (!restored.length) return json({ error: 'This mention is not waiting for permission.' }, 409);
    for (const item of restored) {
      this.appendEvent('turn.queued', { turnId: item.id, agentId: item.agent_id, agentName: item.agent_name, ownerId: actor, requestedBy: turn.requested_by, requestMessageId: item.request_message_id });
    }
    return json({ ok: true });
  }

  private appendChunk(actor: string, turnId: string, input: { index?: number; text?: string }): Response {
    const sql = this.ctx.storage.sql;
    const turn = sql.exec<{ reply_id: string; owner_id: string; state: string; next_chunk: number }>(
      'SELECT reply_id, owner_id, state, next_chunk FROM turns WHERE id=?', turnId,
    ).toArray()[0];
    if (!turn || turn.owner_id !== actor || turn.state !== 'active') return json({ error: 'This turn is not active for this agent owner.' }, 409);
    const index = Number.isInteger(input.index) ? Number(input.index) : -1;
    const text = typeof input.text === 'string' ? input.text : '';
    const prior = sql.exec<{ text: string }>('SELECT text FROM agent_chunks WHERE turn_id=? AND chunk_index=?', turnId, index).toArray()[0];
    if (prior) return prior.text === text ? json({ ok: true, duplicate: true }) : json({ error: 'A different chunk already uses this index.' }, 409);
    if (index !== turn.next_chunk || !text || text.length > 16_384) return json({ error: 'Chunk index or size is invalid.' }, 400);
    const timestamp = now();
    sql.exec('INSERT INTO agent_chunks (turn_id, chunk_index, text) VALUES (?, ?, ?)', turnId, index, text);
    sql.exec('UPDATE messages SET text=text || ?, updated_at=? WHERE id=?', text, timestamp, turn.reply_id);
    sql.exec('UPDATE turns SET next_chunk=next_chunk+1, updated_at=? WHERE id=?', timestamp, turnId);
    const body = sql.exec<{ message_seq: number }>('SELECT message_seq FROM messages WHERE id=?', turn.reply_id).toArray()[0];
    if (!body) throw new Error('Agent reply is missing.');
    const event = this.appendEvent('message.delta', { turnId, messageId: turn.reply_id, messageSeq: body.message_seq, chunkIndex: index, text, updatedAt: timestamp });
    return json({ ok: true, eventSeq: event.eventSeq });
  }

  private finishTurn(actor: string, turnId: string, input: { state?: string; error?: string }): Response {
    const sql = this.ctx.storage.sql;
    const turn = sql.exec<{ reply_id: string; owner_id: string; state: string; agent_id: string; harness: string }>('SELECT reply_id, owner_id, state, agent_id, harness FROM turns WHERE id=?', turnId).toArray()[0];
    const state = ['complete', 'failed', 'stopped'].includes(input.state || '') ? input.state as string : 'complete';
    if (!turn || turn.owner_id !== actor) return json({ error: 'This turn is not available to this agent owner.' }, 409);
    if (turn.state !== 'active') return turn.state === state ? json({ ok: true, duplicate: true }) : json({ error: 'This turn is already finished.' }, 409);
    const timestamp = now();
    sql.exec('UPDATE turns SET state=?, updated_at=? WHERE id=?', state, timestamp, turnId);
    sql.exec('UPDATE messages SET state=?, updated_at=? WHERE id=?', state, timestamp, turn.reply_id);
    const event = this.appendEvent('turn.finished', { turnId, messageId: turn.reply_id, agentId: turn.agent_id, harness: turn.harness, state, error: typeof input.error === 'string' ? input.error.slice(0, 4000) : undefined, finishedAt: timestamp });
    return json({ ok: true, eventSeq: event.eventSeq });
  }

  private appendEvent(type: string, data: Record<string, unknown>) {
    const timestamp = now();
    const row = this.ctx.storage.sql.exec<{ event_seq: number }>(
      'INSERT INTO events (type, data, created_at) VALUES (?, ?, ?) RETURNING event_seq', type, JSON.stringify(data), timestamp,
    ).toArray()[0];
    if (!row) throw new Error('Event insert did not return its sequence.');
    const event = { eventSeq: row.event_seq, type, ...data, createdAt: timestamp };
    this.broadcast(event);
    return event;
  }

  private broadcast(event: unknown) {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch { /* disconnected sockets are removed by the runtime */ }
    }
  }
}

function directory(env: Env) { return env.DIRECTORY.get(env.DIRECTORY.idFromName('workspace')); }
function response(value: unknown, status: number, env: Env) { return new Response(JSON.stringify(value), { status, headers: { ...jsonHeaders, ...corsHeaders(env) } }); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: jsonHeaders }); }
function corsHeaders(env: Env): HeadersInit { return { ...(env.APP_ORIGIN && env.APP_ORIGIN !== '*' ? { 'access-control-allow-origin': env.APP_ORIGIN, vary: 'Origin' } : {}), 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' }; }

function now() { return new Date().toISOString(); }
function cleanName(input: unknown): string { const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''; if (!name || name.length > 64) throw new HttpError('Enter a name up to 64 characters.', 400); return name; }
function cleanRoomName(input: unknown): string { const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''; if (!name || name.length > 80) throw new HttpError('Enter a chat name up to 80 characters.', 400); return name; }
async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> { const length = Number(request.headers.get('content-length') || 0); if (length > MAX_BODY_BYTES) throw new HttpError('Request is too large.', 413); const body = await request.json().catch(() => null); if (!body || typeof body !== 'object') throw new HttpError('Expected a JSON request body.', 400); return body as T; }
function parseObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
function randomToken(size = 24) { const bytes = crypto.getRandomValues(new Uint8Array(size)); return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function hashText(value: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function base64url(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
async function signChallenge(value: { nonce: string; exp: number }, secret: string) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(value)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return `${payload}.${base64url(signature)}`;
}
async function verifyChallenge(value: string, secret: string): Promise<{ nonce: string; exp: number }> {
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) throw new HttpError('Google sign-in challenge is invalid.', 400);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let decoded: Uint8Array<ArrayBuffer>;
  try { decoded = decodeBase64url(signature); } catch { throw new HttpError('Google sign-in challenge is invalid.', 400); }
  if (!await crypto.subtle.verify('HMAC', key, decoded, new TextEncoder().encode(payload))) throw new HttpError('Google sign-in challenge is invalid.', 400);
  let claims: { nonce?: unknown; exp?: unknown };
  try { claims = JSON.parse(new TextDecoder().decode(decodeBase64url(payload))); } catch { throw new HttpError('Google sign-in challenge is invalid.', 400); }
  if (typeof claims.nonce !== 'string' || claims.nonce.length < 32 || typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000))
    throw new HttpError('Google sign-in challenge expired. Please try again.', 400);
  return { nonce: claims.nonce, exp: claims.exp };
}

async function exchangeGoogleAuthorizationCode(
  input: { authorizationCode?: string; codeVerifier?: string; redirectUri?: string },
  env: Env,
): Promise<string> {
  const code = input.authorizationCode || '';
  const verifier = input.codeVerifier || '';
  const redirectUri = input.redirectUri || '';
  if (!code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code))
    throw new HttpError('Google did not return a valid sign-in code. Please try again.', 400);
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
    throw new HttpError('Google sign-in could not verify the authorization code. Please try again.', 400);

  let callback: URL;
  try { callback = new URL(redirectUri); } catch { throw new HttpError('Google sign-in callback is invalid.', 400); }
  const callbackPort = Number(callback.port);
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || !Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535 || callback.pathname !== '/' || callback.search || callback.hash || callback.username || callback.password)
    throw new HttpError('Google sign-in callback is invalid.', 400);

  let tokenEndpoint: URL;
  try { tokenEndpoint = new URL(env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'); }
  catch { throw new HttpError('Google sign-in is not configured correctly.', 503); }
  const googleEndpoint = tokenEndpoint.protocol === 'https:' && tokenEndpoint.hostname === 'oauth2.googleapis.com' && tokenEndpoint.pathname === '/token';
  const localTestEndpoint = env.GOOGLE_TOKEN_URL && tokenEndpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(tokenEndpoint.hostname) && tokenEndpoint.pathname === '/token';
  if ((!googleEndpoint && !localTestEndpoint) || tokenEndpoint.username || tokenEndpoint.password || tokenEndpoint.search || tokenEndpoint.hash)
    throw new HttpError('Google sign-in is not configured correctly.', 503);

  const form = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: callback.toString().replace(/\/$/, ''),
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError('Could not contact Google to complete sign-in. Please try again.', 503);
  }
  const body = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!tokenResponse.ok) {
    const errorCode = typeof body.error === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(body.error)
      ? body.error
      : 'Google token exchange failed.';
    const errorDescription = typeof body.error_description === 'string'
      ? body.error_description.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240)
      : '';
    const details = errorDescription ? { error_description: errorDescription } : undefined;
    throw new HttpError(errorCode, tokenResponse.status === 400 ? 400 : 502, details);
  }
  if (typeof body.id_token !== 'string' || !body.id_token || body.id_token.length > 16_384)
    throw new HttpError('Google did not return a valid sign-in token. Please try again.', 502);
  return body.id_token;
}

type GoogleJwk = JsonWebKey & { kid?: string; use?: string; alg?: string };
let googleJwksCache: { url: string; keys: GoogleJwk[]; expiresAt: number } | null = null;
async function verifyGoogleIdToken(token: string, expectedNonce: string, clientId: string, configuredJwksUrl?: string): Promise<{ sub: string; name: string }> {
  if (token.length > 16_384) throw new HttpError('Google sign-in token is invalid.', 401);
  const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split('.');
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra) throw new HttpError('Google sign-in token is invalid.', 401);
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64url(encodedHeader)));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64url(encodedClaims)));
  } catch { throw new HttpError('Google sign-in token is invalid.', 401); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new HttpError('Google sign-in token is invalid.', 401);
  const jwksUrl = new URL(configuredJwksUrl || 'https://www.googleapis.com/oauth2/v3/certs');
  if (jwksUrl.protocol !== 'https:' && jwksUrl.hostname !== 'localhost' && jwksUrl.hostname !== '127.0.0.1')
    throw new HttpError('Google sign-in could not be verified.', 503);
  const jwk = (await googleJwks(jwksUrl.toString())).find((key) => key.kid === header.kid && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'))
    || (await googleJwks(jwksUrl.toString(), true)).find((key) => key.kid === header.kid && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
  if (!jwk) throw new HttpError('Google sign-in could not be verified.', 401);
  let validSignature = false;
  try {
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64url(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  } catch { validSignature = false; }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = Number(claims.iat);
  const expiresAt = Number(claims.exp);
  const issuerValid = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  if (!validSignature || !issuerValid || claims.aud !== clientId || claims.nonce !== expectedNonce || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || !Number.isFinite(issuedAt) || issuedAt > nowSeconds + 60 || !Number.isFinite(expiresAt) || expiresAt <= nowSeconds)
    throw new HttpError('Google sign-in could not be verified. Please try again.', 401);
  let name = typeof claims.name === 'string' ? claims.name.trim().replace(/\s+/g, ' ').slice(0, 64) : '';
  if (!name) name = 'Google user';
  return { sub: claims.sub, name };
}

async function googleJwks(url: string, refresh = false): Promise<GoogleJwk[]> {
  if (!refresh && googleJwksCache?.url === url && googleJwksCache.expiresAt > Date.now()) return googleJwksCache.keys;
  let responseValue: Response;
  try { responseValue = await fetch(url, { headers: { accept: 'application/json' }, cf: { cacheTtl: 3600, cacheEverything: true } }); }
  catch { throw new HttpError('Could not verify Google sign-in right now. Please try again.', 503); }
  if (!responseValue.ok) throw new HttpError('Could not verify Google sign-in right now. Please try again.', 503);
  const body = await responseValue.json().catch(() => null) as { keys?: unknown } | null;
  if (!body || !Array.isArray(body.keys) || !body.keys.length) throw new HttpError('Could not verify Google sign-in right now. Please try again.', 503);
  const keys = body.keys.filter((item): item is GoogleJwk => Boolean(item && typeof item === 'object' && (item as GoogleJwk).kty === 'RSA'));
  googleJwksCache = { url, keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) output[index] = binary.charCodeAt(index);
  return output;
}

async function authenticate(request: Request, env: Env, protocolToken?: string): Promise<Identity | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || protocolToken || '';
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const result = await directory(env).fetch(`https://directory/auth/session?hash=${encodeURIComponent(await hashText(token))}`);
  if (!result.ok) return null;
  return result.json<Identity>();
}

async function verifyLegacySession(token: string, secret: string): Promise<Identity | null> {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, decodeBase64url(signature), new TextEncoder().encode(`${header}.${payload}`))) return null;
    const value = JSON.parse(new TextDecoder().decode(decodeBase64url(payload))) as Identity & { sub?: string };
    const id = typeof value.id === 'string' ? value.id : value.sub;
    if (!id || typeof value.name !== 'string' || !['owner', 'member'].includes(value.role) || !value.exp || value.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id, name: value.name, role: value.role, exp: value.exp };
  } catch { return null; }
}
function requireAdmin(request: Request, env: Env) { if (!env.ADMIN_SECRET || request.headers.get('authorization') !== `Bearer ${env.ADMIN_SECRET}`) throw new HttpError('Admin access denied.', 403); }
class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly details?: Record<string, unknown>) { super(message); }
}
