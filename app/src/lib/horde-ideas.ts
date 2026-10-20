export type HordeIdea = {
  name: string;
  category: string;
  pitch: string;
  first: string;
  architecture: string;
  strategy: string;
  skills: string;
  note?: string;
  source?: string;
};
export const hordeIdeas: HordeIdea[] = [
  {
    name: 'Earth Commons',
    category: 'Worlds',
    pitch:
      'A shared, walkable Earth where every district is built by a different group, with persistent places to meet and play.',
    first: 'One 1 km² district, shared avatars, ten landmarks and seamless adjacent tiles.',
    architecture:
      'Spatial partitions, shared coordinates and asset contracts, seam checks, then multiplayer integration.',
    strategy: 'spatial',
    skills: 'OSM ingestion, Blender terrain, glTF optimization, Godot networking',
    note: 'Distributed compute helps production. Source data, storage, streaming and moderation also limit scale.',
    source: 'https://www.openstreetmap.org/copyright',
  },
  {
    name: 'The Living Archive',
    category: 'Worlds',
    pitch:
      'Walk through Alexandria, Tenochtitlan and Edo at their height, with every reconstructed building linked to evidence.',
    first: 'One historically sourced street with a visible uncertainty layer.',
    architecture:
      'Research and reconstruction teams per place, source review, then world assembly.',
    strategy: 'spatial',
    skills: 'Historical sourcing, procedural architecture, provenance review',
  },
  {
    name: 'The Last City',
    category: 'Games',
    pitch:
      'An original multiplayer world combining Dwarf Fortress depth, Factorio logistics and Zelda-like exploration. Players rebuild a city whose economy and history persist.',
    first: 'A cooperative island with a 30-minute building and exploration loop.',
    architecture:
      'Subsystem teams with fixed APIs, simulation tests, playtest feedback and integration milestones.',
    strategy: 'plan-build-verify',
    skills: 'Godot gameplay, simulation invariants, headless multiplayer testing',
  },
  {
    name: 'A Billion Worlds',
    category: 'Games',
    pitch:
      'A space exploration game where contributors build distinct planets, ecosystems and stories within one coherent universe.',
    first: 'Three planets, one ship and a shared exploration progression.',
    architecture: 'Planet teams work independently against engine, art and quest contracts.',
    strategy: 'spatial',
    skills: 'Procedural ecosystems, terrain generation, asset budgets, quest validation',
  },
  {
    name: 'Frankenstein: The Arctic Testimony',
    category: 'Film',
    pitch:
      'A 25-minute photoreal Gothic film, framed by Walton finding the creature in the Arctic, with original synthetic actors and a consistent visual language.',
    first:
      'A 90-second Arctic rescue sequence with four shots, original score and one consistent actor.',
    architecture:
      'Story bible, character and set approvals, parallel shot production, continuity review and editorial assembly.',
    strategy: 'production',
    skills: 'Screenplay breakdown, actor reference sheets, shot generation, dialogue, editing',
    source: 'https://www.gutenberg.org/ebooks/84',
    note: 'Use Shelley’s source text and original designs; check source rights in release territories.',
  },
  {
    name: 'Kenshin: A New Lens',
    category: 'Film',
    pitch:
      'A licensed reinterpretation of the Kyoto arc using photoreal synthetic actors and deliberately choreographed action.',
    first: 'An original 60-second proof of visual style after rights clearance.',
    architecture:
      'Sequence teams, a shared character bible, fight continuity and director approvals.',
    strategy: 'production',
    skills: 'Action previsualization, character continuity, camera planning',
    note: 'Rurouni Kenshin already has live-action films. This is a new adaptation concept requiring permission.',
    source: 'https://about.netflix.com/en/news/10dance-streams-2025',
  },
  {
    name: 'Methods of Rationality',
    category: 'Film',
    pitch:
      'Adapt Harry Potter and the Methods of Rationality into a carefully paced dramatic series, beginning with a pilot about investigating magic scientifically.',
    first: 'A licensed pilot treatment and a short original visual test.',
    architecture:
      'Season-level story planning, episode teams, canon and character continuity review.',
    strategy: 'production',
    skills: 'Long-form adaptation, continuity graph, episodic screenwriting',
    note: 'Fanfiction and underlying franchise adaptation permissions are separate.',
    source: 'https://hpmor.com/',
  },
  {
    name: 'All the Young Dudes',
    category: 'Film',
    pitch:
      'A character-led limited-series adaptation of the Marauders fanfiction, with a shared performance and continuity bible.',
    first: 'A rights-cleared series treatment and one short scene.',
    architecture:
      'Writers room plus episode teams, with central continuity and editorial approval.',
    strategy: 'production',
    skills: 'Adaptation, character arcs, production design',
    note: 'A fanfiction adaptation prospect, not an authorized production.',
    source: 'https://archiveofourown.org/works/10057010',
  },
  {
    name: 'The Incal: A Cinematic Atlas',
    category: 'Film',
    pitch:
      'A licensed comic-to-film project that turns the vertical city into a reusable 3D set and develops a coherent cinematic visual language.',
    first: 'A licensed concept trailer and one reusable city block.',
    architecture:
      'Asset teams build the city while sequence teams develop scenes against approved designs.',
    strategy: 'production',
    skills: 'Comic adaptation, environment art, camera blocking',
    note: 'Requires adaptation rights before production.',
  },
  {
    name: 'Ramsey Frontier',
    category: 'Mathematics',
    pitch:
      'Attack R(5,5) with independent graph construction and SAT search, keeping candidates and certificates reproducible.',
    first:
      'Reproduce a known 42-vertex construction and independently verify every 5-vertex subset before any new search.',
    architecture:
      'Independent search branches, shared immutable candidates, deterministic checkers and expert mathematical review.',
    strategy: 'search',
    skills: 'Graph search, SAT encoding, certificate verification, Lean',
    note: 'A research attempt with uncertain outcome. Verify the current frontier before each search campaign.',
    source: 'https://www.cs.rit.edu/~spr/COURSES/CCOMP/srg_r55.pdf',
  },
  {
    name: 'Open City Car',
    category: 'Hardware',
    pitch:
      'Design an open, repairable compact electric vehicle as a complete digital engineering package.',
    first: 'A requirements baseline and simulated chassis, packaging and energy model.',
    architecture:
      'Subsystem teams for structure, energy, controls and manufacturing, with controlled interfaces and integration reviews.',
    strategy: 'systems',
    skills: 'Parametric CAD, FEA, requirements traceability, control simulation',
    note: 'Simulation and design evidence first; qualified engineers approve physical implementation.',
  },
  {
    name: 'Pocket Orbital Lab',
    category: 'Hardware',
    pitch:
      'A digital twin of a small research rocket and payload, connecting atmospheric simulation, telemetry and recovery planning.',
    first: 'A non-operational mission simulation and telemetry viewer using synthetic data.',
    architecture:
      'Subsystem models, uncertainty sweeps and integration gates with specialist human reviews.',
    strategy: 'systems',
    skills: 'Flight simulation, telemetry, uncertainty analysis',
    note: 'Concept and simulation only; physical flight needs specialist oversight and approvals.',
  },
  {
    name: 'The Coral Cathedral',
    category: '3D assets',
    pitch:
      'An enormous explorable underwater environment made of millions of coherent, instanced assets, with schools of life and architectural spaces.',
    first: 'One streaming environment with a 60-fps target on a specified reference machine.',
    architecture:
      'Asset families and spatial teams, deterministic naming, level-of-detail checks and performance gates.',
    strategy: 'spatial',
    skills: 'Blender geometry nodes, USD composition, LOD generation, profiling',
  },
  {
    name: 'Open Accessibility Corps',
    category: 'Software',
    pitch:
      'Make hundreds of open-source apps usable with keyboards and screen readers, returning reviewed fixes to their maintainers.',
    first:
      'Five consenting repositories with reproducible accessibility failures and reviewed PRs.',
    architecture:
      'Independent repository teams with local reproduction, separate review and maintainer acceptance.',
    strategy: 'plan-build-verify',
    skills: 'Accessibility audits, browser tests, patch review, maintainer handoff',
  },
];
