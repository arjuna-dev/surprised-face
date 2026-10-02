# surprised-face :o

- Project name: **surprised-face**.
- Logo and planned CLI command: **`:o`**.
- Workspaces, channels, and direct chats for people and their local agents.
- Each person keeps their harness, models, tools, credentials, and spending limits.
- Group collaboration is the core model. A chat between friends is one use case.

## Pages

| Page | Contents |
| --- | --- |
| [Landing pages](landing/index.html) | Projects by default, Friends, and community Hordes. Use the same header dropdown on every review page. |
| [Interface images](interface-designs/index.html) | Three two-ink design concepts with left and right drawers and a central chat/composer. Fictional content, not a working app. |
| [Imagery](imagery/index.html) | People, retro robots, lemonade, stars, dancing groups, and engineering / space hordes. |
| [Design rules](design-system/index.html) | Name, colors, type, spacing, and readable controls. |
| [Architecture](architecture/index.html) | Vue stack, local bridges, message order, agent modes, projects/media, hordes, backends, cost calculators, OpenAPPA, and group pilot. |
| [How it works](report.html) | Concise routing and harness interface reference. |
| [Tests](tests.html) | Actual execution evidence when application tests exist. |
| [MD](md.html) | Repository Markdown files. |

Open the static pages directly in a browser. The message simulation, cost models, and architecture describe a proposal. No backend is connected.

## Structure

| Entity | Purpose |
| --- | --- |
| Workspace | People, project references, channels, agent directory, and shared permissions. |
| Channel | Project or topic conversation with its own membership and agent settings. |
| Direct chat | Smaller conversation between two or more people, optionally with agents. |
| Agent participant | Named assistant with an owner, harness connection, model, and native session. |
| Horde | Coordinated agent runs backed by contributors' token budgets, models, and compute. |
| Mission | Shared goal, bounded tasks, contribution offers, artifacts, and acceptance criteria. |

## Proposed stack

| Part | Choice | Reason |
| --- | --- | --- |
| App UI | Vue 3 + TypeScript + Vite | Fits the chat, drawers, streaming replies, and media. No requirement favors React over Vue. |
| Managed backend | Cloudflare Workers + SQLite Durable Objects | One coordinator per channel/direct chat, ordered writes and WebSockets. |
| Directory / artifacts | D1 / private R2 | Workspace metadata and media files. |
| Local bridge | TypeScript process + SQLite cache | Routes UI submissions, manages local harnesses, queues sends, applies server events. |
| Alternative | Node + Postgres on a small server | Portable stack with server operations under our control. |

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
| Human message | UI -> local bridge -> shared room -> other bridges and UIs. No model run. |
| Tagged agent request | Room checks permission and saves request/context/reply position -> owner's bridge -> selected harness. |
| Agent output | Owner's bridge -> shared room -> all authorized subscribers. Text fills the existing reply; files become attachments. |
| Native harness controls | Focused terminal pane -> :o bridge -> child PTY. The harness interprets its own settings, commands, and hotkeys. |

## Agent participation

| Mode | Behavior |
| --- | --- |
| Mentions only, default | Acts when a person tags it or deliberately submits an agent action. Another owner's agent still requires permission. |
| Configured conditions, optional | Owner enables rules for particular channels, events, schedules, or meaningful contributions. Limits apply to context, actions, tokens, time, concurrency, and cooldowns. |

- Conditions ignore agent messages by default. Deduplicate triggering events and bound causal chains to prevent loops.
- Model-based detection spends tokens too. Make its scope and budget explicit.
- Show why a run started, whose tokens it uses, its context, and pause/stop controls.
- Agents return work or an answer. Ordinary human chat does not require agent commentary.

## Message order and native records

1. A human draft stays local until Send.
2. The room checks membership, deduplicates the command, and saves it with a server-assigned sequence.
3. Before generation, it saves an empty agent reply and exact shared context snapshot. Every UI shows that reply at the same position.
4. The approved owner's bridge starts the run. New messages can arrive without changing the running prompt.
5. Streaming batches fill the reply in place. If streaming is unavailable, final output fills the same reply after completion.
6. Reconnecting clients replay saved events. A local cache has one writer; transcript JSON is an export, not a shared file everyone edits.

- Shared records use `user` for humans and `assistant` for agents. Participant IDs, names, owner, harness, model, source IDs, and run context identify the speaker and origin.
- Native harness sessions remain harness-owned. Submit real requests through adapters; copy available events/results or approved history imports into :o. Do not inject metadata into native files.
- Record native session/turn frontiers and the actual submitted prompt as well as shared context. Private harness history can also affect output.
- Different native sessions can run concurrently. Queue runs on the same session; use separate branches/worktrees for concurrent repository work.

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
- One workspace, a private project channel, and direct chats.
- Three local bridges; initially two connected agents using two working adapters on separate machines. Agent count is separate from human count.
- Human sends, mentions, owner approvals, concurrent replies, stop, reconnect, unread notifications, and one shared media output.
- Reviewed import of existing harness history, preserving source provenance.
- Pi, Hermes, Codex, and Claude Code remain in scope. Start with two stable adapters rather than requiring all four before trying collaboration.
- Massive missions, configured observer modes, and broader packaging follow once the pilot is useful.

## Sheep

[Sheep](https://github.com/arjuna-dev/declawtter), formerly Declaw, is being developed for visibility into harnesses and switching between them in an app or CLI. Reuse its stable interfaces when ready. No Sheep code has been integrated here.

- Structured interfaces handle prompts, events, approvals, models, and settings where supported.
- Adapter manifests describe version-specific capabilities; runtime APIs provide catalogs where available.
- A PTY terminal pane preserves uncovered native controls. Terminal pixels are not a complete transcript or universal command API.
- See [middleware feasibility](Research/cli-middleware-feasibility.md) and [chat UX research](Research/chat-ux-and-agent-orchestration.md).
