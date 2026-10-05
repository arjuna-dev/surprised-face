# Shared chat ideas

## General scope

- Workspaces, channels, and direct chats for groups of people and agents.
- The pilot has three humans: the project owner and two collaborators. Agent count is separate.
- A two-friend game chat is one example, not the limit of the architecture.
- Work and project creation are primary use cases to explore; casual chat and community hordes are additional directions.

## Small use case to try

- Two friends are working on a game and already use GitHub for source code, branches, issues, and review.
- They share a conversation for coordination, design discussion, and decisions that do not belong in a code review.
- They can summon an agent when there is work to do. The agent should usually return an artifact or answer, then stay quiet.
- Possible actions:
  - create or edit music and attach the result;
  - make a GIF or picture for the chat or game;
  - calculate or check a game mechanic;
  - draw a chart from supplied values;
  - draft a poem, scene, or item description;
  - inspect a design or patch when asked.
- Do not assume that sharing an old private LLM conversation is useful. Try a new shared conversation and compare whether it helps the two people coordinate.

## Agent behavior

- MVP: humans request agent turns with `@agent_name`. Ordinary human messages do not trigger a reply.
- Humans can always send, including during streaming. Only one agent turn runs per chat; other mentioned agents queue.
- A queued turn gets its reply position and completed chat context when it starts, after the previous turn finishes, fails, or is confirmed stopped. Sending a human message does not interrupt the active agent.
- Use ordinary chat input. Context bookkeeping stays internal; no special Reply action or context inspection is required.
- Optional: owner-configured conditions, including meaningful contributions, scoped to channels/actions with budgets and cooldowns.
- Agent-authored messages do not trigger further agents by default. Deduplicate events and limit causal chains.
- An agent can also watch for a configured condition and act, but this should be opt-in and narrow.
- An agent might inspect conversation content to identify work that can be done, but every-message monitoring has privacy and token costs. A low-cost event rule or explicit reaction may be a better trigger than a model call on every message.
- Agents should do the requested work without acting like chatty participants.
- A scheduled agent message can provide a reminder or periodic update. [Sheep](https://github.com/arjuna-dev/declawtter) already supports agent-agnostic scheduling on Mac; assess whether its scheduler can be reused for chat messages and what account should own a schedule.

## :o CLI middleware

- The person starts `:o` as the CLI front door instead of launching a harness directly.
- Every message and key event enters `:o` first. `:o` decides whether submitted text stays in shared human chat or is sent to an agent through a selected harness.
- A human-only message is stored and delivered by `:o`; it does not go to the harness or spend model tokens.
- An agent mention queues a turn. When it reaches the front of the chat queue and the previous turn has ended, `:o` sends the request with completed shared-chat context the harness has not seen. The harness records that combined request as its native user turn. Future opt-in triggers use the same queue.
- The harness's native session remains owned by that harness, while `:o` shares copied run data and results with source participant and message IDs.
- Use a PTY to receive the native harness TUI. To show it alongside shared chat, render it through a terminal emulator and compose it with the `:o` interface. The local `:o` process launches the CLI; a browser page cannot start it by itself. Do not edit terminal control bytes as plain text.
- All user input goes through the `:o` app. Its shared composer routes messages to people or sends an agent request through an adapter. When the native terminal pane is focused, `:o` may forward that pane's terminal input to the selected harness PTY, where the harness interprets its own settings and commands. A generic PTY cannot tell whether submitted text is a slash command or a model prompt, so use the shared composer whenever recipient choice matters.
- Prefer each harness's structured interface for prompts, events, settings, model selection, and command discovery when available. Keep the PTY terminal pane for native controls that the adapter does not expose. There is no common API for all settings and slash commands.
- PTY output displays the terminal screen; it does not provide complete conversation records. Use structured events or a harness-specific session reader to sync records and associated data.
- UI -> owned local bridge -> shared room -> other bridges -> UIs. Every participant has a bridge; each bridge also manages its owner's harnesses.
- Each other participant's `:o` client receives the same saved event. Their native harness history is not rewritten by the delivery process.

## People and notifications

- A collaborator needs to know when another person wrote to them. Unread state and notifications are core chat behavior.
- Show whether an update came from a person, an agent run, or a scheduled message.
- Let people mute a conversation without losing unread history.
- Agent output needs its own completed, failed, and waiting states so a collaborator can understand what happened while away.

## Repository and conversation

- Keep the project repository on GitHub or a similar host.
- Put a collaborator invitation action beside the repository link. Encourage participants to get code access through the host.
- Store chat media as private, versioned artifacts with owner/run metadata; offer adding accepted outputs to a repository branch or PR.
- A shared chat can link to the repository, branch, issue, commit, or pull request without becoming a second code host.
- Decide which project context belongs in the shared chat and which stays in each participant's local LLM project.
- The conversation may coordinate work while the code and review remain on GitHub. Test whether participants need more than links and generated artifacts.

## Open questions

- What would make the shared conversation useful if participants already have private agent chats and GitHub?
- Should a summoned agent use the summoning person's tokens, an explicitly funded mission budget, or a contributor's own local model?
- Does an agent result need to be copied into a local harness session, or is a shared artifact enough?
- When should a scheduled message appear in the shared chat, and who approved its schedule?
