import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoomService } from '../src-electron/room-service';
import type { RoomEvent } from '../src-electron/local-store';
import type { SettingsStore } from '../src-electron/settings-store';

test('applies out-of-order room events only after the missing sequence arrives', () => {
  let cursor = 0;
  const applied: number[] = [];
  const store = {
    cursor: () => cursor,
    applyEvent: (_roomId: string, event: RoomEvent) => {
      if (event.eventSeq <= cursor) return false;
      assert.equal(event.eventSeq, cursor + 1, 'local event cursor must stay contiguous');
      cursor = event.eventSeq;
      applied.push(event.eventSeq);
      return true;
    },
  };
  const service = new RoomService({} as SettingsStore, store as never);
  const internal = service as unknown as {
    acceptEvent(roomId: string, event: RoomEvent): void;
    syncRoom(roomId: string): Promise<void>;
  };
  internal.syncRoom = async () => {};

  internal.acceptEvent('room-1', { eventSeq: 2, type: 'message.created' });
  internal.acceptEvent('room-1', { eventSeq: 1, type: 'message.created' });

  assert.deepEqual(applied, [1, 2]);
  assert.equal(cursor, 2);
  service.disconnect();
});

test('flushes pending sends once and in the outbox order', async () => {
  const rows = [
    { client_id: 'first', room_id: 'room-1', text: 'first message', agent_ids: '[]', state: 'pending' },
    { client_id: 'second', room_id: 'room-1', text: 'second message', agent_ids: '[]', state: 'pending' },
  ];
  const store = {
    pendingMessages: () => rows.filter((row) => row.state === 'pending'),
    updateOutbox: (clientId: string, state: string) => {
      const row = rows.find((item) => item.client_id === clientId);
      if (row) row.state = state;
    },
  };
  const service = new RoomService({} as SettingsStore, store as never);
  const internal = service as unknown as {
    flushOutbox(roomId: string): Promise<void>;
    syncRoom(roomId: string): Promise<void>;
    api(route: string, options: { body?: unknown }): Promise<unknown>;
  };
  const sent: string[] = [];
  const acknowledgements: unknown[] = [];
  service.on('outbox/changed', (value) => acknowledgements.push(value));
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  internal.syncRoom = async () => {};
  internal.api = async (_route, options) => {
    const body = options.body as { clientId: string };
    activeRequests++;
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    sent.push(body.clientId);
    activeRequests--;
    return { status: 200 };
  };

  await Promise.all([internal.flushOutbox('room-1'), internal.flushOutbox('room-1')]);

  assert.deepEqual(sent, ['first', 'second']);
  assert.equal(maximumConcurrentRequests, 1);
  assert.deepEqual(rows.map((row) => row.state), ['sent', 'sent']);
  assert.ok(acknowledgements.some((value) => (value as { roomId: string }).roomId === 'room-1'), 'the UI must be told when queued messages are acknowledged');
  service.disconnect();
});
