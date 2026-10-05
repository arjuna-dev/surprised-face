import { DurableObject } from 'cloudflare:workers';

interface Env {
  DIRECTORY: DurableObjectNamespace<WorkspaceDirectory>;
  ROOMS: DurableObjectNamespace<ChatRoom>;
  SESSION_SECRET: string;
  ADMIN_SECRET: string;
  APP_ORIGIN: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

    try {
      if (url.pathname === '/health' && request.method === 'GET') return response({ ok: true, service: 'surprised-face-rooms' }, 200, env);

      if (url.pathname === '/v1/admin/bootstrap' && request.method === 'POST') {
        requireAdmin(request, env);
        const input = await readJson<{ name: string }>(request);
        const result = await directory(env).fetch('https://directory/bootstrap', { method: 'POST', body: JSON.stringify(input) });
        const member = await result.json<Omit<Identity, 'exp'>>();
        return response({ member, token: await signSession(member, env.SESSION_SECRET) }, result.status, env);
      }

      if (url.pathname === '/v1/register' && request.method === 'POST') {
        const input = await readJson<{ name: string }>(request);
        const result = await directory(env).fetch('https://directory/register', { method: 'POST', body: JSON.stringify(input) });
        const member = await result.json<Omit<Identity, 'exp'>>();
        return response(result.ok ? { member, token: await signSession(member, env.SESSION_SECRET) } : member, result.status, env);
      }

      if (url.pathname === '/v1/join' && request.method === 'POST') {
        const input = await readJson<{ code: string; name: string }>(request);
        const result = await directory(env).fetch('https://directory/join', { method: 'POST', body: JSON.stringify(input) });
        const member = await result.json<Omit<Identity, 'exp'> & { roomId?: string }>();
        if (result.ok && member.roomId) {
          await env.ROOMS.get(env.ROOMS.idFromName(member.roomId)).fetch('https://room/member-joined', {
            method: 'POST', body: JSON.stringify({ participantId: member.id, participantName: member.name }),
          });
        }
        return response(result.ok ? { member, token: await signSession(member, env.SESSION_SECRET) } : member, result.status, env);
      }

      const protocolToken = request.headers.get('sec-websocket-protocol')?.split(',').map((value) => value.trim()).find((value) => value.startsWith('bearer.'))?.slice('bearer.'.length);
      const identity = await authenticate(request, env, protocolToken);
      if (!identity) return response({ error: 'Create your account or join a chat first.' }, 401, env);

      if (url.pathname === '/v1/me' && request.method === 'GET') return response(identity, 200, env);

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
        const input = await readJson<{ name: string; defaultAgentId?: string }>(request);
        const result = await directory(env).fetch('https://directory/rooms', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': identity.id }, body: JSON.stringify(input),
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
        if (operation === 'turns/claim' || /^turns\/[^/]+\/(?:chunk|finish)$/.test(operation)) {
          return stub.fetch(new Request(`https://room/${roomId}/${operation}`, { method: request.method, headers, body: request.method === 'GET' ? null : request.body }));
        }
        if (operation === 'events' && request.method === 'GET') return stub.fetch(new Request(`https://room/${roomId}/events${url.search}`, { headers }));
      }

      return response({ error: 'Not found.' }, 404, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      return response({ error: error instanceof Error ? error.message : 'Request failed.' }, status, env);
    }
  },
};

export class WorkspaceDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, room_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT);
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, default_agent_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_members (room_id TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY(room_id, member_id));
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const inviteColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(invites)').toArray();
    if (!inviteColumns.some((column) => column.name === 'room_id')) ctx.storage.sql.exec('ALTER TABLE invites ADD COLUMN room_id TEXT');
    const roomColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(rooms)').toArray();
    if (!roomColumns.some((column) => column.name === 'default_agent_id')) ctx.storage.sql.exec('ALTER TABLE rooms ADD COLUMN default_agent_id TEXT');
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/bootstrap') return this.bootstrap(await readJson(request));
    if (request.method === 'POST' && url.pathname === '/register') return this.register(await readJson(request));
    if (request.method === 'POST' && url.pathname === '/invites') return this.createInvites(await readJson(request));
    if (request.method === 'POST' && url.pathname === '/join') return this.join(await readJson(request));
    if (request.method === 'POST' && url.pathname === '/join-room') return this.joinRoom(request, await readJson(request));
    if (request.method === 'GET' && url.pathname === '/rooms') return this.rooms(url.searchParams.get('member') || '');
    if (request.method === 'GET' && url.pathname === '/room-access') return this.roomAccess(url.searchParams);
    if (request.method === 'GET' && url.pathname === '/room-members') return this.roomMembers(url.searchParams.get('room') || '');
    if (request.method === 'GET' && url.pathname === '/room-agents') return this.roomAgents(url.searchParams.get('room') || '');
    if (request.method === 'GET' && url.pathname === '/members-for-actor') return this.membersForActor(request.headers.get('x-actor-id') || '');
    if (request.method === 'GET' && url.pathname === '/agents-for-actor') return this.agentsForActor(request.headers.get('x-actor-id') || '');
    if (request.method === 'POST' && url.pathname === '/rooms') return this.createRoom(request, await readJson(request));
    if (request.method === 'POST' && url.pathname === '/agents') return this.registerAgent(request, await readJson(request));
    if (request.method === 'GET' && url.pathname.startsWith('/agents/')) return this.getAgent(decodeURIComponent(url.pathname.slice('/agents/'.length)));
    return json({ error: 'Not found.' }, 404);
  }

  private bootstrap(input: { name?: string }): Response {
    const name = cleanName(input.name);
    if (this.sql().exec('SELECT id FROM members LIMIT 1').toArray().length) return json({ error: 'The workspace is already initialized.' }, 409);
    const id = crypto.randomUUID();
    this.sql().exec('INSERT INTO members (id, name, role, created_at) VALUES (?, ?, ?, ?)', id, name, 'owner', now());
    this.makeRoom(id, 'general');
    return json({ id, name, role: 'owner' });
  }

  private register(input: { name?: string }): Response {
    const name = cleanName(input.name);
    const id = crypto.randomUUID();
    this.sql().exec('INSERT INTO members (id, name, role, created_at) VALUES (?, ?, ?, ?)', id, name, 'member', now());
    return json({ id, name, role: 'member' });
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
    const rows = this.sql().exec<{ id: string; name: string; created_at: string }>(
      'SELECT r.id, r.name, r.created_at, r.default_agent_id FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.member_id=? ORDER BY r.created_at', memberId,
    ).toArray();
    return json({ rooms: rows });
  }

  private roomMembers(roomId: string): Response {
    const members = this.sql().exec<{ id: string; name: string; role: string }>(
      'SELECT p.id, p.name, p.role FROM members p JOIN room_members m ON m.member_id=p.id WHERE m.room_id=? ORDER BY p.created_at', roomId,
    ).toArray();
    return json({ members });
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

  private createRoom(request: Request, input: { name?: string; defaultAgentId?: string }): Response {
    const actor = request.headers.get('x-actor-id') || '';
    const member = this.sql().exec<{ id: string }>('SELECT id FROM members WHERE id=?', actor).toArray()[0];
    if (!member) return json({ error: 'Unknown member.' }, 403);
    const agentId = typeof input.defaultAgentId === 'string' ? input.defaultAgentId : '';
    if (agentId && !this.sql().exec('SELECT id FROM agents WHERE id=? AND owner_id=?', agentId, actor).toArray().length)
      return json({ error: 'Choose an agent you own for this chat.' }, 403);
    const room = this.makeRoom(actor, cleanRoomName(input.name), agentId);
    return json(room, 201);
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
      CREATE TABLE IF NOT EXISTS turns (queue_seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_message_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, owner_id TEXT NOT NULL, requested_by TEXT NOT NULL, state TEXT NOT NULL, reply_id TEXT, context_through_seq INTEGER, next_chunk INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_chunks (turn_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(turn_id, chunk_index));
      CREATE TABLE IF NOT EXISTS imported_messages (source_id TEXT NOT NULL, source_index INTEGER NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(source_id, source_index));
      CREATE INDEX IF NOT EXISTS turns_queue ON turns(state, created_at);
    `);
    const messageColumns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(messages)').toArray();
    if (!messageColumns.some((column) => column.name === 'actor_name')) {
      ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN actor_name TEXT NOT NULL DEFAULT ''");
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
    if (url.pathname.endsWith('/claim') && request.method === 'POST') return this.claimTurn(actor, await readJson(request));
    const match = /\/turns\/([^/]+)\/(chunk|finish)$/.exec(url.pathname);
    if (match && request.method === 'POST') {
      const turnId = match[1]!;
      const action = match[2]!;
      return action === 'chunk' ? this.appendChunk(actor, turnId, await readJson(request)) : this.finishTurn(actor, turnId, await readJson(request));
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
    const active = sql.exec('SELECT id FROM turns WHERE state=\'active\' LIMIT 1').toArray()[0];
    if (active) return json({ turn: null, reason: 'another_agent_active' }, 409);
    const turn = sql.exec<{ id: string; request_message_id: string; agent_id: string; agent_name: string; harness: string; model: string; owner_id: string; requested_by: string }>(
      'SELECT id, request_message_id, agent_id, agent_name, harness, model, owner_id, requested_by FROM turns WHERE state=\'queued\' AND (owner_id<>? OR requested_by=? OR ?=1) ORDER BY queue_seq LIMIT 1',
      actor, actor, input.allowRemote ? 1 : 0,
    ).toArray()[0];
    if (!turn) {
      const blocked = sql.exec<{ owner_id: string }>("SELECT owner_id FROM turns WHERE state='queued' ORDER BY queue_seq LIMIT 1").toArray()[0];
      return json({ turn: null, ...(blocked?.owner_id === actor ? { reason: 'remote_requests_disabled' } : {}) });
    }
    if (turn.owner_id !== actor) return json({ turn: null, reason: 'earlier_turn_waiting_for_owner' });
    if (turn.requested_by !== actor && !input.allowRemote) return json({ turn: null, reason: 'remote_requests_disabled' });
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
    const turn = sql.exec<{ reply_id: string; owner_id: string; state: string }>('SELECT reply_id, owner_id, state FROM turns WHERE id=?', turnId).toArray()[0];
    const state = ['complete', 'failed', 'stopped'].includes(input.state || '') ? input.state as string : 'complete';
    if (!turn || turn.owner_id !== actor) return json({ error: 'This turn is not available to this agent owner.' }, 409);
    if (turn.state !== 'active') return turn.state === state ? json({ ok: true, duplicate: true }) : json({ error: 'This turn is already finished.' }, 409);
    const timestamp = now();
    sql.exec('UPDATE turns SET state=?, updated_at=? WHERE id=?', state, timestamp, turnId);
    sql.exec('UPDATE messages SET state=?, updated_at=? WHERE id=?', state, timestamp, turn.reply_id);
    const event = this.appendEvent('turn.finished', { turnId, messageId: turn.reply_id, state, error: typeof input.error === 'string' ? input.error.slice(0, 4000) : undefined, finishedAt: timestamp });
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
function corsHeaders(env: Env): HeadersInit { return { 'access-control-allow-origin': env.APP_ORIGIN || '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' }; }
function now() { return new Date().toISOString(); }
function cleanName(input: unknown): string { const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''; if (!name || name.length > 64) throw new HttpError('Enter a name up to 64 characters.', 400); return name; }
function cleanRoomName(input: unknown): string { const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''; if (!name || name.length > 80) throw new HttpError('Enter a chat name up to 80 characters.', 400); return name; }
async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> { const length = Number(request.headers.get('content-length') || 0); if (length > MAX_BODY_BYTES) throw new HttpError('Request is too large.', 413); const body = await request.json().catch(() => null); if (!body || typeof body !== 'object') throw new HttpError('Expected a JSON request body.', 400); return body as T; }
function parseObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(24)); return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function hashText(value: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function base64url(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
async function signSession(member: Identity, secret: string) { const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))); const payload = base64url(new TextEncoder().encode(JSON.stringify({ sub: member.id, name: member.name, role: member.role, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }))); const data = `${header}.${payload}`; const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))); return `${data}.${base64url(signature)}`; }
async function authenticate(request: Request, env: Env, protocolToken?: string): Promise<Identity | null> { const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || protocolToken || ''; const [header, payload, signature, extra] = token.split('.'); if (!header || !payload || !signature || extra) return null; const data = `${header}.${payload}`; try { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']); const decoded = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)); if (!await crypto.subtle.verify('HMAC', key, decoded, new TextEncoder().encode(data))) return null; const value = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Identity & { sub?: string }; const id = typeof value.id === 'string' ? value.id : value.sub; if (!id || typeof value.name !== 'string' || !['owner', 'member'].includes(value.role) || !value.exp || value.exp <= Math.floor(Date.now() / 1000)) return null; return { id, name: value.name, role: value.role, exp: value.exp }; } catch { return null; } }
function requireAdmin(request: Request, env: Env) { if (!env.ADMIN_SECRET || request.headers.get('authorization') !== `Bearer ${env.ADMIN_SECRET}`) throw new HttpError('Admin access denied.', 403); }
class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
