import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import { app } from 'electron';
import { resolveSheepExecutable } from './sheep-path';

const PROTOCOL_VERSION = 'sheep.bridge.v1';
const REQUEST_TIMEOUT_MS = 60_000;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type BridgeResponse = {
  id?: string;
  version?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

export class SheepBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private startup: Promise<void> | null = null;
  private stderrTail: string[] = [];

  async request<T>(op: string, payload?: Record<string, unknown>): Promise<T> {
    await this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) throw new Error('Sheep bridge is not running.');
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sheep did not answer ${op} in time.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      child.stdin.write(
        `${JSON.stringify({ id, version: PROTOCOL_VERSION, op, ...(payload ? { payload } : {}) })}\n`,
      );
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.startup = null;
    child?.kill();
    this.rejectPending(new Error('Sheep bridge stopped.'));
  }

  private async ensureStarted(): Promise<void> {
    if (this.startup) return this.startup;
    this.startup = this.start().catch((error: unknown) => {
      this.stop();
      throw error;
    });
    return this.startup;
  }

  private async start(): Promise<void> {
    const executable = resolveSheepExecutable(
      app.isPackaged,
      app.getAppPath(),
      process.cwd(),
      process.resourcesPath,
    );
    if (!existsSync(executable))
      throw new Error(`The bundled Sheep helper is missing at ${executable}.`);
    const child = spawn(executable, ['bridge', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
    });
    this.child = child;
    child.once('error', (error) =>
      this.fail(new Error(`Could not start Sheep: ${error.message}`), child),
    );
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      const tail = this.stderrTail.slice(-4).join('\n');
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      this.fail(new Error(`Sheep stopped (${reason}).${tail ? ` ${tail}` : ''}`), child);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      this.stderrTail = [...this.stderrTail, ...lines].slice(-30);
      for (const line of lines) this.emit('diagnostic', line);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    const health = await this.requestAfterStart<{ protocol: string }>('health');
    if (health.protocol !== PROTOCOL_VERSION)
      throw new Error(`Unsupported Sheep protocol: ${health.protocol || 'unknown'}.`);
  }

  private requestAfterStart<T>(op: string): Promise<T> {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error('Sheep bridge is not running.'));
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sheep did not answer ${op} in time.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      child.stdin.write(`${JSON.stringify({ id, version: PROTOCOL_VERSION, op })}\n`);
    });
  }

  private handleLine(line: string): void {
    let message: BridgeResponse;
    try {
      message = JSON.parse(line) as BridgeResponse;
    } catch {
      this.emit('diagnostic', `Ignored invalid Sheep bridge output: ${line.slice(0, 500)}`);
      return;
    }
    if (message.version !== PROTOCOL_VERSION) {
      this.emit('diagnostic', `Sheep returned protocol ${message.version || 'unknown'}.`);
      return;
    }
    const id = typeof message.id === 'string' ? message.id : '';
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Sheep request failed.'));
  }

  private fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.child === child) {
      this.child = null;
      this.startup = null;
    }
    this.rejectPending(error);
    this.emit('process/error', error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
