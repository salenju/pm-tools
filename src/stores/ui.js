import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 轻量吐司提示。 */
export const useUiStore = defineStore('ui', () => {
  const toasts = ref([])
  let seq = 0

  function push(message, type = 'info', duration = 4000) {
    const id = (seq += 1)
    toasts.value.push({ id, message: String(message ?? ''), type })
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  function dismiss(id) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return {
    toasts,
    push,
    dismiss,
    success: (message) => push(message, 'success', 3000),
    info: (message) => push(message, 'info', 4000),
    warn: (message) => push(message, 'warn', 5000),
    error: (message) => push(message, 'error', 7000),
  }
})
