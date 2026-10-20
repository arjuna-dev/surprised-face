import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import {
  CodexAppServer,
  resolveCodexExecutable,
  type ServerRequestResponse,
  type StartThreadInput,
  type StartTurnInput,
} from './codex-app-server';
import { HermesAcpClient } from './hermes-acp';
import { AgentRunner } from './agent-runner';
import { NativeChatService } from './native-chat';
import { CodexDesktopLink } from './codex-desktop-link';
import { CodexSessionFollow, findCodexSessionFile } from './codex-session-follow';
import { LocalStore } from './local-store';
import { RoomService } from './room-service';
import { SettingsStore, type HarnessName } from './settings-store';
import { harnessParticipants } from './harness-participants';
import { HarnessContextMirror } from './harness-context-mirror';
import { HarnessSessionSync } from './harness-session-sync';
import { SheepBridge } from './sheep-bridge';
import { isSafeAppNavigation } from './navigation-policy';
import { projectsForUi, projectsFromConversations, sortProjectsByRecent } from './local-projects';
import { displayTranscriptMessages } from '../src/lib/native-transcript';
import { configureAppProfile } from './app-data-path';
import { GOOGLE_OAUTH_CLIENT_ID } from './google-auth-config';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
configureAppProfile(app, process.env.SURPRISED_FACE_DEV_DATA);
const ownsSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | undefined;
let localStore: LocalStore;
let settingsStore: SettingsStore;
let roomService: RoomService;
let sheepBridge: SheepBridge;
let codex: CodexAppServer;
let hermes: HermesAcpClient;
let agentRunner: AgentRunner;
let nativeChat: NativeChatService;
let harnessContextMirror: HarnessContextMirror;
let harnessSessionSync: HarnessSessionSync;
let availableHarnesses: HarnessName[] = [];
let appSessionVerified = false;
const codexSessionFollows = new Map<string, CodexSessionFollow>();

if (!ownsSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      localStore = new LocalStore(path.join(app.getPath('userData'), 'surprised-face.sqlite'));
      harnessContextMirror = new HarnessContextMirror(app.getPath('userData'), localStore);
      settingsStore = new SettingsStore(app.getPath('userData'));
      sheepBridge = new SheepBridge();
      roomService = new RoomService(settingsStore, localStore);
      codex = new CodexAppServer();
      hermes = new HermesAcpClient({
        environment: () => ({}),
        workingDirectory: () => os.homedir(),
        clientVersion: app.getVersion(),
      });
      harnessSessionSync = new HarnessSessionSync(localStore, async (input) => {
        if (input.harness === 'codex') {
          const link = new CodexDesktopLink({
            socketPath: process.env.CODEX_IPC_SOCKET || path.join(os.homedir(), '.codex', 'ipc', 'ipc.sock'),
            sessionFile: findCodexSessionFile(input.sessionId, path.join(os.homedir(), '.codex', 'sessions')),
          });
          await link.appendPlainText({ threadId: input.sessionId, text: input.text, cwd: input.cwd }).finally(() => link.close());
          return;
        }
        await hermes.appendPlainText(input.sessionId, input.text, input.cwd);
      }, 300, (error) => sendToRenderer('app:error', errorMessage(error)));
      const desktop = {
        startTurn: (input: { threadId: string; text: string; cwd?: string; onDelta?: (text: string) => void }) => {
          const link = new CodexDesktopLink({
            socketPath: process.env.CODEX_IPC_SOCKET || path.join(os.homedir(), '.codex', 'ipc', 'ipc.sock'),
            sessionFile: findCodexSessionFile(input.threadId, path.join(os.homedir(), '.codex', 'sessions')),
          });
          return link.startTurn(input).finally(() => link.close());
        },
      };
      agentRunner = new AgentRunner(roomService, localStore, settingsStore, codex, hermes, desktop, () => availableHarnesses);
      nativeChat = new NativeChatService(codex, hermes, desktop);

      bindEvents();
      registerHandlers();
      await createWindow();
    })
    .catch((error: unknown) => {
      dialog.showErrorBox('surprised-face could not start', errorMessage(error));
      app.quit();
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    roomService?.stop();
    sheepBridge?.stop();
    for (const follow of codexSessionFollows.values()) follow.close();
    codexSessionFollows.clear();
    codex?.stop();
    hermes?.stop();
    localStore?.close();
  });
}

function bindEvents(): void {
  roomService.on('event', (payload) => {
    sendToRenderer('room:event', payload);
    const event = asObject(asObject(payload)?.event);
    const roomId = stringValue(asObject(payload)?.roomId);
    if (roomId && ['message.created', 'message.delta', 'turn.started', 'turn.finished'].includes(stringValue(event?.type) || '')) {
      void harnessContextMirror.sync(roomId).catch((error: unknown) => sendToRenderer('app:error', errorMessage(error)));
    }
    if (roomId && (event?.type === 'message.created' || event?.type === 'turn.finished')) harnessSessionSync.schedule(roomId);
    if (event?.type === 'turn.queued' || event?.type === 'turn.finished' || event?.type === 'turn.availability') {
      if (roomId) setTimeout(() => void agentRunner.runPending(roomId), 0);
    }
  });
  roomService.on('connection', (payload) => sendToRenderer('room:connection', payload));
  roomService.on('outbox/changed', (payload) => sendToRenderer('room:outbox', payload));
  roomService.on('service/error', (message) => sendToRenderer('app:error', message));
  roomService.on('agent/error', (payload) => sendToRenderer('app:error', payload));
  agentRunner.on('codex/request', (event) => sendToRenderer('codex:request', event));
  agentRunner.on('hermes/request', (event) => sendToRenderer('hermes:request', event));
  agentRunner.on('agent/activity', (event) => sendToRenderer('agent:activity', event));
  agentRunner.on('agent/error', (event) => sendToRenderer('app:error', event));
  nativeChat.on('event', (event) => sendToRenderer('native:chat-event', event));
  codex.on('event', (event) => sendToRenderer('codex:event', event));
  hermes.on('event', (event) => sendToRenderer('hermes:event', event));
  sheepBridge.on('diagnostic', (message) => sendToRenderer('sheep:diagnostic', message));
  sheepBridge.on('process/error', (error) =>
    sendToRenderer('app:error', error instanceof Error ? error.message : String(error)),
  );
}

function registerHandlers(): void {
  safeIpc('app:settings', () => settingsStore.get());
  safeIpc('app:session-check', async () => {
    const result = await roomService.sessionCheck();
    appSessionVerified = result.authenticated;
    if (appSessionVerified) await connectExistingRooms();
    else roomService.disconnect();
    return result;
  });
  safeIpc('app:google-sign-in', async () => {
    const member = await roomService.signInWithGoogle(
      GOOGLE_OAUTH_CLIENT_ID,
      (url) => shell.openExternal(url),
    );
    appSessionVerified = true;
    await connectExistingRooms();
    return member;
  });
  safeIpc('app:available-harnesses', () => detectAvailableHarnesses());
  safeIpc('app:update-settings', async (_event, input) => {
    const previous = await settingsStore.get();
    const settings = await settingsStore.update(input as Parameters<SettingsStore['update']>[0]);
    if (settings.connected && settings.allowRemoteAgentRequests !== previous.allowRemoteAgentRequests) {
      void roomService.rooms()
        .then((rooms) => agentRunner.resumePending(rooms.map((room) => room.id)))
        .catch((error: unknown) => sendToRenderer('app:error', error instanceof Error ? error.message : String(error)));
    }
    return settings;
  });
  safeIpc('app:bootstrap', async (_event, input) => {
    const result = await roomService.bootstrap(
      input as { backendUrl: string; adminSecret: string; name: string },
    );
    await connectExistingRooms();
    return result;
  });
  safeIpc('app:copy-text', async (_event, value) => {
    await clipboard.writeText(String(value));
    return { ok: true };
  });
  safeIpc('app:join-room', async (_event, code) => {
    const result = await roomService.joinRoom(String(code));
    await connectExistingRooms();
    return result;
  });
  safeIpc('app:logout', async () => {
    await roomService.logout();
    appSessionVerified = false;
    return settingsStore.get();
  });
  safeIpc('app:create-invites', async (_event, roomId) => roomService.createInvites(String(roomId), 1));
  safeIpc('app:rooms', async () => roomService.rooms());
  safeIpc('app:create-room', async (_event, input) =>
    roomService.createRoom(
      typeof input === 'string' ? input : stringField((input as Record<string, unknown>)?.name),
      typeof input === 'string' ? '' : stringField((input as Record<string, unknown>)?.defaultAgentId),
    ),
  );
  safeIpc('app:rename-room', async (_event, input) => {
    const value = input as { roomId: string; name: string };
    return roomService.renameRoom(String(value.roomId), String(value.name));
  });
  safeIpc('app:open-room', async (_event, roomId) => {
    await roomService.openRoom(String(roomId));
    await harnessContextMirror.sync(String(roomId));
    return roomService.messages(String(roomId));
  });
  safeIpc('app:room-messages', (_event, roomId) => roomService.messages(String(roomId)));
  safeIpc('app:pending-messages', (_event, roomId) => roomService.pendingMessages(String(roomId)));
  safeIpc('app:send-message', (_event, input) => {
    const message = input as { roomId: string; text: string; agentIds?: string[] };
    roomService.sendMessage(message);
    return { ok: true };
  });
  safeIpc('app:members', (_event, roomId) => roomService.members(String(roomId)));
  safeIpc('app:agents', (_event, roomId) => roomService.agents(String(roomId)));
  safeIpc('app:decide-mention', async (_event, input) => {
    const value = input as { roomId: string; turnId: string; decision: 'once' | 'always' | 'decline' };
    await roomService.decideMention(String(value.roomId), String(value.turnId), value.decision);
    return { ok: true };
  });
  safeIpc('app:run-pending', async (_event, roomId) => {
    await agentRunner.runPending(String(roomId));
    return { ok: true };
  });

  safeIpc('sheep:cached', () => {
    const conversations = conversationCatalog(localStore.catalog('conversation'));
    const projects = sortProjectsByRecent(projectsForUi(localStore.catalog('project')), conversations as { path?: string; updatedAt?: string }[]);
    return { projects, conversations };
  });
  safeIpc('sheep:health', () => sheepBridge.request('health'));
  safeIpc('sheep:projects', async () => {
    const result = await sheepBridge.request<{ projects: Record<string, unknown>[] }>('projects.list');
    const projects = sortProjectsByRecent(projectsForUi(result.projects || []), []);
    localStore.replaceCatalog('project', projects);
    return { ...result, projects };
  });
  safeIpc('sheep:conversations', async () => {
    const result = await sheepBridge.request<{ conversations: Record<string, unknown>[]; sourceError?: string }>('conversations.list');
    localStore.replaceCatalog('conversation', result.conversations || [], !result.sourceError);
    result.conversations = conversationCatalog(result.sourceError ? localStore.catalog('conversation') : result.conversations || []);
    return result;
  });
  safeIpc('sheep:refresh', async () => {
    const result = await sheepBridge.request<{
      projects: Record<string, unknown>[];
      conversations: Record<string, unknown>[];
      conversationSourceError?: string;
    }>('refresh');
    localStore.replaceCatalog('conversation', result.conversations || [], !result.conversationSourceError);
    result.conversations = conversationCatalog(result.conversationSourceError ? localStore.catalog('conversation') : result.conversations || []);
    const conversations = (result.conversations || []) as { path?: string; updatedAt?: string }[];
    const projects = sortProjectsByRecent(
      projectsFromConversations(result.projects || [], conversations),
      conversations,
    );
    localStore.replaceCatalog('project', projects);
    return { ...result, projects };
  });
  safeIpc('sheep:read', (_event, identity) =>
    sheepBridge.request('conversations.read', identity as Record<string, unknown>),
  );
  safeIpc('sheep:read-native', async (_event, input) => {
    const request = input as {
      harness: string;
      id: string;
      cursor?: string;
      limit?: number;
      title?: string;
    };
    const page = await sheepBridge.request<{
      harness: string;
      sessionId: string;
      format: string;
      cursor?: string;
      complete: boolean;
      nextCursor?: string;
      summary?: unknown;
      note?: string;
      records: { index: number; kind?: string; at?: string; raw: unknown }[];
    }>('conversations.readNative', request);
    localStore.saveNativePage(page, request.title || '');
    return page;
  });
  safeIpc('sheep:native-records', (_event, input) => {
    const value = input as { harness: string; id: string };
    return localStore.nativeRecords(value.harness, value.id);
  });

  safeIpc('native:create', async (_event, input) => {
    const value = input as { harness: 'codex' | 'hermes'; cwd: string; title: string };
    const requestId = randomUUID();
    const usage = await roomService.reserveChatCreation(requestId);
    const settings = await settingsStore.get();
    const cwd = value.cwd || os.homedir();
    const agent = harnessParticipants(settings).find((item) => item.harness === value.harness);
    let session: Awaited<ReturnType<typeof nativeChat.create>>;
    try {
      session = await nativeChat.create({ harness: value.harness, cwd, ...(agent?.model ? { model: agent.model } : {}) });
    } catch (error) {
      await roomService.releaseChatCreation(requestId).catch(() => {});
      throw error;
    }
    const chat = { id: session.sessionId, harness: session.harness, path: session.cwd, title: value.title.trim().slice(0, 80) || 'New chat', updatedAt: new Date().toISOString() };
    localStore.cache('app-conversation', chat.id, chat.harness, chat);
    return { ...chat, remainingChatsToday: usage.remaining };
  });
  safeIpc('native:send', async (_event, input) => {
    const value = input as { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; text: string };
    const chat = localStore.catalog('app-conversation').find((item) => item.id === value.sessionId && item.harness === value.harness);
    if (chat) localStore.cache('app-conversation', value.sessionId, value.harness, { ...chat, updatedAt: new Date().toISOString() });
    if (value.harness === 'codex') followCodexSession(value.sessionId);
    await nativeChat.send({ ...value, cwd: value.cwd || os.homedir() });
  });
  safeIpc('native:follow', (_event, input) => {
    const value = input as { sessionId?: string };
    if (value.sessionId) followCodexSession(value.sessionId);
  });
  safeIpc('native:links', () => localStore.nativeRoomLinks());
  safeIpc('native:link', (_event, input) => {
    const value = input as { harness: string; sessionId: string };
    return localStore.nativeRoomLink(value.harness, value.sessionId);
  });
  safeIpc('native:share', (_event, input) => shareNativeChat(input as { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; title: string; agentName?: string }));

  safeIpc('codex:account-read', (_event, refresh) => codex.accountRead(Boolean(refresh)));
  safeIpc('codex:account-rates', () => codex.accountRateLimitsRead());
  safeIpc('codex:login', async () => {
    const result = await codex.loginWithChatGpt();
    const authUrl = asObject(result)?.authUrl;
    if (typeof authUrl === 'string') await shell.openExternal(authUrl);
    return result;
  });
  safeIpc('codex:login-api-key', (_event, key) => codex.loginWithApiKey(String(key)));
  safeIpc('codex:logout', () => codex.logout());
  safeIpc('codex:models', () => codex.listModels());
  safeIpc('codex:threads', (_event, cwd) =>
    codex.listThreads(typeof cwd === 'string' ? cwd : undefined),
  );
  safeIpc('codex:start-thread', (_event, input) => codex.startThread(input as StartThreadInput));
  safeIpc('codex:resume-thread', (_event, input) =>
    codex.resumeThread(input as { threadId: string; cwd?: string }),
  );
  safeIpc('codex:start-turn', (_event, input) => codex.startTurn(input as StartTurnInput));
  safeIpc('codex:interrupt', (_event, input) => {
    const value = input as { threadId: string; turnId: string };
    return codex.interruptTurn(value.threadId, value.turnId);
  });
  safeIpc('codex:server-response', (_event, input) =>
    codex.respondToServerRequest(input as ServerRequestResponse),
  );

  safeIpc('hermes:status', (_event, refresh) => hermes.status(Boolean(refresh)));
  safeIpc('hermes:models', (_event, refresh) => hermes.listModels(Boolean(refresh)));
  safeIpc('hermes:new-session', (_event, input) => {
    const value = input as { model?: string; workingDirectory?: string };
    return hermes.newSession(value.model, value.workingDirectory);
  });
  safeIpc('hermes:load-session', (_event, input) => {
    const value = input as { sessionId: string; workingDirectory?: string };
    return hermes.loadSession(value.sessionId, value.workingDirectory);
  });
  safeIpc('hermes:set-model', (_event, input) => {
    const value = input as { sessionId: string; modelId: string };
    return hermes.setModel(value.sessionId, value.modelId);
  });
  safeIpc('hermes:prompt', (_event, input) => {
    const value = input as { sessionId: string; text: string };
    return hermes.prompt(value.sessionId, value.text);
  });
  safeIpc('hermes:cancel', (_event, sessionId) => {
    hermes.cancel(String(sessionId));
    return { ok: true };
  });
  safeIpc('hermes:permission', (_event, input) => {
    const value = input as { requestId: string; optionId: string | null };
    hermes.respondPermission(value.requestId, value.optionId);
    return { ok: true };
  });
}

function conversationCatalog(discovered: Record<string, unknown>[]): Record<string, unknown>[] {
  const chats = new Map(localStore.catalog('app-conversation').map((chat) => [`${stringField(chat.harness)}:${stringField(chat.id)}`, chat]));
  for (const chat of discovered) {
    const key = `${stringField(chat.harness)}:${stringField(chat.id)}`;
    const saved = chats.get(key);
    chats.set(key, saved ? { ...chat, ...saved, updatedAt: [stringField(chat.updatedAt), stringField(saved.updatedAt)].sort().at(-1) } : chat);
  }
  return [...chats.values()];
}

async function connectExistingRooms(): Promise<void> {
  const settings = await settingsStore.get();
  if (!settings.connected) return;
  const available = await detectAvailableHarnesses();
  for (const agent of harnessParticipants(settings, available)) {
    try {
      await roomService.registerAgent({
        id: agent.id,
        name: agent.name,
        harness: agent.harness,
        model: agent.model,
      });
    } catch (error) {
      sendToRenderer('app:error', errorMessage(error));
    }
  }
  const rooms = await roomService.rooms();
  for (const room of rooms) {
    try {
      await roomService.openRoom(room.id);
      await harnessContextMirror.sync(room.id);
    } catch (error) {
      sendToRenderer('app:error', errorMessage(error));
    }
  }
  agentRunner.resumePending(rooms.map((room) => room.id));
}

async function shareNativeChat(input: { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; title: string; agentName?: string }) {
  const settings = await settingsStore.get();
  if (!settings.connected || !settings.member) throw new Error('Connect to the room service before inviting a friend.');
  if (!['codex', 'hermes'].includes(input.harness) || !input.sessionId)
    throw new Error('Choose a Codex or Hermes chat before sharing it.');
  if (nativeChat.isActive(input.harness, input.sessionId)) throw new Error('Wait for the current agent reply before inviting a friend.');
  const transcript = await sheepBridge.request<Record<string, unknown>>('conversations.read', { harness: input.harness, id: input.sessionId });
  const entries = displayTranscriptMessages(transcript).map((message, index) => {
    const { role, content: text } = message;
    if (text.length > 32_000) throw new Error('This conversation has a message too long to share.');
    const entry: { index: number; role: 'user' | 'assistant'; text: string; at?: string } = { index, role, text };
    if (typeof message?.at === 'string') entry.at = message.at;
    return entry;
  });
  const linked = localStore.nativeRoomLink(input.harness, input.sessionId);
  const available = await detectAvailableHarnesses();
  const participants = harnessParticipants(settings, available);
  const agent = participants.find((item) => item.id === linked?.agentId)
    || participants.find((item) => item.harness === input.harness);
  if (!agent) throw new Error('This harness is unavailable on this computer.');
  await roomService.registerAgent({ id: agent.id, name: agent.name, harness: agent.harness, model: agent.model });
  const room = linked
    ? (await roomService.rooms()).find((item) => item.id === linked.roomId)
    : await roomService.createRoom(input.title || 'Chat', agent.id);
  if (!room) throw new Error('The linked shared chat is unavailable.');
  if (!linked) localStore.saveNativeRoomLink(input.harness, input.sessionId, room.id, agent.id);
  if (!localStore.agentSession(room.id, agent.id) && (await roomService.members(room.id)).length === 1) {
    const sourceId = createHash('sha256').update(`${input.harness}:${input.sessionId}`).digest('hex');
    const lastMessageSeq = await roomService.importMessages(room.id, sourceId, agent.id, entries);
    localStore.saveAgentSession({ roomId: room.id, agentId: agent.id, harness: agent.harness, sessionId: input.sessionId, cwd: input.cwd || os.homedir(), model: agent.model, contextThroughSeq: lastMessageSeq });
  }
  await roomService.openRoom(room.id);
  await harnessContextMirror.sync(room.id);
  const invite = (await roomService.createInvites(room.id, 1))[0];
  return { room, invite };
}

async function detectAvailableHarnesses(): Promise<HarnessName[]> {
  const available: HarnessName[] = [];
  if (resolveCodexExecutable()) available.push('codex');
  try {
    if ((await hermes.status()).installed) available.push('hermes');
  } catch { /* An unavailable harness is omitted from the local list. */ }
  availableHarnesses = available;
  return available;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f8f9fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER || '',
          `electron-preload${process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION || '.js'}`,
        ),
      ),
    },
  });
  if (process.env.DEV && process.env.APP_URL) await mainWindow.loadURL(process.env.APP_URL);
  else await mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!mainWindow || !isSafeAppNavigation(mainWindow.webContents.getURL(), url))
      event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) =>
    sendToRenderer('app:error', `The interface stopped: ${details.reason}.`),
  );
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function safeIpc(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertMainWindowSender(event);
      if (!['app:session-check', 'app:google-sign-in', 'app:logout'].includes(channel) && !appSessionVerified)
        throw new Error('Sign in with Google to continue.');
      return await handler(event, ...args);
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  });
}

function assertMainWindowSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents)
    throw new Error('Request did not come from the active app window.');
}

function followCodexSession(sessionId: string): void {
  if (!sessionId || nativeChat.owns('codex', sessionId) || codexSessionFollows.has(sessionId)) return;
  const filePath = findCodexSessionFile(sessionId, path.join(os.homedir(), '.codex', 'sessions'));
  if (!filePath) return;
  const follow = new CodexSessionFollow(filePath);
  codexSessionFollows.set(sessionId, follow);
  follow.on('update', (view: { messages: unknown[] }) => {
    sendToRenderer('native:chat-event', { harness: 'codex', sessionId, type: 'transcript', messages: view.messages });
  });
  follow.start();
}

function sendToRenderer(channel: string, value: unknown): void {
  if (appSessionVerified && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
    mainWindow.webContents.send(channel, value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
