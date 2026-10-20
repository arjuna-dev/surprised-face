import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildGoogleAuthorizationUrl, createPkcePair, readOAuthCallback, signInWithGoogle } from '../src-electron/google-auth';

void test('Google authorization uses a system-browser code flow with PKCE and minimal scopes', () => {
  const pair = createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(pair.challenge, createHash('sha256').update(pair.verifier).digest('base64url'));

  const url = buildGoogleAuthorizationUrl({
    clientId: 'desktop-client.apps.googleusercontent.com',
    redirectUri: 'http://127.0.0.1:43123',
    state: 'state-value',
    nonce: 'nonce-value',
    codeChallenge: pair.challenge,
  });
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('nonce'), 'nonce-value');
  assert.equal(url.searchParams.get('code_challenge'), pair.challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:43123');
  assert.equal(url.searchParams.has('client_secret'), false);
});

void test('OAuth callback accepts only a matching state and a non-empty authorization code', () => {
  assert.deepEqual(
    readOAuthCallback(new URL('http://127.0.0.1/?code=abc&state=good'), 'good'),
    { code: 'abc' },
  );
  assert.throws(() => readOAuthCallback(new URL('http://127.0.0.1/?code=abc&state=bad'), 'good'), /state/i);
  assert.throws(() => readOAuthCallback(new URL('http://127.0.0.1/?error=access_denied&state=good'), 'good'), /cancel/i);
});

void test('Google sign-in sends the code and PKCE verifier only to the HTTPS Worker', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === '127.0.0.1') return originalFetch(input, init);
    requests.push({ url, init });
    if (url.endsWith('/v1/auth/google/challenge'))
      return new Response(JSON.stringify({ nonce: 'server-nonce', challenge: 'signed-challenge' }), { status: 200 });
    if (url.endsWith('/v1/auth/google/complete'))
      return new Response(JSON.stringify({ member: { id: 'member-1', name: 'Maya', role: 'member' }, token: 'opaque-session' }), { status: 200 });
    throw new Error(`Unexpected request to ${url}`);
  };
  globalThis.fetch = mockFetch;
  try {
    const result = await signInWithGoogle({
      backendUrl: 'https://rooms.example',
      clientId: 'desktop-client.apps.googleusercontent.com',
      currentToken: 'legacy-app-session',
      openExternal: async (authorizationUrl) => {
        const authorization = new URL(authorizationUrl);
        assert.equal(authorization.searchParams.get('client_id'), 'desktop-client.apps.googleusercontent.com');
        assert.equal(authorization.searchParams.get('nonce'), 'server-nonce');
        const redirectUri = authorization.searchParams.get('redirect_uri');
        assert.ok(redirectUri);
        const callback = new URL(redirectUri);
        callback.search = new URLSearchParams({ code: 'google-auth-code', state: authorization.searchParams.get('state') || '' }).toString();
        const page = await originalFetch(callback);
        assert.equal(page.status, 200);
        assert.equal(page.headers.get('cache-control'), 'no-store');
        assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
        assert.match(await page.text(), /history\.replaceState/);
      },
    });
    assert.deepEqual(result, { member: { id: 'member-1', name: 'Maya', role: 'member' }, token: 'opaque-session' });
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => new URL(request.url).hostname !== 'oauth2.googleapis.com'));
    const completeRequest = requests.find((request) => request.url.endsWith('/v1/auth/google/complete'));
    assert.equal(new Headers(completeRequest?.init?.headers).get('authorization'), 'Bearer legacy-app-session');
    assert.ok(typeof completeRequest?.init?.body === 'string');
    const completion = JSON.parse(completeRequest.init.body);
    assert.equal(completion.authorizationCode, 'google-auth-code');
    assert.match(completion.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.match(completion.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(completion.challenge, 'signed-challenge');
    assert.equal('idToken' in completion, false);
    assert.equal('clientSecret' in completion, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('Google Worker errors include the token exchange description', async () => {
  const originalFetch = globalThis.fetch;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === '127.0.0.1') return originalFetch(input, init);
    if (url.endsWith('/v1/auth/google/challenge'))
      return new Response(JSON.stringify({ nonce: 'server-nonce', challenge: 'signed-challenge' }), { status: 200 });
    if (url.endsWith('/v1/auth/google/complete'))
      return new Response(JSON.stringify({ error: 'google_token_exchange_failed', error_description: 'Google OAuth client is not configured.' }), { status: 400 });
    throw new Error(`Unexpected request to ${url}`);
  };
  globalThis.fetch = mockFetch;
  try {
    await assert.rejects(signInWithGoogle({
      backendUrl: 'https://rooms.example',
      clientId: 'desktop-client.apps.googleusercontent.com',
      openExternal: async (authorizationUrl) => {
        const authorization = new URL(authorizationUrl);
        const redirectUri = authorization.searchParams.get('redirect_uri');
        assert.ok(redirectUri);
        const callback = new URL(redirectUri);
        callback.search = new URLSearchParams({ code: 'google-auth-code', state: authorization.searchParams.get('state') || '' }).toString();
        assert.equal((await originalFetch(callback)).status, 200);
      },
    }), /google_token_exchange_failed: Google OAuth client is not configured\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('Google sign-in refuses to send an authorization code to a non-HTTPS backend', async () => {
  let openedBrowser = false;
  await assert.rejects(signInWithGoogle({
    backendUrl: 'http://example.invalid',
    clientId: 'desktop-client.apps.googleusercontent.com',
    openExternal: () => { openedBrowser = true; return Promise.resolve(); },
  }), /HTTPS/);
  assert.equal(openedBrowser, false);
});
