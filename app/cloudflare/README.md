# Room service

Cloudflare Worker API for chat membership, invites, ordered messages, and agent turns.

## Deploy

1. Install dependencies with `npm install`.
2. Sign in with `npx wrangler login`.
3. Set the signing secret: `openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET`.
4. Deploy with `npx wrangler deploy`.
5. Open the desktop app. It uses the hosted pilot Worker by default. New people create their own account in the app and join a particular chat with its invite code.

The optional `ADMIN_SECRET` supports an operator-only first-room bootstrap on a fresh, separate Worker. Ordinary users never enter a Cloudflare key or configure a Worker. Set the secret with `npx wrangler secret put ADMIN_SECRET`, call `POST /v1/admin/bootstrap` with `Authorization: Bearer <ADMIN_SECRET>`, and remove the secret after setup. The app also supports `SURPRISED_FACE_ROOM_SERVICE_URL` for local development or a separate deployment.

The app does not need `SESSION_SECRET`. Do not commit either secret or a `.dev.vars` file.

## Current pilot service

- Worker: `https://surprised-face-rooms.camus-00.workers.dev`
- Health check: `GET /health`
- Cloudflare currently lists this account on Workers Free, with no payment method on file. Free Durable Object usage has daily limits; over-limit operations fail until the daily reset.
- `wrangler.jsonc` contains the Cloudflare account ID so Wrangler can deploy non-interactively.
- The pilot directory has been initialized. Its one-time `ADMIN_SECRET` was deleted from Cloudflare and the local bootstrap file was removed after setup.
- The owner session is stored in the app's secure local settings. The `general` chat is available. The deployed Worker supports chat-specific invites and public account registration.
- Keep `ADMIN_SECRET` off once the service has been initialized. To bootstrap a fresh Worker, create a new secret before first use, then delete it after setup.

For local development, put `SESSION_SECRET` and `ADMIN_SECRET` in an untracked `.dev.vars` file and run `npm run dev`.

The Worker uses one SQLite Durable Object for identities, chat membership, invites, and agents, plus one object per chat. Each invite is bound to one chat. Existing members use a code to join another chat. A new member gets access only to the invited chat. Agent turns are queued in each chat and run by the owning desktop.
