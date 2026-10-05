# Hordes and community missions

Research checked 2026-09-28.

## Term

- A **horde** is a coordinated group of agent runs contributing to a community mission.
- A mission is the shared goal. A horde is the people-backed model and harness capacity doing work for it.
- A horde can contain runs using different models and harnesses. The agents do not need to share a brand or runtime.
- The useful contribution is access to model tokens, a model, a harness, or local compute. An agent identity by itself is not a scarce resource.
- Skills and harnesses are often free. Inference tokens and available compute are the constrained resources, so a mission should show who is paying for each run.
- Local delegation and handoff can be useful for one person's review workflow. Community hordes make them more useful when separate contributors supply model budgets or compute and work must be coordinated across people.

## Is Horde the project name?

- Use **horde** for a coordinated group working on a mission.
- Keep the project name as `surprised-face`, and the mark and CLI command as `:o`. The current project identity is already established, while the proposed horde is one concept inside it.
- A mission can have one or more hordes. A person can contribute a harness run without making that harness the mission's shared execution environment.
- Reconsider the product name only after trying the language in a few concrete flows: create a mission, join a horde, offer model or compute, take a task, return a result.

## What a community horde needs

| Part | What it records |
| --- | --- |
| Mission | Goal, linked GitHub repository, constraints, and completion conditions |
| Contribution offer | Contributor, model or harness available, token or compute limit, and time window |
| Work item | Bounded task, required context, owner, dependencies, and expected artifact |
| Run | Model, harness, input, token usage when available, status, and output |
| Handoff | What is ready for another contributor, what remains uncertain, and what evidence to check |
| Result | Patch, analysis, image, test result, or other artifact linked to the mission |
| Review | Human or agent feedback and whether the result was accepted |

- Keep provider credentials on the contributor's machine. A mission may track an agreed budget or reported usage without collecting API keys.
- Encourage repository access with an invitation action beside the project link. Keep its grant explicit, alongside chat membership and permission to run an agent.
- Let contributors pause or cap their own model usage. Show the expected or observed cost before launching work when the provider exposes it.
- Prefer reviewable outputs in GitHub or another canonical project host. The mission links those artifacts instead of becoming another repository host.

## Proposed room architecture

- Ordinary collaboration uses workspaces, channels, and direct chats with many humans and agents.
- Large missions use bounded task rooms, an atomic claim/lease per work item, contributor budgets, and explicit result acceptance.
- Task attempts carry fencing epochs; expired workers cannot publish as the current owner. Paid work is not rerun automatically.
- Contributors keep their own bridge, harnesses, API keys/local models, and spending controls.
- Separate task rooms can run agents in parallel. Within one chat, humans can always send but agent turns run one at a time; queued turns start with completed chat context. Also serialize access to any native session shared across rooms. Use branches/worktrees for repository work and immutable versions for artifacts.
- A mission summary receives selected findings. Do not fan every agent's token stream out to every contributor.
- Preserve music, GIFs, patches, analyses, and verification evidence as attributed artifacts.
- Review submissions independently. More agents or messages do not prove a claim.

## Orchestration patterns

| Pattern | How work is split | Useful when |
| --- | --- | --- |
| Independent exploration | Give several contributors distinct approaches or variants; compare their results later | The right approach is uncertain |
| Fan out and combine | Split a goal into bounded tasks, then give a person or agent the outputs to integrate | Tasks can proceed independently |
| Sequential handoff | One run produces an artifact or question for the next run | Work has real dependencies |
| Review pass | A separate contributor checks a patch, calculation, or claim | Errors are costly or the result needs independent scrutiny |
| Shared investigation | Contributors post evidence and partial findings to a common mission thread | The problem changes as new evidence arrives |

- Do not spawn more runs just to make a horde look active. Every run spends a contributor's tokens or compute and adds integration work.
- Keep independent exploration independent at first. Share useful intermediate results when the coordinator has something concrete to cross-pollinate.
- State the handoff contract: artifact, evidence, unresolved questions, and next action.
- Use a human coordinator for scope and acceptance unless a mission explicitly chooses an automated coordinator.

## OpenAI's large mathematics run

OpenAI's September 8, 2026 account of its Navier-Stokes effort describes a system coordinated at a much larger scale than an ordinary group chat. The details below are OpenAI's report of its own run, not an independently reproduced study. [OpenAI's account](https://openai.com/index/navier-stokes-solution/)

- Agents were divided into groups that could communicate within each group. Group sizes varied.
- The group that produced the Navier-Stokes result had about 10,000 concurrent agents.
- Separate groups received different variants of the problem, including variants framed toward proof and variants framed toward disproof.
- OpenAI says it encouraged diverse approaches, then used Codex to consolidate useful intermediate insights and feed them across groups.
- Nearly 100 agents had spent about 50 hours on a related Euler problem. OpenAI shifted resources to Navier-Stokes and gave that result to the later effort as context.
- OpenAI reports an 88-hour run to the Navier-Stokes resolution, followed by 17 hours for Lean formalization and verification.
- OpenAI reports about 2.7 million messages and 130 billion output tokens for the Navier-Stokes work. Across all attempted problems, it reports 4.9 million messages and about 300 billion output tokens.

The public account does **not** specify the low-level scheduler, task queue, agent selection policy, group communication protocol, retry policy, or the exact roles of individual agents. It also does not describe a single flat chat containing 10,000 agents. Those details should not be inferred from the headline scale.

## What this suggests for :o

- A community horde is primarily a way to coordinate scarce model-token and compute contributions around a shared task.
- The useful orchestration ideas are bounded work items, independent exploration, selected cross-pollination, explicit handoffs, and a verification pass.
- A local agent review is already possible without a community horde. Community value appears when contributors bring otherwise unavailable budget, different models, harnesses, or compute.
- Record model, harness, contributor, and token use per run so a mission can understand where work and cost came from.
- Start with a person assigning and accepting tasks. Automate queue management only after a real mission shows repeated coordination work.

## Sources

- [OpenAI: On the Navier-Stokes Millennium Prize Problem](https://openai.com/index/navier-stokes-solution/)
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)
