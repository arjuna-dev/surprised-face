import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalStore } from './local-store';

/** An app-owned copy of shared chat context. Native harness journals stay harness-owned. */
export class HarnessContextMirror {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly userDataPath: string, private readonly store: Pick<LocalStore, 'messages' | 'cursor'>) {}

  pathFor(roomId: string, harness: 'codex' | 'hermes'): string {
    const roomKey = createHash('sha256').update(roomId).digest('hex');
    return path.join(this.userDataPath, 'harness-context', roomKey, `${harness}.json`);
  }

  async sync(roomId: string): Promise<void> {
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
    const messages = this.store.messages(roomId).map((message) => ({
      messageSeq: message.messageSeq,
      participantId: message.participantId,
      participantName: message.participantName,
      role: message.role,
      text: message.text,
      state: message.state,
      harness: message.harness,
      createdAt: message.createdAt,
    }));
    const throughEventSeq = this.store.cursor(roomId);
    for (const harness of ['codex', 'hermes'] as const) {
      const file = this.pathFor(roomId, harness);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, roomId, harness, throughEventSeq, messages }, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, file);
    }
  }
}
