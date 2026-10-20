export type HordeRole = 'warchief' | 'warlord' | 'warrior' | 'scout';
export type BudgetUnit = 'tokens' | 'usd' | 'gpu_hours';
export type HordeSkill = { name: string; instructions: string; tools: string[] };
export type HordeStrategy = { id: string; parallelism: number };
export type HordeInput = {
  name: string;
  summary: string;
  category: string;
  repositoryUrl: string;
  strategy: HordeStrategy;
  skills: HordeSkill[];
  revision?: number;
};
export type HordeProject = HordeInput & {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  myRole: HordeRole | null;
  memberCount: number;
  totals: Record<BudgetUnit, number>;
  deletedAt: string | null;
};
export type HordeMember = { id: string; name: string; role: HordeRole };
export type HordeBudget = {
  memberId: string;
  name: string;
  unit: BudgetUnit;
  amount: number;
  updatedAt: string;
};
export type HordeMessage = {
  id: string;
  messageSeq: number;
  memberId: string;
  name: string;
  text: string;
  createdAt: string;
};
export type HordeDetail = {
  project: HordeProject;
  members: HordeMember[];
  budgets: HordeBudget[];
  messages: HordeMessage[];
};
export const hordeRoles: { id: HordeRole; name: string; rights: string }[] = [
  {
    id: 'warchief',
    name: 'Horde Warchief',
    rights: 'Full project control, roles, deletion and restore.',
  },
  { id: 'warlord', name: 'Warlord', rights: 'Edit the project, repository, strategy and skills.' },
  { id: 'warrior', name: 'Warrior', rights: 'Contribute a budget and join project discussions.' },
  { id: 'scout', name: 'Scout', rights: 'Read the project and its discussions.' },
];
export const hordeStrategies = [
  {
    id: 'plan-build-verify',
    name: 'Plan, build, verify',
    description:
      'Default. A coordinator divides the goal into bounded tasks. Contributors choose independent work. A separate reviewer checks each result. A human accepts the integrated outcome.',
    stages: [
      'Define acceptance checks',
      'Plan bounded tasks',
      'Build in parallel',
      'Verify independently',
      'Integrate and accept',
    ],
  },
  {
    id: 'spatial',
    name: 'World sectors',
    description:
      'Divide a world into versioned tiles. Work in parallel with shared boundary and asset contracts, then validate seams and performance before assembly.',
    stages: [
      'Define world contracts',
      'Assign sectors',
      'Build tiles',
      'Check seams and performance',
      'Assemble world',
    ],
  },
  {
    id: 'production',
    name: 'Creative production',
    description:
      'Approve a story and style bible, then develop sequences in parallel. Continuity, editorial and human review connect the work into one film.',
    stages: [
      'Approve story and style',
      'Plan sequences',
      'Produce shots',
      'Review continuity',
      'Edit and approve',
    ],
  },
  {
    id: 'search',
    name: 'Search and verify',
    description:
      'Explore independent hypotheses with bounded experiments. Retain evidence, check candidates with reproducible tools, and send promising results for expert review.',
    stages: [
      'State the problem',
      'Explore hypotheses',
      'Run experiments',
      'Verify candidates',
      'Expert acceptance',
    ],
  },
  {
    id: 'systems',
    name: 'Systems engineering',
    description:
      'Freeze subsystem interfaces, explore designs in parallel, and integrate through simulation and specialist reviews. Physical builds require qualified human approval.',
    stages: [
      'Define requirements',
      'Freeze interfaces',
      'Design subsystems',
      'Simulate and review',
      'Human approval',
    ],
  },
] as const;
export const canEditHorde = (role: HordeRole | null): boolean =>
  role === 'warchief' || role === 'warlord';
export const budgetLabel = (unit: BudgetUnit): string =>
  ({ tokens: 'tokens', usd: 'USD', gpu_hours: 'GPU hours' })[unit];
