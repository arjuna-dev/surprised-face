<template>
  <main class="hordes" aria-label="Hordes">
    <div class="horde-wrap">
      <div v-if="error" class="error" role="alert">
        {{ error }} <button @click="refresh">Retry</button>
      </div>
      <template v-if="!detail">
        <header class="horde-intro">
          <div>
            <p class="eyebrow">BUILD SOMETHING BIG, TOGETHER</p>
            <h1>Horde projects</h1>
            <p>Bring your ideas, your skills, and the compute you choose to contribute.</p>
            <button class="primary" :disabled="!connected" @click="create()">
              <Plus :size="16" /> Create project
            </button>
          </div>
          <img :src="hordeArt" alt="A crowd of people and friendly robots gathered together" />
        </header>
        <form v-if="!connected" class="connect" @submit.prevent="register">
          <label>Your name<input v-model="name" required maxlength="80" /></label
          ><button class="primary" :disabled="busy">Create account</button>
          <p>An account lets you discover shared projects and contribute.</p>
        </form>
        <nav class="section-tabs" aria-label="Hordes views">
          <button :class="{ active: view === 'projects' }" @click="changeView('projects')">
            Projects</button
          ><button :class="{ active: view === 'ideas' }" @click="changeView('ideas')">
            Project ideas <span>{{ hordeIdeas.length }}</span></button
          ><button :class="{ active: view === 'trash' }" @click="changeView('trash')">Trash</button
          ><button class="refresh" :disabled="loading" @click="refresh">
            <RefreshCw :size="14" /> Refresh
          </button>
        </nav>
        <template v-if="view !== 'ideas'">
          <div class="listing-tools">
            <h2>{{ view === 'trash' ? 'Your deleted projects' : 'Explore the projects' }}</h2>
            <label class="search"
              ><Search :size="15" /><input
                v-model="query"
                placeholder="Find a project"
                aria-label="Find a horde project"
            /></label>
          </div>
          <p v-if="loading" role="status">Loading projects...</p>
          <div v-else class="project-grid">
            <article v-for="project in filtered" :key="project.id" class="project-card">
              <div class="card-top">
                <span class="category">{{ project.category }}</span
                ><span v-if="project.myRole" class="role">{{ roleName(project.myRole) }}</span>
              </div>
              <h2>
                <button
                  v-if="view !== 'trash'"
                  :aria-label="`Open ${project.name}`"
                  @click="open(project.id)"
                >
                  {{ project.name }}<ArrowUpRight :size="18" /></button
                ><template v-else>{{ project.name }}</template>
              </h2>
              <p class="card-summary">{{ project.summary }}</p>
              <p class="card-strategy">{{ strategyFor(project.strategy.id).name }}</p>
              <div class="card-bottom">
                <span
                  ><Users :size="14" /> {{ project.memberCount }}
                  {{ project.memberCount === 1 ? 'collaborator' : 'collaborators' }}</span
                ><span>{{ totalText(project) }}</span>
              </div>
              <button
                v-if="view === 'trash'"
                class="secondary"
                :disabled="busy"
                :aria-label="`Restore ${project.name}`"
                @click="restore(project.id)"
              >
                Restore project
              </button>
            </article>
          </div>
          <div v-if="!loading && !filtered.length" class="empty">
            <h2>
              {{
                view === 'trash'
                  ? 'No deleted projects'
                  : query
                    ? 'No matching projects'
                    : 'The first horde starts here.'
              }}
            </h2>
            <p>
              {{
                view === 'trash'
                  ? 'Deleted projects remain recoverable by their Warchief.'
                  : query
                    ? 'Try a different search.'
                    : 'Create a project, or find your next ambitious idea.'
              }}
            </p>
            <button
              v-if="view === 'projects' && !query"
              class="secondary"
              @click="changeView('ideas')"
            >
              Explore project ideas
            </button>
          </div>
        </template>
        <template v-else>
          <div class="listing-tools">
            <div>
              <h2>Big ideas. A first step for each.</h2>
              <p>Starting points for a horde. These are proposals, not active projects.</p>
            </div>
          </div>
          <div class="project-grid idea-grid">
            <article v-for="idea in hordeIdeas" :key="idea.name" class="project-card idea-card">
              <span class="category">{{ idea.category }}</span>
              <h2>{{ idea.name }}</h2>
              <p>{{ idea.pitch }}</p>
              <h3>First milestone</h3>
              <p>{{ idea.first }}</p>
              <h3>How the horde works</h3>
              <p>{{ idea.architecture }}</p>
              <p class="muted">Skills: {{ idea.skills }}</p>
              <p v-if="idea.note" class="idea-note">{{ idea.note }}</p>
              <a v-if="idea.source" :href="idea.source" target="_blank" rel="noopener noreferrer"
                >Source <ArrowUpRight :size="12" /></a
              ><button class="secondary" :disabled="!connected" @click="create(idea)">
                Start this project
              </button>
            </article>
          </div>
        </template>
      </template>
      <template v-else>
        <button class="back" @click="back"><ArrowLeft :size="16" /> All projects</button>
        <header class="project-header">
          <div>
            <p class="eyebrow">
              {{ detail.project.category }} / {{ roleName(detail.project.myRole) }}
            </p>
            <h1>{{ detail.project.name }}</h1>
            <p class="goal">{{ detail.project.summary }}</p>
            <a
              v-if="detail.project.repositoryUrl"
              :href="detail.project.repositoryUrl"
              target="_blank"
              rel="noopener noreferrer"
              ><Github :size="16" />
              {{ detail.project.repositoryUrl.replace('https://github.com/', '') }}
              <ArrowUpRight :size="14"
            /></a>
          </div>
          <div class="header-buttons">
            <button v-if="canEditHorde(detail.project.myRole)" class="secondary" @click="edit">
              Edit project</button
            ><button
              v-if="detail.project.myRole === 'warchief'"
              class="text-danger"
              @click="confirmDelete = true"
            >
              Delete project</button
            ><button v-if="!detail.project.myRole" class="primary" :disabled="busy" @click="join">
              Join this horde</button
            ><button
              class="icon"
              aria-label="Refresh project"
              :disabled="busy"
              @click="reloadDetail"
            >
              <RefreshCw :size="16" />
            </button>
          </div>
        </header>
        <div class="detail-grid">
          <div class="detail-main">
            <section>
              <div class="section-heading">
                <h2>Orchestration</h2>
                <span>{{ detail.project.strategy.parallelism }} parallel work slots</span>
              </div>
              <h3>{{ strategyFor(detail.project.strategy.id).name }}</h3>
              <p>{{ strategyFor(detail.project.strategy.id).description }}</p>
              <ol class="pipeline">
                <li
                  v-for="(stage, index) in strategyFor(detail.project.strategy.id).stages"
                  :key="stage"
                >
                  <span>{{ index + 1 }}</span
                  >{{ stage }}
                </li>
              </ol>
              <p class="muted">
                This is the project’s working strategy. Automatic task execution and custom strategy
                builders are planned. Joining or setting a budget does not start a harness.
              </p>
            </section>
            <section>
              <div class="section-heading">
                <h2>Project skills</h2>
                <span>{{ detail.project.skills.length }} skills</span>
              </div>
              <p v-if="!detail.project.skills.length" class="muted">
                Add specific instructions and tools when you edit the project.
              </p>
              <details v-for="(skill, i) in detail.project.skills" :key="i" class="skill">
                <summary>{{ skill.name }}</summary>
                <pre>{{ skill.instructions }}</pre>
                <p>Tools: {{ skill.tools.join(', ') || 'None specified' }}</p>
              </details>
              <p class="muted">
                Skills describe the intended workflow. Contributors review instructions and tool
                access before using them.
              </p>
            </section>
            <section>
              <div class="section-heading">
                <h2>Project discussion</h2>
                <span>Stored in :o</span>
              </div>
              <p v-if="!detail.project.myRole" class="muted">
                Join this project to read and take part in its discussion.
              </p>
              <template v-else
                ><p v-if="!detail.messages.length" class="muted">
                  Start the conversation with a goal, question, or useful finding.
                </p>
                <article
                  v-for="message in detail.messages"
                  :key="message.id"
                  class="discussion-message"
                >
                  <div>
                    <strong>{{ message.name }}</strong
                    ><time>{{ new Date(message.createdAt).toLocaleString() }}</time>
                  </div>
                  <p>{{ message.text }}</p>
                </article>
                <form
                  v-if="detail.project.myRole !== 'scout'"
                  class="discussion-form"
                  @submit.prevent="post"
                >
                  <label for="horde-message">Project message</label
                  ><textarea
                    id="horde-message"
                    v-model="message"
                    maxlength="16000"
                    placeholder="Share a finding or coordinate the work..."
                    required
                  /><button class="primary" :disabled="busy || !message.trim()">
                    Post message
                  </button>
                </form></template
              >
            </section>
          </div>
          <aside class="detail-side">
            <section>
              <h2>Contribute a budget</h2>
              <p>Dedicate capacity you control to this project.</p>
              <dl class="totals">
                <template v-for="unit in units" :key="unit"
                  ><dt>{{ budgetLabel(unit) }}</dt>
                  <dd>{{ format(detail.project.totals[unit]) }}</dd></template
                >
              </dl>
              <button
                v-if="detail.project.myRole && detail.project.myRole !== 'scout'"
                class="primary full"
                @click="openBudget"
              >
                Set my budget</button
              ><button
                v-else-if="!detail.project.myRole"
                class="primary full"
                :disabled="busy"
                @click="join"
              >
                Join to contribute
              </button>
              <p class="muted">
                Commitments only. No payment, token transfer, or automatic spend. You can update
                your own limits or set them to zero.
              </p>
              <div
                v-for="pledge in detail.budgets"
                :key="`${pledge.memberId}:${pledge.unit}`"
                class="pledge"
              >
                <span>{{ pledge.name }}</span
                ><strong>{{ format(pledge.amount) }} {{ budgetLabel(pledge.unit) }}</strong>
              </div>
            </section>
            <section>
              <h2>
                Collaborators <span>{{ detail.project.memberCount }}</span>
              </h2>
              <div v-for="member in detail.members" :key="member.id" class="member">
                <span class="member-avatar">{{ member.name.slice(0, 1).toUpperCase() }}</span>
                <div>
                  <strong>{{ member.name }}</strong
                  ><select
                    v-if="detail.project.myRole === 'warchief' && member.role !== 'warchief'"
                    :aria-label="`Role for ${member.name}`"
                    :value="member.role"
                    :disabled="busy"
                    @change="changeRole(member.id, ($event.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="role in hordeRoles.filter((r) => r.id !== 'warchief')"
                      :key="role.id"
                      :value="role.id"
                    >
                      {{ role.name }}
                    </option></select
                  ><small v-else>{{ roleName(member.role) }}</small>
                </div>
              </div>
              <details class="role-guide">
                <summary>What each role can do</summary>
                <p v-for="role in hordeRoles" :key="role.id">
                  <strong>{{ role.name }}</strong
                  ><br />{{ role.rights }}
                </p>
              </details>
            </section>
            <section class="storage-note">
              <FolderGit2 :size="20" />
              <h3>Code in Git. Conversation in :o.</h3>
              <p>
                Source code and local working copies belong in your repository. Project discussions,
                roles, budgets and skill definitions live in the shared database. Joining does not
                grant GitHub access.
              </p>
            </section>
          </aside>
        </div>
      </template>
    </div>
    <ChatDialog
      v-if="editor"
      :title="editingId ? 'Edit horde project' : 'Create horde project'"
      return-focus=".hordes .primary"
      @close="!busy && (editor = false)"
    >
      <form class="horde-form" @submit.prevent="save">
        <p class="muted">
          Projects are listed to signed-in people. Discussion is visible to project collaborators.
        </p>
        <label>Project name<input v-model="draft.name" maxlength="100" required /></label
        ><label
          >Project goal<textarea v-model="draft.summary" maxlength="6000" rows="3" required />
        </label>
        <div class="form-row">
          <label
            >Category<select v-model="draft.category">
              <option v-for="category in categories" :key="category">{{ category }}</option>
            </select></label
          ><label
            >Parallel work limit<input
              v-model.number="draft.strategy.parallelism"
              type="number"
              min="1"
              max="32"
              required
          /></label>
        </div>
        <label
          >GitHub repository<input
            v-model="draft.repositoryUrl"
            placeholder="https://github.com/owner/repository"
            type="url"
            pattern="https://github.com/[\w.\-]+/[\w.\-]+/?" /></label
        ><small>Optional. Chats and discussions stay in the :o database.</small
        ><label
          >Orchestration strategy<select v-model="draft.strategy.id">
            <option v-for="strategy in hordeStrategies" :key="strategy.id" :value="strategy.id">
              {{ strategy.name }}
            </option>
          </select></label
        >
        <p class="muted">{{ strategyFor(draft.strategy.id).description }}</p>
        <div class="section-heading">
          <h3>Project skills</h3>
          <button
            type="button"
            class="secondary"
            :disabled="draft.skills.length >= 20"
            @click="draft.skills.push({ name: '', instructions: '', tools: [] })"
          >
            Add skill
          </button>
        </div>
        <fieldset v-for="(skill, i) in draft.skills" :key="i">
          <legend>Skill {{ i + 1 }}</legend>
          <label>Skill name<input v-model="skill.name" maxlength="80" required /></label
          ><label
            >Skill instructions<textarea
              v-model="skill.instructions"
              maxlength="8000"
              rows="3"
              required
            /></label
          ><label
            >Tools<input
              :value="skill.tools.join(', ')"
              placeholder="Blender, Godot, pytest"
              @change="
                skill.tools = ($event.target as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              " /></label
          ><button class="text-danger" type="button" @click="draft.skills.splice(i, 1)">
            Remove skill
          </button>
        </fieldset>
        <p v-if="formError" class="error" role="alert">{{ formError }}</p>
        <div class="form-actions">
          <button class="secondary" type="button" :disabled="busy" @click="editor = false">
            Cancel</button
          ><button class="primary" :disabled="busy">
            {{ busy ? 'Saving...' : 'Save project' }}
          </button>
        </div>
      </form>
    </ChatDialog>
    <ChatDialog
      v-if="budgetOpen"
      title="Dedicate a budget"
      return-focus=".detail-side .primary"
      @close="!busy && (budgetOpen = false)"
      ><form class="horde-form" @submit.prevent="saveBudget">
        <p>This records your commitment. It does not charge you or start work.</p>
        <label
          >Budget unit<select v-model="budget.unit" @change="selectBudgetUnit">
            <option v-for="unit in units" :key="unit" :value="unit">{{ budgetLabel(unit) }}</option>
          </select></label
        ><label
          >Budget amount<input
            v-model.number="budget.amount"
            type="number"
            min="0"
            max="1000000000000"
            :step="budget.unit === 'tokens' ? '1' : '0.01'"
            required
        /></label>
        <p v-if="formError" class="error" role="alert">{{ formError }}</p>
        <button class="primary" :disabled="busy">Save commitment</button>
      </form></ChatDialog
    >
    <ChatDialog
      v-if="confirmDelete"
      title="Delete this project?"
      return-focus=".text-danger"
      @close="!busy && (confirmDelete = false)"
      ><p>
        The project will leave the offering. You can restore it from Trash, including its discussion
        and budgets.
      </p>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <button class="secondary" :disabled="busy" @click="confirmDelete = false">Cancel</button
        ><button class="danger" :disabled="busy" @click="remove">Move to trash</button>
      </div></ChatDialog
    >
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowUpRight,
  FolderGit2,
  Github,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-vue-next';
import ChatDialog from './ChatDialog.vue';
import hordeArt from '../../../imagery/assets/horde-front-facing-chatgpt.png';
import { hordeIdeas, type HordeIdea } from '../lib/horde-ideas';
import {
  budgetLabel,
  canEditHorde,
  hordeRoles,
  hordeStrategies,
  type BudgetUnit,
  type HordeDetail,
  type HordeInput,
  type HordeProject,
} from '../lib/hordes';
const props = defineProps<{ connected: boolean; memberId: string }>();
const emit = defineEmits<{ connected: [] }>();
const api = window.surprisedFace;
const projects = ref<HordeProject[]>([]);
const detail = ref<HordeDetail | null>(null);
const view = ref<'projects' | 'ideas' | 'trash'>('projects');
const query = ref('');
const name = ref('');
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const formError = ref('');
const message = ref('');
const editor = ref(false);
const editingId = ref('');
const confirmDelete = ref(false);
const budgetOpen = ref(false);
const emptyDraft = (): HordeInput => ({
  name: '',
  summary: '',
  category: 'Software',
  repositoryUrl: '',
  strategy: { id: 'plan-build-verify', parallelism: 3 },
  skills: [],
});
const draft = ref<HordeInput>(emptyDraft());
const units: BudgetUnit[] = ['tokens', 'usd', 'gpu_hours'];
const budget = ref<{ unit: BudgetUnit; amount: number }>({ unit: 'tokens', amount: 0 });
const categories = [
  'Software',
  'Worlds',
  'Games',
  'Film',
  'Mathematics',
  'Hardware',
  '3D assets',
  'Science',
  'Other',
];
const filtered = computed(() =>
  projects.value.filter((p) =>
    `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const format = (amount: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount || 0);
const roleName = (id: string | null) =>
  hordeRoles.find((r) => r.id === id)?.name || 'Open to contributors';
const strategyFor = (id: string) => hordeStrategies.find((s) => s.id === id) || hordeStrategies[0];
const totalText = (p: HordeProject) =>
  units
    .filter((u) => p.totals[u])
    .map((u) => `${format(p.totals[u])} ${budgetLabel(u)}`)
    .join(' · ') || 'Be the first to contribute';
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
async function request<T>(
  action: string,
  data?: unknown,
  projectId = detail.value?.project.id,
): Promise<T> {
  return (await api.hordeRequest({
    action,
    ...(projectId ? { projectId } : {}),
    ...(data === undefined ? {} : { data: JSON.parse(JSON.stringify(data)) }),
    deleted: view.value === 'trash',
  })) as T;
}
let listVersion = 0;
let readVersion = 0;
async function refresh(): Promise<void> {
  const version = ++listVersion;
  if (!props.connected) return;
  loading.value = true;
  error.value = '';
  try {
    const result = await request<{ projects: HordeProject[] }>('list');
    if (version === listVersion) projects.value = result.projects;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
async function open(id: string): Promise<void> {
  const version = ++readVersion;
  error.value = '';
  try {
    const result = await request<HordeDetail>('read', undefined, id);
    if (version === readVersion) detail.value = result;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function reloadDetail(): Promise<void> {
  if (detail.value) await open(detail.value.project.id);
}
function back(): void {
  ++readVersion;
  detail.value = null;
  void refresh();
}
function changeView(next: 'projects' | 'ideas' | 'trash'): void {
  view.value = next;
  query.value = '';
  if (next !== 'ideas') void refresh();
}
function create(idea?: HordeIdea): void {
  editingId.value = '';
  draft.value = emptyDraft();
  if (idea)
    Object.assign(draft.value, {
      name: idea.name,
      summary: `${idea.pitch}\n\nFirst milestone: ${idea.first}`,
      category: idea.category,
      strategy: { id: idea.strategy, parallelism: 3 },
    });
  formError.value = '';
  editor.value = true;
}
function edit(): void {
  if (!detail.value) return;
  editingId.value = detail.value.project.id;
  draft.value = JSON.parse(JSON.stringify(detail.value.project));
  formError.value = '';
  editor.value = true;
}
async function mutate(action: string, data?: unknown, id?: string): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  formError.value = '';
  error.value = '';
  try {
    const version = ++readVersion;
    const result = await request<HordeDetail>(action, data, id);
    if (version === readVersion) detail.value = result;
    return true;
  } catch (e) {
    formError.value = errorText(e);
    if (!editor.value && !budgetOpen.value && !confirmDelete.value) error.value = formError.value;
    return false;
  } finally {
    busy.value = false;
  }
}
async function save(): Promise<void> {
  if (
    await mutate(editingId.value ? 'update' : 'create', draft.value, editingId.value || undefined)
  )
    editor.value = false;
}
async function join(): Promise<void> {
  await mutate('join');
}
function selectBudgetUnit(): void {
  budget.value.amount =
    detail.value?.budgets.find((b) => b.memberId === props.memberId && b.unit === budget.value.unit)
      ?.amount || 0;
}
function openBudget(): void {
  budget.value.unit = 'tokens';
  selectBudgetUnit();
  formError.value = '';
  budgetOpen.value = true;
}
async function saveBudget(): Promise<void> {
  if (await mutate('budget', budget.value)) budgetOpen.value = false;
}
async function changeRole(memberId: string, role: string): Promise<void> {
  await mutate('members', { memberId, role });
}
let pendingMessage: { clientId: string; text: string } | null = null;
async function post(): Promise<void> {
  const text = message.value.trim();
  if (!text) return;
  if (pendingMessage?.text !== text) pendingMessage = { clientId: crypto.randomUUID(), text };
  if (await mutate('messages', pendingMessage)) {
    message.value = '';
    pendingMessage = null;
  }
}
async function remove(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await request('delete');
    confirmDelete.value = false;
    detail.value = null;
    await refresh();
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
async function restore(id: string): Promise<void> {
  if (await mutate('restore', {}, id)) {
    detail.value = null;
    await refresh();
  }
}
async function register(): Promise<void> {
  busy.value = true;
  try {
    await api.register(name.value.trim());
    emit('connected');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const focusRefresh = () => {
  if (!editor.value && !budgetOpen.value && !busy.value) {
    if (detail.value) void reloadDetail();
    else if (view.value !== 'ideas') void refresh();
  }
};
watch(
  () => props.connected,
  (connected) => {
    if (connected) void refresh();
  },
);
onMounted(() => {
  void refresh();
  window.addEventListener('focus', focusRefresh);
});
onUnmounted(() => window.removeEventListener('focus', focusRefresh));
</script>

<style scoped>
.hordes {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg);
  color: var(--text);
}
.horde-wrap {
  max-width: 1440px;
  margin: 0 auto;
  padding: 32px 44px 64px;
}
.horde-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
  min-height: 230px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 28px;
}
.horde-intro > div {
  max-width: 620px;
}
.horde-intro img {
  width: 300px;
  height: 210px;
  object-fit: cover;
  border-radius: 8px;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 1.6px;
  font-weight: 650;
  color: var(--muted);
  text-transform: uppercase;
}
h1 {
  font-size: 38px;
  line-height: 1.15;
  letter-spacing: -1.2px;
  margin: 12px 0 16px;
  font-weight: 650;
}
h2 {
  font-size: 19px;
  line-height: 1.3;
  font-weight: 600;
  margin: 0 0 14px;
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 14px 0 8px;
}
p {
  line-height: 1.6;
  margin: 8px 0 16px;
}
button,
input,
textarea,
select {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
a {
  color: var(--blue);
  text-decoration: none;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
a:hover {
  text-decoration: underline;
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 3px;
}
.primary,
.secondary,
.danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 5px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 550;
  border: 1px solid var(--line);
  background: var(--panel);
}
.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: var(--panel);
}
.danger {
  background: #b02d34;
  color: white;
  border-color: #b02d34;
}
.secondary:hover {
  background: var(--panel-soft);
}
.text-danger {
  color: #a82d35;
  background: none;
  border: 0;
  font-size: 12px;
}
.section-tabs {
  display: flex;
  gap: 24px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  margin-top: 24px;
}
.section-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  padding: 14px 0;
  color: var(--muted);
}
.section-tabs button.active {
  color: var(--text);
  border-bottom-color: var(--blue);
  font-weight: 600;
}
.section-tabs span {
  font-size: 11px;
  margin-left: 4px;
}
.section-tabs .refresh {
  margin-left: auto;
  display: flex;
  gap: 7px;
  align-items: center;
}
.listing-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin: 30px 0 20px;
}
.listing-tools h2 {
  margin: 0;
}
.listing-tools p {
  color: var(--muted);
  font-size: 13px;
}
.search {
  display: flex;
  align-items: center;
  gap: 6px;
}
.search input {
  width: 200px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}
.project-card {
  padding: 24px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 230px;
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 24px;
}
.category {
  color: var(--blue);
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 1px;
}
.role {
  font-size: 10px;
  color: var(--muted);
}
.project-card h2 button {
  padding: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  color: var(--text);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
}
.project-card h2 button:hover {
  color: var(--blue);
}
.card-summary {
  font-size: 14px;
  color: var(--muted);
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-strategy {
  font-size: 12px;
  margin-top: auto;
  padding-top: 20px;
}
.card-bottom {
  border-top: 1px solid var(--line);
  padding-top: 14px;
  font-size: 11px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  flex-wrap: wrap;
}
.card-bottom span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.empty {
  padding: 64px;
  text-align: center;
  color: var(--muted);
}
.empty h2 {
  color: var(--text);
}
.back {
  display: flex;
  gap: 7px;
  align-items: center;
  background: none;
  border: 0;
  padding: 0;
  color: var(--muted);
  margin-bottom: 25px;
}
.project-header {
  display: flex;
  gap: 32px;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  padding-bottom: 30px;
  margin-bottom: 30px;
}
.project-header > div:first-child {
  max-width: 800px;
}
.goal {
  white-space: pre-line;
  color: var(--muted);
}
.header-buttons {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.icon {
  padding: 8px;
  background: none;
  border: 1px solid var(--line);
  border-radius: 5px;
}
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 32px;
}
.detail-main section,
.detail-side section {
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel);
  margin-bottom: 24px;
}
.detail-side h2 span {
  font-size: 12px;
  color: var(--muted);
  margin-left: 6px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-heading > span {
  font-size: 11px;
  color: var(--muted);
}
.pipeline {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 8px;
  margin: 24px 0;
}
.pipeline li {
  flex: 1;
  font-size: 11px;
  border-top: 2px solid var(--blue);
  padding: 12px 5px 0;
}
.pipeline li span {
  display: block;
  color: var(--muted);
  font-size: 10px;
  margin-bottom: 7px;
}
.muted {
  font-size: 12px;
  color: var(--muted);
}
.skill {
  border-top: 1px solid var(--line);
  padding: 12px 0;
}
.skill summary {
  cursor: pointer;
  font-weight: 550;
}
.skill pre {
  white-space: pre-wrap;
  font: 12px/1.6 monospace;
}
.totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 10px;
}
.totals dt {
  font-size: 12px;
  color: var(--muted);
}
.totals dd {
  margin: 0;
  font-size: 23px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.full {
  width: 100%;
  margin: 12px 0 4px;
}
.pledge {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
  gap: 10px;
}
.member {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 16px 0;
}
.member-avatar {
  width: 32px;
  height: 32px;
  background: var(--blue-soft);
  color: var(--blue);
  display: grid;
  place-items: center;
  border-radius: 50%;
}
.member strong {
  font-size: 13px;
}
.member small {
  display: block;
  color: var(--muted);
  font-size: 11px;
}
.member select {
  display: block;
  font-size: 11px;
  border: 1px solid var(--line);
  background: var(--panel);
  max-width: 200px;
  padding: 3px;
}
.role-guide {
  font-size: 12px;
  color: var(--muted);
  margin-top: 24px;
}
.role-guide summary {
  cursor: pointer;
}
.storage-note p {
  font-size: 12px;
  color: var(--muted);
}
.discussion-message {
  border-top: 1px solid var(--line);
  padding: 14px 0;
}
.discussion-message > div {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  font-size: 12px;
}
.discussion-message time {
  font-size: 10px;
  color: var(--muted);
}
.discussion-message p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.discussion-form label {
  font-size: 12px;
}
.discussion-form textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--line);
  background: var(--bg);
  border-radius: 5px;
  margin: 8px 0 12px;
  min-height: 85px;
}
.horde-form {
  display: grid;
  gap: 14px;
}
.horde-form label,
.connect label {
  display: grid;
  gap: 6px;
  font-size: 12px;
}
.horde-form input,
.horde-form textarea,
.horde-form select,
.connect input {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 9px;
  font-size: 13px;
}
.horde-form small {
  font-size: 11px;
  color: var(--muted);
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.horde-form fieldset {
  display: grid;
  gap: 12px;
  border: 1px solid var(--line);
  padding: 12px;
  min-width: 0;
}
.horde-form legend {
  font-size: 11px;
  color: var(--muted);
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.error {
  background: var(--red-soft);
  color: var(--red);
  padding: 12px;
  font-size: 13px;
  margin-bottom: 12px;
  border-radius: 4px;
}
.error button {
  background: none;
  border: 0;
  text-decoration: underline;
  color: inherit;
}
.connect {
  padding: 24px;
  max-width: 440px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 7px;
  margin: 20px 0;
  display: grid;
  gap: 12px;
}
.idea-card h2 {
  font-size: 22px;
  margin-top: 18px;
}
.idea-card p {
  font-size: 13px;
}
.idea-card h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
}
.idea-note {
  border-left: 2px solid var(--line);
  padding-left: 12px;
  color: var(--muted);
  font-size: 11px !important;
}
.idea-card a {
  font-size: 11px;
  margin-bottom: 20px;
}
.idea-card > button {
  margin-top: auto;
}
.idea-grid {
  align-items: stretch;
}
@media (max-width: 1100px) {
  .horde-wrap {
    padding: 24px;
  }
  .horde-intro img {
    width: 230px;
  }
  .detail-grid {
    grid-template-columns: minmax(0, 1fr) 275px;
    gap: 20px;
  }
  .project-header {
    gap: 18px;
  }
  .header-buttons {
    max-width: 160px;
  }
}
@media (max-width: 780px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .horde-intro img {
    display: none;
  }
  .horde-wrap {
    padding: 20px;
  }
  .listing-tools {
    flex-wrap: wrap;
  }
  .project-header {
    flex-direction: column;
  }
  .pipeline {
    flex-wrap: wrap;
  }
  .pipeline li {
    min-width: 75px;
  }
  .section-tabs {
    gap: 18px;
  }
  h1 {
    font-size: 30px;
  }
}
</style>
