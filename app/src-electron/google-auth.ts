import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_TIMEOUT_MS = 5 * 60_000;

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): URL {
  if (!input.clientId) throw new Error('Google sign-in is not configured for this app yet.');
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
  }).toString();
  return url;
}

export function readOAuthCallback(url: URL, expectedState: string): { code: string } {
  const receivedState = url.searchParams.get('state') || '';
  const left = Buffer.from(receivedState);
  const right = Buffer.from(expectedState);
  if (!receivedState || left.length !== right.length || !timingSafeEqual(left, right))
    throw new Error('Google sign-in could not verify the redirect state. Please try again.');
  if (url.searchParams.has('error'))
    throw new Error('Google sign-in was canceled. You can try again when you are ready.');
  const code = url.searchParams.get('code') || '';
  if (!code) throw new Error('Google did not return a sign-in code. Please try again.');
  return { code };
}

export async function signInWithGoogle(input: {
  backendUrl: string;
  clientId: string;
  currentToken?: string;
  openExternal: (url: string) => Promise<void>;
}): Promise<{ member: { id: string; name: string; role: 'owner' | 'member' }; token: string }> {
  if (!input.clientId) throw new Error('Google sign-in is not configured for this app yet.');
  const backend = new URL(input.backendUrl);
  const localHttpBackend = backend.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(backend.hostname);
  if (backend.protocol !== 'https:' && !localHttpBackend)
    throw new Error('The sign-in service must use HTTPS.');

  const { verifier, challenge: codeChallenge } = createPkcePair();
  const state = randomBytes(32).toString('base64url');
  const challengeResponse = await fetch(new URL('/v1/auth/google/challenge', backend), { method: 'POST' });
  const challengeBody = await readResponse<{ nonce: string; challenge: string }>(challengeResponse);
  const callback = await startLoopbackCallback(state);
  try {
    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId: input.clientId,
      redirectUri: callback.redirectUri,
      state,
      nonce: challengeBody.nonce,
      codeChallenge,
    });
    await input.openExternal(authorizationUrl.toString());
    const { code } = await callback.result;
    const form = new URLSearchParams({
      client_id: input.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: callback.redirectUri,
    });
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
    });
    const tokenBody = await readResponse<{ id_token?: string }>(tokenResponse);
    if (!tokenBody.id_token) throw new Error('Google did not return a sign-in token. Please try again.');

    const completeResponse = await fetch(new URL('/v1/auth/google/complete', backend), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.currentToken ? { authorization: `Bearer ${input.currentToken}` } : {}),
      },
      body: JSON.stringify({ idToken: tokenBody.id_token, challenge: challengeBody.challenge }),
    });
    return await readResponse(completeResponse);
  } finally {
    callback.close();
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Sign-in failed. Please try again.';
    throw new Error(message);
  }
  return body as T;
}

async function startLoopbackCallback(state: string): Promise<{
  redirectUri: string;
  result: Promise<{ code: string }>;
  close: () => void;
}> {
  let resolveResult!: (value: { code: string }) => void;
  let rejectResult!: (error: Error) => void;
  let settled = false;
  const result = new Promise<{ code: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let port = 0;
  const server: Server = createServer((request, response) => {
    const host = request.headers.host || '';
    const remoteAddress = request.socket.remoteAddress || '';
    if (host !== `127.0.0.1:${port}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(remoteAddress) || request.method !== 'GET') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Not found.');
      return;
    }
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== '/') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Not found.');
      return;
    }
    try {
      const callback = readOAuthCallback(url, state);
      response.writeHead(200, callbackHeaders);
      response.end('<!doctype html><meta charset="utf-8"><title>Sign-in complete</title><p>Sign-in complete. Return to surprised-face.</p><script>history.replaceState(null, "", "/")</script>');
      if (!settled) { settled = true; resolveResult(callback); }
    } catch (error) {
      response.writeHead(400, callbackHeaders);
      response.end('<!doctype html><meta charset="utf-8"><title>Sign-in incomplete</title><p>Sign-in could not be completed. Return to surprised-face and try again.</p><script>history.replaceState(null, "", "/")</script>');
      if (!settled) { settled = true; rejectResult(error instanceof Error ? error : new Error('Sign-in failed.')); }
    }
  });

  port = await listenOnLoopback(server);
  const timeout = setTimeout(() => {
    if (!settled) { settled = true; rejectResult(new Error('Google sign-in timed out. Please try again.')); }
    server.close();
  }, OAUTH_TIMEOUT_MS);
  timeout.unref();
  return {
    redirectUri: `http://127.0.0.1:${port}`,
    result,
    close: () => { clearTimeout(timeout); server.close(); },
  };
}

const callbackHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not start the sign-in callback.'));
      resolve(address.port);
    });
  });
}
