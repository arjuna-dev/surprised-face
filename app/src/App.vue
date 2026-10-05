<template>
  <div v-if="viewError" class="recovery-view" role="alert">
    <div class="recovery-content">
      <span class="recovery-mark">:o</span>
      <h1>Something went wrong in this view.</h1>
      <p>Your chats and local files are still available. Return to the chat list to continue.</p>
      <button type="button" @click="recover">Return to chats</button>
      <details><summary>Error details</summary><pre>{{ viewError }}</pre></details>
    </div>
  </div>
  <router-view v-else :key="viewKey" />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';

const viewError = ref('');
const viewKey = ref(0);

onErrorCaptured((error) => {
  viewError.value = error instanceof Error ? error.message : String(error);
  console.error('Could not render the app view:', error);
  return false;
});

function recover(): void {
  viewKey.value += 1;
  viewError.value = '';
}
</script>

<style scoped>
.recovery-view {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f8f9fb;
  color: #263044;
  font-family: Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.recovery-content { width: min(100%, 460px); }
.recovery-mark { color: #2148b8; font-size: 40px; font-weight: 700; }
h1 { font-size: 24px; line-height: 1.25; }
p { line-height: 1.5; }
button {
  padding: 10px 14px;
  border: 1px solid #2148b8;
  background: #2148b8;
  color: #fff;
  cursor: pointer;
  font: inherit;
}
details { margin-top: 24px; }
summary { cursor: pointer; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
