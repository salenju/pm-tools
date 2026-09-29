<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { getCurrentNode, getStaleDays, isClosed, isStale } from '../utils/flow'
import { formatDay, isDueTodayOrEarlier } from '../utils/time'

/*
 * PRD FR-20 我的待办（P1）。
 *
 * 待办来源（按 PRD 共三种）：
 *   1. 下次跟进日期到期   —— 已实现
 *   2. 节点停滞超期       —— 已实现
 *   3. 手动待办           —— 待实现（需要新增一份 todos 数据文件，涉及新的并发规则，
 *                            在对齐数据模型后再补，避免擅自引入新的文件类型）
 *
 * 说明：无后端，无法做微信/邮件推送（PRD R-03）。待办只在打开工具时可见。
 */
const router = useRouter()
const workspace = useWorkspaceStore()

const followUps = computed(() =>
  workspace.projectList
    .filter((p) => !isClosed(p) && isDueTodayOrEarlier(p.nextFollowUpAt))
    .sort((a, b) => String(a.nextFollowUpAt).localeCompare(String(b.nextFollowUpAt))),
)

const staleProjects = computed(() =>
  workspace.projectList
    .filter((p) => !isClosed(p) && isStale(p))
    .sort((a, b) => getStaleDays(b) - getStaleDays(a)),
)

const total = computed(() => followUps.value.length + staleProjects.value.length)

function open(project) {
  router.push({ name: 'project-detail', params: { id: project.id } })
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-4">
    <div class="mb-3 flex flex-wrap items-baseline gap-2">
      <h1 class="text-lg font-semibold text-slate-900">我的待办</h1>
      <span class="text-xs text-slate-400">共 {{ total }} 项</span>
      <span class="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
        提醒只在打开工具时可见
      </span>
    </div>

    <p class="mb-3 text-xs leading-relaxed text-slate-400">
      本工具没有后端，无法做微信或邮件推送，因此待办需要你打开页面才能看到。
      建议把页面添加到手机主屏幕，方便随时打开。
    </p>

    <section class="mb-4 rounded-xl border border-slate-200 bg-white">
      <header class="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 class="text-sm font-semibold text-slate-900">今日及已过期跟进</h2>
        <span class="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
          {{ followUps.length }}
        </span>
      </header>
      <p v-if="!followUps.length" class="px-4 py-6 text-center text-sm text-slate-400">
        没有到期的跟进。
      </p>
      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="project in followUps"
          :key="project.id"
          class="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-slate-50"
          @click="open(project)"
        >
          <span class="flex-1 text-sm font-medium text-slate-900">{{ project.name }}</span>
          <span class="text-xs text-slate-500">{{ workspace.customerName(project.customerId) }}</span>
          <span class="text-xs text-slate-500">{{ getCurrentNode(project)?.name || '—' }}</span>
          <span class="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700">
            应于 {{ formatDay(project.nextFollowUpAt) }} 跟进
          </span>
        </li>
      </ul>
    </section>

    <section class="mb-4 rounded-xl border border-slate-200 bg-white">
      <header class="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 class="text-sm font-semibold text-slate-900">阶段停滞超期</h2>
        <span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
          {{ staleProjects.length }}
        </span>
      </header>
      <p v-if="!staleProjects.length" class="px-4 py-6 text-center text-sm text-slate-400">
        没有停滞超期的项目。
      </p>
      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="project in staleProjects"
          :key="project.id"
          class="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-slate-50"
          @click="open(project)"
        >
          <span class="flex-1 text-sm font-medium text-slate-900">{{ project.name }}</span>
          <span class="text-xs text-slate-500">{{ workspace.customerName(project.customerId) }}</span>
          <span class="text-xs text-slate-500">{{ getCurrentNode(project)?.name || '—' }}</span>
          <span class="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
            已停留 {{ getStaleDays(project) }} 天（阈值 {{ getCurrentNode(project)?.staleDays }} 天）
          </span>
        </li>
      </ul>
    </section>

    <p class="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-400">
      手动待办（自己随手记一条）尚未实现：它需要新增一份独立的待办数据文件并定义并发规则，
      在对齐数据模型后再补，避免擅自引入新的文件类型。
    </p>
  </div>
</template>
