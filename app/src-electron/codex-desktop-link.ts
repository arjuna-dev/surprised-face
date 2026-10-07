import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { messagesFromCodexSession } from '../src/lib/codex-session';
import type { NativeDisplayMessage } from '../src/lib/native-transcript';

type IpcMessage = {
  type?: string;
  requestId?: string;
  method?: string;
  resultType?: string;
  error?: unknown;
  result?: { clientId?: unknown };
  response?: { canHandle?: boolean };
};

export class CodexDesktopUnavailable extends Error {
  constructor(message = 'Codex desktop is not owning this chat.') {
    super(message);
    this.name = 'CodexDesktopUnavailable';
  }
}

/**
 * Talks to the Codex desktop thread that is already open.
 * Messages go out through its local IPC router and replies are read from the same session file Codex writes.
 */
export class CodexDesktopLink {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private clientId: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, { resolve: (message: IpcMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly options: { socketPath: string; sessionFile: string | null; acceptTimeoutMs?: number }) {}

  async connect(): Promise<void> {
    if (this.clientId) return;
    this.connectPromise ??= this.open().catch((error: unknown) => {
      this.connectPromise = null;
      throw error;
    });
    await this.connectPromise;
  }

  async startTurn(input: { threadId: string; text: string; cwd?: string }): Promise<NativeDisplayMessage[]> {
    await this.connect();
    const previousCount = this.readSession().messages.length;
    const acceptTimeoutMs = this.options.acceptTimeoutMs ?? 8_000;
    const requestId = randomUUID();
    const response = this.request({
      type: 'request',
      requestId,
      sourceClientId: this.clientId,
      version: 2,
      method: 'thread-follower-start-turn',
      params: {
        conversationId: input.threadId,
        turnStart: {
          request: {
            threadId: input.threadId,
            input: [{ type: 'text', text: input.text, text_elements: [] }],
            ...(input.cwd ? { cwd: input.cwd } : {}),
          },
          context: {},
        },
      },
    }, acceptTimeoutMs).then((message) => {
      const error = typeof message.error === 'string' ? message.error : '';
      if (message.resultType === 'error' || error) {
        if (/no-client-found|owner became unavailable|unavailable/i.test(error)) throw new CodexDesktopUnavailable(error || 'Codex desktop is not owning this chat.');
        throw new Error(error || 'Codex desktop rejected the message.');
      }
    });
    const appeared = this.waitFor(() => this.hasNewUserText(input.text, previousCount), acceptTimeoutMs).then((found) => {
      if (!found) throw new CodexDesktopUnavailable('Codex desktop did not accept the message.');
    });
    try {
      await Promise.any([response, appeared]);
    } catch (error) {
      const errors = error instanceof AggregateError ? error.errors : [error];
      if (!this.hasNewUserText(input.text, previousCount)) {
        const rejected = errors.find((item) => item instanceof Error && !(item instanceof CodexDesktopUnavailable));
        throw rejected ?? errors.find((item) => item instanceof CodexDesktopUnavailable) ?? new CodexDesktopUnavailable();
      }
    }
    if (!this.hasNewUserText(input.text, previousCount)) {
      const found = await this.waitFor(() => this.hasNewUserText(input.text, previousCount), acceptTimeoutMs);
      if (!found) throw new Error('Codex desktop accepted the message, but it was not saved to the chat.');
    }
    const settled = await this.waitFor(() => this.turnSettled(input.text, previousCount), 45 * 60_000);
    if (!settled) throw new Error('Codex did not finish the reply.');
    return this.readSession().messages;
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexDesktopUnavailable('Codex desktop connection closed.'));
    }
    this.pending.clear();
    this.socket?.destroy();
    this.socket = null;
    this.clientId = null;
    this.connectPromise = null;
    this.buffer = Buffer.alloc(0);
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.options.socketPath);
      this.socket = socket;
      const fail = (error: Error) => reject(new CodexDesktopUnavailable(error.message));
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        socket.on('error', () => this.failPending(new CodexDesktopUnavailable('Codex desktop connection closed.')));
        socket.on('close', () => this.failPending(new CodexDesktopUnavailable('Codex desktop connection closed.')));
        socket.on('data', (chunk: Buffer) => this.onData(chunk));
        const requestId = randomUUID();
        this.pending.set(requestId, {
          resolve: (message) => {
            if (message.resultType === 'error') reject(new CodexDesktopUnavailable(typeof message.error === 'string' ? message.error : 'Codex desktop rejected initialization.'));
            else {
              this.clientId = typeof message.result?.clientId === 'string' ? message.result.clientId : 'surprised-face';
              resolve();
            }
          },
          reject,
          timer: setTimeout(() => {
            this.pending.delete(requestId);
            reject(new CodexDesktopUnavailable('Codex desktop did not accept the connection.'));
          }, this.options.acceptTimeoutMs ?? 8_000),
        });
        this.write({ type: 'request', requestId, sourceClientId: 'surprised-face', method: 'initialize', params: { clientType: 'surprised-face' } });
      });
    });
  }

  private request(message: Record<string, unknown>, timeoutMs: number): Promise<IpcMessage> {
    const requestId = String(message.requestId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new CodexDesktopUnavailable('Codex desktop did not accept the message.'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.write(message);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > 32_000_000) {
        this.failPending(new Error('Codex desktop sent a message that is too large.'));
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      let message: IpcMessage;
      try { message = JSON.parse(body.toString()) as IpcMessage; } catch { continue; }
      this.onMessage(message);
    }
  }

  private onMessage(message: IpcMessage): void {
    if (message.type === 'client-discovery-request' && message.requestId) {
      this.write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
      return;
    }
    if (message.type === 'request' && message.requestId) {
      this.write({ type: 'response', requestId: message.requestId, resultType: 'error', error: 'no-handler-for-request' });
      return;
    }
    if (message.type === 'response' && message.requestId && this.pending.has(message.requestId)) {
      const pending = this.pending.get(message.requestId)!;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  }

  private write(message: unknown): void {
    if (!this.socket?.writable) throw new CodexDesktopUnavailable('Codex desktop is not connected.');
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    this.socket.write(Buffer.concat([header, body]));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.clientId = null;
    this.connectPromise = null;
  }

  private readSession() {
    if (!this.options.sessionFile || !existsSync(this.options.sessionFile)) return { messages: [], settled: false };
    return messagesFromCodexSession(readFileSync(this.options.sessionFile, 'utf8'));
  }

  private hasNewUserText(text: string, previousCount: number): boolean {
    return this.readSession().messages.slice(previousCount).some((message) => message.role === 'user' && message.content.trim() === text.trim());
  }

  private turnSettled(text: string, previousCount: number): boolean {
    const session = this.readSession();
    return session.settled && this.hasNewUserText(text, previousCount);
  }

  private async waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  }
}
