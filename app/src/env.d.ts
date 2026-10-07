declare global {
type SurprisedFaceSettings = {
  backendUrl: string;
  displayName: string;
  member: { id: string; name: string; role: 'owner' | 'member' } | null;
  theme: 'cobalt-red' | 'mint-charcoal' | 'classic';
  allowRemoteAgentRequests: boolean;
  agents: { id: string; name: string; harness: 'codex' | 'hermes'; model: string; workingDirectory: string }[];
  connected: boolean;
};

type SharedMessage = {
  id: string;
  roomId: string;
  messageSeq: number;
  participantId: string;
  participantName: string;
  role: 'user' | 'assistant';
  text: string;
  state: string;
  agentId: string | null;
  agentName: string | null;
  ownerId: string | null;
  harness: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

type PendingLocalMessage = { client_id: string; room_id: string; text: string; agent_ids: string; error: string | null; created_at: string };
type SharedRoom = { id: string; name: string; createdAt?: string };
type SharedMember = { id: string; name: string; role: 'owner' | 'member' };
type SharedAgent = { id: string; ownerId: string; name: string; harness: 'codex' | 'hermes'; model: string };

interface SurprisedFaceApi {
  settings(): Promise<SurprisedFaceSettings>;
  updateSettings(input: Partial<SurprisedFaceSettings>): Promise<SurprisedFaceSettings>;
  bootstrap(input: unknown): Promise<unknown>;
  register(name: string): Promise<unknown>;
  copyText(value: string): Promise<{ ok: boolean }>;
  join(input: unknown): Promise<unknown>;
  joinRoom(code: string): Promise<{ roomId: string }>;
  logout(): Promise<SurprisedFaceSettings>;
  createInvites(roomId: string): Promise<{ code: string; expiresAt: string }[]>;
  rooms(): Promise<SharedRoom[]>;
  createRoom(input: { name: string; defaultAgentId?: string }): Promise<SharedRoom>;
  openRoom(roomId: string): Promise<SharedMessage[]>;
  roomMessages(roomId: string): Promise<SharedMessage[]>;
  pendingMessages(roomId: string): Promise<PendingLocalMessage[]>;
  sendMessage(input: { roomId: string; text: string; agentIds?: string[] }): Promise<unknown>;
  members(roomId: string): Promise<SharedMember[]>;
  agents(roomId: string): Promise<SharedAgent[]>;
  saveAgent(input: unknown): Promise<SurprisedFaceSettings>;
  runPending(roomId: string): Promise<unknown>;
  chooseFolder(): Promise<string | null>;
  sheepHealth(): Promise<unknown>;
  sheepProjects(): Promise<{ projects: Record<string, unknown>[] }>;
  sheepConversations(): Promise<{ conversations: Record<string, unknown>[]; sourceError?: string }>;
  sheepRefresh(): Promise<{ projects: Record<string, unknown>[]; conversations: Record<string, unknown>[]; conversationSourceError?: string }>;
  sheepRead(input: { harness: string; id: string }): Promise<unknown>;
  sheepReadNative(input: unknown): Promise<unknown>;
  sheepNativeRecords(input: { harness: string; id: string }): Promise<unknown[]>;
  nativeSend(input: { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; text: string }): Promise<void>;
  nativeFollow(input: { sessionId: string }): Promise<void>;
  nativeCreate(input: { harness: 'codex' | 'hermes'; cwd: string; title: string }): Promise<{ id: string; harness: 'codex' | 'hermes'; path: string; title: string; updatedAt: string }>;
  nativeLink(input: { harness: string; sessionId: string }): Promise<{ roomId: string; agentId: string } | null>;
  nativeShare(input: { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; title: string; agentName?: string }): Promise<{ room: SharedRoom; invite?: { code: string; expiresAt: string } }>;
  onNativeChatEvent(handler: (value: unknown) => void): () => void;
  codexAccount(refresh?: boolean): Promise<unknown>;
  codexAccountRates(): Promise<unknown>;
  codexLogin(): Promise<unknown>;
  codexLoginApiKey(key: string): Promise<unknown>;
  codexLogout(): Promise<unknown>;
  codexModels(): Promise<unknown>;
  codexThreads(cwd?: string): Promise<unknown>;
  codexStartThread(input: unknown): Promise<unknown>;
  codexResumeThread(input: unknown): Promise<unknown>;
  codexStartTurn(input: unknown): Promise<unknown>;
  codexInterrupt(input: unknown): Promise<unknown>;
  codexServerResponse(input: unknown): Promise<unknown>;
  hermesStatus(refresh?: boolean): Promise<unknown>;
  hermesModels(refresh?: boolean): Promise<unknown>;
  hermesNewSession(input: unknown): Promise<unknown>;
  hermesLoadSession(input: unknown): Promise<unknown>;
  hermesSetModel(input: unknown): Promise<unknown>;
  hermesPrompt(input: unknown): Promise<unknown>;
  hermesCancel(sessionId: string): Promise<unknown>;
  hermesPermission(input: unknown): Promise<unknown>;
  onRoomEvent(handler: (value: unknown) => void): () => void;
  onOutboxChanged(handler: (value: unknown) => void): () => void;
  onRoomConnection(handler: (value: unknown) => void): () => void;
  onAppError(handler: (value: unknown) => void): () => void;
  onAgentActivity(handler: (value: unknown) => void): () => void;
  onCodexRequest(handler: (value: unknown) => void): () => void;
  onHermesRequest(handler: (value: unknown) => void): () => void;
  onCodexEvent(handler: (value: unknown) => void): () => void;
  onHermesEvent(handler: (value: unknown) => void): () => void;
}

  interface Window {
    surprisedFace: SurprisedFaceApi;
  }
}

export {};
