export type MentionAtCursor = { start: number; end: number; search: string };

export function mentionAtCursor(text: string, cursor: number): MentionAtCursor | null {
  const position = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, position);
  const match = /(^|\s)@([a-z0-9-]*)( ?)$/i.exec(before);
  if (!match) return null;
  const search = match[2] || '';
  const trailingSpace = match[3] || '';
  return {
    start: position - search.length - trailingSpace.length - 1,
    end: position,
    search: search.toLowerCase(),
  };
}

export function insertMentionAtCursor(text: string, cursor: number, id: string): { text: string; cursor: number } {
  const mention = mentionAtCursor(text, cursor);
  if (!mention) return { text, cursor };
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);
  const replacement = `@${id}${after.startsWith(' ') ? '' : ' '}`;
  return { text: before + replacement + after, cursor: before.length + replacement.length };
}
