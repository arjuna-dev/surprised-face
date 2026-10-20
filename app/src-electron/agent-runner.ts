import { EventEmitter } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import { CodexDesktopUnavailable } from './codex-desktop-link';
import type { NativeDisplayMessage } from '../src/lib/native-transcript';
import type { CodexAppServer } from './codex-app-server';
import type { HermesAcpClient, HermesEvent } from './hermes-acp';
import type { LocalStore } from './local-store';
import type { RoomService } from './room-service';
import type { HarnessName, LocalAgentSettings, SettingsStore } from './settings-store';
import { harnessParticipants } from './harness-participants';

type AgentTurn = {
  turnId: string;
  request: { text: string; requestedBy: string };
  agentId: string;
  ownerId: string;
  harness: 'codex' | 'hermes';
  model: string;
  contextThroughSeq: number;
  context: { messageSeq: number; participantId: string; participantName?: string; role: 'user' | 'assistant'; text: string; agentId?: string; agentName?: string }[];
};

type StreamState = {
  roomId: string;
  turnId: string;
  sessionId: string;
  agentId: string;
  chunkIndex: number;
  sawText: boolean;
  buffer: string;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  finishing: boolean;
  failure: string;
  chain: Promise<void>;
  complete: Promise<void>;
  resolve: () => void;
};

export class AgentRunner extends EventEmitter {
  private readonly activeRooms = new Set<string>();
  private readonly pendingWakeups = new Set<string>();
  private readonly codexRuns = new Map<string, StreamState>();
  private readonly hermesRuns = new Map<string, StreamState>();
  private readonly resumedCodexThreads = new Set<string>();
  private readonly loadedHermesSessions = new Set<string>();

  constructor(
    private readonly rooms: RoomService,
    private readonly store: LocalStore,
    private readonly settings: SettingsStore,
    private readonly codex: CodexAppServer,
    private readonly hermes: HermesAcpClient,
    private readonly desktop: { startTurn(input: { threadId: string; text: string; cwd?: string; onDelta?: (text: string) => void }): Promise<NativeDisplayMessage[]> } | null = null,
    private readonly availableHarnesses: () => HarnessName[] = () => ['codex', 'hermes'],
  ) {
    super();
    this.codex.on('event', (event: unknown) => this.handleCodexEvent(event));
    this.hermes.on('event', (event: HermesEvent) => this.handleHermesEvent(event));
  }

  async runPending(roomId: string): Promise<void> {
    if (!roomId) return;
    if (this.activeRooms.has(roomId)) {
      this.pendingWakeups.add(roomId);
      return;
    }
    this.activeRooms.add(roomId);
    let ranTurn = false;
    try {
      const settings = await this.settings.get();
      if (!settings.connected) return;
      const participants = harnessParticipants(settings, this.availableHarnesses());
      const turn = await this.rooms.claimTurn(roomId, participants.map((agent) => agent.id), settings.allowRemoteAgentRequests) as AgentTurn | null;
      if (!turn) return;
      const agent = participants.find((item) => item.id === turn.agentId);
      if (!agent) return;
      ranTurn = true;
      try {
        await this.execute(roomId, turn, agent);
      } catch (error) {
        const message = errorMessage(error);
        this.emit('agent/error', { roomId, agentId: agent.id, message });
        try { await this.rooms.finishAgentTurn(roomId, turn.turnId, 'failed', message); } catch { /* connection retry or app shutdown */ }
      }
    } catch (error) {
      this.emit('agent/error', { roomId, message: errorMessage(error) });
    } finally {
      this.activeRooms.delete(roomId);
      const wakeAgain = this.pendingWakeups.delete(roomId);
      if (ranTurn || wakeAgain) setTimeout(() => void this.runPending(roomId), 0);
    }
  }

  resumePending(roomIds: string[]): void {
    for (const roomId of roomIds) void this.runPending(roomId);
  }

  private async execute(roomId: string, turn: AgentTurn, agent: LocalAgentSettings): Promise<void> {
    if (turn.ownerId !== (await this.settings.get()).member?.id) throw new Error('This agent is configured for another member.');
    if (turn.harness !== agent.harness) throw new Error('The registered harness and local agent settings do not match.');
    const previous = this.store.agentSession(roomId, agent.id);
    const candidate = previous?.working_directory || agent.workingDirectory;
    const workingDirectory = candidate && existsSync(candidate) && statSync(candidate).isDirectory() ? candidate : os.homedir();
    const activeAgent = { ...agent, workingDirectory };
    const isSameSession = previous?.harness === agent.harness
      && previous.working_directory === workingDirectory
      && previous.model === agent.model;
    const context = this.contextPrompt(turn, agent, isSameSession ? previous.context_through_seq : 0, Boolean(isSameSession));
    if (agent.harness === 'codex') {
      await this.executeCodex(roomId, turn, activeAgent, context, isSameSession ? previous : undefined);
    } else {
      await this.executeHermes(roomId, turn, activeAgent, context, isSameSession ? previous : undefined);
    }
  }

  private async executeCodex(
    roomId: string,
    turn: AgentTurn,
    agent: LocalAgentSettings,
    prompt: string,
    previous?: { native_session_id: string; context_through_seq: number },
  ): Promise<void> {
    if (previous && this.desktop && !this.resumedCodexThreads.has(previous.native_session_id)) {
      let replies: NativeDisplayMessage[] | undefined;
      const state = this.createStream(roomId, turn.turnId, previous.native_session_id, agent.id);
      try {
        replies = await this.desktop.startTurn({ threadId: previous.native_session_id, text: prompt, cwd: agent.workingDirectory, onDelta: (text) => this.addChunk(state, text) });
      } catch (error) {
        // Only a confirmed unavailable desktop permits trying another writer.
        if (!(error instanceof CodexDesktopUnavailable) && !(error instanceof Error && error.name === 'CodexDesktopUnavailable')) throw error;
      }
      if (replies) {
        if (!state.sawText) {
          const reply = replies.filter((item) => item.role === 'assistant').at(-1);
          if (reply?.content) this.addChunk(state, reply.content);
        }
        this.store.saveAgentSession({ roomId, agentId: agent.id, harness: agent.harness, sessionId: previous.native_session_id, cwd: agent.workingDirectory, model: agent.model, contextThroughSeq: turn.contextThroughSeq });
        await this.finishStream(state, 'complete');
        if (state.failure) throw new Error(state.failure);
        return;
      }
    }
    let threadId = previous?.native_session_id || '';
    if (!threadId) {
      const started = asObject(await this.codex.startThread({ cwd: agent.workingDirectory, ...(agent.model ? { model: agent.model } : {}) }));
      const thread = asObject(started?.thread);
      threadId = stringValue(thread?.id) || stringValue(started?.id) || '';
      if (!threadId) throw new Error('Codex did not create a session.');
      this.resumedCodexThreads.add(threadId);
    } else if (!this.resumedCodexThreads.has(threadId)) {
      await this.codex.resumeThread({ threadId, cwd: agent.workingDirectory });
      this.resumedCodexThreads.add(threadId);
    }
    this.store.saveAgentSession({
      roomId, agentId: agent.id, harness: agent.harness, sessionId: threadId,
      cwd: agent.workingDirectory, model: agent.model, contextThroughSeq: turn.contextThroughSeq,
    });
    const state = this.createStream(roomId, turn.turnId, threadId, agent.id);
    this.codexRuns.set(threadId, state);
    try {
      await this.codex.startTurn({ threadId, text: prompt, cwd: agent.workingDirectory, ...(agent.model ? { model: agent.model } : {}) });
      await waitFor(state.complete, 45 * 60_000, 'Codex turn did not finish.');
      if (state.failure) throw new Error(state.failure);
    } catch (error) {
      await this.finishStream(state, 'failed', errorMessage(error));
      throw error;
    } finally {
      if (this.codexRuns.get(threadId) === state) this.codexRuns.delete(threadId);
    }
  }

  private async executeHermes(
    roomId: string,
    turn: AgentTurn,
    agent: LocalAgentSettings,
    prompt: string,
    previous?: { native_session_id: string; context_through_seq: number },
  ): Promise<void> {
    let sessionId = previous?.native_session_id || '';
    if (!sessionId) {
      const session = await this.hermes.newSession(agent.model || undefined, agent.workingDirectory);
      sessionId = session.sessionId;
      this.loadedHermesSessions.add(sessionId);
    } else if (!this.loadedHermesSessions.has(sessionId)) {
      await this.hermes.loadSession(sessionId, agent.workingDirectory);
      this.loadedHermesSessions.add(sessionId);
    }
    this.store.saveAgentSession({
      roomId, agentId: agent.id, harness: agent.harness, sessionId,
      cwd: agent.workingDirectory, model: agent.model, contextThroughSeq: turn.contextThroughSeq,
    });
    const state = this.createStream(roomId, turn.turnId, sessionId, agent.id);
    this.hermesRuns.set(sessionId, state);
    try {
      await this.hermes.prompt(sessionId, prompt);
      await waitFor(state.complete, 45 * 60_000, 'Hermes turn did not finish.');
      if (state.failure) throw new Error(state.failure);
    } catch (error) {
      await this.finishStream(state, 'failed', errorMessage(error));
      throw error;
    } finally {
      if (this.hermesRuns.get(sessionId) === state) this.hermesRuns.delete(sessionId);
    }
  }

  private contextPrompt(turn: AgentTurn, agent: LocalAgentSettings, afterSeq: number, continuing: boolean): string {
    const messages = turn.context.filter((message) => {
      if (message.messageSeq <= afterSeq) return false;
      if (continuing && message.role === 'assistant' && message.agentId === agent.id) return false;
      return Boolean(message.text.trim());
    });
    if (messages.length === 0) return turn.request.text;
    if (messages.length === 1) return messages[0]!.text;
    const transcript = messages.map((message) => {
      const author = message.role === 'assistant'
        ? message.agentName || message.agentId || 'Harness'
        : message.participantName || message.participantId || 'Person';
      return `${author}:\n${message.text}`;
    }).join('\n\n');
    return transcript;
  }

  private createStream(roomId: string, turnId: string, sessionId: string, agentId: string): StreamState {
    let resolve!: () => void;
    const complete = new Promise<void>((done) => { resolve = done; });
    return { roomId, turnId, sessionId, agentId, chunkIndex: 0, sawText: false, buffer: '', flushTimer: undefined, finishing: false, failure: '', chain: Promise.resolve(), complete, resolve };
  }

  private handleCodexEvent(value: unknown): void {
    const event = asObject(value);
    const method = stringValue(event?.method);
    if (event?.type === 'process/exited' || event?.type === 'process/error') {
      const reason = stringValue(event.message) || 'Codex app-server stopped.';
      for (const state of this.codexRuns.values()) void this.finishStream(state, 'failed', reason);
      return;
    }
    const params = asObject(event?.params);
    const threadId = stringValue(params?.threadId);
    if (event?.type === 'server/request') {
      this.emit('codex/request', event);
      return;
    }
    if (!threadId) return;
    const state = this.codexRuns.get(threadId);
    if (!state) return;
    this.emit('agent/activity', { roomId: state.roomId, agentId: state.agentId, harness: 'codex', method, params });
    if (method === 'item/agentMessage/delta') {
      const delta = stringValue(params?.delta) || '';
      if (delta) this.addChunk(state, delta);
    } else if (method === 'item/completed' && !state.sawText) {
      const item = asObject(params?.item);
      if (item?.type === 'agentMessage' || item?.type === 'assistant_message') {
        const text = stringValue(item.text) || '';
        if (text) this.addChunk(state, text);
      }
    } else if (method === 'turn/completed') {
      void this.finishStream(state, 'complete');
    } else if (method === 'turn/failed') {
      const message = stringValue(params?.error) || 'Codex turn failed.';
      void this.finishStream(state, 'failed', message);
    }
  }

  private handleHermesEvent(event: HermesEvent): void {
    if (event.type === 'process/exited') {
      for (const state of this.hermesRuns.values()) void this.finishStream(state, 'failed', event.message);
      return;
    }
    if (event.type === 'permission/request') {
      this.emit('hermes/request', event);
      return;
    }
    const state = 'sessionId' in event ? this.hermesRuns.get(event.sessionId) : undefined;
    if (!state) return;
    if (event.type === 'message') this.addChunk(state, event.text);
    else if (event.type === 'tool' || event.type === 'notice') this.emit('agent/activity', { roomId: state.roomId, agentId: state.agentId, harness: 'hermes', event });
    else if (event.type === 'prompt/completed') void this.finishStream(state, 'complete');
    else if (event.type === 'prompt/failed') void this.finishStream(state, 'failed', event.message);
  }

  private addChunk(state: StreamState, text: string): void {
    if (!text || state.finishing) return;
    state.sawText = true;
    state.buffer += text;
    if (state.buffer.length >= 8_000) this.flushStream(state);
    else if (!state.flushTimer) state.flushTimer = setTimeout(() => this.flushStream(state), 80);
  }

  private flushStream(state: StreamState): void {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = undefined;
    while (state.buffer) {
      const text = state.buffer.slice(0, 12_000);
      state.buffer = state.buffer.slice(text.length);
      const index = state.chunkIndex++;
      state.chain = state.chain.then(async () => {
        if (state.failure) return;
        try {
          await this.rooms.appendAgentChunk(state.roomId, state.turnId, index, text);
        } catch (error) {
          state.failure = errorMessage(error);
        }
      });
    }
  }

  private async finishStream(state: StreamState, status: 'complete' | 'failed' | 'stopped', error?: string): Promise<void> {
    if (state.finishing) return state.complete;
    state.finishing = true;
    if (error) state.failure = error;
    this.flushStream(state);
    await state.chain;
    const finalStatus = state.failure && status === 'complete' ? 'failed' : status;
    try { await this.rooms.finishAgentTurn(state.roomId, state.turnId, finalStatus, state.failure || error); }
    catch (finishError) { this.emit('agent/error', { roomId: state.roomId, agentId: state.agentId, message: errorMessage(finishError) }); }
    state.resolve();
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function waitFor(promise: Promise<void>, timeout: number, message: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    promise.then(() => { clearTimeout(timer); resolve(); }, (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
