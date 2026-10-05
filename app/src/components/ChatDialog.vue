<template>
  <dialog ref="dialog" class="chat-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @click="closeOnBackdrop" @keydown="keepFocus">
    <header class="dialog-heading">
      <h2 :id="titleId">{{ title }}</h2>
      <button type="button" class="dialog-close" aria-label="Close" @click="emit('close')"><X :size="18" /></button>
    </header>
    <div class="dialog-body"><slot /></div>
  </dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{ title: string; returnFocus: string }>();
const emit = defineEmits<{ close: [] }>();
const titleId = useId();
const dialog = ref<HTMLDialogElement | null>(null);
let trigger: HTMLElement | null = null;
let backdropPress = false;

function keepFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !dialog.value) return;
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]')]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function rememberPointer(event: PointerEvent): void {
  backdropPress = event.target === dialog.value && outsideDialog(event.clientX, event.clientY);
}
function outsideDialog(x: number, y: number): boolean {
  const bounds = dialog.value?.getBoundingClientRect();
  return Boolean(bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom));
}
function closeOnBackdrop(event: MouseEvent): void {
  if (backdropPress && event.target === dialog.value && outsideDialog(event.clientX, event.clientY)) emit('close');
  backdropPress = false;
}

onMounted(() => {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.addEventListener('pointerdown', rememberPointer);
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.removeEventListener('pointerdown', rememberPointer);
  dialog.value?.close();
  // Sharing a native chat replaces its header, so find the corresponding new action.
  const target = trigger?.isConnected ? trigger : document.querySelector<HTMLElement>(props.returnFocus);
  target?.focus();
});
</script>

<style scoped>
.chat-dialog {
  width: min(440px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  box-sizing: border-box;
  margin: auto;
  padding: 24px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font: 14px/1.5 Arial, sans-serif;
  box-shadow: 0 16px 50px #09152c33;
}
.chat-dialog::backdrop { background: #14203a66; }
.dialog-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dialog-heading h2 { margin: 0; font: 400 18px/1.5 Arial, sans-serif; letter-spacing: normal; }
.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.dialog-close:hover { background: var(--panel-soft); color: var(--text); }
.dialog-close:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.dialog-body { margin-top: 16px; }
</style>
