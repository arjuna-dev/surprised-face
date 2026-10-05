import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { accessSync, constants, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Hermes uses its local ACP process. The app leaves Hermes's installed settings
 * and permissions in control of its tools.
 */

const ACP_PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 60_000;
const SESSION_TIMEOUT_MS = 120_000;
/** Hermes stops waiting for a permission answer after 60 seconds and treats it as denied. */
const PERMISSION_TIMEOUT_MS = 60_000;
const STDERR_TAIL_LINES = 30;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Json;
  result?: Json;
  error?: { code: number; message: string; data?: Json };
}

interface PendingRequest {
  method: string;
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface PendingPermission {
  rpcId: number | string;
  sessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface HermesInstallation {
  installed: boolean;
  executable: string | null;
  version: string | null;
  running: boolean;
  message: string | null;
}

export interface HermesModelOption {
  id: string;
  name: string;
  description: string;
}

export interface HermesModels {
  available: HermesModelOption[];
  current: string;
}

export interface HermesSessionInfo {
  sessionId: string;
  models: HermesModels | null;
}

export interface HermesPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export type HermesEvent =
  | { type: 'message'; sessionId: string; messageId: string; text: string }
  | { type: 'tool'; sessionId: string; toolCallId: string; title: string; status: string }
  | { type: 'prompt/completed'; sessionId: string; stopReason: string }
  | { type: 'prompt/failed'; sessionId: string; message: string }
  | {
      type: 'permission/request';
      requestId: string;
      sessionId: string;
      title: string;
      detail: string;
      options: HermesPermissionOption[];
      expiresAt: number;
    }
  | { type: 'permission/closed'; requestId: string }
  /** A provider problem Hermes only logs, such as a rate limit it waits out before retrying. */
  | { type: 'notice'; message: string }
  | { type: 'process/exited'; message: string };

export interface HermesAcpOptions {
  environment: () => Record<string, string>;
  workingDirectory: () => string;
  clientVersion: string;
}

export class HermesAcpClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private initializePromise: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly permissions = new Map<string, PendingPermission>();
  /** Sessions whose history Hermes is replaying during session/load. Their updates are dropped. */
  private readonly replaying = new Set<string>();
  private readonly activePrompts = new Set<string>();
  private stderrTail: string[] = [];
  private lastApiError = '';
  private installation: HermesInstallation | null = null;
  private models: HermesModels | null = null;

  constructor(private readonly options: HermesAcpOptions) {
    super();
  }

  async status(refresh = false): Promise<HermesInstallation> {
    if (!this.installation || refresh) {
      this.installation = await detectHermes();
    }
    return { ...this.installation, running: Boolean(this.proc) };
  }

  /** Model list for the settings picker. A throwaway session is created once to read it. */
  async listModels(refresh = false): Promise<HermesModels | null> {
    if (this.models && !refresh) return this.models;
    await this.ensureStarted();
    const result = asObject(await this.request('session/new', { cwd: this.options.workingDirectory(), mcpServers: [] }, SESSION_TIMEOUT_MS));
    this.models = parseModels(result?.models);
    return this.models;
  }

  async newSession(model?: string, workingDirectory?: string): Promise<HermesSessionInfo> {
    await this.ensureStarted();
    const result = asObject(await this.request('session/new', { cwd: workingDirectory || this.options.workingDirectory(), mcpServers: [] }, SESSION_TIMEOUT_MS));
    const sessionId = typeof result?.sessionId === 'string' ? result.sessionId : '';
    if (!sessionId) throw new Error('Hermes did not create a conversation.');
    let models = parseModels(result?.models);
    if (models) this.models = models;
    if (model && models && model !== models.current) {
      try {
        await this.setModel(sessionId, model);
      } catch (error) {
        throw new Error(`Hermes could not switch to ${model}: ${errorMessage(error)}`);
      }
      models = { ...models, current: model };
    }
    return { sessionId, models };
  }

  /** Reopen a saved conversation after the app or Hermes restarted. */
  async loadSession(sessionId: string, workingDirectory?: string): Promise<HermesSessionInfo> {
    await this.ensureStarted();
    this.replaying.add(sessionId);
    try {
      const result = await this.request('session/load', { sessionId, cwd: workingDirectory || this.options.workingDirectory(), mcpServers: [] }, SESSION_TIMEOUT_MS);
      if (result === null || typeof result !== 'object') throw new Error('Hermes no longer has this conversation.');
      return { sessionId, models: parseModels(asObject(result)?.models) };
    } finally {
      this.replaying.delete(sessionId);
    }
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.ensureStarted();
    await this.request('session/set_model', { sessionId, modelId }, SESSION_TIMEOUT_MS);
  }

  /**
   * Start a turn. Returns once Hermes accepted the request; the answer streams as `message`
   * events and the turn ends with `prompt/completed` or `prompt/failed`.
   */
  async prompt(sessionId: string, text: string): Promise<{ accepted: true }> {
    await this.ensureStarted();
    if (this.activePrompts.has(sessionId)) throw new Error('This conversation is still working.');
    this.activePrompts.add(sessionId);
    this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 0)
      .then((result) => {
        const stopReason = asObject(result)?.stopReason;
        this.publish({ type: 'prompt/completed', sessionId, stopReason: typeof stopReason === 'string' ? stopReason : 'end_turn' });
      })
      .catch((error: unknown) => {
        this.publish({ type: 'prompt/failed', sessionId, message: errorMessage(error) });
      })
      .finally(() => this.activePrompts.delete(sessionId));
    return { accepted: true };
  }

  cancel(sessionId: string): void {
    for (const [requestId, permission] of this.permissions) {
      if (permission.sessionId === sessionId) this.respondPermission(requestId, null);
    }
    if (this.proc?.stdin.writable) this.write({ method: 'session/cancel', params: { sessionId } });
  }

  /** Answer a permission request. `null` declines it. */
  respondPermission(requestId: string, optionId: string | null): void {
    const permission = this.permissions.get(requestId);
    if (!permission) return;
    clearTimeout(permission.timer);
    this.permissions.delete(requestId);
    const outcome = optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' };
    if (this.proc?.stdin.writable) this.write({ id: permission.rpcId, result: { outcome } });
    this.publish({ type: 'permission/closed', requestId });
  }

  /** Stop the process. The next request starts a fresh one, with the current settings. */
  stop(): void {
    const proc = this.proc;
    this.proc = null;
    this.initializePromise = null;
    this.models = null;
    this.rejectPending(new Error('Hermes stopped.'));
    this.closePermissions();
    proc?.kill();
  }

  private async ensureStarted(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.start().catch((error: unknown) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  private async start(): Promise<void> {
    const installation = await this.status(true);
    if (!installation.executable) throw new Error(installation.message || 'Hermes was not found on this computer.');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.environment(),
    };

    this.stderrTail = [];
    const proc = spawn(installation.executable, ['acp'], {
      cwd: this.options.workingDirectory(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    const startupError = new Promise<never>((_resolve, reject) => {
      proc.once('error', (error) => reject(new Error(`Could not start Hermes: ${error.message}`)));
      proc.once('exit', (code) => reject(new Error(this.exitMessage(code))));
    });
    startupError.catch(() => undefined);

    proc.once('exit', (code, signal) => {
      if (this.proc !== proc) return;
      const message = this.exitMessage(code, signal);
      this.proc = null;
      this.initializePromise = null;
      this.models = null;
      this.rejectPending(new Error(message));
      this.closePermissions();
      this.publish({ type: 'process/exited', message });
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').map((line) => line.trimEnd()).filter(Boolean);
      this.stderrTail = [...this.stderrTail, ...lines].slice(-STDERR_TAIL_LINES);
      for (const line of lines) this.watchLogLine(line);
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(line));

    await Promise.race([
      this.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'surprised-face', title: 'surprised-face', version: this.options.clientVersion },
      }, REQUEST_TIMEOUT_MS),
      startupError,
    ]);
  }

  private exitMessage(code: number | null, signal?: NodeJS.Signals | null): string {
    const lastError = [...this.stderrTail].reverse().find((line) => /error|exception|traceback|can't open file|no such file/i.test(line));
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    return `Hermes stopped (${reason}).${lastError ? ` ${lastError}` : ''}`;
  }

  /**
   * Hermes retries failed model calls silently, for example 600 seconds after a rate limit.
   * Its log is the only place that says so, so turn those two lines into a notice.
   */
  private watchLogLine(line: string): void {
    const failure = /API call failed .*summary=(.+)$/.exec(line);
    if (failure?.[1]) {
      this.lastApiError = failure[1].trim();
      return;
    }
    const retry = /Retrying API call in (\d+)s/.exec(line);
    if (retry?.[1]) {
      const reason = this.lastApiError ? ` (${this.lastApiError})` : '';
      this.publish({ type: 'notice', message: `The model provider returned an error${reason}. Hermes tries again in ${retry[1]} seconds. Stop and pick another model to continue now.` });
    }
  }

  private request(method: string, params: Json, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Json> {
    if (!this.proc?.stdin.writable) return Promise.reject(new Error('Hermes is not running.'));
    const id = this.nextId++;
    const promise = new Promise<Json>((resolve, reject) => {
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`Hermes did not answer in time (${method}).`));
          }, timeoutMs)
        : null;
      this.pending.set(id, { method, resolve, reject, timeout });
    });
    this.write({ id, method, params });
    return promise;
  }

  private write(message: RpcMessage): void {
    this.proc?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return; // Hermes logs to stderr; anything else on stdout is not protocol.
    }

    if (message.id !== undefined && message.method) {
      this.handleAgentRequest(message.id, message.method, asObject(message.params));
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (pending.timeout) clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(describeRpcError(message.error)));
      else pending.resolve(message.result === undefined ? null : message.result);
      return;
    }

    if (message.method === 'session/update') {
      const params = asObject(message.params);
      const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';
      if (sessionId && !this.replaying.has(sessionId)) this.handleUpdate(sessionId, asObject(params?.update));
    }
  }

  private handleAgentRequest(rpcId: number | string, method: string, params: JsonObject | null): void {
    if (method !== 'session/request_permission') {
      // No file system or terminal capabilities were offered, so nothing else is expected.
      this.write({ id: rpcId, error: { code: -32601, message: `surprised-face does not support ${method}.` } });
      return;
    }
    const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';
    const toolCall = asObject(params?.toolCall);
    const options = (Array.isArray(params?.options) ? params.options : [])
      .map((option) => asObject(option))
      .filter((option): option is JsonObject => Boolean(option && typeof option.optionId === 'string'))
      .map((option) => ({ optionId: stringField(option.optionId, ''), name: stringField(option.name, stringField(option.optionId, '')), kind: stringField(option.kind, '') }));
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      // Hermes has given up waiting and denied the request; only the dialog needs closing.
      this.permissions.delete(requestId);
      this.publish({ type: 'permission/closed', requestId });
    }, PERMISSION_TIMEOUT_MS);
    this.permissions.set(requestId, { rpcId, sessionId, timer });
    this.publish({
      type: 'permission/request',
      requestId,
      sessionId,
      title: typeof toolCall?.title === 'string' ? toolCall.title : 'Hermes wants to continue',
      detail: toolCallText(toolCall),
      options,
      expiresAt: Date.now() + PERMISSION_TIMEOUT_MS,
    });
  }

  private handleUpdate(sessionId: string, update: JsonObject | null): void {
    const kind = update?.sessionUpdate;
    if (kind === 'agent_message_chunk') {
      const content = asObject(update?.content);
      if (content?.type === 'text' && typeof content.text === 'string' && content.text) {
        const messageId = typeof update?.messageId === 'string' && update.messageId ? update.messageId : 'reply';
        this.publish({ type: 'message', sessionId, messageId, text: content.text });
      }
      return;
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const toolCallId = typeof update?.toolCallId === 'string' ? update.toolCallId : '';
      if (!toolCallId) return;
      this.publish({
        type: 'tool',
        sessionId,
        toolCallId,
        title: typeof update?.title === 'string' ? update.title : '',
        status: typeof update?.status === 'string' ? update.status : kind === 'tool_call' ? 'pending' : '',
      });
    }
  }

  private publish(event: HermesEvent): void {
    this.emit('event', event);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private closePermissions(): void {
    for (const [requestId, permission] of this.permissions) {
      clearTimeout(permission.timer);
      this.publish({ type: 'permission/closed', requestId });
    }
    this.permissions.clear();
  }
}

async function detectHermes(): Promise<HermesInstallation> {
  const base = { running: false };
  const executable = findExecutable('hermes', [
    process.env.HERMES_BIN || '',
    path.join(os.homedir(), '.local/bin/hermes'),
    '/opt/homebrew/bin/hermes',
    '/usr/local/bin/hermes',
    process.env.HERMES_AGENT_BIN || '',
    findExecutable('hermes-agent', []) || '',
  ]);

  if (!executable) {
    return {
      ...base,
      installed: false,
      executable: null,
      version: null,
      message: 'Install Hermes and configure a model with its own CLI, then check again.',
    };
  }

  try {
    const version = (await run(executable, ['--version'])).trim();
    return { ...base, installed: true, executable, version: version || null, message: null };
  } catch (error) {
    return { ...base, installed: false, executable, version: null, message: `Found Hermes at ${executable}, but it did not start: ${errorMessage(error)}` };
  }
}

function run(command: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  return new Promise((resolve, reject) => {
    // A neutral working folder keeps a local package from shadowing Hermes modules.
    execFile(command, args, { cwd: os.homedir(), env, timeout: 20_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().split('\n').pop() || error.message));
      else resolve(String(stdout));
    });
  });
}

function findExecutable(command: string, candidates: string[]): string | null {
  const names = process.platform === 'win32' ? [`${command}.exe`, `${command}.cmd`, command] : [command];
  const fromPath = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => path.join(directory, name)));
  return [candidates[0] || '', ...fromPath, ...candidates.slice(1)].find(isExecutable) || null;
}

function isFile(filePath: string): boolean {
  if (!filePath) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExecutable(filePath: string): boolean {
  if (!isFile(filePath)) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function parseModels(value: Json | undefined): HermesModels | null {
  const record = asObject(value ?? null);
  if (!record || !Array.isArray(record.availableModels)) return null;
  const available = record.availableModels
    .map((item) => asObject(item))
    .filter((item): item is JsonObject => Boolean(item && typeof item.modelId === 'string'))
    .map((item) => ({
      id: stringField(item.modelId, ''),
      name: stringField(item.name, stringField(item.modelId, '')),
      description: typeof item.description === 'string' ? item.description : '',
    }));
  return { available, current: typeof record.currentModelId === 'string' ? record.currentModelId : '' };
}

function toolCallText(toolCall: JsonObject | null): string {
  const parts: string[] = [];
  for (const item of Array.isArray(toolCall?.content) ? toolCall.content : []) {
    const entry = asObject(item);
    const content = asObject(entry?.content ?? null);
    if (content?.type === 'text' && typeof content.text === 'string') parts.push(content.text);
    else if (entry?.type === 'diff' && typeof entry.path === 'string') {
      parts.push(`File: ${entry.path}\n${typeof entry.newText === 'string' ? entry.newText.slice(0, 1500) : ''}`);
    }
  }
  const text = parts.join('\n\n').trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function describeRpcError(error: { code: number; message: string; data?: Json }): string {
  const data = asObject(error.data ?? null);
  const details = typeof error.data === 'string' ? error.data : typeof data?.details === 'string' ? data.details : '';
  return details && !error.message.includes(details) ? `${error.message}: ${details}` : error.message;
}

function stringField(value: Json | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asObject(value: Json | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
