import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  CodexAppServer,
  type ServerRequestResponse,
  type StartThreadInput,
  type StartTurnInput,
} from './codex-app-server';
import { HermesAcpClient } from './hermes-acp';
import { AgentRunner } from './agent-runner';
import { NativeChatService } from './native-chat';
import { LocalStore } from './local-store';
import { RoomService } from './room-service';
import { SettingsStore, type LocalAgentSettings } from './settings-store';
import { SheepBridge } from './sheep-bridge';
import { isSafeAppNavigation } from './navigation-policy';
import { projectsForUi, sortProjectsByRecent } from './local-projects';
import { displayTranscriptMessages } from '../src/lib/native-transcript';
import { configureAppProfile } from './app-data-path';

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
      settingsStore = new SettingsStore(app.getPath('userData'));
      sheepBridge = new SheepBridge();
      roomService = new RoomService(settingsStore, localStore);
      codex = new CodexAppServer();
      hermes = new HermesAcpClient({
        environment: () => ({}),
        workingDirectory: () => os.homedir(),
        clientVersion: app.getVersion(),
      });
      agentRunner = new AgentRunner(roomService, localStore, settingsStore, codex, hermes);
      nativeChat = new NativeChatService(codex, hermes);

      bindEvents();
      registerHandlers();
      await createWindow();
      void connectExistingRooms();
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
    codex?.stop();
    hermes?.stop();
    localStore?.close();
  });
}

function bindEvents(): void {
  roomService.on('event', (payload) => {
    sendToRenderer('room:event', payload);
    const event = asObject(asObject(payload)?.event);
    if (event?.type === 'turn.queued' || event?.type === 'turn.finished') {
      const roomId = stringValue(asObject(payload)?.roomId);
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
  safeIpc('app:update-settings', async (_event, input) => {
    const previous = await settingsStore.get();
    const settings = await settingsStore.update(input as Parameters<SettingsStore['update']>[0]);
    if (settings.connected && settings.allowRemoteAgentRequests && !previous.allowRemoteAgentRequests) {
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
  safeIpc('app:register', async (_event, name) => {
    const member = await roomService.register(stringField(name) || os.userInfo().username);
    await connectExistingRooms();
    return member;
  });
  safeIpc('app:copy-text', async (_event, value) => {
    await clipboard.writeText(String(value));
    return { ok: true };
  });
  safeIpc('app:join', async (_event, input) => {
    const result = await roomService.join(
      input as { backendUrl: string; code: string; name: string },
    );
    await connectExistingRooms();
    return result;
  });
  safeIpc('app:join-room', async (_event, code) => {
    const result = await roomService.joinRoom(String(code));
    await connectExistingRooms();
    return result;
  });
  safeIpc('app:logout', async () => {
    roomService.disconnect();
    return settingsStore.clearConnection();
  });
  safeIpc('app:create-invites', async (_event, roomId) => roomService.createInvites(String(roomId), 1));
  safeIpc('app:rooms', async () => roomService.rooms());
  safeIpc('app:create-room', async (_event, input) =>
    roomService.createRoom(
      typeof input === 'string' ? input : stringField((input as Record<string, unknown>)?.name),
      typeof input === 'string' ? '' : stringField((input as Record<string, unknown>)?.defaultAgentId),
    ),
  );
  safeIpc('app:open-room', async (_event, roomId) => {
    await roomService.openRoom(String(roomId));
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
  safeIpc('app:save-agent', async (_event, value) => {
    const agent = value as LocalAgentSettings;
    const settings = await settingsStore.get();
    const agents = [...settings.agents.filter((item) => item.id !== agent.id), agent];
    await settingsStore.update({ agents });
    if (settings.connected)
      await roomService.registerAgent({
        id: agent.id,
        name: agent.name,
        harness: agent.harness,
        model: agent.model,
      });
    return settingsStore.get();
  });
  safeIpc('app:run-pending', async (_event, roomId) => {
    await agentRunner.runPending(String(roomId));
    return { ok: true };
  });
  safeIpc('app:choose-folder', async () => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] || null;
  });

  safeIpc('sheep:health', () => sheepBridge.request('health'));
  safeIpc('sheep:projects', async () => {
    const result = await sheepBridge.request<{ projects: Record<string, unknown>[] }>(
      'projects.list',
    );
    const projects = sortProjectsByRecent(projectsForUi(result.projects || []), []);
    for (const project of projects)
      localStore.cache(
        'project',
        stringField(project.name) || stringField(project.path),
        '',
        project,
      );
    return { ...result, projects };
  });
  safeIpc('sheep:conversations', async () => {
    const result = await sheepBridge.request<{ conversations: Record<string, unknown>[] }>(
      'conversations.list',
    );
    result.conversations = conversationCatalog(result.conversations || []);
    for (const conversation of result.conversations || [])
      localStore.cache(
        'conversation',
        stringField(conversation.id),
        stringField(conversation.harness),
        conversation,
      );
    return result;
  });
  safeIpc('sheep:refresh', async () => {
    const result = await sheepBridge.request<{
      projects: Record<string, unknown>[];
      conversations: Record<string, unknown>[];
    }>('refresh');
    result.conversations = conversationCatalog(result.conversations || []);
    const projects = sortProjectsByRecent(projectsForUi(result.projects || []), (result.conversations || []) as { path?: string; updatedAt?: string }[]);
    for (const project of projects)
      localStore.cache(
        'project',
        stringField(project.name) || stringField(project.path),
        '',
        project,
      );
    for (const conversation of result.conversations || [])
      localStore.cache(
        'conversation',
        stringField(conversation.id),
        stringField(conversation.harness),
        conversation,
      );
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
    const settings = await settingsStore.get();
    const agent = settings.agents.find((item) => item.harness === value.harness && item.workingDirectory === value.cwd);
    const session = await nativeChat.create({ harness: value.harness, cwd: value.cwd, ...(agent?.model ? { model: agent.model } : {}) });
    const chat = { id: session.sessionId, harness: session.harness, path: session.cwd, title: value.title.trim().slice(0, 80) || 'New chat', updatedAt: new Date().toISOString() };
    localStore.cache('app-conversation', chat.id, chat.harness, chat);
    return chat;
  });
  safeIpc('native:send', async (_event, input) => {
    const value = input as { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; text: string };
    const chat = localStore.catalog('app-conversation').find((item) => item.id === value.sessionId && item.harness === value.harness);
    if (chat) localStore.cache('app-conversation', value.sessionId, value.harness, { ...chat, updatedAt: new Date().toISOString() });
    await nativeChat.send(value);
  });
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
  for (const agent of settings.agents) {
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
    } catch (error) {
      sendToRenderer('app:error', errorMessage(error));
    }
  }
  agentRunner.resumePending(rooms.map((room) => room.id));
}

async function shareNativeChat(input: { harness: 'codex' | 'hermes'; sessionId: string; cwd: string; title: string; agentName?: string }) {
  const settings = await settingsStore.get();
  if (!settings.connected || !settings.member) throw new Error('Connect to the room service before inviting a friend.');
  if (!['codex', 'hermes'].includes(input.harness) || !input.sessionId || !input.cwd)
    throw new Error('This chat needs a Codex or Hermes session and working folder before it can be shared.');
  if (nativeChat.isActive(input.harness, input.sessionId)) throw new Error('Wait for the current agent reply before inviting a friend.');
  const transcript = await sheepBridge.request<Record<string, unknown>>('conversations.read', { harness: input.harness, id: input.sessionId });
  const entries = displayTranscriptMessages(transcript).map((message, index) => {
    const { role, content: text } = message;
    if (text.length > 32_000) throw new Error('This conversation has a message too long to share.');
    const entry: { index: number; role: 'user' | 'assistant'; text: string; at?: string } = { index, role, text };
    if (typeof message?.at === 'string') entry.at = message.at;
    return entry;
  });
  let agent = settings.agents.find((item) => item.harness === input.harness && item.workingDirectory === input.cwd);
  if (!agent) {
    agent = {
      id: `agent-${settings.member.id.slice(0, 8)}-${input.harness}-${createHash('sha256').update(input.cwd).digest('hex').slice(0, 8)}`,
      name: input.agentName || `${settings.displayName || 'My'} ${input.harness === 'codex' ? 'Codex' : 'Hermes'}`,
      harness: input.harness,
      model: '',
      workingDirectory: input.cwd,
    };
    await settingsStore.update({ agents: [...settings.agents, agent] });
  }
  await roomService.registerAgent({ id: agent.id, name: agent.name, harness: agent.harness, model: agent.model });
  const linked = localStore.nativeRoomLink(input.harness, input.sessionId);
  const room = linked
    ? (await roomService.rooms()).find((item) => item.id === linked.roomId)
    : await roomService.createRoom(input.title || 'Chat', agent.id);
  if (!room) throw new Error('The linked shared chat is unavailable.');
  if (!linked) localStore.saveNativeRoomLink(input.harness, input.sessionId, room.id, agent.id);
  if (!localStore.agentSession(room.id, agent.id) && (await roomService.members(room.id)).length === 1) {
    const sourceId = createHash('sha256').update(`${input.harness}:${input.sessionId}`).digest('hex');
    const lastMessageSeq = await roomService.importMessages(room.id, sourceId, agent.id, entries);
    localStore.saveAgentSession({ roomId: room.id, agentId: agent.id, harness: agent.harness, sessionId: input.sessionId, cwd: input.cwd, model: agent.model, contextThroughSeq: lastMessageSeq });
  }
  await roomService.openRoom(room.id);
  const invite = (await roomService.createInvites(room.id, 1))[0];
  return { room, invite };
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

function sendToRenderer(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
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
