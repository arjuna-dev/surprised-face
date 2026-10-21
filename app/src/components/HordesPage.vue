<template>
  <main ref="hordesRoot" class="hordes" aria-label="Hordes">
    <div class="horde-wrap">
      <div v-if="error" class="error" role="alert">
        {{ error }} <button :disabled="loading" @click="retry">Retry</button>
      </div>
      <template v-if="!detail">
        <header class="horde-intro">
          <img :src="hordeArt" alt="" class="hero-art" />
          <div class="hero-copy">
            <p class="eyebrow"><span class="hero-highlight">HORDE PROJECTS</span></p>
            <h1>
              <span class="hero-highlight">Build something big,</span><br />
              <span class="hero-highlight">together.</span>
            </h1>
            <p class="hero-description">
              <span class="hero-highlight">
                Find a project you want to be part of. Contribute with your agent. Help build
                something big.
              </span>
            </p>
          </div>
        </header>
        <div class="listing-heading">
          <div>
            <h2>Projects</h2>
            <p>
              Open projects from across the :o community. Join one to make your own contribution.
            </p>
            <button class="create-project" @click="connected ? create() : emit('signIn')">
              <Plus :size="14" /> Create project
            </button>
            <a
              v-if="publicUrl"
              class="public-link"
              :href="publicUrl"
              target="_blank"
              rel="noopener noreferrer"
              >View public page <ArrowUpRight :size="12"
            /></a>
          </div>
        </div>
        <div class="listing-tools">
          <label class="search"
            ><Search :size="15" /><input
              v-model="query"
              placeholder="Find a project"
              aria-label="Find a horde project"
          /></label>
          <div class="view-tools">
            <button class="icon" aria-label="Refresh projects" :disabled="loading" @click="refresh">
              <RefreshCw :size="15" />
            </button>
            <div class="view-switch" role="group" aria-label="Project layout">
              <button
                aria-label="List view"
                :aria-pressed="layout === 'list'"
                @click="setLayout('list')"
              >
                <List :size="16" />
              </button>
              <button
                aria-label="Card view"
                :aria-pressed="layout === 'cards'"
                @click="setLayout('cards')"
              >
                <LayoutGrid :size="16" />
              </button>
            </div>
          </div>
        </div>
        <p v-if="loading && !projects.length" role="status">Loading projects...</p>
        <div
          v-else
          :class="layout === 'list' ? 'project-list' : 'project-grid'"
          :aria-busy="loading"
        >
          <button
            v-for="project in filtered"
            :key="project.id"
            class="project-entry"
            :aria-label="`Open ${project.name}`"
            @click="open(project.id)"
          >
            <img
              :src="projectCover(project)"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @error="coverFallback($event, project.id)"
            />
            <span class="entry-copy"
              ><span class="entry-title">{{ project.name }}</span
              ><span class="entry-summary">{{ hordeExcerpt(project.summary) }}</span></span
            >
            <ArrowUpRight class="entry-arrow" :size="17" />
          </button>
        </div>
        <div v-if="!loading && !error && !filtered.length" class="empty">
          <h2>{{ query ? 'No matching projects' : 'No projects available yet' }}</h2>
          <p>{{ query ? 'Try a different search.' : 'Check back soon for community projects.' }}</p>
        </div>
      </template>
      <template v-else>
        <button class="back" @click="back"><ArrowLeft :size="16" /> All projects</button>
        <img
          class="project-cover"
          :src="projectCover(detail.project)"
          alt=""
          referrerpolicy="no-referrer"
          @error="coverFallback($event, detail.project.id)"
        />
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
            ><button
              v-if="!detail.project.myRole"
              class="primary"
              :disabled="busy"
              @click="connected ? join() : emit('signIn')"
            >
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
      return-focus=".hordes .create-project"
      @close="!busy && !imageLoading && (editor = false)"
    >
      <form class="horde-form" @submit.prevent="save">
        <p class="muted">
          Project names, goals, covers, skills and budget totals are public. Discussion is visible
          to project collaborators.
        </p>
        <div class="cover-editor">
          <img
            :src="projectCover({ id: editingId || draft.name, coverImage: draft.coverImage || '' })"
            alt="Project cover preview"
            referrerpolicy="no-referrer"
            @error="coverFallback($event, editingId)"
          />
          <label
            >Upload cover image<input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              :disabled="imageLoading"
              @change="uploadCover"
          /></label>
          <small>PNG, JPEG or WebP, up to 10 MB.</small>
          <label
            >Cover image URL<input
              v-model="coverUrl"
              type="url"
              placeholder="https://example.com/cover.webp"
              @input="draft.coverImage = ($event.target as HTMLInputElement).value"
          /></label>
          <button
            v-if="draft.coverImage"
            type="button"
            class="create-project"
            @click="
              draft.coverImage = '';
              coverUrl = '';
            "
          >
            Use a Horde illustration
          </button>
          <p v-if="imageLoading" role="status">Preparing cover...</p>
        </div>
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
          <button
            class="secondary"
            type="button"
            :disabled="busy || imageLoading"
            @click="editor = false"
          >
            Cancel</button
          ><button class="primary" :disabled="busy || imageLoading">
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
        The project will be removed from the public directory. Collaborators will no longer be able
        to open it.
      </p>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <button class="secondary" :disabled="busy" @click="confirmDelete = false">Cancel</button
        ><button class="danger" :disabled="busy" @click="remove">Delete project</button>
      </div></ChatDialog
    >
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowUpRight,
  Github,
  FolderGit2,
  Plus,
  RefreshCw,
  Search,
  List,
  LayoutGrid,
} from 'lucide-vue-next';
import ChatDialog from './ChatDialog.vue';
import hordeArt from '../assets/hordes/gathering.webp';
import { projectCover, defaultHordeCover } from '../lib/horde-covers';
import {
  budgetLabel,
  canEditHorde,
  hordeRoles,
  hordeStrategies,
  hordeExcerpt,
  type BudgetUnit,
  type HordeDetail,
  type HordeInput,
  type HordeProject,
} from '../lib/hordes';
const props = defineProps<{
  connected: boolean;
  memberId: string;
  transport?: {
    hordeRequest: (input: {
      action: string;
      projectId?: string;
      data?: unknown;
    }) => Promise<unknown>;
  };
  initialProjectId?: string;
  publicUrl?: string;
}>();
const emit = defineEmits<{ signIn: []; projectChange: [id: string | null] }>();
const api = props.transport || window.surprisedFace;
const hordesRoot = ref<HTMLElement | null>(null);
const projects = ref<HordeProject[]>([]);
const detail = ref<HordeDetail | null>(null);
const layout = ref<'list' | 'cards'>(
  localStorage.getItem('hordes-layout') === 'cards' ? 'cards' : 'list',
);
const failedProjectId = ref('');
const imageLoading = ref(false);
const coverUrl = ref('');
function setLayout(value: 'list' | 'cards'): void {
  layout.value = value;
  localStorage.setItem('hordes-layout', value);
}
const query = ref('');
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
  coverImage: '',
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
  'Music',
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
  })) as T;
}
let listVersion = 0;
let readVersion = 0;
async function refresh(): Promise<void> {
  const version = ++listVersion;
  loading.value = true;
  error.value = '';
  failedProjectId.value = '';
  try {
    const result = await request<{ projects: HordeProject[] }>('list');
    if (version === listVersion) projects.value = result.projects;
  } catch (e) {
    if (version === listVersion)
      error.value = /not found/i.test(errorText(e))
        ? 'The project directory is unavailable on this server. Please try again shortly.'
        : `Could not load the project directory. ${errorText(e)}`;
  } finally {
    if (version === listVersion) loading.value = false;
  }
}
async function open(id: string): Promise<void> {
  const version = ++readVersion;
  error.value = '';
  try {
    const result = await request<HordeDetail>('read', undefined, id);
    if (version === readVersion) {
      detail.value = result;
      failedProjectId.value = '';
      emit('projectChange', id);
    }
  } catch (e) {
    if (version === readVersion) {
      failedProjectId.value = id;
      error.value = `Could not open this project. ${errorText(e)}`;
    }
  }
}
async function reloadDetail(): Promise<void> {
  if (detail.value) await open(detail.value.project.id);
}
function back(): void {
  ++readVersion;
  detail.value = null;
  emit('projectChange', null);
  void refresh();
}
function navigateBackShortcut(event: KeyboardEvent): void {
  if (
    !event.metaKey ||
    event.key !== 'ArrowLeft' ||
    !detail.value ||
    editor.value ||
    budgetOpen.value ||
    confirmDelete.value ||
    busy.value ||
    !hordesRoot.value?.getClientRects().length
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  back();
}
function retry(): void {
  if (failedProjectId.value) void open(failedProjectId.value);
  else if (detail.value) void reloadDetail();
  else void refresh();
}
function create(): void {
  editingId.value = '';
  draft.value = emptyDraft();
  coverUrl.value = '';
  formError.value = '';
  editor.value = true;
}
function coverFallback(event: Event, id: string): void {
  const image = event.target as HTMLImageElement;
  const fallback = defaultHordeCover(id);
  if (image.getAttribute('src') !== fallback) image.src = fallback;
}
async function uploadCover(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  formError.value = '';
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  ) {
    formError.value = 'Choose a PNG, JPEG or WebP image up to 10 MB.';
    input.value = '';
    return;
  }
  imageLoading.value = true;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 900 / bitmap.width, 600 / bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let image = canvas.toDataURL('image/webp', 0.82);
    for (const quality of [0.65, 0.45, 0.25]) {
      if (image.length <= 160000) break;
      image = canvas.toDataURL('image/webp', quality);
    }
    if (image.length > 160000)
      throw new Error('This image is too detailed. Choose a smaller image.');
    draft.value.coverImage = image;
    coverUrl.value = '';
  } catch (e) {
    formError.value = `Could not use this cover. ${errorText(e)}`;
  } finally {
    bitmap?.close();
    imageLoading.value = false;
    input.value = '';
  }
}
function edit(): void {
  if (!detail.value) return;
  editingId.value = detail.value.project.id;
  draft.value = JSON.parse(JSON.stringify(detail.value.project));
  coverUrl.value = draft.value.coverImage?.startsWith('https://') ? draft.value.coverImage : '';
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
    if (version === readVersion) {
      detail.value = result;
      if (result?.project) emit('projectChange', result.project.id);
    }
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
  if (imageLoading.value) return;
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
    emit('projectChange', null);
    await refresh();
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const focusRefresh = () => {
  if (!editor.value && !budgetOpen.value && !busy.value) {
    if (detail.value) void reloadDetail();
    else void refresh();
  }
};
watch(
  () => props.connected,
  (connected) => {
    if (connected) void refresh();
  },
);
watch(
  () => props.initialProjectId,
  (id) => {
    if (id && id !== detail.value?.project.id) void open(id);
    else if (!id && detail.value) back();
  },
);
onMounted(() => {
  void refresh();
  if (props.initialProjectId) void open(props.initialProjectId);
  window.addEventListener('focus', focusRefresh);
  window.addEventListener('keydown', navigateBackShortcut, true);
});
onUnmounted(() => {
  window.removeEventListener('focus', focusRefresh);
  window.removeEventListener('keydown', navigateBackShortcut, true);
});
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
  position: relative;
  isolation: isolate;
  min-height: 255px;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  padding: 24px 28px;
  background: var(--panel);
}
.horde-intro .hero-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 47%;
  opacity: 1;
  z-index: -1;
}
.hero-copy {
  max-width: 550px;
  padding: 0;
  background: transparent;
}
.hero-highlight {
  background: #fff;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  padding: 0.08em 0.2em;
}
.hero-copy p:last-child {
  max-width: 450px;
  font-size: 14px;
  margin-bottom: 0;
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
.listing-heading {
  margin: 32px 0 20px;
}
.listing-heading h2 {
  margin: 0;
  font-size: 20px;
}
.listing-heading p {
  color: var(--muted);
  font-size: 13px;
  margin: 8px 0 10px;
}
.create-project {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 0;
  padding: 2px 0;
  font-size: 12px;
  color: var(--muted);
}
.public-link {
  margin-left: 20px;
  font-size: 12px;
  color: var(--muted);
}
.create-project:hover {
  color: var(--text);
  text-decoration: underline;
}
.listing-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 9px 12px;
  background: var(--panel);
  width: min(320px, 100%);
  min-width: 0;
}
.search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 12px;
}
.view-tools {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}
.view-switch {
  display: flex;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 3px;
  background: var(--panel);
}
.view-switch button {
  display: grid;
  place-items: center;
  border: 0;
  padding: 5px 7px;
  border-radius: 3px;
  background: transparent;
  color: var(--muted);
}
.view-switch button[aria-pressed='true'] {
  background: var(--panel-soft);
  color: var(--text);
}
.project-entry {
  min-width: 0;
  padding: 0;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  text-align: left;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  transition: border-color 120ms;
}
.project-entry:hover {
  border-color: var(--muted);
}
.entry-copy {
  display: block;
  min-width: 0;
}
.entry-title {
  display: block;
  font-size: 16px;
  line-height: 1.4;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.entry-summary {
  display: block;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.entry-arrow {
  color: var(--muted);
  flex-shrink: 0;
}
.project-list {
  display: grid;
  gap: 8px;
}
.project-list .project-entry {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 18px 12px 12px;
}
.project-list .project-entry img {
  width: 96px;
  height: 74px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}
.project-list .entry-copy {
  flex: 1;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(235px, 100%), 1fr));
  gap: 16px;
}
.project-grid .project-entry {
  display: flex;
  flex-direction: column;
}
.project-grid .project-entry img {
  width: 100%;
  height: 128px;
  object-fit: cover;
  border-bottom: 1px solid var(--line);
}
.project-grid .entry-copy {
  padding: 15px 16px 18px;
}
.project-grid .entry-title {
  font-size: 15px;
}
.project-grid .entry-arrow {
  display: none;
}
.project-cover {
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 7px;
  margin-bottom: 24px;
}
.cover-editor {
  display: grid;
  gap: 10px;
}
.cover-editor img {
  width: 100%;
  height: 125px;
  object-fit: cover;
  border-radius: 4px;
}
@media (prefers-reduced-motion: reduce) {
  .project-entry {
    transition: none;
  }
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
@media (max-width: 1100px) {
  .horde-wrap {
    padding: 24px;
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
  .horde-intro {
    padding: 24px;
    min-height: 230px;
  }
  .project-list .project-entry {
    gap: 12px;
    padding: 10px;
  }
  .project-list .project-entry img {
    width: 62px;
    height: 70px;
  }
  .entry-arrow {
    display: none;
  }
  .view-tools {
    gap: 8px;
  }
  h1 {
    font-size: 30px;
  }
}
</style>
