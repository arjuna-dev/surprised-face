/** Shared-chat reply header: owner and harness, for example "Maya · Codex". */
export function sharedReplyLabel(input: {
  role: string;
  harnessLabel?: string | null;
  ownerName?: string | null;
  participantName?: string | null;
}): string {
  if (input.role === 'assistant') {
    const harness = input.harnessLabel?.trim() || 'Harness';
    const owner = input.ownerName?.trim();
    return owner ? `${owner} · ${harness}` : harness;
  }
  return input.participantName?.trim() || 'Member';
}

/** Sidebar status while a mention waits for the harness owner. */
export function harnessStatusLabel(state: string, ownerName: string, mine: boolean): string {
  if (state !== 'waiting') return state;
  return mine ? 'waiting for you' : `waiting for ${ownerName}`;
}
