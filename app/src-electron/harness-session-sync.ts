export type SyncMessage = {
  id: string;
  messageSeq: number;
  participantName: string;
  role: 'user' | 'assistant';
  text: string;
  agentName?: string | null;
};

export type SyncSession = {
  agent_id: string;
  harness: string;
  native_session_id: string;
  working_directory: string;
  model: string;
  context_through_seq: number;
};

type SyncStore = {
  messages(roomId: string): SyncMessage[];
  agentSessionsForRoom(roomId: string): SyncSession[];
  turnRequestMessageIds(roomId: string): string[];
  saveAgentSession(input: { roomId: string; agentId: string; harness: string; sessionId: string; cwd: string; model?: string; contextThroughSeq?: number }): void;
};

export type HarnessAppend = (input: { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; text: string }) => Promise<void>;

/** Plain text for a harness session. This is not the room JSON or the context mirror file. */
export function formatHarnessContext(messages: SyncMessage[]): string {
  return messages.map((message) => {
    const author = message.role === 'assistant'
      ? message.agentName?.trim() || 'Harness'
      : message.participantName?.trim() || 'Person';
    return `${author}:\n${message.text.trim()}`;
  }).join('\n\n');
}

/**
 * Copy new shared messages into the local harness session linked to the room.
 * A message that queued a harness turn is left for that turn, so a mention still gets a reply.
 * This path never writes the messages back to the room database.
 */
export class HarnessSessionSync {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: SyncStore,
    private readonly append: HarnessAppend,
    private readonly delayMs = 300,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  schedule(roomId: string): void {
    if (!roomId) return;
    const existing = this.timers.get(roomId);
    if (existing) clearTimeout(existing);
    this.timers.set(roomId, setTimeout(() => {
      this.timers.delete(roomId);
      void this.push(roomId).catch((error: unknown) => this.onError(error));
    }, this.delayMs));
  }

  async push(roomId: string): Promise<void> {
    if (!roomId) return;
    const previous = this.pending.get(roomId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.write(roomId));
    this.pending.set(roomId, next);
    try {
      await next;
    } finally {
      if (this.pending.get(roomId) === next) this.pending.delete(roomId);
    }
  }

  private async write(roomId: string): Promise<void> {
    const sessions = this.store.agentSessionsForRoom(roomId);
    if (!sessions.length) return;
    const messages = this.store.messages(roomId);
    const turnRequests = new Set(this.store.turnRequestMessageIds(roomId));
    for (const session of sessions) {
      if (session.harness !== 'codex' && session.harness !== 'hermes') continue;
      const deliverable: SyncMessage[] = [];
      for (const message of messages) {
        if (message.messageSeq <= session.context_through_seq) continue;
        if (turnRequests.has(message.id)) break;
        if (!message.text.trim()) continue;
        deliverable.push(message);
      }
      const last = deliverable.at(-1);
      if (!last) continue;
      await this.append({
        harness: session.harness,
        sessionId: session.native_session_id,
        cwd: session.working_directory,
        text: formatHarnessContext(deliverable),
      });
      this.store.saveAgentSession({
        roomId,
        agentId: session.agent_id,
        harness: session.harness,
        sessionId: session.native_session_id,
        cwd: session.working_directory,
        model: session.model,
        contextThroughSeq: last.messageSeq,
      });
    }
  }
}
