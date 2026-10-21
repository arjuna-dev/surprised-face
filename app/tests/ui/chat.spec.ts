import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, options: { room?: boolean; foreignOwned?: boolean; twoHarnesses?: boolean; ownerAttribution?: boolean; failCreate?: boolean; connected?: boolean; leaveSignedOut?: boolean; failCopy?: boolean; emptyInvite?: boolean; signedOut?: boolean; failSettings?: boolean; slowSettings?: boolean; failAccount?: boolean; failLogout?: boolean; slowInvite?: boolean; failInvite?: boolean; slowCatalog?: boolean; failCatalog?: boolean; hermesUnavailable?: boolean } = {}) {

  await page.addInitScript((options) => {
    const events: Record<string, ((value: unknown) => void)[]> = {};
    const state = {
      calls: [] as { method: string; input: unknown }[], clipboard: '', failCreate: Boolean(options.failCreate),
      settingsReadsBeforeSession: 0,
      failSettings: Boolean(options.failSettings), failInvite: Boolean(options.failInvite),
      account: options.signedOut ? null : { type: 'chatgpt', email: 'maya@example.test', planType: 'plus' },
      settings: { backendUrl: 'https://fixture.invalid', displayName: 'Maya', member: { id: 'maya', name: 'Maya', role: options.foreignOwned ? 'owner' : 'member' }, theme: 'mint-charcoal', agents: [], allowRemoteAgentRequests: false, connected: options.connected !== false },
      rooms: options.room ? [{ id: 'chat-1', name: 'Design review', createdBy: options.foreignOwned ? 'mukesh' : 'maya' }] : [],
      sharedMessages: options.ownerAttribution ? [
        { id: 'aman-reply', roomId: 'chat-1', messageSeq: 1, participantId: 'aman-codex', participantName: 'Aman agent', role: 'assistant', text: 'Hi Alejandro!', state: 'complete', agentId: 'aman-codex', agentName: 'Aman agent', ownerId: 'aman', harness: 'codex', createdAt: '2026-10-20T19:42:00Z' },
        { id: 'mukesh-reply', roomId: 'chat-1', messageSeq: 2, participantId: 'mukesh-codex', participantName: 'mukesh Codex', role: 'assistant', text: 'It really is!', state: 'complete', agentId: 'mukesh-codex', agentName: 'mukesh Codex', ownerId: 'mukesh', harness: 'codex', createdAt: '2026-10-20T19:43:00Z' },
      ] as Record<string, unknown>[] : [] as Record<string, unknown>[], sharedAgents: options.ownerAttribution ? [
        { id: 'aman-codex', name: 'Aman agent', ownerId: 'aman', harness: 'codex', model: '' },
        { id: 'mukesh-codex', name: 'mukesh Codex', ownerId: 'mukesh', harness: 'codex', model: '' },
      ] as Record<string, unknown>[] : options.room ? [
        { id: 'maya-codex', name: 'Codex', ownerId: 'maya', harness: 'codex', model: '' },
        ...(options.twoHarnesses ? [{ id: 'maya-hermes', name: 'Hermes', ownerId: 'maya', harness: 'hermes', model: '' }] : []),
      ] as Record<string, unknown>[] : [] as Record<string, unknown>[],
      pendingOutbox: [] as Record<string, unknown>[],
      conversations: [{ id: 'local-1', harness: 'codex', title: 'Local design', path: '/work/design', updatedAt: '2026-10-05T10:00:00Z' }],
    };
    const call = (method: string, input: unknown) => state.calls.push({ method, input });
    const savedSettings = localStorage.getItem('fixture-settings');
    if (savedSettings) Object.assign(state.settings, JSON.parse(savedSettings));
    const on = (name: string) => (handler: (value: unknown) => void) => { (events[name] ||= []).push(handler); return () => {}; };
    // Match Electron's unsupported window.prompt rather than accepting browser dialogs.
    window.prompt = () => { throw new Error('prompt() is and will not be supported.'); };
    Object.assign(window, { uiFixture: state, emitCodex: (value: unknown) => { for (const handler of events.codexEvent || []) handler(value); }, emitNative: (value: unknown) => { for (const handler of events.native || []) handler(value); }, emitRoom: (value: unknown) => { for (const handler of events.room || []) handler(value); }, surprisedFace: {
      settings: async () => { if (!state.settings.connected) state.settingsReadsBeforeSession++; return structuredClone(state.settings); },
      sessionCheck: async () => { call('sessionCheck', null); return { authenticated: state.settings.connected }; },
      googleSignIn: async () => { call('googleSignIn', null); state.settings.connected = true; return state.settings.member; },
      availableHarnesses: async () => options.hermesUnavailable ? ['codex'] : ['codex', 'hermes'],
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
      renameRoom: async (input: { roomId: string; name: string }) => {
        call('renameRoom', input);
        const room = state.rooms.find((item) => item.id === input.roomId);
        if (!room) throw new Error('Chat not found.');
        room.name = input.name.trim();
        return structuredClone(room);
      },
      sheepCached: async () => { call('sheepCached', null); return { projects: [{ name: 'Design', path: '/work/design' }], conversations: options.slowCatalog || options.failCatalog ? [{ id: 'cached-1', harness: 'codex', title: 'Saved conversation', path: '/work/design' }] : [] }; },
      sheepRefresh: async () => {
        if (options.slowCatalog) await new Promise(resolve => setTimeout(resolve, 5000));
        if (options.failCatalog) throw new Error('Catalog refresh unavailable');
        return { projects: [{ name: 'Design', path: '/work/design' }, { name: 'Garden', path: '/work/garden' }], conversations: state.conversations };
      },
      sheepRead: async () => ({ messages: [
        { role: 'user', content: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>' },
        { role: 'user', content: 'A sample conversation' },
        { role: 'assistant', content: 'Sample reply' },
      ] }),
      roomMessages: async () => structuredClone(state.sharedMessages), pendingMessages: async () => structuredClone(state.pendingOutbox), openRoom: async () => structuredClone(state.sharedMessages),
      sendMessage: async (input: { roomId: string; text: string }) => {
        call('sendMessage', input);
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
      members: async () => options.ownerAttribution
        ? [{ id: 'maya', name: 'Maya', role: 'member' }, { id: 'aman', name: 'Aman', role: 'owner' }, { id: 'mukesh', name: 'Mukesh', role: 'member' }]
        : options.foreignOwned
        ? [{ id: 'maya', name: 'Maya', role: 'owner' }, { id: 'mukesh', name: 'Mukesh', role: 'member' }]
        : [{ id: 'maya', name: 'Maya', role: 'member' }], agents: async () => state.sharedAgents, runPending: async () => ({}),
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
          handler({ ...input, type: 'delta', text: 'Hello from Codex' });
          handler({ ...input, type: 'completed' });
        }
      },
      nativeShare: async (input: unknown) => {
        call('nativeShare', input);
        const room = { id: 'chat-1', name: 'Local design', createdBy: 'maya' };
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
      joinRoom: async (code: string) => { call('joinRoom', code); if (code === 'invalid') throw new Error('This invite code is invalid.'); state.rooms.push({ id: 'joined-chat', name: 'Friends', createdBy: 'friend' }); return { roomId: 'joined-chat' }; },
      join: async (input: unknown) => { call('join', input); state.settings.connected = true; state.rooms.push({ id: 'joined-chat', name: 'Friends', createdBy: 'friend' }); return { roomId: 'joined-chat' }; },
      logout: async () => { call('logout', null); state.settings.connected = false; return structuredClone(state.settings); },
      onNativeChatEvent: on('native'), onRoomEvent: on('room'), onRoomConnection: on('connection'), onAppError: on('error'),
      onOutboxChanged: on('outbox'),
      onAgentActivity: on('activity'), onCodexRequest: on('codex'), onHermesRequest: on('hermes'),
    } });
  }, options);
  await page.goto('/');
  if (options.connected === false) {
    await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
    if (!options.leaveSignedOut) {
      await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible();
    }
  } else await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible();
}

test('Google authentication gates local project discovery until sign-in completes', async ({ page }) => {
  await fixture(page, { connected: false, leaveSignedOut: true });
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toHaveCount(0);
  let calls = await page.evaluate(() => (window as any).uiFixture.calls.map((entry: { method: string }) => entry.method));
  expect(calls).not.toContain('sheepCached');
  expect(calls).not.toContain('sheepRefresh');
  expect(await page.evaluate(() => (window as any).uiFixture.settingsReadsBeforeSession)).toBe(0);
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCSS('background-color', 'rgb(48, 45, 46)');
  await page.screenshot({ path: '../output/playwright/google-auth-gate.png' });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible();
  calls = await page.evaluate(() => (window as any).uiFixture.calls.map((entry: { method: string }) => entry.method));
  expect(calls).toContain('googleSignIn');
});

test('signing out revokes the app session and returns to the Google sign-in gate', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).uiFixture.calls.map((entry: { method: string }) => entry.method));
  expect(calls).toContain('logout');
});

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
  await page.getByRole('combobox', { name: 'Harness', exact: true }).selectOption('hermes');
  await page.getByRole('textbox', { name: 'Message' }).fill('Plan my garden');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Hello from Codex', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Hello from Codex', { exact: true })).toBeVisible();
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

test('join dialog contains keyboard focus, closes on its backdrop, and accepts a code after Google sign-in', async ({ page }) => {
  await fixture(page, { connected: false });
  await page.getByRole('button', { name: 'Join a chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Join chat', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Your name', exact: true })).toHaveCount(0);
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
  expect(await page.evaluate(() => (window as any).uiFixture.calls)).toContainEqual({ method: 'joinRoom', input: 'new-person-code' });
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
  test(`Settings accepts a chat invite after ${connected ? 'an existing' : 'a new Google'} sign-in`, async ({ page }) => {
    await fixture(page, { connected });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const code = page.getByRole('textbox', { name: 'Invite code', exact: true });
    await expect(code).toBeVisible();
    await code.fill('friend-settings-code');
    await page.screenshot({ path: `../output/playwright/settings-join-${connected ? 'connected' : 'new'}.png` });
    await page.getByRole('button', { name: 'Join chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { uiFixture: { calls: { method: string; input: unknown }[] } }).uiFixture.calls);
    expect(calls).toContainEqual({ method: 'joinRoom', input: 'friend-settings-code' });
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
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Run harness mentions/ }).check();
  await expect(page.getByText('Settings saved automatically', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.allowRemoteAgentRequests)).toBe(true);
  await page.getByRole('button', { name: /Mint \+ charcoal/ }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'mint-charcoal');
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.theme)).toBe('mint-charcoal');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'mint-charcoal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
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


test('saved catalog appears while refresh is pending and is replaced by fresh discovery', async ({ page }) => {
  await fixture(page, { slowCatalog: true });
  await page.getByText('Design', { exact: true }).first().click();
  await expect(page.getByText('Saved conversation', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../output/playwright/cached-catalog-startup.png' });
  await expect(page.getByText('Local design', { exact: true })).toBeVisible({ timeout: 7000 });
  await expect(page.getByText('Saved conversation', { exact: true })).toHaveCount(0);
});

test('saved catalog remains usable when discovery fails', async ({ page }) => {
  await fixture(page, { failCatalog: true });
  await page.getByText('Design', { exact: true }).first().click();
  await expect(page.getByText('Saved conversation', { exact: true })).toBeVisible();
  await expect(page.getByText('Catalog refresh unavailable', { exact: true })).toBeVisible();
  await page.getByText('Saved conversation', { exact: true }).click();
  await expect(page.getByText('Sample reply', { exact: true })).toBeVisible();
});


test('shared chat explains disabled remote mentions and opens the owner control', async ({ page }) => {
  await fixture(page, { room: true });
  await expect(page.getByText('Mentions from other people are paused on this computer.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../output/playwright/agent-mentions-paused.png' });
  await page.getByRole('button', { name: 'Manage harness mentions', exact: true }).click();
  await page.getByRole('checkbox', { name: /Run harness mentions/ }).check();
  await expect.poll(() => page.evaluate(() => (window as any).uiFixture.settings.allowRemoteAgentRequests)).toBe(true);
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.getByText('Mentions from other people are paused on this computer.', { exact: true })).toHaveCount(0);
});

test('harnesses need no agent setup or working folder for a new chat', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Local agents', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Working folder', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello without a project');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Hello from Codex', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).uiFixture.calls);
  expect(calls).toContainEqual({ method: 'nativeCreate', input: { harness: 'codex', cwd: '', title: 'Hello without a project' } });
  await page.screenshot({ path: '../output/playwright/harness-no-folder.png' });
});

test('new chats list only locally available harnesses', async ({ page }) => {
  await fixture(page, { hermesUnavailable: true });
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  const selector = page.getByRole('combobox', { name: 'Harness', exact: true });
  await expect(selector.locator('option')).toHaveText(['Codex']);
});

test('a mention before existing text opens suggestions at the cursor', async ({ page }) => {
  await fixture(page, { room: true });
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.fill('existing text');
  await composer.press('Home');
  await composer.pressSequentially('@ ');
  await expect(page.getByRole('button', { name: /@codex/ })).toBeVisible();
  await page.getByRole('button', { name: /@codex/ }).click();
  await expect(composer).toHaveValue('@codex existing text');
  await page.screenshot({ path: '../output/playwright/harness-mention-cursor.png' });
  await page.getByRole('button', { name: 'Send message' }).click();
  const calls = await page.evaluate(() => (window as any).uiFixture.calls);
  expect(calls).toContainEqual({ method: 'sendMessage', input: { roomId: 'chat-1', text: '@codex existing text', agentIds: ['maya-codex'] } });
});

test('a solo chat chooses its harness even when several are registered', async ({ page }) => {
  await fixture(page, { room: true, twoHarnesses: true });
  await expect(page.locator('.right-section .agent-state')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  const calls = await page.evaluate(() => (window as any).uiFixture.calls);
  expect(calls).toContainEqual({ method: 'sendMessage', input: { roomId: 'chat-1', text: 'Hello', agentIds: ['maya-codex'] } });
});

test('the harness sidebar returns to idle after a streamed reply', async ({ page }) => {
  await fixture(page, { room: true });
  const status = page.locator('.right-section .agent-state');
  await expect(page.getByRole('heading', { name: 'Harnesses', exact: true })).toBeVisible();
  await expect(status).toHaveText('idle');
  await page.evaluate(() => (window as any).emitRoom({ roomId: 'chat-1', event: { type: 'turn.queued', agentId: 'maya-codex' } }));
  await expect(status).toHaveText('queued');
  await page.evaluate(() => {
    const state = (window as any).uiFixture;
    state.sharedMessages.push({ id: 'reply-1', roomId: 'chat-1', messageSeq: 1, participantId: 'maya-codex', participantName: 'Codex', role: 'assistant', text: '', state: 'streaming', agentId: 'maya-codex', agentName: 'Codex', harness: 'codex', createdAt: new Date().toISOString() });
    (window as any).emitRoom({ roomId: 'chat-1', event: { type: 'turn.started', agentId: 'maya-codex' } });
  });
  await expect(status).toHaveText('working');
  await page.evaluate(() => {
    (window as any).uiFixture.sharedMessages[0].text = 'First words';
    (window as any).emitRoom({ roomId: 'chat-1', event: { type: 'message.delta', agentId: 'maya-codex' } });
  });
  await expect(page.getByText('First words', { exact: true })).toBeVisible();
  await expect(page.getByText(/is replying/)).toHaveCount(0);
  await page.screenshot({ path: '../output/playwright/harness-streaming.png' });
  await page.evaluate(() => {
    (window as any).uiFixture.sharedMessages[0].state = 'complete';
    (window as any).emitRoom({ roomId: 'chat-1', event: { type: 'turn.finished', agentId: 'maya-codex' } });
  });
  await expect(status).toHaveText('idle');
});

test('shared chats lead the sidebar and the actual chat creator is labeled owner', async ({ page }) => {
  await fixture(page, { room: true, foreignOwned: true });
  await expect(page.locator('.sidebar-scroll > .sidebar-section-head').first()).toContainText('Shared chats');
  const people = page.locator('.right-section').filter({ has: page.getByRole('heading', { name: 'People', exact: true }) });
  await expect(people).toContainText('Mukeshowner');
  await expect(people).not.toContainText('Mayaowner');
  await expect(page.getByRole('button', { name: 'Rename Design review' })).toHaveCount(0);
});

test('shared replies and harness list identify the owner of each Codex harness', async ({ page }) => {
  await fixture(page, { room: true, ownerAttribution: true });
  await page.getByRole('button', { name: 'Design review', exact: true }).click();
  await expect(page.locator('.chat-message').filter({ hasText: 'Hi Alejandro!' }).locator('.message-meta strong')).toHaveText("Aman · Codex");
  await expect(page.locator('.chat-message').filter({ hasText: 'It really is!' }).locator('.message-meta strong')).toHaveText("Mukesh · Codex");
  const harnesses = page.locator('.right-section').filter({ has: page.getByRole('heading', { name: 'Harnesses' }) });
  await expect(harnesses).toContainText("Aman · Codex");
  await expect(harnesses).toContainText("Mukesh · Codex");
  await page.getByRole('textbox', { name: 'Message' }).fill('@');
  await expect(page.locator('.mention-menu')).toContainText("Aman · Codex");
  await expect(page.locator('.mention-menu')).toContainText("Mukesh · Codex");
  await page.screenshot({ path: '../output/playwright/harness-owner-attribution.png' });
});

test('a chat owner renames the shared chat from the sidebar or header', async ({ page }) => {
  await fixture(page, { room: true });
  await page.getByRole('button', { name: 'Rename Design review' }).first().click();
  await page.getByRole('textbox', { name: 'Chat title' }).fill('Planning together');
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByRole('heading', { name: 'Planning together' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Planning together', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rename Planning together' }).last().click();
  await page.getByRole('textbox', { name: 'Chat title' }).fill('Shared plan');
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByRole('heading', { name: 'Shared plan' })).toBeVisible();
  await page.screenshot({ path: '../output/playwright/shared-chat-renamed.png', fullPage: true });
  await page.evaluate(() => (window as unknown as { emitRoom: (value: unknown) => void }).emitRoom({ roomId: 'chat-1', event: { type: 'room.renamed', name: 'Title from another window' } }));
  await expect(page.getByRole('heading', { name: 'Title from another window' })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { uiFixture: { calls: { method: string; input: unknown }[] } }).uiFixture.calls);
  expect(calls.filter((call) => call.method === 'renameRoom').map((call) => call.input)).toEqual([
    { roomId: 'chat-1', name: 'Planning together' },
    { roomId: 'chat-1', name: 'Shared plan' },
  ]);
});

test('Hordes manages projects, covers, skills, budgets, discussion and deletion', async ({ page }) => {
  await fixture(page);
  await page.route('https://example.com/earth.webp', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }));
  await page.evaluate(() => {
    const projects: Record<string, unknown>[] = [];
    let detail: Record<string, unknown>;
    window.surprisedFace.hordeRequest = async ({ action, data, deleted }) => {
      const input = (data || {}) as Record<string, unknown>;
      if (action === 'list') return { projects: projects.filter(p => Boolean(p.deletedAt) === Boolean(deleted)) };
      if (action === 'create') {
        const project = { ...input, id: 'horde-1', revision: 1, myRole: 'warchief', createdBy: 'maya', memberCount: 1, totals: { tokens: 0, usd: 0, gpu_hours: 0 }, deletedAt: null };
        projects.push(project); detail = { project, members: [{ id: 'maya', name: 'Maya', role: 'warchief' }], budgets: [], messages: [] };
      }
      const project = detail.project as Record<string, unknown>;
      if (action === 'update') Object.assign(project, input, { revision: Number(project.revision) + 1 });
      if (action === 'budget') { detail.budgets = [{ memberId: 'maya', name: 'Maya', ...input }]; (project.totals as Record<string, unknown>)[String(input.unit)] = input.amount; }
      if (action === 'messages') (detail.messages as unknown[]).push({ id: 'm1', name: 'Maya', text: input.text, createdAt: new Date().toISOString() });
      if (action === 'delete') project.deletedAt = new Date().toISOString();
      if (action === 'restore') project.deletedAt = null;
      return structuredClone(detail);
    };
  });
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Build something big,.*together\./ })).toBeVisible();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Earth Commons');
  await page.getByLabel('Project goal', { exact: true }).fill('A walkable planet built district by district.');
  await page.getByLabel('GitHub repository', { exact: true }).fill('https://github.com/example/earth');
  await page.getByRole('button', { name: 'Add skill', exact: true }).click();
  await page.getByLabel('Skill name', { exact: true }).fill('Tile builder');
  await page.getByLabel('Skill instructions', { exact: true }).fill('Validate boundary seams.');
  await page.getByLabel('Tools', { exact: true }).fill('Blender, Godot');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Earth Commons', exact: true })).toBeVisible();
  await expect(page.getByText('Tile builder', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set my budget', exact: true }).click();
  await page.getByLabel('Budget amount', { exact: true }).fill('250000');
  await page.getByRole('button', { name: 'Save commitment', exact: true }).click();
  await expect(page.getByText('250,000 tokens', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Project message', { exact: true }).fill('I can build the first district.');
  await page.getByRole('button', { name: 'Post message', exact: true }).click();
  await expect(page.getByText('I can build the first district.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Earth Together');
  await page.getByLabel('Cover image URL', { exact: true }).fill('https://example.com/earth.webp');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Earth Together', exact: true })).toBeVisible();
  await page.screenshot({ path: '../output/playwright/hordes-project.png' });
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await page.getByRole('button', { name: 'Open Earth Together', exact: true }).click();
  await expect(page.locator('.project-cover')).toHaveAttribute('src', 'https://example.com/earth.webp');
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Earth Together', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trash', exact: true })).toHaveCount(0);
});

test('Hordes defaults to a global list and offers compact image cards with separate details', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const projects = Array.from({length: 8}, (_, i) => ({ id: `earth-${i}`, name: `Earth Commons ${i + 1}`, summary: 'A walkable planet. '.repeat(25), category: 'Worlds', repositoryUrl: '', strategy: { id: 'spatial', parallelism: 3 }, skills: [], myRole: 'scout', memberCount: 2, totals: { tokens: 0, usd: 0, gpu_hours: 0 } }));
    window.surprisedFace.hordeRequest = async ({ action, projectId }) => action === 'list' ? { projects } : { project: projects.find(p => p.id === projectId), members: [{ id:'maya', name:'Maya', role:'scout' }], budgets: [], messages: [] };
  });
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.project-list .project-entry')).toHaveCount(8);
  await expect(page.getByRole('button', { name: /^Project ideas/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trash', exact: true })).toHaveCount(0);
  await expect(page.locator('.horde-intro .primary')).toHaveCount(0);
  const summaries = await page.locator('.entry-summary').allTextContents();
  expect(summaries.every(text => Array.from(text).length <= 200 && text.endsWith('...'))).toBe(true);
  await page.screenshot({ path: '../output/playwright/hordes-list.png' });
  await page.getByRole('button', { name: 'Card view', exact: true }).click();
  await expect(page.locator('.project-grid .project-entry')).toHaveCount(8);
  const images = await page.locator('.project-entry img').evaluateAll(els => els.map(el => (el as HTMLImageElement).src));
  expect(new Set(images).size).toBeGreaterThan(1);
  await page.screenshot({ path: '../output/playwright/hordes-cards.png' });
  await page.getByRole('button', { name: 'Open Earth Commons 1', exact: true }).click();
  await expect(page.locator('.goal')).toHaveText('A walkable planet. '.repeat(25).trim());
  for (const name of ['Edit project', 'Delete project', 'Set my budget']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Project message', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.setViewportSize({width: 680, height: 800});
  expect(await page.locator('.hordes').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '../output/playwright/hordes-narrow.png' });
});

test('Hordes explains a missing directory and retries the request without a page reload', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    let requests = 0;
    window.surprisedFace.hordeRequest = async () => { if (++requests === 1) throw new Error('Not found.'); return { projects: [] }; };
    (window as unknown as { retryMarker: string }).retryMarker = 'still here';
  });
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('project directory');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { retryMarker: string }).retryMarker)).toBe('still here');
});

test('a failed Hordes save preserves the project draft for retry', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { window.surprisedFace.hordeRequest = async ({action}) => { if(action === 'list') return {projects:[]}; throw new Error('Connection lost. Please retry.'); }; });
  await page.getByRole('tab', {name:'Hordes',exact:true}).click();
  await page.getByRole('button', {name:'Create project',exact:true}).click();
  await page.getByLabel('Project name',{exact:true}).fill('A Billion Worlds');
  await page.getByLabel('Project goal',{exact:true}).fill('Build three distinct planets.');
  await page.getByRole('button', {name:'Save project',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Connection lost');
  await expect(page.getByLabel('Project name',{exact:true})).toHaveValue('A Billion Worlds');
  await expect(page.getByRole('button',{name:'Save project',exact:true})).toBeEnabled();
});

test('public Hordes webpage needs no account and supports direct links and browser navigation', async ({ page }) => {
  const project = { id: 'earth', name: 'Earth Commons', summary: 'Build one district together.', category: 'Worlds', repositoryUrl: '', strategy: { id: 'spatial', parallelism: 3 }, skills: [], myRole: null, memberCount: 2, totals: { tokens: 0, usd: 0, gpu_hours: 0 } };
  await page.route('**/v1/hordes**', route => route.fulfill({ json: route.request().url().endsWith('/hordes') ? { projects: [project] } : { project, members: [], budgets: [], messages: [] } }));
  await page.goto('http://127.0.0.1:9019/hordes/');
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Open Earth Commons', exact: true }).click();
  await expect(page).toHaveURL(/\/hordes\/earth$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Earth Commons', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Join this horde', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('desktop app');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Earth Commons', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('button', { name: 'Open Earth Commons', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../output/playwright/hordes-public-mobile.png' });
});

test('Hordes uploads a raster cover and persists it through a project save', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.surprisedFace.hordeRequest = async ({ action, data }) => action === 'list' ? { projects: [] } : { project: { ...(data as Record<string, unknown>), id: 'upload', myRole: 'warchief', revision: 1, totals: { tokens: 0, usd: 0, gpu_hours: 0 }, memberCount: 1 }, members: [], budgets: [], messages: [] };
  });
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('A new world');
  await page.getByLabel('Project goal', { exact: true }).fill('Build a shared world.');
  await page.getByLabel('Upload cover image', { exact: true }).setInputFiles('src/assets/hordes/space.webp');
  await expect(page.getByRole('img', { name: 'Project cover preview' })).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.locator('.project-cover')).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Project cover preview' })).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await expect(page.getByLabel('Cover image URL', { exact: true })).toHaveValue('');
});

test('Command-left returns from Hordes project details to the project list', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const project = { id: 'earth', name: 'Earth Commons', summary: 'Explore a shared Earth.', category: 'Worlds', repositoryUrl: '', strategy: { id: 'spatial', parallelism: 3 }, skills: [], myRole: 'scout', memberCount: 2, totals: { tokens: 0, usd: 0, gpu_hours: 0 } };
    window.surprisedFace.hordeRequest = async ({ action }) => action === 'list' ? { projects: [project] } : { project, members: [], budgets: [], messages: [] };
  });
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await page.getByRole('button', { name: 'Open Earth Commons', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Earth Commons', exact: true })).toBeVisible();
  await page.keyboard.press('Meta+ArrowLeft');
  await expect(page.getByRole('button', { name: 'Open Earth Commons', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All projects', exact: true })).toHaveCount(0);
});

test('Hordes header uses the requested copy, edge-to-edge artwork and line-level text backgrounds', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { window.surprisedFace.hordeRequest = async () => ({ projects: [] }); });
  await page.getByRole('tab', { name: 'Hordes', exact: true }).click();
  await expect(page.getByText('Find a project you want to be part of. Contribute with your agent. Help build something big.', { exact: true })).toBeVisible();
  await expect(page.locator('.project-count')).toHaveCount(0);
  await expect(page.getByText('Open projects from across the :o community. Join one to make your own contribution.', { exact: true })).toBeVisible();
  await expect(page.locator('.horde-intro')).toHaveCSS('border-radius', '0px');
  await expect(page.locator('.horde-intro')).toHaveCSS('border-width', '0px');
  await expect(page.locator('.hero-art')).toHaveCSS('opacity', '1');
  await expect(page.locator('.hero-copy')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const highlightedText = page.locator('.hero-highlight');
  await expect(highlightedText).toHaveCount(4);
  const highlightStyles = await highlightedText.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, boxDecorationBreak: style.boxDecorationBreak };
  }));
  expect(highlightStyles).toEqual(Array.from({ length: 4 }, () => ({
    backgroundColor: 'rgb(255, 255, 255)',
    boxDecorationBreak: 'clone',
  })));
  const publicLink = page.getByRole('link', { name: 'View public page', exact: true });
  await expect(publicLink).toHaveAttribute('href', 'https://fixture.invalid/hordes/');
  await expect(publicLink).toHaveAttribute('target', '_blank');
  await page.screenshot({ path: '../output/playwright/hordes-header-contrast.png' });
});

test('red-blue appearance uses the red-blue brand icon and retains the mint icon for green', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Cobalt \+ red/ }).click();
  await expect(page.locator('.brand-art')).toHaveCSS('background-image', /cobalt-red-logo/);
  await page.screenshot({ path: '../output/playwright/cobalt-red-brand.png' });
  await page.getByRole('button', { name: /Mint \+ charcoal/ }).click();
  await expect(page.locator('.brand-art')).toHaveCSS('background-image', /mint-charcoal-logo/);
});
