# Room service

Cloudflare Worker API for Google-authenticated accounts, chat membership, invites, ordered messages, and agent turns.

## Google sign-in setup

1. Create a Google OAuth client with application type **Desktop app**.
2. Put its public client ID in `app/src-electron/google-auth-config.ts` and in the Worker `GOOGLE_CLIENT_ID` variable. Do not create, store, or ship a client secret for a desktop client.
3. Keep `SESSION_SECRET` as a Cloudflare secret. For local Worker development, set `SESSION_SECRET` and `ADMIN_SECRET` in an untracked `.dev.vars` file.
4. Deploy the Worker and rebuild the desktop app after setting the client ID.

The desktop app opens Google in the user's system browser, binds the OAuth callback to an ephemeral `127.0.0.1` port, validates OAuth state, and uses PKCE. Google returns an ID token; the Worker verifies its signature, issuer, audience, expiry, and one-time nonce against Google's public keys. The app requests only `openid profile`. It stores the Google subject and display name, not the email, ID token, Google access token, or project/chat contents. The app's opaque session token is encrypted with Electron `safeStorage`; the Worker stores only its SHA-256 hash and supports revocation at sign-out.

Existing unexpired app sessions can be used once to link the same existing member record during Google sign-in. Account linking uses possession of that session and the verified Google subject; it never links accounts by matching names or email addresses.

## Chat limit

Each authenticated account can start at most 100 new chats per UTC calendar day. Local Codex/Hermes chat creation reserves one count in the Worker before the native session starts and releases it if the harness fails to start. Creating a shared chat is counted atomically with the room record. The count is per account across devices; joining an existing chat and reopening an existing chat do not count. The Worker serializes quota checks and writes in the directory Durable Object's SQLite transaction.

## Deploy

1. Install dependencies with `npm install`.
2. Sign in with `npx wrangler login`.
3. Set the signing secret: `openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET`.
4. Set `GOOGLE_CLIENT_ID` in `wrangler.jsonc` (or an environment-specific Worker variable).
5. Deploy with `npx wrangler deploy`.

The optional `ADMIN_SECRET` supports operator-only bootstrap for a fresh, separate Worker. Set it with `npx wrangler secret put ADMIN_SECRET`, call `POST /v1/admin/bootstrap` with `Authorization: Bearer <ADMIN_SECRET>`, then remove the secret. Ordinary users do not enter a Cloudflare key or configure a Worker. The app also supports `SURPRISED_FACE_ROOM_SERVICE_URL` for local development or a separate deployment.

The app does not need `SESSION_SECRET`. Do not commit either secret or a `.dev.vars` file. `GOOGLE_CLIENT_ID` is public configuration, not a secret.

## Current pilot service

- Worker: `https://surprised-face-rooms.camus-00.workers.dev`
- Health check: `GET /health`
- Cloudflare currently lists this account on Workers Free, with no payment method on file. Free Durable Object usage has daily limits; over-limit operations fail until the daily reset.
- `wrangler.jsonc` contains the Cloudflare account ID so Wrangler can deploy non-interactively.
- Keep `ADMIN_SECRET` off once the service has been initialized. To bootstrap a fresh Worker, create a new secret before first use, then delete it after setup.

The Worker uses one SQLite Durable Object for identities, hashed sessions, account-link records, quota records, chat membership, invites, and agents, plus one object per chat. Each invite is bound to one chat. Existing members use a code to join another chat. Agent turns are queued in each chat and run by the owning desktop.

For local development, put `SESSION_SECRET` and `ADMIN_SECRET` in an untracked `.dev.vars` file and run `npm run dev`.
