import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { LocalStore, RoomEvent } from './local-store';
import type { SettingsStore } from './settings-store';

type ApiRoom = { id: string; name: string; createdAt?: string; defaultAgentId?: string };
type ApiMember = { id: string; name: string; role: 'owner' | 'member' };
type ApiAgent = {
  id: string;
  ownerId: string;
  name: string;
  harness: 'codex' | 'hermes';
  model: string;
};

type ApiResult<T> = { status: number; body: T };

export class RoomService extends EventEmitter {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscribedRooms = new Set<string>();
  private readonly outboxFlushes = new Map<string, Promise<void>>();
  private readonly roomSyncs = new Map<string, Promise<void>>();
  private readonly bufferedEvents = new Map<string, Map<number, RoomEvent>>();
  private stopped = false;

  constructor(
    private readonly settings: SettingsStore,
    private readonly store: LocalStore,
  ) {
    super();
  }

  async bootstrap(input: {
    backendUrl: string;
    adminSecret: string;
    name: string;
  }): Promise<unknown> {
    const backendUrl = normalizeUrl(input.backendUrl);
    const result = await this.requestAt<{ member: ApiMember; token: string }>(
      backendUrl,
      '/v1/admin/bootstrap',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${input.adminSecret}` },
        body: { name: input.name },
      },
    );
    await this.settings.saveConnection(backendUrl, result.body.member, result.body.token);
    return result.body.member;
  }

  async register(name: string): Promise<ApiMember> {
    const settings = await this.settings.get();
    const backendUrl = normalizeUrl(settings.backendUrl);
    const result = await this.requestAt<{ member: ApiMember; token: string }>(backendUrl, '/v1/register', {
      method: 'POST', body: { name },
    });
    await this.settings.saveConnection(backendUrl, result.body.member, result.body.token);
    return result.body.member;
  }

  async join(input: { backendUrl: string; code: string; name: string }): Promise<unknown> {
    const backendUrl = normalizeUrl(input.backendUrl);
    const result = await this.requestAt<{ member: ApiMember; token: string }>(
      backendUrl,
      '/v1/join',
      {
        method: 'POST',
        body: { code: input.code, name: input.name },
      },
    );
    await this.settings.saveConnection(backendUrl, result.body.member, result.body.token);
    return result.body.member;
  }

  async joinRoom(code: string): Promise<{ roomId: string }> {
    const result = await this.api<{ roomId: string }>('/v1/rooms/join', { method: 'POST', body: { code } });
    return result.body;
  }

  async rooms(): Promise<ApiRoom[]> {
    const result = await this.api<{ rooms: ApiRoom[] }>('/v1/rooms');
    this.store.storeRooms(result.body.rooms || []);
    return result.body.rooms || [];
  }

  async members(roomId: string): Promise<ApiMember[]> {
    const result = await this.api<{ members: ApiMember[] }>(`/v1/rooms/${encodeURIComponent(roomId)}/members`);
    return result.body.members || [];
  }

  async agents(roomId: string): Promise<ApiAgent[]> {
    const result = await this.api<{ agents: ApiAgent[] }>(`/v1/rooms/${encodeURIComponent(roomId)}/agents`);
    return result.body.agents || [];
  }

  async registerAgent(agent: Omit<ApiAgent, 'ownerId'>): Promise<ApiAgent> {
    const result = await this.api<ApiAgent>('/v1/agents', { method: 'POST', body: agent });
    return result.body;
  }

  async createRoom(name: string, defaultAgentId = ''): Promise<ApiRoom> {
    const result = await this.api<ApiRoom>('/v1/rooms', { method: 'POST', body: { name, defaultAgentId } });
    this.store.storeRooms([result.body]);
    return result.body;
  }

  async createInvites(roomId: string, count = 1): Promise<{ code: string; expiresAt: string }[]> {
    const result = await this.api<{ invites: { code: string; expiresAt: string }[] }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/invites`,
      { method: 'POST', body: { count } },
    );
    return result.body.invites || [];
  }

  async importMessages(roomId: string, sourceId: string, agentId: string, entries: { index: number; role: 'user' | 'assistant'; text: string; at?: string }[]): Promise<number> {
    let lastMessageSeq = 0;
    let batch: typeof entries = [];
    let size = 0;
    const send = async () => {
      if (!batch.length) return;
      const result = await this.api<{ lastMessageSeq: number }>(`/v1/rooms/${encodeURIComponent(roomId)}/import`, {
        method: 'POST', body: { sourceId, agentId, entries: batch },
      });
      lastMessageSeq = Math.max(lastMessageSeq, result.body.lastMessageSeq || 0);
      batch = [];
      size = 0;
    };
    for (const entry of entries) {
      const length = JSON.stringify(entry).length;
      if (batch.length >= 50 || size + length > 48_000) await send();
      batch.push(entry);
      size += length;
    }
    await send();
    await this.syncRoom(roomId);
    return lastMessageSeq;
  }

  async openRoom(roomId: string): Promise<void> {
    if (!roomId) return;
    this.subscribedRooms.add(roomId);
    await this.connectSocket(roomId);
    await this.syncRoom(roomId);
    await this.flushOutbox(roomId);
  }

  messages(roomId: string) {
    return this.store.messages(roomId);
  }

  pendingMessages(roomId: string) {
    return this.store.pendingOutbox(roomId);
  }

  sendMessage(input: { roomId: string; text: string; agentIds?: string[] }): void {
    const text = input.text.trim();
    if (!text) return;
    const clientId = randomUUID();
    this.store.queueMessage({ ...input, text, clientId });
    void this.flushOutbox(input.roomId).catch((error: unknown) =>
      this.emit('service/error', errorMessage(error)),
    );
  }

  async claimTurn(roomId: string, agentIds: string[], allowRemote = false): Promise<Record<string, unknown> | null> {
    const result = await this.api<{ turn?: Record<string, unknown> | null }>(
      `/v1/rooms/${encodeURIComponent(roomId)}/turns/claim`,
      {
        method: 'POST',
        body: { agentIds, allowRemote },
        allowConflict: true,
      },
    );
    return result.body.turn || null;
  }

  async appendAgentChunk(
    roomId: string,
    turnId: string,
    index: number,
    text: string,
  ): Promise<void> {
    if (!text) return;
    await retry(() =>
      this.api(
        `/v1/rooms/${encodeURIComponent(roomId)}/turns/${encodeURIComponent(turnId)}/chunk`,
        {
          method: 'POST',
          body: { index, text },
        },
      ),
    );
  }

  async finishAgentTurn(
    roomId: string,
    turnId: string,
    state: 'complete' | 'failed' | 'stopped',
    error?: string,
  ): Promise<void> {
    await retry(() =>
      this.api(
        `/v1/rooms/${encodeURIComponent(roomId)}/turns/${encodeURIComponent(turnId)}/finish`,
        {
          method: 'POST',
          body: { state, error },
        },
      ),
    );
  }

  stop(): void {
    this.stopped = true;
    this.disconnect();
  }

  disconnect(): void {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.subscribedRooms.clear();
  }

  private async flushOutbox(roomId: string): Promise<void> {
    const existing = this.outboxFlushes.get(roomId);
    if (existing) {
      await existing;
      return this.flushOutbox(roomId);
    }
    const current = this.flushOutboxQueue(roomId);
    this.outboxFlushes.set(roomId, current);
    try {
      await current;
    } finally {
      if (this.outboxFlushes.get(roomId) === current) this.outboxFlushes.delete(roomId);
    }
  }

  private async flushOutboxQueue(roomId: string): Promise<void> {
    const hadPending = this.store.pendingMessages(roomId).length > 0;
    try { await this.sendPendingQueue(roomId); }
    finally { if (hadPending) this.emit('outbox/changed', { roomId }); }
  }

  private async sendPendingQueue(roomId: string): Promise<void> {
    while (true) {
      const pending = this.store.pendingMessages(roomId);
      if (!pending.length) break;
      for (const item of pending) {
        try {
          await this.api(`/v1/rooms/${encodeURIComponent(item.room_id)}/messages`, {
            method: 'POST',
            body: {
              clientId: item.client_id,
              text: item.text,
              agentIds: safeStringArray(item.agent_ids),
            },
          });
          this.store.updateOutbox(item.client_id, 'sent');
        } catch (error) {
          this.store.updateOutbox(
            item.client_id,
            'pending',
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      }
    }
    await this.syncRoom(roomId);
  }

  private syncRoom(roomId: string): Promise<void> {
    const existing = this.roomSyncs.get(roomId);
    if (existing) return existing;
    const current = this.replayRoom(roomId).finally(() => {
      if (this.roomSyncs.get(roomId) === current) this.roomSyncs.delete(roomId);
    });
    this.roomSyncs.set(roomId, current);
    return current;
  }

  private async replayRoom(roomId: string): Promise<void> {
    let cursor = this.store.cursor(roomId);
    for (let page = 0; page < 100; page++) {
      const result = await this.api<{ events: RoomEvent[]; cursor: number; hasMore?: boolean }>(
        `/v1/rooms/${encodeURIComponent(roomId)}/events?after=${cursor}`,
      );
      const events = result.body.events || [];
      for (const event of events) this.acceptEvent(roomId, event);
      const appliedCursor = this.store.cursor(roomId);
      if (appliedCursor <= cursor || !result.body.hasMore) break;
      cursor = appliedCursor;
    }
  }

  private async connectSocket(roomId: string): Promise<void> {
    const existing = this.sockets.get(roomId);
    if (existing && existing.readyState < WebSocket.CLOSING) return;
    const settings = await this.settings.get();
    if (!settings.connected || !settings.backendUrl)
      throw new Error('Connect to the room service first.');
    const token = await this.settings.accessToken();
    const url = new URL(`/v1/rooms/${encodeURIComponent(roomId)}/connect`, settings.backendUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('after', String(this.store.cursor(roomId)));
    const socket = new WebSocket(url, [`bearer.${token}`, 'sf.v1']);
    this.sockets.set(roomId, socket);
    socket.addEventListener('open', () => {
      this.emit('connection', { roomId, state: 'connected' });
      void this.syncRoom(roomId)
        .then(() => this.flushOutbox(roomId))
        .catch((error: unknown) => this.emit('service/error', errorMessage(error)));
    });
    socket.addEventListener('message', (message) => {
      try {
        const event = JSON.parse(String(message.data)) as RoomEvent;
        this.acceptEvent(roomId, event);
      } catch {
        this.emit('service/error', 'The room service sent an invalid event.');
      }
    });
    socket.addEventListener('error', () => this.emit('connection', { roomId, state: 'error' }));
    socket.addEventListener('close', () => {
      if (this.sockets.get(roomId) === socket) this.sockets.delete(roomId);
      this.emit('connection', { roomId, state: 'offline' });
      this.scheduleReconnect(roomId);
    });
  }

  private scheduleReconnect(roomId: string): void {
    if (this.stopped || !this.subscribedRooms.has(roomId) || this.reconnectTimers.has(roomId))
      return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(roomId);
      void this.connectSocket(roomId).catch((error: unknown) =>
        this.emit('service/error', errorMessage(error)),
      );
    }, 2_000);
    this.reconnectTimers.set(roomId, timer);
  }

  private acceptEvent(roomId: string, event: RoomEvent): void {
    if (!Number.isInteger(event.eventSeq) || event.eventSeq < 1) return;
    const cursor = this.store.cursor(roomId);
    if (event.eventSeq <= cursor) return;
    if (event.eventSeq > cursor + 1) {
      let buffer = this.bufferedEvents.get(roomId);
      if (!buffer) {
        buffer = new Map();
        this.bufferedEvents.set(roomId, buffer);
      }
      if (buffer.size < 1000) buffer.set(event.eventSeq, event);
      void this.syncRoom(roomId).catch((error: unknown) =>
        this.emit('service/error', errorMessage(error)),
      );
      return;
    }
    this.applyContiguousEvent(roomId, event);
    const buffer = this.bufferedEvents.get(roomId);
    if (!buffer) return;
    while (true) {
      const next = buffer.get(this.store.cursor(roomId) + 1);
      if (!next) break;
      buffer.delete(next.eventSeq);
      this.applyContiguousEvent(roomId, next);
    }
    if (!buffer.size) this.bufferedEvents.delete(roomId);
  }

  private applyContiguousEvent(roomId: string, event: RoomEvent): void {
    if (this.store.applyEvent(roomId, event)) this.emit('event', { roomId, event });
  }

  private async api<T = unknown>(
    route: string,
    options: { method?: string; body?: unknown; allowConflict?: boolean } = {},
  ): Promise<ApiResult<T>> {
    const settings = await this.settings.get();
    if (!settings.connected || !settings.backendUrl)
      throw new Error('Connect to the room service first.');
    const token = await this.settings.accessToken();
    return this.requestAt<T>(settings.backendUrl, route, {
      ...(options.method ? { method: options.method } : {}),
      headers: { authorization: `Bearer ${token}` },
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.allowConflict === undefined ? {} : { allowConflict: options.allowConflict }),
    });
  }

  private async requestAt<T>(
    backendUrl: string,
    route: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      allowConflict?: boolean;
    },
  ): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await fetch(new URL(route, backendUrl), {
        method: options.method || 'GET',
        headers: {
          ...(options.headers || {}),
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new Error('Could not reach the chat service. Check your internet connection and try again.');
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text || 'Invalid service response.' };
    }
    if (!response.ok && !(options.allowConflict && response.status === 409)) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Room service returned ${response.status}.`;
      throw new Error(message);
    }
    return { status: response.status, body: body as T };
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
    throw new Error('The room service URL must use HTTPS.');
  return url.toString().replace(/\/+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}
