import { isHarnessContext, type NativeDisplayMessage } from './native-transcript';

export type CodexSessionView = { messages: NativeDisplayMessage[]; settled: boolean };

/** Read the conversation Codex saved, without harness-injected page context. */
export function messagesFromCodexSession(jsonl: string): CodexSessionView {
  const messages: NativeDisplayMessage[] = [];
  let settled = false;
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    const record = row as { type?: unknown; timestamp?: unknown; payload?: unknown };
    const payload = record.payload && typeof record.payload === 'object' ? record.payload as { type?: unknown; role?: unknown; content?: unknown } : null;
    if (record.type === 'event_msg' && payload?.type === 'task_complete') {
      settled = true;
      continue;
    }
    if (record.type !== 'response_item' || payload?.type !== 'message') continue;
    if (payload.role !== 'user' && payload.role !== 'assistant') continue;
    const content = textOf(payload.content);
    if (!content || isHarnessContext(content)) continue;
    const at = typeof record.timestamp === 'string' ? record.timestamp : undefined;
    messages.push({ role: payload.role, content, ...(at ? { at } : {}) });
    if (payload.role === 'user') settled = false;
  }
  return { messages, settled };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.map((entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const text = (entry as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }).join('\n').trim();
}
