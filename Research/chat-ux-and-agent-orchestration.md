# Chat UX for people and agents

Research checked 2026-09-28.

## The interaction question

In a workspace channel or direct chat with several people and agents, decide whether each agent should:

- stay quiet;
- answer a direct request;
- perform an action and return an artifact;
- watch for a narrowly defined condition and act when it occurs.

For the game-collaboration example, the agent may be more useful as a tool that makes an image, checks a calculation, plots data, or drafts a poem than as another person-like speaker.

## How current products handle intervention

| Product or pattern | When the agent gets involved | What it implies |
| --- | --- | --- |
| ChatGPT group chats | ChatGPT follows the conversation and decides when to speak or stay quiet; participants can explicitly mention ChatGPT | Ambient relevance detection can coexist with a direct trigger, but the agent may still speak without a mention. [OpenAI](https://openai.com/index/group-chats-in-chatgpt/) |
| Slack agents | Add an agent to a channel, then mention it to start an interaction. Slack Code can create a shared working channel after a request. | Explicit invocation is easy to understand and limits routine interruptions. [Slack agent guide](https://slack.com/help/articles/33076000248851-Work-with-AI-agents-in-Slack), [Slack Code](https://slack.com/help/articles/54310833022355-Build-with-AI-as-a-team-using-Slack-Code) |
| Microsoft Teams agents | By default, group and channel agents receive only direct @mentions. Resource-specific consent can grant access to every message. | Passive monitoring is a separate permission, not an automatic consequence of adding an agent. [Microsoft Learn](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-and-group-conversations) |
| Teams suggested actions | A button can send a command, silently invoke behavior, or put a prepared message in the composer. | An action need not create another conversational reply. [Microsoft Learn](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/teams-conversational-ai/agents-best-practices-features-checklist) |

## What the research studies

There is research on intervention timing and human-agent group collaboration. It is still an emerging area, and several results below are claims made by the papers' authors.

| Work | Focus | Relevance |
| --- | --- | --- |
| [GroupGPT (2026)](https://arxiv.org/abs/2603.01059) | Separates the decision about whether to intervene from generating the actual answer. Introduces a 2,500-segment group-chat dataset with intervention labels and rationales. | Directly studies the timing problem. The paper reports lower token use and good evaluation results; those are paper-reported findings. |
| [GCAgent (2026)](https://arxiv.org/abs/2603.05240) | Uses a dialogue manager to track group state and agent invocation, including @-tagging. | Shows a system architecture for agent invocation and multi-user context. Its deployment and engagement figures are reported by the authors. |
| [ChatCollab (2024)](https://arxiv.org/abs/2412.01992) | Lets multiple humans and AI agents collaborate as peers in Slack, with roles, tasks, and agents waiting for requested inputs or deliverables. | A close precedent for software and game development collaboration. It tests agents as contributors with work to do, rather than only as answer bots. |
| [HUMA (2025)](https://arxiv.org/abs/2511.17315) | Studies a facilitator that adapts its timing and participation in group chats. | Useful as a study of timing, but its aim of making an agent hard to distinguish from a person should not be copied. Participants should know when an agent is speaking. |

## Current direction

| Mode | Rules |
| --- | --- |
| Mentions only, default | A person tags an agent or deliberately requests an action; the owner controls who may invoke it. |
| Configured conditions, optional | Owner chooses channels, events, actions, context, token/time budgets, cooldowns, and concurrency. Meaningful-contribution detection also needs a budget. |

- Conditions ignore agent messages by default. Record trigger IDs, deduplicate them, and bound causal chain depth.
- Approved chat rule: humans can always send; only one agent turn runs per chat, across all harnesses.
- In the MVP, humans request agent turns with `@agent_name`. Ordinary messages do not trigger automatic replies.
- Mentions queue turns in server acceptance order. Other agents wait until the active turn finishes, fails, or is confirmed stopped.
- Reserve the reply position and freeze completed conversation context when a queued turn starts, not when it is requested. Include intervening human messages and the previous agent's completed response.
- Streaming fills that reply in place. New human messages appear after it without changing its prompt or interrupting it.
- No required Reply action or context inspection. Keep run context records internal so people can read the chat normally.
- Independent chats/task rooms can run concurrently. A pause, tool wait, or temporary disconnect does not start the next agent in the same chat.
- Notifications distinguish human messages from agent activity.

## A starting rule for :o

- Default to quiet. Do not run an LLM check on every ordinary message unless participants opt in to the token cost and monitoring.
- Let a participant explicitly summon a selected agent with a mention, button, or command.
- Describe the request as an action: make an image, calculate a value, draw a chart, inspect a design, or draft text.
- Return the result as an attributed agent message or attached artifact. Do not add follow-up conversation unless someone asks for it.
- Allow an opt-in observer for a bounded rule, such as “check the balance calculation when we post a table.” Show which messages it can inspect and what its checks may cost.
- Keep the action, source messages, selected model and harness, token use when available, and output together.
- Give every agent an on/off control, a way to stop a run, and a clear status while it is working.
- Let a person privately invoke an action when its result should not be visible to everyone. A public group message should not silently cause a private or expensive agent task.
- Prevent agents from triggering one another by default. Require a human request or an explicitly configured mission rule for agent-to-agent work.
- Mark generated output as coming from an agent. Do not design agents to pass as human participants.

## Notification needs

- A notification system is necessary if collaborators are expected to notice one another's messages or scheduled agent output.
- Separate unread human messages, mentions, agent run completion, run failures, and scheduled messages.
- Support per-chat mute settings and a notification history so offline participants can catch up.
- Make the author and source clear: person, local harness, community horde, or scheduled run.
- A live connection can update an open chat, but offline delivery still needs stored unread state and operating-system or email push notifications where allowed.

## Questions to answer in a prototype

- In a game chat, which actions would someone actually request: image generation, balance calculations, charts, code review, or something else?
- Is the result most useful inline, as an attachment, or in a linked work item?
- When an agent uses someone's model tokens, who should approve that cost and where should it be displayed?
- Does an optional observer save effort often enough to justify reading every message and using tokens?
- Do participants want the agent to preserve shared context in each person's local harness, or is an attributed result in the shared chat enough?

## Sources

- [OpenAI: Introducing group chats in ChatGPT](https://openai.com/index/group-chats-in-chatgpt/)
- [Slack: Work with AI agents](https://slack.com/help/articles/33076000248851-Work-with-AI-agents-in-Slack)
- [Slack: Build with AI as a team using Slack Code](https://slack.com/help/articles/54310833022355-Build-with-AI-as-a-team-using-Slack-Code)
- [Microsoft Teams: Channel and group conversations for agents](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-and-group-conversations)
- [Microsoft Teams: Agent best practices and feature checklist](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/teams-conversational-ai/agents-best-practices-features-checklist)
- [GroupGPT](https://arxiv.org/abs/2603.01059), [GCAgent](https://arxiv.org/abs/2603.05240), [ChatCollab](https://arxiv.org/abs/2412.01992), [HUMA](https://arxiv.org/abs/2511.17315)
