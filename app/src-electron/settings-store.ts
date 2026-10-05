import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { DEFAULT_ROOM_SERVICE_URL, normalizeAppTheme, resolveRoomServiceUrl } from './settings-defaults';
import type { AppTheme } from './settings-defaults';

export type HarnessName = 'codex' | 'hermes';
export type LocalAgentSettings = {
  id: string;
  name: string;
  harness: HarnessName;
  model: string;
  workingDirectory: string;
};

export type PublicSettings = {
  backendUrl: string;
  displayName: string;
  member: { id: string; name: string; role: 'owner' | 'member' } | null;
  theme: AppTheme;
  allowRemoteAgentRequests: boolean;
  agents: LocalAgentSettings[];
  connected: boolean;
};

type StoredSettings = Omit<PublicSettings, 'connected'> & {
  encryptedAccessToken?: string;
};

const defaults: StoredSettings = {
  backendUrl: DEFAULT_ROOM_SERVICE_URL,
  displayName: '',
  member: null,
  theme: 'mint-charcoal',
  allowRemoteAgentRequests: false,
  agents: [],
};

export class SettingsStore {
  private readonly filePath: string;
  private value: StoredSettings = { ...defaults };
  private loaded = false;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'settings.json');
  }

  async get(): Promise<PublicSettings> {
    await this.load();
    return this.publicValue();
  }

  async accessToken(): Promise<string> {
    await this.load();
    const encrypted = this.value.encryptedAccessToken;
    if (!encrypted) return '';
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable on this computer.');
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  async update(
    input: Partial<
      Pick<
        PublicSettings,
        'backendUrl' | 'displayName' | 'theme' | 'allowRemoteAgentRequests' | 'agents'
      >
    >,
  ): Promise<PublicSettings> {
    await this.load();
    if (typeof input.backendUrl === 'string')
      this.value.backendUrl = normalizeBackendUrl(input.backendUrl);
    if (typeof input.displayName === 'string')
      this.value.displayName = cleanName(input.displayName);
    if (input.theme && ['classic', 'cobalt-red', 'mint-charcoal'].includes(input.theme))
      this.value.theme = input.theme;
    if (typeof input.allowRemoteAgentRequests === 'boolean')
      this.value.allowRemoteAgentRequests = input.allowRemoteAgentRequests;
    if (Array.isArray(input.agents)) this.value.agents = cleanAgents(input.agents);
    await this.save();
    return this.publicValue();
  }

  async saveConnection(
    backendUrl: string,
    member: NonNullable<PublicSettings['member']>,
    accessToken: string,
  ): Promise<PublicSettings> {
    await this.load();
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable on this computer.');
    this.value.backendUrl = normalizeBackendUrl(backendUrl);
    this.value.member = member;
    this.value.displayName = member.name;
    this.value.encryptedAccessToken = safeStorage.encryptString(accessToken).toString('base64');
    await this.save();
    return this.publicValue();
  }

  async clearConnection(): Promise<PublicSettings> {
    await this.load();
    this.value.member = null;
    delete this.value.encryptedAccessToken;
    await this.save();
    return this.publicValue();
  }

  private publicValue(): PublicSettings {
    const { encryptedAccessToken, ...value } = this.value;
    return { ...value, connected: Boolean(encryptedAccessToken && value.member) };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<StoredSettings>;
      this.value = {
        ...defaults,
        ...saved,
        backendUrl: resolveRoomServiceUrl(saved.backendUrl, Boolean(saved.member && saved.encryptedAccessToken), process.env.SURPRISED_FACE_ROOM_SERVICE_URL),
        theme: normalizeAppTheme(saved.theme),
        agents: cleanAgents(Array.isArray(saved.agents) ? saved.agents : []),
      };
    } catch {
      this.value = { ...defaults, backendUrl: resolveRoomServiceUrl('', false, process.env.SURPRISED_FACE_ROOM_SERVICE_URL) };
    }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('The room service URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/, '');
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > 64) throw new Error('Names can be up to 64 characters.');
  return name;
}

function cleanAgents(values: unknown[]): LocalAgentSettings[] {
  return values.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const agent = item as Record<string, unknown>;
    const id = typeof agent.id === 'string' ? agent.id.trim() : '';
    const name = typeof agent.name === 'string' ? cleanName(agent.name) : '';
    const harness =
      agent.harness === 'hermes' ? 'hermes' : agent.harness === 'codex' ? 'codex' : null;
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/i.test(id) || !name || !harness) return [];
    return [
      {
        id,
        name,
        harness,
        model: typeof agent.model === 'string' ? agent.model.trim().slice(0, 160) : '',
        workingDirectory:
          typeof agent.workingDirectory === 'string' ? agent.workingDirectory.trim() : '',
      },
    ];
  });
}
