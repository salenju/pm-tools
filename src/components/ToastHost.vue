<script setup>
import { useUiStore } from '../stores/ui'

const ui = useUiStore()

const STYLES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-white text-slate-700',
}
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:top-4">
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg"
        :class="STYLES[toast.type] || STYLES.info"
      >
        <span class="flex-1 whitespace-pre-wrap break-words">{{ toast.message }}</span>
        <button
          type="button"
          class="shrink-0 rounded text-xs opacity-60 hover:opacity-100"
          aria-label="关闭提示"
          @click="ui.dismiss(toast.id)"
        >
          ✕
        </button>
      </div>
    </div>
  </Teleport>
</template>
