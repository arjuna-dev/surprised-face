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

## First application release, October 20, 2026

The Hordes tab opens a shared project offering as cards. An account can create a project, join an existing project, dedicate a budget commitment and discuss the work. Project updates use revisions so one person cannot silently overwrite another person's edits. Deletion moves a project to the Warchief's Trash; restoration retains its discussion, skills, roles and commitments.

Source code stays in GitHub and local working copies. The existing Cloudflare SQLite database stores project definitions, memberships, budget commitments and discussion messages. A repository link does not grant GitHub access. Project descriptions and skills are discoverable to signed-in people; discussion and individual commitments are visible to project collaborators. The listing shows aggregate commitments by unit.

Budget commitments support tokens, USD and GPU hours separately. No unit conversion, payment, token transfer, automatic model call or verified spending meter is implemented. The project's orchestration setting and parallel work limit describe the agreed workflow; they do not launch work. Skills persist a name, explicit instructions and a tools list. They are project material for contributors to review, not automatic grants to tools or local files.

| Role | Current rights |
| --- | --- |
| Horde Warchief | Create, edit, change roles, delete and restore. The creator remains Warchief. |
| Warlord | Edit project details, repository, orchestration and skills; contribute and discuss. |
| Warrior | Read, contribute their own budget and discuss. Joining grants this role. |
| Scout | Read the project and its discussion. |

Roles are enforced in the shared service, independently of hidden UI controls. Horde roles do not alter existing chat membership or the Run harness mentions on this computer setting.

## Default strategy

Plan, build, verify is the initial default:

1. A human defines the goal, constraints and acceptance evidence.
2. A coordinator breaks it into bounded tasks with explicit inputs, dependencies and expected artifacts.
3. Contributors select independent work that fits their own capacity and tools.
4. A separate reviewer checks results with tests, source checks, simulations or reproducible certificates.
5. A human accepts integrated results and decides the next cycle.

The release also offers world sectors, creative production, search and verify, and systems engineering as predefined strategies. A custom strategy editor and executable task scheduler are later work. Any future scheduler needs contributor authorization, reserved budgets, task attempts, renewable leases with fencing epochs, idempotent submissions, independent acceptance and a local stop control. A lost heartbeat does not prove a paid run stopped, so automatic retries must not silently double-spend a contribution.

## Projects to pitch

These are proposed projects, not claims that a full world, film or vehicle can be delivered with a known token budget. The matching in this table is our design recommendation. Tokens fund planning, code, analysis and evaluation. Render time, simulation time, storage, bandwidth, licensed inputs and specialist work need separate budgets.

| Project | Concrete first milestone | Architecture and validation |
| --- | --- | --- |
| Earth Commons | One walkable 1 km² district, ten landmarks and a shared multiplayer visit | Spatial tasks with fixed coordinates, common asset contracts, seam and streaming checks. Scale to districts before claiming a planet. |
| The Living Archive | One evidence-linked street in historic Alexandria, Tenochtitlan or Edo | Research teams and environment teams, reviewed sources, explicit uncertainty and spatial assembly. |
| The Last City | A 30-minute cooperative island combining Dwarf Fortress-like simulation, Factorio-like logistics and Zelda-like exploration in an original game | Subsystem teams, stable engine APIs, deterministic simulation tests and human playtests. |
| A Billion Worlds | Three distinct planets, one ship and an exploration progression | Independent planet teams conform to shared world, art, quest and performance contracts. |
| Frankenstein: The Arctic Testimony | A 90-second rescue scene, leading to a 25-minute Gothic film framed by Walton finding the creature | Approve screenplay, synthetic actor references and visual bible; parallel shots; continuity, sound and editorial review. |
| Kenshin: A New Lens | A rights-cleared visual test for a new interpretation of the Kyoto arc | Sequence teams, consistent synthetic actors and choreography; human director and continuity gates. Existing live-action films already cover this franchise. |
| Harry Potter and the Methods of Rationality | A licensed pilot treatment and short visual test about investigating magic scientifically | Season architecture, episode teams, character and canon checks, central editing. |
| All the Young Dudes | A rights-cleared limited-series treatment and one short scene | Writers room, episode production teams, centrally reviewed character arcs and continuity. This is a fanfiction adaptation prospect, not an authorized production. |
| The Incal: A Cinematic Atlas | A licensed comic adaptation concept trailer and one reusable vertical-city block | Parallel environment and sequence teams sharing an approved design bible. |
| Ramsey Frontier | Reproduce a known 42-vertex R(5,5) construction and independently check all 5-vertex subsets; then define a bounded new search | Independent graph and SAT experiments, deterministic verifiers, immutable candidates and expert review. No promised mathematical breakthrough. |
| Open City Car | A complete requirements baseline and simulated vehicle packaging, chassis and energy model | Interface-controlled subsystem engineering, independent simulation review and qualified human approval before physical builds. |
| Pocket Orbital Lab | A non-operational research rocket digital twin and telemetry viewer with synthetic data | Subsystem simulation and uncertainty sweeps; human specialist review. No construction or launch execution. |
| The Coral Cathedral | One immense streaming underwater environment tested on an agreed reference machine | Asset-family teams and spatial partitions, instancing, LOD checks, GPU profiling and visual review. |
| Open Accessibility Corps | Reviewed accessibility fixes for five consenting open-source repositories | Independent repository workers, reproducible browser tests, separate patch reviewers and maintainer acceptance. |

For the first public demonstration, Earth Commons offers the clearest collaborative visual payoff. The Last City can show functional code integration. Frankenstein offers an immediately understandable media result with a manageable first sequence. Ramsey Frontier demonstrates independent search with objective verification.

## Additional primary sources checked October 20, 2026

- [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright): usable map data requires attribution and ODbL compliance. Open data does not imply free unlimited hosted map services.
- [Godot MultiMesh documentation](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html): instancing and spatially divided batches are relevant to large environments. Asset count alone does not guarantee interactive performance.
- [Carnegie Mellon presentation on R(5,5), March 2026](https://www.cs.rit.edu/~spr/COURSES/CCOMP/srg_r55.pdf): a concrete graph construction and SAT search target. Recheck the frontier before a research campaign.
- [Frankenstein source text](https://www.gutenberg.org/ebooks/84): Project Gutenberg lists its text as public domain in the USA. Release territories and modern adaptation designs require separate consideration.
- [Netflix on Keishi Otomo and existing Kenshin live-action films](https://about.netflix.com/en/news/10dance-streams-2025).
- [Authorized HPMOR mirror](https://hpmor.com/): confirms the work and its completed serial form. An authorized text mirror does not establish film adaptation permission.
- [All the Young Dudes original work page](https://archiveofourown.org/works/10057010): identified as an adaptation prospect; the research browser could not retrieve the page, so no popularity ranking or adaptation permission is claimed.
- [Towards a Science of Scaling Agent Systems, latest revision](https://arxiv.org/abs/2512.08296): the revision reports 260 configurations, rather than the earlier 180. Architectural benefits depend on task structure.
- [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) and [Cursor scaling experiments](https://cursor.com/blog/scaling-agents): bounded delegated work and explicit verification are useful precedents; their results do not establish a universal topology for heterogeneous community machines.
