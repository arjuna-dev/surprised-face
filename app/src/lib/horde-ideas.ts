export type HordeIdea = {
  name: string;
  starterId?: string;
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
      'Turn the whole Earth into a walkable 3D world. Visit places you know, discover places you may never see in person, and explore the planet together.',
    first: 'A small walkable place with a recognizable street, a landmark, a patch of nature and one visit with a friend.',
    architecture:
      'Connect regions using one coordinate system and shared art rules. Test navigation, boundaries and loading before expanding.',
    strategy: 'spatial',
    skills: 'OSM ingestion, Blender terrain, glTF optimization, Godot networking',
    note: 'The goal is the entire Earth. The first place is a test slice, not the limit of the finished world.',
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
      'A co-op city-builder where you gather supplies, place homes and help residents rebuild a town one project at a time.',
    first: 'A ten-minute town-building loop: collect one resource, place three buildings and complete one resident request.',
    architecture:
      'Start with one map, a few buildings and one clear resource loop. Add residents and systems after playtests.',
    strategy: 'plan-build-verify',
    skills: 'Godot gameplay, simulation invariants, headless multiplayer testing',
    note: 'This starts with a familiar city-building loop instead of combining several large games at once.',
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
    name: 'Frankenstein: Mary Shelley’s Novel on Film',
    starterId: 'frankenstein-the-arctic-testimony',
    category: 'Film',
    pitch:
      'Adapt Mary Shelley’s novel into a Gothic film: Victor creates life, abandons the creature and faces the consequences as their story reaches the Arctic.',
    first:
      'AI writers draft a short scene from Mary Shelley’s novel. A human editor chooses and revises the screenplay before production.',
    architecture:
      'Approve the screenplay and character designs, produce one scene, then expand shot by shot with continuity and human editorial review.',
    strategy: 'production',
    skills: 'Screenplay breakdown, actor reference sheets, shot generation, dialogue, editing',
    source: 'https://www.gutenberg.org/ebooks/84',
    note: 'This is a new screenplay adaptation of Mary Shelley’s original novel, not a retelling of a recent film. AI contributors can draft options; a human editor directs and approves the script.',
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
    name: 'The Five-Person Party Problem',
    starterId: 'ramsey-frontier',
    category: 'Mathematics',
    pitch:
      'How large must a party be to guarantee five mutual friends or five mutual strangers? Current proofs place the answer between 43 and 46 people.',
    first:
      'Recreate a published 42-person counterexample and independently check every group of five before beginning a new search.',
    architecture:
      'Separate graph search, SAT encoding and independent certificate checking. Keep candidates reproducible and ask graph theorists to review any claimed bound.',
    strategy: 'search',
    skills: 'Graph search, SAT encoding, certificate verification, Lean',
    note: 'This was chosen as a math project with checkable evidence, not because a solution is likely. The 42-person example tests the checker and establishes the known lower bound before harder research. Planning estimate for reproducing and checking that known example only: 3 to 5 contributors and 100,000 to 500,000 model tokens in total, plus separate compute and expert review. A new bound has no credible token or contributor estimate. No breakthrough is promised.',
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
      'Build a playable underwater world where you can swim through coral reefs, meet sea life, explore caves and discover a city reclaimed by coral.',
    first: 'A short playable reef with swimming, fish, one cave and a small coral-covered ruin that runs smoothly on an agreed computer.',
    architecture:
      'Build one biome at a time with compatible art, then test how it looks and runs before adding more of the ocean.',
    strategy: 'spatial',
    skills: 'Blender geometry nodes, USD composition, LOD generation, profiling',
    note: 'The goal is an explorable underwater world. Millions of assets are not a target; the world should grow only while it remains beautiful and playable.',
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
  {
    name: 'Super Mario Bros. in 2.5D',
    category: 'Games',
    pitch:
      'Rebuild the original NES Super Mario Bros. as a 2.5D side-scrolling game: keep the familiar left-to-right play, but stage the world in 3D.',
    first:
      'Make one short level with classic running, jumping, enemies and collectibles, viewed through a 3D side-scrolling camera.',
    architecture:
      'Prototype one movement model, camera and level. Playtest whether the 3D depth adds something while the platforming stays clear.',
    strategy: 'plan-build-verify',
    skills: 'Godot gameplay, platformer physics, 3D environment art, playtest design',
    note: 'A public Mario project needs rights clearance. Without a license, use original characters, level designs and branding for a classic NES-inspired 2.5D platformer.',
    source: 'https://en-americas-support.nintendo.com/app/answers/detail/a_id/50035/',
  },
  {
    name: 'The Thousand-Voice Symphony',
    category: 'Music',
    pitch:
      'Imagine a many-hour symphony woven from hundreds or thousands of voices, microtonal harmonies, and instruments and traditions from across centuries and cultures.',
    first:
      'Compose a five-minute opening movement with 24 independent parts, a shared theme, microtonal tuning and stems that can be heard separately.',
    architecture:
      'A lead composer sets the theme and tuning language. Instrument and style teams write compatible passages; editors shape transitions and the final mix.',
    strategy: 'production',
    skills: 'Orchestration, microtonal theory, notation, digital audio workstations, mixing',
    note: 'Grow the scale in stages: first make a coherent, listenable ensemble across traditions and tunings, then expand its size and duration.',
  },
];
