<template>
  <div class="public-app">
    <header class="public-header">
      <a href="/hordes/" class="brand" aria-label=":o projects">:o <span>/ surprised-face</span></a
      ><span>Hordes</span
      ><a
        href="https://github.com/arjuna-dev/surprised-face"
        target="_blank"
        rel="noopener noreferrer"
        >Get the app <ArrowUpRight :size="14"
      /></a>
    </header>
    <HordesPage
      :connected="false"
      member-id=""
      :transport="transport"
      :initial-project-id="projectId"
      @sign-in="showJoin = true"
      @project-change="navigate"
    />
    <ChatDialog
      v-if="showJoin"
      title="Build with the horde"
      return-focus=".hordes .create-project"
      @close="showJoin = false"
    >
      <p>
        Open the :o desktop app and sign in with Google to join projects, contribute a budget, and
        take part in discussions.
      </p>
      <p>You can browse all public projects here without an account.</p>
      <a
        href="https://github.com/arjuna-dev/surprised-face#readme"
        target="_blank"
        rel="noopener noreferrer"
        >Get the desktop app <ArrowUpRight :size="14"
      /></a>
    </ChatDialog>
  </div>
</template>
<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { ArrowUpRight } from 'lucide-vue-next';
import HordesPage from '../src/components/HordesPage.vue';
import ChatDialog from '../src/components/ChatDialog.vue';
const pathProject = () => location.pathname.replace(/^\/hordes\/?/, '').split('/')[0] || '';
const projectId = ref(pathProject());
const showJoin = ref(false);
const transport = {
  async hordeRequest(input: { action: string; projectId?: string }): Promise<unknown> {
    if (!['list', 'read'].includes(input.action))
      throw new Error('Sign in using the desktop app to contribute.');
    const response = await fetch(
      `/v1/hordes${input.action === 'read' ? `/${encodeURIComponent(input.projectId || '')}` : ''}`,
    );
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error('The project service is unavailable. Please try again shortly.');
    const body = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(body.error || `The project service returned ${response.status}.`);
    return body;
  },
};
function navigate(id: string | null): void {
  projectId.value = id || '';
  const path = `/hordes/${id ? encodeURIComponent(id) : ''}`;
  if (location.pathname !== path) history.pushState({}, '', path);
  document.title = id ? 'Horde project | :o' : 'Horde projects | :o';
}
const pop = () => {
  projectId.value = pathProject();
};
window.addEventListener('popstate', pop);
onUnmounted(() => window.removeEventListener('popstate', pop));
</script>
