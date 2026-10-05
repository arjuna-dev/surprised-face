import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, options: { room?: boolean; failCreate?: boolean; connected?: boolean; failCopy?: boolean; emptyInvite?: boolean } = {}) {
  await page.addInitScript((options) => {
    const events: Record<string, ((value: unknown) => void)[]> = {};
    const state = {
      calls: [] as { method: string; input: unknown }[], clipboard: '', failCreate: Boolean(options.failCreate),
      settings: { backendUrl: 'https://fixture.invalid', displayName: 'Maya', member: { id: 'maya', name: 'Maya', role: 'member' }, theme: 'mint-charcoal', agents: [], allowRemoteAgentRequests: false, connected: options.connected !== false },
      rooms: options.room ? [{ id: 'chat-1', name: 'Design review' }] : [],
      sharedMessages: [] as Record<string, unknown>[], sharedAgents: [] as Record<string, unknown>[],
      pendingOutbox: [] as Record<string, unknown>[],
      conversations: [{ id: 'local-1', harness: 'codex', title: 'Local design', path: '/work/design', updatedAt: '2026-10-05T10:00:00Z' }],
    };
    const call = (method: string, input: unknown) => state.calls.push({ method, input });
    const on = (name: string) => (handler: (value: unknown) => void) => { (events[name] ||= []).push(handler); return () => {}; };
    // Match Electron's unsupported window.prompt rather than accepting browser dialogs.
    window.prompt = () => { throw new Error('prompt() is and will not be supported.'); };
    Object.assign(window, { uiFixture: state, surprisedFace: {
      settings: async () => state.settings,
      rooms: async () => state.rooms,
      sheepRefresh: async () => ({ projects: [{ name: 'Design', path: '/work/design' }, { name: 'Garden', path: '/work/garden' }], conversations: state.conversations }),
      sheepRead: async () => ({ messages: [{ role: 'user', content: 'A sample conversation' }, { role: 'assistant', content: 'Sample reply' }] }),
      roomMessages: async () => state.sharedMessages, pendingMessages: async () => state.pendingOutbox, openRoom: async () => state.sharedMessages,
      sendMessage: async (input: { roomId: string; text: string }) => {
        const createdAt = new Date().toISOString();
        state.pendingOutbox = [{ client_id: 'client-1', room_id: input.roomId, text: input.text, agent_ids: '[]', created_at: createdAt, error: null }];
        state.sharedMessages.push({ id: 'cloud-new', roomId: input.roomId, messageSeq: 1, participantId: 'maya', participantName: 'Maya', role: 'user', text: input.text, createdAt, state: 'complete' });
        for (const handler of events.room || []) handler({ roomId: input.roomId, event: { type: 'message.created' } });
        setTimeout(() => {
          state.pendingOutbox = [];
          for (const handler of events.outbox || []) handler({ roomId: input.roomId });
        }, 50);
        return { ok: true };
      },
      members: async () => [{ id: 'maya', name: 'Maya', role: 'member' }], agents: async () => state.sharedAgents, runPending: async () => ({}),
      nativeLink: async () => null,
      nativeCreate: async (input: { harness: string; cwd: string; title: string }) => {
        call('nativeCreate', input);
        if (state.failCreate) { state.failCreate = false; throw new Error('Codex needs sign-in. Open Settings.'); }
        const chat = { id: `new-${input.harness}`, harness: input.harness, path: input.cwd, title: input.title, updatedAt: new Date().toISOString() };
        state.conversations.push(chat);
        return chat;
      },
      nativeSend: async (input: { harness: string; sessionId: string; text: string }) => {
        call('nativeSend', input);
        for (const handler of events.native || []) {
          handler({ ...input, type: 'delta', text: 'Hello from your agent' });
          handler({ ...input, type: 'completed' });
        }
      },
      register: async (name: string) => { call('register', name); state.settings.connected = true; return state.settings.member; },
      nativeShare: async (input: unknown) => {
        call('nativeShare', input);
        const room = { id: 'chat-1', name: 'Local design' };
        state.rooms.push(room);
        state.sharedAgents = [{ id: 'maya-codex', name: 'Maya Codex', ownerId: 'maya', harness: 'codex', model: '' }];
        state.sharedMessages = [
          { id: 'message-1', roomId: room.id, messageSeq: 1, role: 'user', text: 'A sample conversation', participantId: 'maya', participantName: 'Maya', createdAt: '2026-10-05T10:00:00Z' },
          { id: 'message-2', roomId: room.id, messageSeq: 2, role: 'assistant', text: 'Sample reply', agentId: 'maya-codex', agentName: 'Maya Codex', participantId: 'maya-codex', harness: 'codex', createdAt: '2026-10-05T10:00:01Z' },
        ];
        return { room, invite: { code: 'fixture-chat-code', expiresAt: '2026-10-12' } };
      },
      createInvites: async (input: unknown) => { call('createInvites', input); return options.emptyInvite ? [] : [{ code: 'fixture-chat-code', expiresAt: '2026-10-12' }]; },
      copyText: async (text: string) => { call('copyText', text); if (options.failCopy) return { ok: false }; state.clipboard = text; return { ok: true }; },
      joinRoom: async (code: string) => { call('joinRoom', code); if (code === 'invalid') throw new Error('This invite code is invalid.'); state.rooms.push({ id: 'joined-chat', name: 'Friends' }); return { roomId: 'joined-chat' }; },
      join: async (input: unknown) => { call('join', input); state.settings.connected = true; state.rooms.push({ id: 'joined-chat', name: 'Friends' }); return { roomId: 'joined-chat' }; },
      onNativeChatEvent: on('native'), onRoomEvent: on('room'), onRoomConnection: on('connection'), onAppError: on('error'),
      onOutboxChanged: on('outbox'),
      onAgentActivity: on('activity'), onCodexRequest: on('codex'), onHermesRequest: on('hermes'),
    } });
  }, options);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible();
}

test('an empty chat view has no phantom invite and selecting a project enables its composer', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('textbox', { name: 'Chat invite code' })).toHaveCount(0);
  await expect(page.getByText('Select a shared chat', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('/work/design');
  await page.screenshot({ path: '../output/playwright/project-composer.png' });
});

test('project plus and composer selectors create a Hermes chat and send its first message', async ({ page }) => {
  await fixture(page, { connected: false });
  await page.getByRole('button', { name: 'Design', exact: true }).hover();
  await page.getByRole('button', { name: 'New chat in Design', exact: true }).click();
  await page.getByRole('combobox', { name: 'Project' }).selectOption('/work/garden');
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('hermes');
  await page.getByRole('textbox', { name: 'Message' }).fill('Plan my garden');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Hello from your agent', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { uiFixture: { calls: unknown[] } }).uiFixture.calls);
  expect(calls).toContainEqual({ method: 'nativeCreate', input: { harness: 'hermes', cwd: '/work/garden', title: 'Plan my garden' } });
  expect(calls).toContainEqual({ method: 'nativeSend', input: { harness: 'hermes', sessionId: 'new-hermes', cwd: '/work/garden', text: 'Plan my garden' } });
  expect(calls).not.toContainEqual(expect.objectContaining({ method: 'register' }));
  await expect(page.getByRole('button', { name: 'H Plan my garden' })).toBeVisible();
  await page.screenshot({ path: '../output/playwright/new-chat-reply.png' });
});

test('New chat survives Electron prompt restrictions and a failed first send keeps the draft for retry', async ({ page }) => {
  await fixture(page, { failCreate: true });
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'Project' }).selectOption('/work/design');
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Hello');
  await expect(page.getByText('Codex needs sign-in. Open Settings.', { exact: true })).toBeVisible();
  await expect(page.getByText('Something went wrong in this view.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Hello from your agent', { exact: true })).toBeVisible();
});

test('the local chat invite icon copies a real code with a short confirmation', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'C Local design' }).click();
  await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Invite code copied');
  expect(await page.evaluate(() => (window as unknown as { uiFixture: { clipboard: string } }).uiFixture.clipboard)).toBe('fixture-chat-code');
  await expect(page.getByRole('textbox', { name: 'Chat invite code' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close invite' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite friend', exact: true })).toHaveText('');
  await page.screenshot({ path: '../output/playwright/invite-copied.png' });
});

test('an existing chat uses the same invite icon and joining uses a working form', async ({ page }) => {
  await fixture(page, { room: true });
  await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Invite code copied');
  await page.getByRole('button', { name: 'Join a chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Invite code', exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Join chat', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This invite code is invalid.');
  await page.getByRole('textbox', { name: 'Invite code', exact: true }).fill('friend-code');
  await page.getByRole('button', { name: 'Join chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { uiFixture: { calls: unknown[] } }).uiFixture.calls)).toContainEqual({ method: 'joinRoom', input: 'friend-code' });
});

test('changing the composer project keeps the draft and New chat resets it', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('An unsent message');
  await page.getByRole('combobox', { name: 'Project' }).selectOption('/work/garden');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('An unsent message');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('/work/garden');
});

test('a delivered chat message clears its sending copy without waiting for another message', async ({ page }) => {
  await fixture(page, { room: true });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A delivered message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.message-text').filter({ hasText: 'A delivered message' })).toHaveCount(1);
  await expect(page.getByText('sending', { exact: true })).toHaveCount(0);
});

for (const scenario of ['emptyInvite', 'failCopy'] as const) {
  test(`an invite ${scenario} shows an error instead of a false copy confirmation`, async ({ page }) => {
    await fixture(page, { room: true, [scenario]: true });
    await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(scenario === 'emptyInvite' ? 'Could not create' : 'Could not copy');
    expect(await page.evaluate(() => (window as unknown as { uiFixture: { clipboard: string } }).uiFixture.clipboard)).toBe('');
    await expect(page.getByRole('heading', { name: 'Design review', exact: true })).toBeVisible();
  });
}

test('composer and project controls fit a smaller desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await fixture(page);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const composer = page.locator('.composer');
  await expect(composer).toBeVisible();
  const bounds = await composer.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
  await page.screenshot({ path: '../output/playwright/small-project-composer.png' });
});
