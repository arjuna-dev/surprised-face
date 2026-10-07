import { EventEmitter } from 'node:events';
import { CodexDesktopUnavailable } from './codex-desktop-link';

type DesktopTurnBridge = {
  startTurn(input: { threadId: string; text: string; cwd?: string }): Promise<unknown>;
};

type Harness = 'codex' | 'hermes';
type NativeChatInput = { harness: Harness; sessionId: string; cwd: string; text: string };
type CodexClient = EventEmitter & {
  startThread(input: { cwd: string; model?: string }): Promise<unknown>;
  resumeThread(input: { threadId: string; cwd?: string }): Promise<unknown>;
  startTurn(input: { threadId: string; text: string; cwd?: string }): Promise<unknown>;
};
type HermesClient = EventEmitter & {
  newSession(model?: string, cwd?: string): Promise<{ sessionId: string }>;
  loadSession(sessionId: string, cwd?: string): Promise<unknown>;
  prompt(sessionId: string, text: string): Promise<unknown>;
};
type ActiveTurn = {
  input: NativeChatInput;
  sawText: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class NativeChatService extends EventEmitter {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly resumed = new Set<string>();
  private readonly owned = new Set<string>();

  constructor(private readonly codex: CodexClient, private readonly hermes: HermesClient, private readonly desktop: DesktopTurnBridge | null = null) {
    super();
    codex.on('event', (event: unknown) => this.onCodex(event));
    hermes.on('event', (event: unknown) => this.onHermes(event));
  }

  isActive(harness: Harness, sessionId: string): boolean {
    return this.active.has(`${harness}:${sessionId}`);
  }

  async create(input: { harness: Harness; cwd: string; model?: string }): Promise<{ harness: Harness; sessionId: string; cwd: string }> {
    if (!input.cwd.trim()) throw new Error('Choose a project before starting a chat.');
    if (input.harness !== 'codex' && input.harness !== 'hermes') throw new Error('Choose Codex or Hermes.');
    const result = input.harness === 'codex'
      ? object(await this.codex.startThread({ cwd: input.cwd, ...(input.model ? { model: input.model } : {}) }))
      : await this.hermes.newSession(input.model, input.cwd);
    const sessionId = input.harness === 'codex' ? string(object(object(result)?.thread)?.id) : string(object(result)?.sessionId);
    if (!sessionId) throw new Error('The agent did not create a chat. Try again.');
    const key = `${input.harness}:${sessionId}`;
    this.resumed.add(key);
    this.owned.add(key);
    return { harness: input.harness, sessionId, cwd: input.cwd };
  }

  owns(harness: Harness, sessionId: string): boolean {
    return this.owned.has(`${harness}:${sessionId}`);
  }

  async send(input: NativeChatInput): Promise<void> {
    const { harness, sessionId, cwd, text } = input;
    if (!sessionId || !cwd || !text.trim()) throw new Error('Choose a chat with a working folder and enter a message.');
    const key = `${harness}:${sessionId}`;
    if (this.active.has(key)) throw new Error('This chat is still answering.');
    const tryDesktop = harness === 'codex' && Boolean(this.desktop) && !this.owned.has(key);
    if (!tryDesktop && !this.resumed.has(key)) await this.resume(harness, sessionId, cwd, key);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const complete = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    complete.catch(() => undefined);
    const timer = setTimeout(() => this.finish(key, 'failed', 'The agent did not finish within 45 minutes.'), 45 * 60_000);
    this.active.set(key, { input, sawText: false, resolve, reject, timer });
    this.emit('event', { harness, sessionId, type: 'started' });
    try {
      if (harness === 'codex' && this.desktop && !this.owned.has(key)) {
        try {
          await this.desktop.startTurn({ threadId: sessionId, text, cwd });
          this.finish(key, 'completed');
          return;
        } catch (error) {
          if (!isDesktopUnavailable(error)) throw error;
        }
      }
      if (!this.resumed.has(key)) await this.resume(harness, sessionId, cwd, key);
      if (harness === 'codex') await this.codex.startTurn({ threadId: sessionId, text, cwd });
      else await this.hermes.prompt(sessionId, text);
      await complete;
    } catch (error) {
      this.finish(key, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async resume(harness: Harness, sessionId: string, cwd: string, key: string): Promise<void> {
    if (harness === 'codex') await this.codex.resumeThread({ threadId: sessionId, cwd });
    else await this.hermes.loadSession(sessionId, cwd);
    this.resumed.add(key);
  }

  private onCodex(value: unknown): void {
    const event = object(value);
    if (event?.type === 'process/exited' || event?.type === 'process/error') {
      for (const key of this.active.keys()) if (key.startsWith('codex:')) this.finish(key, 'failed', 'Codex stopped.');
      this.resumed.clear();
      return;
    }
    const params = object(event?.params);
    const sessionId = string(params?.threadId);
    const key = `codex:${sessionId}`;
    const active = this.active.get(key);
    if (!active) return;
    if (event?.method === 'item/agentMessage/delta') this.delta(key, string(params?.delta));
    else if (event?.method === 'item/completed' && !active.sawText) {
      const item = object(params?.item);
      if (item?.type === 'agentMessage' || item?.type === 'assistant_message') this.delta(key, string(item.text));
    } else if (event?.method === 'turn/completed') this.finish(key, 'completed');
    else if (event?.method === 'turn/failed') this.finish(key, 'failed', string(params?.error) || 'Codex turn failed.');
  }

  private onHermes(value: unknown): void {
    const event = object(value);
    if (event?.type === 'process/exited') {
      for (const key of this.active.keys()) if (key.startsWith('hermes:')) this.finish(key, 'failed', string(event.message) || 'Hermes stopped.');
      for (const key of this.resumed) if (key.startsWith('hermes:')) this.resumed.delete(key);
      return;
    }
    const key = `hermes:${string(event?.sessionId)}`;
    if (!this.active.has(key)) return;
    if (event?.type === 'message') this.delta(key, string(event.text));
    else if (event?.type === 'prompt/completed') this.finish(key, 'completed');
    else if (event?.type === 'prompt/failed') this.finish(key, 'failed', string(event.message) || 'Hermes turn failed.');
  }

  private delta(key: string, text: string): void {
    const active = this.active.get(key);
    if (!active || !text) return;
    active.sawText = true;
    this.emit('event', { harness: active.input.harness, sessionId: active.input.sessionId, type: 'delta', text });
  }

  private finish(key: string, type: 'completed' | 'failed', message = ''): void {
    const active = this.active.get(key);
    if (!active) return;
    this.active.delete(key);
    clearTimeout(active.timer);
    this.emit('event', { harness: active.input.harness, sessionId: active.input.sessionId, type, ...(message ? { message } : {}) });
    if (type === 'failed') active.reject(new Error(message));
    else active.resolve();
  }
}

function isDesktopUnavailable(error: unknown): boolean {
  return error instanceof CodexDesktopUnavailable || (error instanceof Error && error.name === 'CodexDesktopUnavailable');
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
