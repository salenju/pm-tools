<script setup>
import { onBeforeUnmount, onMounted } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  maxWidth: { type: String, default: 'max-w-lg' },
  closable: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

function onKeydown(event) {
  if (event.key === 'Escape' && props.closable) emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div
        class="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        :class="maxWidth"
      >
        <div class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 class="text-base font-semibold text-slate-900">{{ title }}</h2>
          <button
            v-if="closable"
            type="button"
            class="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-4 py-4">
          <slot />
        </div>

        <div v-if="$slots.footer" class="border-t border-slate-200 bg-slate-50 px-4 py-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
