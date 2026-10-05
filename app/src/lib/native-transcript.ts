export type NativeDisplayMessage = { role: 'user' | 'assistant'; content: string; at?: string };

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
    if (row.role === 'user' && (
      (content.startsWith('# AGENTS.md instructions for ') && content.includes('<INSTRUCTIONS>') && content.includes('</INSTRUCTIONS>')) ||
      (content.startsWith('<environment_context>') && content.endsWith('</environment_context>'))
    )) return [];
    return [{ role: row.role, content: row.content, ...(typeof row.at === 'string' ? { at: row.at } : {}) }];
  });
}
