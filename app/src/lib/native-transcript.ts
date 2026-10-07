export type NativeDisplayMessage = { role: 'user' | 'assistant'; content: string; at?: string };

const HARNESS_CONTEXT = [
  /^<external_codex_apps_/,
  /^<codex_apps_/,
  /^<app-context>/,
  /^<skills_instructions>/,
  /^<multi_agent_/,
  /^<permissions instructions>/,
  /^<collaboration_mode>/,
  /^<recommended_plugins>/,
];

/** Harness-injected setup and page context, not a message someone sent. */
export function isHarnessContext(content: string): boolean {
  const text = content.trim();
  if (text.startsWith('# AGENTS.md instructions for ') && text.includes('<INSTRUCTIONS>') && text.includes('</INSTRUCTIONS>')) return true;
  if (text.startsWith('<environment_context>') && text.endsWith('</environment_context>')) return true;
  return HARNESS_CONTEXT.some((pattern) => pattern.test(text));
}

export function displayTranscriptMessages(transcript: unknown): NativeDisplayMessage[] {
  if (!transcript || typeof transcript !== 'object') return [];
  const source = transcript as Record<string, unknown>;
  const rows = source.messages || source.Messages;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value): NativeDisplayMessage[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string' || !row.content.trim()) return [];
    const content = row.content.trim();
    if (isHarnessContext(content)) return [];
    return [{ role: row.role, content: row.content, ...(typeof row.at === 'string' ? { at: row.at } : {}) }];
  });
}
