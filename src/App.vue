<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useSessionStore } from './stores/session'
import { useWorkspaceStore } from './stores/workspace'
import { useUiStore } from './stores/ui'
import { repoWebUrl } from './utils/repoUrl'
import SyncIndicator from './components/SyncIndicator.vue'
import ToastHost from './components/ToastHost.vue'
import ConflictResolver from './components/ConflictResolver.vue'

const session = useSessionStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()
const route = useRoute()

const NAV = [
  { name: 'kanban', label: '看板' },
  { name: 'projects', label: '项目' },
  { name: 'customers', label: '客户' },
  { name: 'todos', label: '待办' },
  { name: 'templates', label: '流程' },
]

const submitting = ref(false)

const showChrome = computed(() => session.isReady)

const pendingDrafts = computed(() => workspace.draftList)

const draftBannerVisible = computed(
  () => pendingDrafts.value.length > 0 && workspace.online && route.name !== 'setup',
)

/**
 * 连错仓库的全局告警。
 * config.json 存在但不是本工具的结构，说明 owner 很可能填错了 ——
 * 这是最隐蔽的风险（GitHub 不会报错，数据会被写进别人的仓库），
 * 所以要让它在任何页面都看得见，而不是只在设置页。
 */
const badRepoWarning = computed(
  () => workspace.configFileExists && !workspace.configShapeValid,
)

/** 公开仓库比连错仓库更严重：全部客户与项目数据对外可见。 */
const publicRepoWarning = computed(() => session.repoIsPublic)

const currentRepoUrl = computed(() => repoWebUrl(session.repoConfig.owner, session.repoConfig.repo))

// 首次连接后引导工作区启动：先读缓存秒开，再后台增量同步（PRD 7.9.2）
watch(
  () => session.isReady,
  async (ready) => {
    if (!ready) return
    if (!workspace.booted) await workspace.boot()
    else safeSync()
    // 数据仓库必须私有（PRD 1.3 / 第 9 章）。启动时就查一次，
    // 不能等用户主动进设置页才发现自己在公开仓库里放数据。
    session.refreshRepoInfo()
  },
  { immediate: true },
)

function safeSync() {
  if (session.isReady) workspace.sync()
}

function onVisibility() {
  if (document.visibilityState === 'visible') safeSync()
}

function onFocus() {
  safeSync()
}

function onOnline() {
  workspace.setOnline(true)
  ui.info('网络已恢复，正在同步…')
  safeSync()
}

function onOffline() {
  workspace.setOnline(false)
  ui.warn('已离线。修改会先存为草稿，联网后可一键补交。')
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})

async function submitDrafts() {
  submitting.value = true
  try {
    const results = await workspace.submitAllDrafts()
    const succeeded = results.filter((r) => r.ok).length
    const conflicted = results.filter((r) => r.conflict).length
    const failed = results.length - succeeded - conflicted
    if (succeeded) ui.success(`已提交 ${succeeded} 条离线修改。`)
    if (conflicted) ui.warn(`${conflicted} 条修改与他人冲突，请在弹出的窗口中处理。`)
    if (failed) ui.error(`${failed} 条提交失败，请稍后重试。`)
  } finally {
    submitting.value = false
  }
}

defineExpose({})
</script>

<template>
  <div class="flex min-h-full flex-col">
    <header
      v-if="showChrome"
      class="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur"
    >
      <div class="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
        <RouterLink to="/" class="flex shrink-0 items-center gap-2">
          <span class="grid h-7 w-7 place-items-center rounded-lg bg-slate-900 text-xs font-bold text-white">
            P
          </span>
          <span class="hidden text-sm font-semibold text-slate-900 sm:inline">pm-tools</span>
        </RouterLink>

        <nav class="thin-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
          <RouterLink
            v-for="item in NAV"
            :key="item.name"
            :to="{ name: item.name }"
            class="shrink-0 rounded-lg px-3 py-1.5 text-sm transition"
            :class="
              route.name === item.name ||
              (item.name === 'projects' && route.name === 'project-detail') ||
              (item.name === 'customers' && route.name === 'customer-detail')
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            "
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="flex shrink-0 items-center gap-2">
          <SyncIndicator />
          <!--
            当前数据仓库必须常驻可见：owner 填错时 GitHub 不会报任何错，
            工具会把数据静默写到别的仓库里。藏在 tooltip 里等于没法自查
            （手机上没有悬浮）。
          -->
          <RouterLink
            :to="{ name: 'setup', query: { force: '1' } }"
            class="flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2 py-1 text-xs transition hover:bg-slate-50"
            :class="badRepoWarning ? 'border-rose-300 text-rose-700' : 'border-slate-200 text-slate-600'"
            :title="`账号：${session.actorName}\n数据仓库：${session.repoLabel}\n点击可更换`"
          >
            <img
              v-if="session.user?.avatar_url"
              :src="session.user.avatar_url"
              alt=""
              class="h-5 w-5 shrink-0 rounded-full"
            />
            <span class="max-w-[6.5rem] truncate font-medium sm:max-w-[12rem]">
              {{ session.repoLabel || '未连接仓库' }}
            </span>
          </RouterLink>
        </div>
      </div>
    </header>

    <div
      v-if="publicRepoWarning"
      class="border-b border-rose-400 bg-rose-600 px-4 py-2 text-sm text-white"
    >
      <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2">
        <span>
          <strong>危险：数据仓库是公开的。</strong>
          任何人（包括搜索引擎）都能读到全部客户与项目数据。请立刻去 GitHub 把它改为 private。
        </span>
        <a
          :href="currentRepoUrl"
          target="_blank"
          rel="noopener"
          class="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-medium underline hover:bg-white/30"
        >
          打开仓库
        </a>
      </div>
    </div>

    <div v-if="badRepoWarning" class="border-b border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">
      <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2">
        <span>
          当前数据仓库
          <code class="rounded bg-white/70 px-1">{{ session.repoLabel }}</code>
          里的 config.json 不是 pm-tools 的结构，很可能<strong>连错仓库</strong>了。已阻止初始化，避免写入别人的仓库。
        </span>
        <RouterLink
          :to="{ name: 'setup', query: { force: '1' } }"
          class="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-rose-700"
        >
          去检查
        </RouterLink>
      </div>
    </div>

    <div
      v-if="draftBannerVisible"
      class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2">
        <span>
          有 <strong>{{ pendingDrafts.length }}</strong> 条离线修改尚未提交。
        </span>
        <button
          type="button"
          class="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
          :disabled="submitting"
          @click="submitDrafts"
        >
          {{ submitting ? '提交中…' : '立即提交' }}
        </button>
      </div>
    </div>

    <main class="flex-1">
      <RouterView />
    </main>

    <ConflictResolver />
    <ToastHost />
  </div>
</template>
