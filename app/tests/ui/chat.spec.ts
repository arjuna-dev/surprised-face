import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, options: { room?: boolean; failCreate?: boolean; connected?: boolean; failCopy?: boolean; emptyInvite?: boolean; signedOut?: boolean; failSettings?: boolean; slowSettings?: boolean; failAccount?: boolean; failLogout?: boolean; slowInvite?: boolean; failInvite?: boolean } = {}) {
  await page.addInitScript((options) => {
    const events: Record<string, ((value: unknown) => void)[]> = {};
    const state = {
      calls: [] as { method: string; input: unknown }[], clipboard: '', failCreate: Boolean(options.failCreate),
      failSettings: Boolean(options.failSettings), failInvite: Boolean(options.failInvite),
      account: options.signedOut ? null : { type: 'chatgpt', email: 'maya@example.test', planType: 'plus' },
      settings: { backendUrl: 'https://fixture.invalid', displayName: 'Maya', member: { id: 'maya', name: 'Maya', role: 'member' }, theme: 'mint-charcoal', agents: [], allowRemoteAgentRequests: false, connected: options.connected !== false },
      rooms: options.room ? [{ id: 'chat-1', name: 'Design review' }] : [],
      sharedMessages: [] as Record<string, unknown>[], sharedAgents: [] as Record<string, unknown>[],
      pendingOutbox: [] as Record<string, unknown>[],
      conversations: [{ id: 'local-1', harness: 'codex', title: 'Local design', path: '/work/design', updatedAt: '2026-10-05T10:00:00Z' }],
    };
    const call = (method: string, input: unknown) => state.calls.push({ method, input });
    const savedSettings = localStorage.getItem('fixture-settings');
    if (savedSettings) Object.assign(state.settings, JSON.parse(savedSettings));
    const on = (name: string) => (handler: (value: unknown) => void) => { (events[name] ||= []).push(handler); return () => {}; };
    // Match Electron's unsupported window.prompt rather than accepting browser dialogs.
    window.prompt = () => { throw new Error('prompt() is and will not be supported.'); };
    Object.assign(window, { uiFixture: state, emitCodex: (value: unknown) => { for (const handler of events.codexEvent || []) handler(value); }, emitNative: (value: unknown) => { for (const handler of events.native || []) handler(value); }, surprisedFace: {
      settings: async () => structuredClone(state.settings),
      updateSettings: async (input: Record<string, unknown>) => {
        call('updateSettings', input);
        if (state.failSettings) { state.failSettings = false; throw new Error('Could not save settings.'); }
        if (options.slowSettings) await new Promise(resolve => setTimeout(resolve, 400));
        Object.assign(state.settings, input);
        localStorage.setItem('fixture-settings', JSON.stringify(state.settings));
        return structuredClone(state.settings);
      },
      codexAccount: async (refresh: boolean) => {
        call('codexAccount', refresh);
        if (options.failAccount) throw new Error('Codex is unavailable.');
        return { account: structuredClone(state.account), requiresOpenaiAuth: true };
      },
      codexLogin: async () => { call('codexLogin', null); return { type: 'chatgpt', loginId: 'fixture-login', authUrl: 'https://fixture.invalid/login' }; },
      codexLogout: async () => { call('codexLogout', null); if (options.failLogout) throw new Error('Could not sign out.'); state.account = null; return {}; },
      onCodexEvent: on('codexEvent'),
      hermesStatus: async () => ({ installed: true, version: 'Fixture Hermes' }),
      rooms: async () => structuredClone(state.rooms),
      sheepRefresh: async () => ({ projects: [{ name: 'Design', path: '/work/design' }, { name: 'Garden', path: '/work/garden' }], conversations: state.conversations }),
      sheepRead: async () => ({ messages: [
        { role: 'user', content: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>' },
        { role: 'user', content: 'A sample conversation' },
        { role: 'assistant', content: 'Sample reply' },
      ] }),
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
      nativeFollow: async (input: unknown) => { call('nativeFollow', input); },
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
      createInvites: async (input: unknown) => {
        call('createInvites', input);
        if (options.slowInvite) await new Promise(resolve => setTimeout(resolve, 500));
        if (state.failInvite) { state.failInvite = false; throw new Error('Could not reach the chat service.'); }
        return options.emptyInvite ? [] : [{ code: 'fixture-chat-code', expiresAt: '2026-10-12' }];
      },
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

test('an open Codex chat follows later desktop messages and hides harness page context', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'C Local design' }).click();
  await expect(page.getByText('A sample conversation', { exact: true })).toBeVisible();
  await expect(page.getByText('Sample reply', { exact: true })).toBeVisible();
  await expect(page.getByText(/external_codex_apps_open_page/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.calls.some((call: { method: string; input?: { sessionId?: string } }) => call.method === 'nativeFollow' && call.input?.sessionId === 'local-1'))).toBe(true);
  await page.evaluate(() => (window as any).emitNative({
    harness: 'codex', sessionId: 'local-1', type: 'transcript',
    messages: [
      { role: 'user', content: 'A sample conversation' },
      { role: 'assistant', content: 'Sample reply' },
      { role: 'user', content: 'Hello from Codex desktop' },
      { role: 'assistant', content: 'Hello from the desktop reply' },
    ],
  }));
  await expect(page.getByText('Hello from Codex desktop', { exact: true })).toBeVisible();
  await expect(page.getByText('Hello from the desktop reply', { exact: true })).toBeVisible();
  await expect(page.getByText(/external_codex_apps_open_page/)).toHaveCount(0);
});

test('inviting from a local chat shows its code in a modal and copies only on request', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'C Local design' }).click();
  await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite friend', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Chat invite code' })).toHaveValue('fixture-chat-code');
  await expect(dialog.getByText('Copy this code and send it to your friend. They can paste it into Join a chat.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).uiFixture.clipboard)).toBe('');
  await dialog.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).uiFixture.clipboard)).toBe('fixture-chat-code');
  await expect(page.locator('.invite-confirmation')).toHaveCount(0);
  await page.screenshot({ path: '../output/playwright/invite-copied.png' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite friend', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('an existing chat has invite and join dialogs with a working join form', async ({ page }) => {
  await fixture(page, { room: true });
  await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite friend', exact: true });
  await expect(invite.getByRole('textbox', { name: 'Chat invite code' })).toHaveValue('fixture-chat-code');
  await invite.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Join a chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Invite code', exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Join chat', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This invite code is invalid.');
  await page.getByRole('textbox', { name: 'Invite code', exact: true }).fill('friend-code');
  await page.getByRole('button', { name: 'Join chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).uiFixture.calls)).toContainEqual({ method: 'joinRoom', input: 'friend-code' });
});

for (const theme of ['mint-charcoal', 'cobalt-red', 'classic'] as const) {
  test(`invite and join dialogs use consistent type and padding in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 680 });
    await fixture(page, { room: true });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: theme === 'mint-charcoal' ? /Mint \+ charcoal/ : theme === 'cobalt-red' ? /Cobalt \+ red/ : /Classic/ }).click();
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    for (const action of ['Join a chat', 'Invite friend']) {
      await page.getByRole('button', { name: action, exact: true }).click();
      const heading = page.getByRole('heading', { name: action === 'Invite friend' ? 'Invite friend' : 'Join chat', exact: true });
      await expect(heading).toBeVisible();
      if (action === 'Join a chat') await page.screenshot({ path: `../output/playwright/join-modal-${theme}.png` });
      const type = await heading.evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), weight: Number(getComputedStyle(element).fontWeight) }));
      expect(type.size).toBeLessThanOrEqual(20);
      expect(type.weight).toBeLessThanOrEqual(500);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      const title = (await heading.boundingBox())!;
      expect(title.x - box.x).toBeGreaterThanOrEqual(24);
      expect(title.y - box.y).toBeGreaterThanOrEqual(24);
      expect(box.y + box.height).toBeLessThanOrEqual(680);
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
      if (action === 'Join a chat') {
        await expect(dialog.getByRole('textbox', { name: 'Invite code', exact: true })).toBeFocused();
        await page.screenshot({ path: `../output/playwright/join-modal-${theme}.png` });
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: action, exact: true })).toBeFocused();
    }
  });
}

test('invite generation shows loading and lets a failed request retry inside the modal', async ({ page }) => {
  await fixture(page, { room: true, slowInvite: true, failInvite: true });
  await page.getByRole('button', { name: 'Invite friend', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite friend', exact: true });
  await expect(dialog.getByText('Creating invite code...')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy code', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveText('Could not reach the chat service.');
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Chat invite code' })).toHaveValue('fixture-chat-code');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).uiFixture.clipboard)).toBe('');
});

test('join dialog contains keyboard focus, closes on its backdrop, and accepts a new account name', async ({ page }) => {
  await fixture(page, { connected: false });
  await page.getByRole('button', { name: 'Join a chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Join chat', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Your name', exact: true })).toHaveValue('Maya');
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  }
  await page.mouse.click(10, 10);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join a chat', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Join a chat', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Invite code', exact: true }).fill('new-person-code');
  await dialog.getByRole('button', { name: 'Join chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).uiFixture.calls)).toContainEqual({ method: 'join', input: { backendUrl: 'https://fixture.invalid', code: 'new-person-code', name: 'Maya' } });
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
    if (scenario === 'failCopy') await page.getByRole('dialog').getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(scenario === 'emptyInvite' ? 'Could not create' : 'Could not copy');
    if (scenario === 'failCopy') await expect(page.getByRole('textbox', { name: 'Chat invite code' })).toHaveValue('fixture-chat-code');
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

for (const connected of [true, false]) {
  test(`Settings accepts a chat invite for a ${connected ? 'connected' : 'new'} account`, async ({ page }) => {
    await fixture(page, { connected });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const code = page.getByRole('textbox', { name: 'Invite code', exact: true });
    await expect(code).toBeVisible();
    await code.fill('friend-settings-code');
    await page.screenshot({ path: `../output/playwright/settings-join-${connected ? 'connected' : 'new'}.png` });
    await page.getByRole('button', { name: 'Join chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { uiFixture: { calls: { method: string; input: unknown }[] } }).uiFixture.calls);
    expect(calls).toContainEqual(connected
      ? { method: 'joinRoom', input: 'friend-settings-code' }
      : { method: 'join', input: { backendUrl: 'https://fixture.invalid', code: 'friend-settings-code', name: 'Maya' } });
  });
}

for (const view of ['new', 'native', 'room'] as const) {
  test(`the ${view} chat header has distinct labeled invite and join actions`, async ({ page }) => {
    await fixture(page, { room: view === 'room' });
    if (view === 'native') {
      await page.getByRole('button', { name: 'Design', exact: true }).click();
      await page.getByRole('button', { name: 'C Local design' }).click();
    }
    const actions = page.locator('.room-actions');
    await expect(actions.getByRole('button', { name: 'Invite friend', exact: true })).toHaveText('Invite friend');
    await expect(actions.getByRole('button', { name: 'Join a chat', exact: true })).toHaveText('Join a chat');
    await expect(page.locator('.left-sidebar').getByRole('button', { name: 'Join a chat', exact: true })).toHaveCount(0);
    await expect(actions.locator('.lucide-user-plus')).toHaveCount(1);
    await expect(actions.locator('.lucide-log-in')).toHaveCount(1);
    if (view === 'new') await expect(actions.getByRole('button', { name: 'Invite friend', exact: true })).toBeDisabled();
    if (view === 'room') await page.screenshot({ path: '../output/playwright/chat-header-actions.png' });
    await actions.getByRole('button', { name: 'Join a chat', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Invite code', exact: true })).toBeVisible();
  });
}

test('appearance and general settings save automatically and stay selected after leaving Settings', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Cobalt \+ red/ }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'cobalt-red');
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.theme)).toBe('cobalt-red');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Maya updated');
  await page.getByRole('checkbox', { name: /Run agent mentions/ }).check();
  await expect(page.getByText('Settings saved automatically', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.displayName)).toBe('Maya updated');
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.allowRemoteAgentRequests)).toBe(true);
  await page.getByRole('button', { name: /Mint \+ charcoal/ }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'mint-charcoal');
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.theme)).toBe('mint-charcoal');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'mint-charcoal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveValue('Maya updated');
});

test('rapid appearance changes save in order without reverting the latest selection', async ({ page }) => {
  await fixture(page, { slowSettings: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Cobalt \+ red/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.calls.filter((call: any) => call.method === 'updateSettings').length)).toBe(1);
  await page.getByRole('button', { name: /Classic/ }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'classic');
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.theme)).toBe('classic');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'classic');
});

test('an automatic save failure is visible and Retry saves the chosen theme', async ({ page }) => {
  await fixture(page, { failSettings: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Cobalt \+ red/ }).click();
  await expect(page.getByText('Could not save settings.', { exact: true })).toBeVisible();
  await expect(page.getByText('Settings saved automatically', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByText('Settings saved automatically', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.theme)).toBe('cobalt-red');
});

test('Settings reads the Codex account, checks status with feedback, and signs out', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Signed in as maya@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByText('Codex status checked. You are signed in.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../output/playwright/settings-codex-account.png' });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Signed out of Codex.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.calls.filter((call: any) => call.method === 'codexLogout').length)).toBe(1);
});

test('checking a signed-out Codex account does not start login and login completion refreshes it', async ({ page }) => {
  await fixture(page, { signedOut: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Not signed in', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByText('Codex status checked. You are not signed in.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).uiFixture.calls.some((call: any) => call.method === 'codexLogin'))).toBe(false);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Complete Codex sign-in in your browser.', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).uiFixture.account = { type: 'chatgpt', email: 'maya@example.test', planType: 'plus' };
    (window as any).emitCodex({ method: 'account/login/completed', params: { loginId: 'fixture-login', success: true, error: null } });
  });
  await expect(page.getByText('Signed in as maya@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Signed in to Codex.', { exact: true })).toBeVisible();
});

test('Codex account changes refresh the status and failed sign-out keeps the account', async ({ page }) => {
  await fixture(page, { failLogout: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Could not sign out.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).uiFixture.account = null;
    (window as any).emitCodex({ method: 'account/updated', params: { authMode: null, planType: null } });
  });
  await expect(page.getByText('Not signed in', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('Codex check failures show an error and leave Check status available', async ({ page }) => {
  await fixture(page, { failAccount: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Codex is unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});
