# surprised-face :o

- Project name: **surprised-face**.
- Logo and planned CLI command: **`:o`**.
- Chats for people and their local agents, with invites scoped to one chat.
- Each person keeps their harness, models, tools, credentials, and spending limits.
- Use cases include projects, friends, community hordes, and Orchestra mode for one person coordinating several local harnesses.

## Pages

| Page | Contents |
| --- | --- |
| [Landing pages](landing/index.html) | Projects by default, Friends, community Hordes, and [Orchestra mode](landing/orchestra.html). Use the same header dropdown on every review page. |
| [Interface images](interface-designs/index.html) | Three two-ink design concepts with left and right drawers and a central chat/composer. Fictional content, not a working app. |
| [Imagery](imagery/index.html) | People, retro robots, lemonade, stars, dancing groups, and engineering / space hordes. |
| [Design rules](design-system/index.html) | Name, colors, type, spacing, and readable controls. |
| [Architecture](architecture/index.html) | Vue stack, local bridges, message order, agent modes, projects/media, hordes, backends, cost calculators, OpenAPPA, and group pilot. |
| [MVP integration](Research/mvp-base-and-harness-integration.md) | heyDataAgent reuse, Sheep discovery, Codex/Hermes pilot, data ownership, and implementation steps. |
| [How it works](report.html) | Concise routing and harness interface reference. |
| [Tests](tests.html) | Inputs and results from `npm test` in `app/`. |
| [MD](md.html) | Repository Markdown files. |

Open the design pages directly in a browser. `app/` contains the Electron app and Cloudflare Worker source. The shared room Worker is deployed at [surprised-face-rooms.camus-00.workers.dev](https://surprised-face-rooms.camus-00.workers.dev); its health endpoint responds. Cloudflare lists the account on Workers Free with no payment method on file. The pilot workspace is initialized and its owner app is connected.

The deployed Worker gives each chat its own invite codes and membership. The current macOS arm64 app package is at `app/dist/electron/Packaged/surprised-face-0.1.0-mac-arm64.dmg`; open this build to use the updated chat flow.

## Structure

| Entity | Purpose |
| --- | --- |
| Identity directory | Member identities, room membership, and agent directory. It does not grant access to every chat. |
| Chat | One conversation with its own members and invite codes. |
| Agent participant | Named assistant with an owner, harness connection, model, and native session. |
| Horde | Coordinated agent runs backed by contributors' token budgets, models, and compute. |
| Mission | Shared goal, bounded tasks, contribution offers, artifacts, and acceptance criteria. |

## Orchestra mode

- One person coordinates multiple local agents through different harnesses in :o.
- Mention agents to assign implementation, review, research, or other operations.
- Agents take turns within a chat. Separate task chats can run in parallel; serialize access to a shared native session.
- Use separate branches/worktrees when agents change code concurrently.
- Local collaboration does not require another human or a shared cloud room. The intended local coordinator uses the bridge and SQLite to keep task queues, chat order, and results on the device.
- Use Sheep's harness discovery, project/chat list, and native-session reader behind the app's local JSON bridge.

## MVP stack

| Part | Current choice | Role |
| --- | --- | --- |
| App UI | Electron + Vue 3 + TypeScript + Quasar/Vite | heyDataAgent-based chat shell with Codex and Hermes adapters. |
| Room service | [Cloudflare Worker](https://surprised-face-rooms.camus-00.workers.dev) + SQLite Durable Objects | Deployed auth and room service; each chat owns ordered events, messages, WebSocket delivery, and its agent queue. |
| Chat directory | SQLite Durable Object | Stores identities, per-chat invites, agents, and chat membership. |
| Local bridge | Electron main process + SQLite cache + bundled Sheep helper | Runs local harnesses, queues writes, applies room events, and reads selected native history. |
| Later storage | D1 and private R2 | Consider for larger directory workloads and shared files; not used by this pilot deployment. |

- Supabase is another option, but Broadcast fan-out and high-frequency streaming can increase message charges. The architecture page models this separately from compute, storage, and other costs.
- Hosting prices and estimates are linked to vendor sources in the architecture page. They are not measured all-in bills.
- OpenAPPA is a possible local tool-policy layer where the harness exposes blocking hooks. It does not replace room ordering or membership checks.

## Local bridge and message routes

```text
Person A :o UI <-> local bridge A <-> shared room <-> local bridge B <-> Person B :o UI
                         |                                |
                    A's harnesses                    B's harnesses
```

- Each participant has an owned bridge. The two-person diagram is only a small example; a room supports many participants.
- The bridge is between the UI and cloud room, and also manages that owner's harness adapters.
- CLI/desktop UI uses local IPC. A local web UI uses an authenticated, origin-checked loopback connection. A browser cannot launch a local harness alone.
- Bridges connect outward over WebSockets/TLS, subscribe to authorized rooms, and replay saved events after disconnects.

| Input | Route |
| --- | --- |
| Human message | UI -> local bridge -> shared room -> other authorized bridges and UIs. In a one-person chat, the selected owner agent can answer automatically. |
| Tagged agent request | Room checks permission and queues the turn. When the chat is free, save context and reply position -> owner's bridge -> selected harness. |
| Agent output | Owner's bridge -> shared room -> all authorized subscribers. Text fills the existing reply; files become attachments. |
| Agent request | :o local adapter -> Codex app-server or Hermes ACP. The harness terminal UI, slash commands, and hotkeys are not embedded in this app. |

## Agent participation

| Mode | Behavior |
| --- | --- |
| One-person chat | The owner's sole or selected agent answers an ordinary message immediately. |
| Group chat | An agent acts when a person mentions its ID. The owner must enable remote agent requests for requests from others. |
| Configured conditions, optional | Owner enables rules for particular channels, events, schedules, or meaningful contributions. Limits apply to context, actions, tokens, time, concurrency, and cooldowns. |

- Conditions ignore agent messages by default. Deduplicate triggering events and bound causal chains to prevent loops.
- Model-based detection spends tokens too. Make its scope and budget explicit.
- Show the agent and owner, whose tokens it uses, and stop controls. Context bookkeeping stays internal; reading the chat must not require inspecting it.
- Agents return work or an answer. Ordinary messages run the owner agent in a one-person chat; group messages need `@agent_name`. Configured conditions are a later option.

## Message order and native records

1. A human draft stays local until Send.
2. The room checks membership, deduplicates the command, and saves it with a server-assigned sequence.
3. Humans can send at any time. A solo chat may queue its owner agent automatically; group chats require a mention. Queued turns do not reserve a reply position yet.
4. Only one agent turn runs per chat. After the previous turn ends and permissions are checked, the room atomically claims the next eligible turn, freezes the completed conversation context, and saves an empty reply at the end of the chat.
5. The approved owner's bridge starts that turn. Human messages continue arriving after its reply position without changing its prompt or interrupting it.
6. Streaming batches fill the reply in place. If streaming is unavailable, final output fills the same reply after completion. The next agent waits for the turn to finish, fail, or be confirmed stopped; a pause or temporary disconnect does not free the slot.
7. Reconnecting clients replay saved events. A local cache has one writer; transcript JSON is an export, not a shared file everyone edits.

- Shared records use `user` for humans and `assistant` for agents. Participant IDs, names, owner, harness, model, source IDs, and run context identify the speaker and origin.
- Native harness sessions remain harness-owned. Submit real requests through adapters; copy available events/results or approved history imports into :o. Do not inject metadata into native files.
- Record native session/turn frontiers and the actual submitted prompt as well as shared context. Private harness history can also affect output.
- Serialize agent turns within each chat, across all harnesses and native sessions. Separate chats/task rooms can run concurrently; also queue access to a native session shared by multiple rooms. Use branches/worktrees for concurrent repository work.

## Repositories and media

| Content | Home | Collaboration flow |
| --- | --- | --- |
| Code and canonical project assets | GitHub or similar | Link repository, branch, issue, commit, and PR. Provide an easy collaborator invitation action through the host. |
| Local LLM workspace | Each person's machine/harness | Associate checkout and selected sessions with the project without replacing private instructions/history. |
| Chat and shared results | :o room log | Coordinate work and reference exact artifacts and repository revisions. |
| Music, GIFs, images, and other files | Private object storage, then repository if adopted | Agent creates/edits locally, bridge uploads, chat shows authorized preview/download, new versions preserve earlier messages. |

- Encourage code access: show who can access the linked repository and direct its owner to invite collaborators.
- Chat membership, repository permissions, and local execution authorization remain explicit and separate.
- Artifacts record filename, media type, bytes, hash, owner, run, version, and optional repository reference. File bytes travel through upload/download endpoints, not chat deltas.
- Offer adding an accepted artifact to the repository through a branch and PR. Large assets may need Git LFS or linked storage.

## Hordes

- Contributors bring their own API keys, local models, token budgets, or compute. Credentials remain local.
- Harnesses and skills are usually free or low cost. Paid tokens and available compute are the constrained resources.
- Split missions into bounded tasks and task rooms. Use atomic claims, leases, budget limits, explicit handoffs, and independent review.
- Publish selected findings in the mission summary. A massive mission should not broadcast every agent token to everyone.
- A submitted claim is not an accepted result. Keep validation and acceptance separate.
- See [horde research](Research/hordes.md) and the [wishlist](FEATURE_WISHLIST.md).

## Group pilot

- Three humans: you and your two collaborators.
- Separate chats with independent membership, including private project and friend conversations.
- Three desktops/local bridges, one named agent per person. Start with two adapter types: Codex app-server and Hermes ACP. Each person chooses their own harness/model.
- Human sends during streaming, mentions, owner approvals, queued agent turns, stop, reconnect, unread notifications, and one shared media output.
- Reviewed import of existing harness history, preserving source provenance.
- Pi, OpenCode, Claude, and Copilot adapters follow the pilot. Inventory may display a harness's chats before its runnable adapter exists. See [MVP integration and next steps](Research/mvp-base-and-harness-integration.md).
- Massive missions, configured observer modes, and broader packaging follow once the pilot is useful.

## MVP interface

- Desktop appearance choices: Cobalt + red, Mint + charcoal, and Classic. Classic keeps the previous app colors.
- In chat, humans use blue tags and agents use red tags, with stable participant shades. Mint `#5EB783` and Charcoal `#302D2E` color the alternate app surfaces.
- The left list shows recent projects with their local chats nested inside, plus shared chats. The right list shows members and agents of the selected chat. Settings opens in the main area and can be closed with the same sidebar button or Back to chat.
- Selecting a project opens a ready composer with project and Codex/Hermes selectors. A plus icon appears when hovering or focusing a project. The first message creates a native chat in that folder, and the chat remains in the local catalog after restart.
- The invite icon copies a code and shows a short confirmation. It shares that conversation's readable history into a chat with its own membership; later messages continue through the existing native session. Injected harness setup instructions and raw records stay internal.
- Names and roles stay visible; color is an additional cue.
- [Design rules](design-system/index.html) show both themes and participant tags.

## Sheep

- [Sheep](https://github.com/arjuna-dev/declawtter), formerly Declaw, provides cross-harness discovery and switching.
- :o starts the bundled executable with `sheep bridge --stdio` as a background JSON process. It is a CLI command, but the interactive Sheep terminal UI is not embedded in :o.
- The bridge lists projects and chats, loads a portable transcript, and reads selected native records in pages. The native source remains read-only.
- Sheep's compact transcript and existing checkout flow stay intact. The richer reader can also support Sheep inspection and export features.
- Rich reads cost I/O and parsing when a session is opened. Ordinary lists do not request the rich records. The current reader path has not been benchmarked, and some page reads may rescan earlier source data.
- The current app bundle is built for macOS arm64 from the local Sheep checkout. A pinned Sheep revision and binaries for other supported systems are still needed.
- See [reader implementation and integration details](Research/mvp-base-and-harness-integration.md#where-sheep-fits).

- Structured interfaces handle prompts, events, approvals, models, and settings where supported.
- Adapter manifests describe version-specific capabilities; runtime APIs provide catalogs where available.
- Codex app-server and Hermes ACP handle the first adapter set. The shared UI currently exposes agent name, harness, model, and working folder; other native settings and commands need adapter support.
- See [middleware feasibility](Research/cli-middleware-feasibility.md) and [chat UX research](Research/chat-ux-and-agent-orchestration.md).

## Run the app

- `cd app && npm install && npm run dev:electron` builds the local reader from the adjacent Sheep checkout and opens the desktop app. The packaged macOS app includes that reader; app users do not install it separately.
- `cd app && npm test` updates [Tests](tests.html) from the test run. `npm run build:electron` makes the macOS app bundle and DMG in `app/dist/electron/Packaged/`.
- `cd app && npm run test:ui` runs the actual Vue interface with synthetic Electron IPC, harness, and chat-service fixtures and updates [Tests](tests.html) with results and screenshots. Install its test browser with `npx playwright install chromium`; `SURPRISED_FACE_TEST_BROWSER=chrome npm run test:ui` can use an installed Chrome instead.
- The pilot Worker is deployed with chat-scoped invites. New people create an account in the app without setting up Cloudflare. Open the updated desktop build for the new flow. Operators deploying a separate Worker can use [Cloudflare room service setup](app/cloudflare/README.md).
- `npm test` runs the local consistency checks and writes their results to [tests.html](tests.html).
- See [Cloudflare room service setup](app/cloudflare/README.md) for Worker secrets and deployment.
