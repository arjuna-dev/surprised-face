import { createHash } from 'node:crypto';
import type { HarnessName, LocalAgentSettings } from './settings-store';

type ParticipantSettings = {
  member: { id: string; name: string; role?: string } | null;
  agents: LocalAgentSettings[];
};

const SUPPORTED_HARNESSES: HarnessName[] = ['codex', 'hermes'];

export function harnessParticipants(settings: ParticipantSettings, available: HarnessName[] = SUPPORTED_HARNESSES): LocalAgentSettings[] {
  if (!settings.member) return [];
  const ownerKey = createHash('sha256').update(settings.member.id).digest('hex').slice(0, 16);
  const current = available.map((harness) => ({
    id: `harness-${ownerKey}-${harness}`,
    name: harness === 'codex' ? 'Codex' : 'Hermes',
    harness,
    model: '',
    workingDirectory: '',
  }));
  return [...current, ...settings.agents.filter((saved) => available.includes(saved.harness) && !current.some((item) => item.id === saved.id))];
}
