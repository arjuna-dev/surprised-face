import type { HordeInput, HordeRole, BudgetUnit } from '../../src/lib/hordes';
import { hordeIdeas } from '../../src/lib/horde-ideas';
import { canEditHorde, hordeStrategies, hordeCoverKeys } from '../../src/lib/hordes';

type Row = { id: string; data: string; creator: string; deleted_at: string | null };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (message: string, status = 400): never => {
  throw Object.assign(new Error(message), { status });
};
const str = (value: unknown, max: number, label: string, required = false): string => {
  if (typeof value !== 'string') {
    if (required) fail(`${label} is required.`);
    return '';
  }
  const text = value.trim();
  if ((required && !text) || text.length > max)
    fail(`${label} must contain ${required ? '1' : '0'} to ${max} characters.`);
  return text;
};
function coverImage(raw: unknown): string {
  const value = str(raw, 170000, 'Cover image');
  if (!value)
    return hordeCoverKeys[crypto.getRandomValues(new Uint32Array(1))[0]! % hordeCoverKeys.length]!;
  if ((hordeCoverKeys as readonly string[]).includes(value)) return value;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (value.length <= 2000 && url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    /* Report the allowed formats below. */
  }
  return fail('Choose a PNG, JPEG or WebP image, or an HTTPS image URL.');
}
function projectInput(raw: Record<string, unknown>): HordeInput {
  const repositoryUrl = str(raw.repositoryUrl, 300, 'GitHub repository');
  if (repositoryUrl && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repositoryUrl))
    fail('Use a GitHub repository URL such as https://github.com/owner/repository.');
  const strategy = (raw.strategy || {}) as Record<string, unknown>;
  const id = typeof strategy.id === 'string' ? strategy.id : 'plan-build-verify';
  if (!hordeStrategies.some((item) => item.id === id))
    fail('Choose a supported orchestration strategy.');
  const parallelism = strategy.parallelism === undefined ? 3 : Number(strategy.parallelism);
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 32)
    fail('Parallel work limit must be between 1 and 32.');
  if (raw.skills !== undefined && !Array.isArray(raw.skills)) fail('Skills must be a list.');
  const rawSkills = (raw.skills || []) as Record<string, unknown>[];
  if (rawSkills.length > 20) fail('Use at most 20 project skills.');
  const skills = rawSkills.map((skill) => {
    if (
      !skill ||
      typeof skill !== 'object' ||
      !Array.isArray(skill.tools) ||
      skill.tools.length > 20
    )
      fail('Each skill needs a tools list.');
    return {
      name: str(skill.name, 80, 'Skill name', true),
      instructions: str(skill.instructions, 8000, 'Skill instructions', true),
      tools: (skill.tools as unknown[]).map((tool) => str(tool, 100, 'Tool', true)),
    };
  });
  return {
    name: str(raw.name, 100, 'Project name', true),
    summary: str(raw.summary, 6000, 'Project goal', true),
    category: str(raw.category, 50, 'Category') || 'Other',
    repositoryUrl,
    coverImage: coverImage(raw.coverImage),
    strategy: { id, parallelism },
    skills,
  };
}
export class HordeStore {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS horde_projects (id TEXT PRIMARY KEY, creator TEXT NOT NULL, data TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE IF NOT EXISTS horde_members (project_id TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(project_id,member_id));
      CREATE TABLE IF NOT EXISTS horde_budgets (project_id TEXT NOT NULL, member_id TEXT NOT NULL, unit TEXT NOT NULL, amount REAL NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,member_id,unit));
      CREATE TABLE IF NOT EXISTS horde_messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, member_id TEXT NOT NULL, client_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,member_id,client_id));`);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handle(request);
    } catch (error) {
      return reply(
        { error: error instanceof Error ? error.message : 'Horde request failed.' },
        Number((error as { status?: number }).status) || 400,
      );
    }
  }
  private seedProjects(): void {
    const curator =
      this.sql
        .exec<{
          id: string;
        }>("SELECT id FROM members WHERE role='owner' ORDER BY created_at LIMIT 1")
        .toArray()[0]?.id || 'surprised-face-curator';
    const names = [
      'Earth Commons',
      'The Living Archive',
      'The Last City',
      'Frankenstein: Mary Shelley’s Novel on Film',
      'The Five-Person Party Problem',
      'The Coral Cathedral',
      'Open Accessibility Corps',
      'Super Mario Bros. in 2.5D',
      'The Thousand-Voice Symphony',
    ];
    for (const [index, name] of names.entries()) {
      const idea = hordeIdeas.find((item) => item.name === name)!;
      const slug = idea.starterId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
      const id = `starter-${slug}`;
      const at = '2026-10-21T00:00:00.000Z';
      const summary = `${idea.pitch}\n\nFirst milestone: ${idea.first}\n\nWorking approach: ${idea.architecture}${idea.note ? `\n\n${idea.note}` : ''}`;
      const contributionSkill = {
        name: 'Contribution workflow',
        instructions: `Start with the first milestone: ${idea.first}\nAgree on a bounded task in the project discussion, keep artifacts in the linked repository when one is added, and submit reproducible evidence for independent review.\nSpecialties: ${idea.skills}`,
        tools: [] as string[],
      };
      const data = {
        name: idea.name,
        category: idea.category,
        summary,
        repositoryUrl: '',
        coverImage: hordeCoverKeys[index % hordeCoverKeys.length],
        strategy: { id: idea.strategy, parallelism: 3 },
        skills: [contributionSkill],
        revision: 1,
        createdAt: at,
        updatedAt: at,
      };
      const existing = this.sql.exec<Row>('SELECT * FROM horde_projects WHERE id=?', id).toArray()[0];
      if (!existing) {
        this.sql.exec(
          'INSERT INTO horde_projects (id,creator,data) VALUES (?,?,?)',
          id,
          curator,
          JSON.stringify(data),
        );
      } else {
        const current = JSON.parse(existing.data) as typeof data;
        // Refresh untouched starter copy while preserving any project edited by its community.
        if (current.revision === 1 && current.updatedAt === at) {
          const skills = [
            ...current.skills.filter((skill) => skill.name !== 'Contribution workflow'),
            { ...contributionSkill, tools: current.skills.find((skill) => skill.name === 'Contribution workflow')?.tools || [] },
          ];
          const changed =
            current.name !== data.name ||
            current.category !== data.category ||
            current.summary !== data.summary ||
            current.strategy.id !== data.strategy.id ||
            JSON.stringify(current.skills) !== JSON.stringify(skills);
          if (changed) {
            this.sql.exec(
              'UPDATE horde_projects SET data=? WHERE id=?',
              JSON.stringify({
                ...current,
                name: data.name,
                category: data.category,
                summary: data.summary,
                strategy: data.strategy,
                skills,
                revision: current.revision + 1,
                updatedAt: new Date().toISOString(),
              }),
              id,
            );
          }
        }
      }
      // A fresh public deployment may be visited before workspace bootstrap.
      if (curator !== 'surprised-face-curator') {
        this.sql.exec(
          "UPDATE horde_projects SET creator=? WHERE id=? AND creator='surprised-face-curator'",
          curator,
          id,
        );
        const owner = this.sql
          .exec<{ creator: string }>('SELECT creator FROM horde_projects WHERE id=?', id)
          .toArray()[0]?.creator;
        if (owner === curator)
          this.sql.exec(
            'INSERT OR IGNORE INTO horde_members VALUES (?,?,?)',
            id,
            curator,
            'warchief',
          );
      }
    }
  }
  private role(id: string, actor: string): HordeRole | null {
    return (
      this.sql
        .exec<{
          role: HordeRole;
        }>('SELECT role FROM horde_members WHERE project_id=? AND member_id=?', id, actor)
        .toArray()[0]?.role || null
    );
  }
  private view(row: Row, actor: string) {
    const totals: Record<BudgetUnit, number> = { tokens: 0, usd: 0, gpu_hours: 0 };
    for (const budget of this.sql
      .exec<{
        unit: BudgetUnit;
        amount: number;
      }>(
        'SELECT unit,SUM(amount) AS amount FROM horde_budgets WHERE project_id=? GROUP BY unit',
        row.id,
      )
      .toArray())
      totals[budget.unit] = budget.amount;
    return {
      ...JSON.parse(row.data),
      id: row.id,
      createdBy: row.creator,
      deletedAt: row.deleted_at,
      myRole: this.role(row.id, actor),
      memberCount:
        this.sql
          .exec<{ n: number }>('SELECT COUNT(*) AS n FROM horde_members WHERE project_id=?', row.id)
          .toArray()[0]?.n || 0,
      totals,
    };
  }
  private detail(row: Row, actor: string) {
    const project = this.view(row, actor);
    const members = project.myRole
      ? this.sql
          .exec(
            'SELECT m.member_id AS id,p.name,m.role FROM horde_members m JOIN members p ON p.id=m.member_id WHERE m.project_id=? ORDER BY p.name',
            row.id,
          )
          .toArray()
      : [];
    const budgets = project.myRole
      ? this.sql
          .exec(
            'SELECT b.member_id AS memberId,p.name,b.unit,b.amount,b.updated_at AS updatedAt FROM horde_budgets b JOIN members p ON p.id=b.member_id WHERE b.project_id=? ORDER BY p.name',
            row.id,
          )
          .toArray()
      : [];
    const messages = project.myRole
      ? this.sql
          .exec(
            'SELECT * FROM (SELECT m.id,m.rowid AS messageSeq,m.member_id AS memberId,p.name,m.text,m.created_at AS createdAt FROM horde_messages m JOIN members p ON p.id=m.member_id WHERE m.project_id=? ORDER BY m.rowid DESC LIMIT 300) ORDER BY messageSeq',
            row.id,
          )
          .toArray()
      : [];
    return { project, members, budgets, messages };
  }
  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const actor = request.headers.get('x-actor-id') || '';
    const publicRead =
      request.method === 'GET' &&
      !url.searchParams.has('deleted') &&
      /^\/hordes(?:\/[^/]+)?$/.test(url.pathname);
    if (!actor && !publicRead) return reply({ error: 'Sign in first.' }, 401);
    this.seedProjects();
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[1] || '';
    const action = parts[2] || '';
    const method = request.method;
    if (!id && method === 'GET') {
      const deleted = url.searchParams.get('deleted') === '1';
      const rows = this.sql
        .exec<Row>(
          deleted
            ? 'SELECT * FROM horde_projects WHERE deleted_at IS NOT NULL AND creator=? ORDER BY rowid DESC'
            : 'SELECT * FROM horde_projects WHERE deleted_at IS NULL ORDER BY rowid DESC',
          ...(deleted ? [actor] : []),
        )
        .toArray();
      return reply({ projects: rows.map((row) => this.view(row, actor)) });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(method)
      ? ((await request.json()) as Record<string, unknown>)
      : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected an object.');
    if (!id && method === 'POST') {
      const value = projectInput(body);
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      const data = JSON.stringify({ ...value, revision: 1, createdAt: at, updatedAt: at });
      this.sql.exec('INSERT INTO horde_projects (id,creator,data) VALUES (?,?,?)', id, actor, data);
      this.sql.exec('INSERT INTO horde_members VALUES (?,?,?)', id, actor, 'warchief');
      return reply(this.detail({ id, creator: actor, data, deleted_at: null }, actor), 201);
    }
    const row = this.sql.exec<Row>('SELECT * FROM horde_projects WHERE id=?', id).toArray()[0];
    if (!row || (row.deleted_at && !(action === 'restore' && row.creator === actor)))
      return reply({ error: 'Project not found.' }, 404);
    const role = this.role(id, actor);
    if (!action && method === 'GET') return reply(this.detail(row, actor));
    if (action === 'restore' && method === 'POST' && role === 'warchief')
      this.sql.exec('UPDATE horde_projects SET deleted_at=NULL WHERE id=?', id);
    else if (!action && method === 'DELETE') {
      if (role !== 'warchief')
        return reply({ error: 'Only the Horde Warchief can delete this project.' }, 403);
      this.sql.exec(
        'UPDATE horde_projects SET deleted_at=? WHERE id=?',
        new Date().toISOString(),
        id,
      );
      return reply({ ok: true });
    } else if (!action && method === 'PATCH') {
      if (!canEditHorde(role))
        return reply({ error: 'A Warchief or Warlord can edit this project.' }, 403);
      const existing = JSON.parse(row.data);
      if (body.revision !== existing.revision)
        return reply({ error: 'This project changed. Refresh before saving your edits.' }, 409);
      const value = projectInput({
        ...body,
        coverImage: body.coverImage === undefined ? existing.coverImage : body.coverImage,
      });
      row.data = JSON.stringify({
        ...existing,
        ...value,
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      this.sql.exec('UPDATE horde_projects SET data=? WHERE id=?', row.data, id);
    } else if (action === 'join' && method === 'POST') {
      this.sql.exec('INSERT OR IGNORE INTO horde_members VALUES (?,?,?)', id, actor, 'warrior');
    } else if (action === 'members' && method === 'PUT') {
      if (role !== 'warchief')
        return reply({ error: 'Only the Horde Warchief can change roles.' }, 403);
      const memberId = str(body.memberId, 100, 'Member ID', true);
      if (
        memberId === row.creator ||
        !['warlord', 'warrior', 'scout'].includes(String(body.role)) ||
        !this.role(id, memberId)
      )
        fail('Choose an existing collaborator and a valid role. The creator remains Warchief.');
      this.sql.exec(
        'UPDATE horde_members SET role=? WHERE project_id=? AND member_id=?',
        String(body.role),
        id,
        memberId,
      );
    } else if (action === 'budget' && method === 'PUT') {
      if (!role || role === 'scout' || (body.memberId && body.memberId !== actor))
        return reply({ error: 'Contributors can change only their own budgets.' }, 403);
      const amount = body.amount;
      const unit = body.unit;
      if (
        typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 1e12 ||
        !['tokens', 'usd', 'gpu_hours'].includes(String(unit)) ||
        (unit === 'tokens'
          ? !Number.isSafeInteger(amount)
          : Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)
      )
        fail('Enter a nonnegative budget with whole tokens or up to two decimals.');
      this.sql.exec(
        'INSERT INTO horde_budgets VALUES (?,?,?,?,?) ON CONFLICT(project_id,member_id,unit) DO UPDATE SET amount=excluded.amount,updated_at=excluded.updated_at',
        id,
        actor,
        String(unit),
        amount,
        new Date().toISOString(),
      );
    } else if (action === 'messages' && method === 'POST') {
      if (!role || role === 'scout')
        return reply({ error: 'Join as a contributor to write to this project.' }, 403);
      this.sql.exec(
        'INSERT OR IGNORE INTO horde_messages VALUES (?,?,?,?,?,?)',
        crypto.randomUUID(),
        id,
        actor,
        str(body.clientId, 100, 'Message ID', true),
        str(body.text, 16000, 'Message', true),
        new Date().toISOString(),
      );
    } else return reply({ error: 'Unsupported horde action.' }, 404);
    const fresh = this.sql.exec<Row>('SELECT * FROM horde_projects WHERE id=?', id).toArray()[0]!;
    return reply(this.detail(fresh, actor));
  }
}
