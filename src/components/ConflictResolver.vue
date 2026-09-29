<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import { formatValue } from '../utils/diff'
import ModalDialog from './ModalDialog.vue'

/*
 * PRD FR-16 写入冲突处理界面。
 *
 * 硬性要求：
 *   - 保留用户已填内容，一个都不丢（数据本来就在本地工作副本里，不刷新即可）
 *   - 展示差异摘要，告诉用户对方改了什么
 *   - 同一字段双边修改必须由用户逐字段选择，默认不选，绝不静默覆盖
 */
const workspace = useWorkspaceStore()
const ui = useUiStore()

const decisions = reactive({})
const submitting = ref(false)

const context = computed(() => workspace.pendingConflict)

const conflicts = computed(() => context.value?.conflicts || [])

const allResolved = computed(() => conflicts.value.every((c) => decisions[c.id]))

watch(
  () => context.value?.projectId,
  () => {
    for (const key of Object.keys(decisions)) delete decisions[key]
  },
)

function choose(conflictId, source) {
  decisions[conflictId] = source
}

function labelOf(scope, value) {
  if (scope === 'flow') {
    const node = (context.value?.nodes || []).find((n) => n.id === value)
    return node?.name || '(未知节点)'
  }
  return formatValue(value)
}

async function submitMerge() {
  if (!allResolved.value) {
    ui.warn('请先为每一处冲突选择保留哪一边。')
    return
  }
  submitting.value = true
  try {
    const result = await workspace.resolveConflict({ ...decisions })
    if (result.ok) ui.success('已按你的选择合并并提交。')
    else if (result.conflict) ui.warn('保存期间又有人修改了该项目，请重新确认。')
    else if (result.error) ui.error(result.error?.message || '提交失败。')
  } finally {
    submitting.value = false
  }
}

async function discard() {
  submitting.value = true
  try {
    const result = await workspace.discardLocalChanges()
    if (result.ok) ui.info('已放弃本地修改，显示最新版本。')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <ModalDialog
    v-if="context"
    title="保存冲突：该项目已被他人修改"
    max-width="max-w-3xl"
    :closable="false"
  >
    <div class="space-y-4">
      <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <p class="font-medium">
          {{ context.summary.by }} 于 {{ context.summary.atText || '刚才' }} 修改了「{{ context.projectName }}」：
        </p>
        <ul v-if="context.summary.entries.length" class="mt-1.5 list-disc space-y-0.5 pl-5">
          <li v-for="(entry, index) in context.summary.entries" :key="index">{{ entry.text }}</li>
        </ul>
        <p v-else class="mt-1.5">（未检测到具体内容变化，可能只是重新保存了一次）</p>
      </div>

      <p class="text-sm text-slate-600">
        你填写的内容<strong class="text-slate-900">已完整保留</strong>，没有被刷新或清空。
        下面
        <template v-if="conflicts.length">
          有 {{ conflicts.length }} 处双方都改动过，需要你决定保留哪一边。
        </template>
        <template v-else>没有双方都改动过的字段，可以直接合并提交。</template>
      </p>

      <div v-if="conflicts.length" class="space-y-3">
        <div
          v-for="conflict in conflicts"
          :key="conflict.id"
          class="rounded-lg border border-slate-200 p-3"
        >
          <p class="mb-2 text-sm font-medium text-slate-900">{{ conflict.label }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              class="rounded-lg border p-2.5 text-left text-sm transition"
              :class="
                decisions[conflict.id] === 'local'
                  ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500'
                  : 'border-slate-200 hover:border-slate-300'
              "
              @click="choose(conflict.id, 'local')"
            >
              <span class="mb-1 block text-xs font-medium text-sky-700">保留我的修改</span>
              <span class="block break-words text-slate-900">
                {{ labelOf(conflict.scope, conflict.localValue) }}
              </span>
            </button>

            <button
              type="button"
              class="rounded-lg border p-2.5 text-left text-sm transition"
              :class="
                decisions[conflict.id] === 'remote'
                  ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                  : 'border-slate-200 hover:border-slate-300'
              "
              @click="choose(conflict.id, 'remote')"
            >
              <span class="mb-1 block text-xs font-medium text-slate-700">保留对方的修改</span>
              <span class="block break-words text-slate-900">
                {{ labelOf(conflict.scope, conflict.remoteValue) }}
              </span>
            </button>
          </div>
          <p class="mt-2 text-xs text-slate-400">
            你同步前的原值：{{ labelOf(conflict.scope, conflict.baseValue) }}
          </p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          :disabled="submitting"
          @click="discard"
        >
          放弃我的修改，查看最新版本
        </button>
        <button
          type="button"
          class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          :disabled="submitting || !allResolved"
          @click="submitMerge"
        >
          {{ submitting ? '提交中…' : '基于最新版本重新提交我的修改' }}
        </button>
      </div>
    </template>
  </ModalDialog>
</template>
