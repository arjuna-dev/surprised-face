# :o middleware and harness UI

Research checked 2026-09-29. The harness set is Pi, Hermes, Codex, and Claude Code.

## Shared scope

- Workspaces, channels, and direct chats can contain many humans and agents.
- Each person's :o UI connects through their local bridge to a shared room. The same bridge manages their local harness adapters.
- Cloud room events determine chat order; bridge caches have one writer and exported JSON is rebuilt from events.
- Default agent mode is mentions only. Owner-configured conditions are optional and budgeted.
- Attach repository links and direct owners to collaborator invitations. Media results use private upload/download endpoints, not terminal bytes or chat deltas.

## Input and routing

The user starts `:o`. The `:o` app receives each submission and chooses its destination.

1. A message for people goes to shared chat. No harness runs.
2. An agent request goes to the selected harness adapter. `:o` can add selected shared-chat messages as context to that actual request.
3. The harness records its own request and response in its native session. `:o` copies available events and results to shared chat with participant, model, harness, and source metadata.

The shared chat and harness prompt are separate surfaces. A human-only message does not become a fake harness turn. It can be included with its speaker name and ID when someone calls an agent.

## Can `:o` intercept and inject content?

| Need | Feasible? | How it works | Limit |
| --- | --- | --- | --- |
| Receive user input before a harness | Yes, when the user launches the harness through `:o`. | The `:o` app owns the composer and the child process input path. It routes a message to shared chat, an adapter, or a focused terminal pane. | Users must use `:o` as the entry point for that session. Launching a harness separately bypasses this routing layer. |
| Display the native CLI interface | Yes, for terminal UIs. | Run the CLI in a pseudo-terminal (PTY), parse its terminal stream in an emulator such as xterm.js, and place that surface inside the `:o` UI. | The terminal view looks native, but it is still a terminal surface. It is not a structured copy of the harness conversation. |
| Send a prompt to a harness | Yes. | Prefer its structured prompt or session API. If none fits, `:o` can write to the child PTY after selecting the harness route. | PTY writes are terminal input bytes. Without knowing the TUI state and focus, text may land in a dialog, editor, or other control. This fallback needs per-harness validation. |
| Insert messages into the visible TUI | Sometimes, through its prompt input. | Send the prompt through a structured API, or type it into the child PTY when the TUI is at a known prompt. | There is no generic way to insert a transcript into every harness's screen and session. Do not modify ANSI output as ordinary text. |
| Read complete conversation records | Not from PTY output alone. | Use structured events, an API, or a harness-specific session reader. | A terminal screen can redraw, truncate, or omit records and metadata. |

The key distinction is between intercepting bytes and understanding their meaning. A PTY lets `:o` receive and send terminal bytes if `:o` owns the process boundary. It does not explain whether bytes represent a prompt, a slash command, a settings change, or navigation in a dialog. Semantic control needs a harness API or a known TUI state.

## Keep native settings and commands

There is no universal interface that exposes every harness's settings and slash commands. A unified `:o` UI can use a hybrid:

- Implement `:o` commands such as `/settings` and `/hotkeys` in the unified UI.
- Let `:o` own shortcuts for its own UI. The selected harness's keybindings apply only inside its native terminal pane.
- Define a versioned adapter manifest for each harness. It lists known commands, settings, control methods, and any harness UI fallback.
- Query runtime catalogs and values through the adapter where available. Examples include models, supported thinking levels, and extension commands.
- Apply settings through structured APIs where available. For documented file-based settings, use explicit schemas and preserve unrecognized values. Some changes need a harness reload or restart.
- Show an embedded PTY terminal pane when a person needs native UI that the adapter does not implement.
- Route input from that pane through `:o` to the selected PTY. The harness interprets it. `:o` cannot generically tell whether text entered there is a slash command or a model prompt. Use the `:o` composer whenever the recipient must be chosen between people and an agent.
- Do not infer a generic command catalog by scraping terminal text.

The outer layout and chat behavior can be consistent across harnesses. The adapter manifest and available controls vary by harness and version. The embedded native terminal surface remains a fallback for features `:o` has not implemented.

A local web or desktop UI needs a local `:o` process to launch and manage child PTYs. A browser page cannot launch a user's local CLI by itself. The UI can connect to that local process and render the PTY stream in xterm.js. [node-pty](https://github.com/microsoft/node-pty) provides a Node PTY interface; [xterm.js](https://xtermjs.org/docs/api/terminal/classes/terminal/) renders terminal streams in a web UI. This local bridge requirement follows from the browser and process boundary.

## Harness interfaces

| Harness | Structured interface | What it gives `:o` | Native UI gaps and fallback |
| --- | --- | --- | --- |
| Pi | Long-lived JSONL RPC with commands, responses, extension UI requests, and session events. | Prompt and session control, model and thinking-level discovery and changes, compaction, and `get_commands` for extension commands, templates, and skills. The user/project settings files and keybindings file are documented. See [Pi RPC](https://pi.dev/docs/latest/rpc), [RPC commands](https://pi.dev/docs/latest/rpc-commands), [RPC extension UI](https://pi.dev/docs/latest/rpc-extension-ui), [configuration](https://pi.dev/docs/latest/configuration), [settings](https://pi.dev/docs/latest/settings), and [keybindings](https://pi.dev/docs/latest/keybindings). | RPC does not list built-in TUI commands such as `/settings` and `/hotkeys`, and it cannot reload TUI-only configuration through a documented RPC command. `:o` can implement supported controls from RPC and documented files, then restart Pi when needed. Keep the PTY pane for native screens not yet implemented. |
| Hermes | TUI Gateway JSON-RPC for custom hosts. | Sessions, streaming events, approvals, command catalog/resolve/dispatch, and config get/set. See [Hermes programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration) and [slash commands](https://hermes-agent.nousresearch.com/docs/reference/slash-commands). | It is a broad custom-host API, but the exact UI and command behavior still need adapter validation. A PTY pane can retain the native TUI. |
| Codex CLI | Codex App Server bidirectional JSON-RPC. | Rich thread and turn events, approvals, configuration, model options, and a PTY-backed command execution interface. See the [Codex App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md). | The protocol exposes app operations; it does not promise a catalog of every TUI slash command. Use the native TUI pane for commands without an adapter operation. |
| Claude Code | CLI print mode with JSON or stream-JSON input and output, plus user/project configuration files. | Programmatic requests and streamed events. Print mode is separate from the interactive TUI. See [Claude Code CLI](https://code.claude.com/docs/en/cli-usage), [settings](https://code.claude.com/docs/en/settings), and [Claude directory](https://code.claude.com/docs/en/claude-directory). | The documented interfaces do not provide one complete catalog of interactive TUI commands. Keep the native CLI available through a PTY pane for uncovered controls. |

These interfaces are not interchangeable. The adapter should report its capabilities rather than claim every harness supports the same operations. Structured interfaces should drive prompt submission and record sync. A versioned manifest can describe stable built-ins, while APIs supply live catalogs and values. The PTY pane keeps native controls reachable when `:o` has not implemented them.

## Discovering available controls

- Query a harness API for runtime data it exposes, such as Pi's model list, thinking levels, and `get_commands` result.
- Use a versioned adapter manifest for built-in commands and settings that have no runtime catalog.
- Read the harness version and declared extension resources so the manifest and dynamic entries match the active installation.
- A CLI `--help` command can list version-specific CLI flags and extension options. It does not generally enumerate interactive TUI commands. See [Pi CLI](https://pi.dev/docs/latest/cli).
- Do not query the live TUI by sending `/` or `/help` and scraping the screen. The menu output is intended for a person and has no cross-harness machine-readable contract.

## Proposed interaction

1. `:o` opens the shared conversation and the selected harness connection.
2. The person writes to the shared-chat composer. `:o` delivers the message to the other people only.
3. The person chooses an agent action. `:o` sends the request and selected chat context through the harness adapter.
4. The person opens the native terminal pane when a harness-specific setting or command is needed. `:o` receives its input and forwards it to that harness PTY. Anything submitted inside the native UI is handled by that harness, so use the `:o` composer for shared messages and agent requests.
5. Structured harness events or a session reader copy the resulting records and artifacts into shared chat. PTY output alone is for display.

This keeps a common chat UI while preserving a route to native harness features. It also avoids spending model tokens on messages meant only for people.

## Delivery to other participants

- Other signed-in `:o` UIs receive saved shared messages through their owned bridges and the `:o` service. Server-sent events or WebSockets can provide live updates. See [MDN server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) and [MDN WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API).
- Chat delivery does not edit another person's local harness session.
- When that person calls an agent, `:o` can include selected shared messages in that person's request to their own harness.

## Feasibility

- **Intercept typed messages:** yes, when `:o` is the CLI or app entry point.
- **Interpret arbitrary PTY output as chat events:** no, not reliably across harnesses.
- **Inject a prompt through PTY:** mechanically possible, but fragile unless the TUI state is known. Prefer a structured prompt API.
- **Expose settings and slash commands in `:o`:** yes for controls with structured APIs or documented config files. Use versioned manifests for known built-ins and runtime catalogs for discoverable commands.
- **Show native controls `:o` has not implemented:** usually, by rendering the interactive harness TUI in an embedded PTY terminal pane. Validate the TUI per harness. Input in that pane is routed to the selected harness and cannot be semantically screened in a generic way.
- **Offer one unified UI:** yes for shared chat, routing, notifications, and common adapter actions. Native terminal content remains harness-specific unless `:o` reimplements it.
- **Work with multiple harnesses:** feasible with per-harness adapters and a capability list. Pi, Hermes, Codex, and Claude expose different programmatic surfaces.
