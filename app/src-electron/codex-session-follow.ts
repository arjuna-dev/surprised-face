import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { messagesFromCodexSession, type CodexSessionView } from '../src/lib/codex-session';

export function findCodexSessionFile(sessionId: string, sessionsRoot: string): string | null {
  if (!/^[A-Za-z0-9-]{8,}$/.test(sessionId) || !existsSync(sessionsRoot)) return null;
  const suffix = `${sessionId}.jsonl`;
  const pending = [sessionsRoot];
  while (pending.length) {
    const directory = pending.pop();
    if (!directory) continue;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(suffix)) return fullPath;
    }
  }
  return null;
}

/** Keep a Codex chat current while Codex desktop appends to its session. */
export class CodexSessionFollow extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = '';

  constructor(private readonly filePath: string) { super(); }

  start(): void {
    this.publish();
    try { this.watcher = watch(this.filePath, () => this.publish()); } catch { /* polling still covers the file */ }
    this.timer = setInterval(() => this.publish(), 400);
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private publish(): void {
    if (!existsSync(this.filePath)) return;
    const view = messagesFromCodexSession(readFileSync(this.filePath, 'utf8'));
    const serialized = JSON.stringify(view.messages);
    if (serialized === this.last) return;
    this.last = serialized;
    this.emit('update', view satisfies CodexSessionView);
  }
}
