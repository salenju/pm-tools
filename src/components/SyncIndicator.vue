<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { SYNC_STATUS, STALE_SYNC_MINUTES } from '../constants/enums'
import { relativeTime } from '../utils/time'

/*
 * PRD FR-15 同步状态指示器：
 * 展示最后同步时间，超阈值转警示色，提供手动刷新，离线时明确标识。
 */
const workspace = useWorkspaceStore()

const now = ref(Date.now())
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 20000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const syncing = computed(() => workspace.syncStatus === SYNC_STATUS.SYNCING)
const failed = computed(() => workspace.syncStatus === SYNC_STATUS.ERROR)

const minutesSince = computed(() => {
  if (!workspace.lastSyncAt) return Number.POSITIVE_INFINITY
  return (now.value - new Date(workspace.lastSyncAt).getTime()) / 60000
})

const isStale = computed(() => minutesSince.value > STALE_SYNC_MINUTES)

const label = computed(() => {
  if (!workspace.online) return '离线，显示本地缓存'
  if (syncing.value) return '正在同步…'
  if (failed.value) return `同步失败：${workspace.syncError || '未知错误'}`
  if (!workspace.lastSyncAt) return '尚未同步'
  return `最后同步 ${relativeTime(workspace.lastSyncAt, now.value)}`
})

const tone = computed(() => {
  if (!workspace.online) return 'text-amber-700 bg-amber-50 border-amber-200'
  if (failed.value) return 'text-rose-700 bg-rose-50 border-rose-200'
  if (syncing.value) return 'text-sky-700 bg-sky-50 border-sky-200'
  if (isStale.value) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-slate-600 bg-white border-slate-200'
})

const canRefresh = computed(() => workspace.online && !syncing.value)

function refresh() {
  if (canRefresh.value) workspace.sync()
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      class="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex"
      :class="tone"
      :title="label"
    >
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="{
          'bg-emerald-500': !failed && !syncing && workspace.online && !isStale,
          'bg-amber-500': workspace.online && (isStale || !workspace.online),
          'bg-rose-500': failed,
          'bg-sky-500 animate-pulse': syncing,
        }"
      />
      {{ label }}
    </span>

    <button
      type="button"
      class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
      :disabled="!canRefresh"
      @click="refresh"
    >
      刷新
    </button>
  </div>
</template>
