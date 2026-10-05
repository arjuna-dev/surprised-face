---
name: visual-dev-console
description: Create a minimal local view of how software works and what real tests show during development. Use when a developer needs to understand a code change through workflows, inputs, outputs, or UI evidence, not for generic post-release QA reports.
---

# Visual Dev Console

Create a small local view that helps a developer understand the software while it is being built. Explain the actual data flow and show real test evidence when it exists. Keep implementation details available one layer deeper.

## Pages and navigation

For this project, use three separate HTML pages with simple links between them:

- `report.html`, labeled **How it works**, for the architecture and important workflows.
- `tests.html`, labeled **Tests**, for real test runs and visual evidence.
- `md.html`, labeled **MD**, for a short index of the repository's Markdown files.

Put the page links in the header on all three pages. Each page must also have the same left drawer listing every Markdown file in the repository, including `AGENTS.md` and this skill. Keep the list in sync when Markdown files are added or removed. Drawer links can open the source Markdown in a new browser tab.

Do not add Overview, Plan, or standalone Evidence pages unless the user asks for them. Avoid a single long page with every section stacked together.

Keep the Tests page empty apart from the page title, page navigation, and Markdown drawer until real test evidence exists. Do not fill it with a placeholder message, status card, sample result, or invented data. When a test run exists, add its actual inputs, expected and observed outputs, command, and result.

For this project, `:o` has private local chats and shared chats with explicit membership. Invites grant access to one chat, never to every chat or project. It owns all user input and is the shared-chat entry point across harnesses. Each participant's UI connects through their owned local bridge to a shared room; that bridge also manages local harnesses. Do not describe user input as going directly to a harness. In a one-person chat, an ordinary message can run the owner's agent immediately. After another person joins, agents use mentions. Owners may enable scoped conditions or meaningful-contribution detection with permissions, context limits, budgets, cooldowns, concurrency limits, and loop prevention. Agent requests enter the room turn queue. When a turn starts, `:o` builds a prompt from the request and completed shared messages the harness has not seen, then sends it through the chosen adapter. Future opt-in triggers must use the same queue. The harness keeps its native session, and `:o` copies selected results and run metadata into shared chat. Keep source participant IDs on included context. Do not edit harness session files directly.

A PTY carries the native TUI's output. To show it beside shared chat, render the PTY stream through a terminal emulator and compose that surface with `:o`'s UI. A local `:o` process must launch and manage a local CLI; a browser page cannot launch a process on its own.

All user input goes through the `:o` app. Its shared composer routes messages to people or submits requests through a harness adapter. If the person focuses the native terminal pane, `:o` can forward that pane's terminal input to the child PTY so the harness can interpret its own settings and commands. A generic PTY cannot tell whether submitted text is a slash command or a model prompt. Use the shared composer whenever the recipient must be chosen between people and an agent. Do not create an input path around `:o`.

Prefer structured harness interfaces for prompt submission, session events, approvals, settings, models, and command discovery where available. Define a versioned capability manifest for each adapter, and query runtime catalogs and values where supported. Use documented config files only through explicit schemas that preserve unknown fields. Do not assume a universal settings or slash-command API. Do not parse terminal screen text as a command catalog or conversation record. Use the native terminal pane for interactive controls the adapter does not expose. PTY prompt injection is a per-harness fallback and may be brittle when the child TUI state is unknown. Use adapter events or a harness-specific session reader to sync messages and associated data. See `Research/cli-middleware-feasibility.md`.

## Project architecture references

- Approved chat rule: humans can always send. A one-person chat can call the owner's agent automatically. A group chat requires `@agent_name` to queue a turn. Only one agent turn runs per chat, across all harnesses.
- When the previous turn finishes, fails, or is confirmed stopped, atomically claim the next eligible queued turn, freeze completed conversation context, and reserve its reply at the end of the chat. Do not reserve a queued reply or freeze its context when the mention arrives. Streaming fills the active reply in place; new human messages do not change its prompt. A pause or temporary disconnect does not free the active slot.
- Keep context bookkeeping internal. Do not require explicit Reply selection or context inspection to read the chat. Separate chats/task rooms can run concurrently; shared native sessions still need serialization. Reconnects replay saved events.
- Repositories remain canonical project hosts. Encourage code collaboration with repository links and a host invitation action; keep grants explicit.
- Music, GIFs, and other outputs are attributed, versioned artifacts with authorized previews/downloads and optional repository links.
- Hordes coordinate contributed model tokens and compute using task rooms, bounded claims, budgets, handoffs, and validation.
- The pilot has three humans; agent count is separate. Two-person diagrams are examples, not a product limit.
- Recommended pilot base: reuse heyDataAgent's Electron/Vue shell and Codex/Hermes clients after removing its domain features. Improve Sheep to preserve available native records alongside compact transcripts and expose a versioned JSON mode. :o bundles and launches the compiled Sheep helper through stdin/stdout without displaying its interactive TUI. Keep summaries lightweight and rich reads on demand. Discovery support does not imply a runnable adapter exists. See `Research/mvp-base-and-harness-integration.md`.
- Generated interface images are fictional design concepts, never evidence of a working harness or backend.

## Writing and layout

- Use short, literal headings such as “Chat copies”, “Sync”, and “Tests”. Say what the section contains.
- Write concise, factual sentences. Avoid taglines, marketing language, abstract slogans, project pitches, repeated summaries, and status badges.
- Prefer lists over paragraphs. Use a list for distinct facts or steps, and keep paragraphs for a short introduction or one connected explanation.
- Prefer a narrow reading column, simple navigation, plain lists or tables, and thin separators. Use cards only when they clarify a real grouping. Avoid decorative hero areas and oversized dashboards.
- Keep the Markdown drawer compact, left aligned, and present on every page, including an otherwise empty Tests page. On narrow screens it can move above the page content.
- Explain a workflow in the order it happens. Keep architecture diagrams small and use them only when they make a real data flow easier to understand.
- Public review pages and the planned app use Blue/red and Green themes through the shared header's manual control. Green replaces dark mode: Mint Green `#5EB783` and Charcoal `#302D2E` on Neutral White `#FAFAF7`. Blue/red uses Cobalt `#2148B8` for humans and Signal Red `#C83232` for agents. Assign stable participant shades, show names/roles, and keep body text neutral. Reuse `shared/project-header.css`; do not recolor raster illustrations. The separate development console may retain its existing light/dark styles.
- Keep pages usable on narrow screens and with keyboard navigation. Respect reduced-motion settings.

If behavior is not implemented yet, describe it as intended behavior in a plain sentence. Do not imply that a proposed flow has been observed in a real run. Avoid badges or banners to communicate this distinction.

## Development workflow

1. Inspect the implementation, architecture, test runner, and UI tooling. Reuse project conventions and installed dependencies where useful.
2. Identify the user workflow affected by the change. Record its intent, acceptance criteria, useful inputs, expected result, and important side effects.
3. Use red/green TDD for behavior changes. Write the smallest useful test first and confirm it fails for the expected reason. Implement the change and confirm the test passes. Then run relevant regression tests. If red/green TDD is impractical for a change, state why and use the closest meaningful verification.
4. Capture evidence from the actual test or application run. Prefer structured test output and real observation points. Never create a second implementation of business logic to make the report look convincing.
5. Update `tests.html` from the relevant test command. Prefer native reporter integration. If the runner cannot write HTML directly, have the same command emit structured data and invoke a deterministic local generator. Document the exact command where developers will find it.
6. Open the updated pages locally and check that navigation, the Markdown drawer, test details, outputs, and screenshots match the implementation and run.

Do not label a test as passing unless it passed. Preserve linked red and green results when practical. Show failures and unverified cases plainly in context.

## What to show

In `report.html`, show only the architecture and workflows needed to understand how the current code behaves. Link explanations to the relevant source files or functions. Separate observed behavior from intended behavior.

In `tests.html`, for each real test run show the workflow, command, timestamp when available, result, useful input, expected output, actual output, and the approach exercised. Show intermediate values only when the code exposes them or a test asserts them. Include screenshots for UI workflows and other visual outputs. For text, format JSON, Markdown, diffs, and code for scanning.

Use expandable raw data or source references when they add useful detail. Label mocks, stubs, wireframes, and synthetic fixtures at the point they appear. Redact secrets and personal data before adding run output.

## Libraries

Choose libraries to fit the project's stack. These are optional defaults for JavaScript reports:

| Need | Option | Guidance |
| --- | --- | --- |
| Render Markdown | `marked` and `DOMPurify` | Sanitize rendered HTML, especially when content includes user or test data. |
| Format code and structured text | `Shiki` | Reuse an existing highlighter when available. |
| Architecture diagrams | `Mermaid` | Keep diagrams focused on real components and data flow. |
| Animation | `GSAP` | Use only when motion explains a workflow or state change. Keep every interaction usable without it. |
| UI evidence | Existing browser test tooling, such as Playwright | Capture real rendered states and label wireframes separately from running UI. |
| Numerical comparisons | `Chart.js` | Use only when a small chart clarifies real data better than text or a table. |

Reuse installed packages first. Add dependencies only when they materially improve understanding. Prefer local pinned assets or a self-contained page over unpinned CDN dependencies. If a local server is required, show its exact command.

## Completion check

Before finishing a feature change, confirm that:

- The relevant behavior has a failing red test and a passing green test, or the reason for not using that cycle is stated.
- The project's test command creates or updates `tests.html` from real run data.
- The pages use the three-page navigation, a complete Markdown drawer, and the minimal styles and applicable theme rules described above.
- `report.html` describes the current code accurately and does not present assumptions as observed behavior.
- UI workflows show real screenshots when available. Text workflows show readable inputs and outputs.
- Source links match the implementation, and secrets or personal data are not exposed.
