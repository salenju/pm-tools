<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import FlowTimeline from '../components/FlowTimeline.vue'
import FieldInput from '../components/FieldInput.vue'
import ModalDialog from '../components/ModalDialog.vue'
import {
  findMissingRequiredFields,
  getCurrentNode,
  getFlowNodes,
  getNextNode,
  getNodeValues,
  getRollbackTargets,
} from '../utils/flow'
import { formatDateTime } from '../utils/time'
import { PROJECT_STATUS_LABEL, ROLLBACK_TYPE_LABEL, ROLLBACK_TYPE_OPTIONS } from '../constants/enums'

/*
 * PRD FR-05 项目详情：五个区块
 *   1 流转轨迹条(FR-24)  2 基本信息  3 当前节点信息  4 流转历史  5 回退历史
 * 并承载 FR-06 推进 / FR-07 回退 的操作入口。
 */
const route = useRoute()
const router = useRouter()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const project = computed(() => workspace.projectById.get(route.params.id) || null)
const currentNode = computed(() => (project.value ? getCurrentNode(project.value) : null))
const nextNode = computed(() => (project.value ? getNextNode(project.value) : null))
const rollbackTargets = computed(() => (project.value ? getRollbackTargets(project.value) : []))

const formValues = reactive({})
const missingIds = ref([])
const formDirty = ref(false)
const saving = ref(false)
const nodeChangedNotice = ref('')
const showRollback = ref(false)
const rollbackForm = reactive({ toNodeId: '', type: ROLLBACK_TYPE_OPTIONS[0].value, reason: '' })
const rollbackError = ref('')

const basicForm = reactive({ name: '', customerId: '', nextFollowUpAt: '', remark: '' })
const savingBasic = ref(false)

const clone = (value) => JSON.parse(JSON.stringify(value ?? {}))

function resetNodeForm() {
  const node = currentNode.value
  if (!node || !project.value) return
  for (const key of Object.keys(formValues)) delete formValues[key]
  Object.assign(formValues, clone(getNodeValues(project.value, node.id)))
  missingIds.value = []
  formDirty.value = false
}

function resetBasicForm() {
  if (!project.value) return
  basicForm.name = project.value.name || ''
  basicForm.customerId = project.value.customerId || ''
  basicForm.nextFollowUpAt = project.value.nextFollowUpAt || ''
  basicForm.remark = project.value.remark || ''
}

watch(
  () => project.value?.id,
  () => {
    resetNodeForm()
    resetBasicForm()
  },
  { immediate: true },
)

// 当前节点被他人推进时不静默清空用户正在填写的内容，只给出提示
watch(
  () => project.value?.currentNodeId,
  (next, previous) => {
    if (!next || next === previous) return
    if (formDirty.value) {
      nodeChangedNotice.value =
        '该项目刚被他人推进到了新的节点。你在页面上填写的内容仍然保留着，请对照后再决定如何提交。'
      return
    }
    nodeChangedNotice.value = ''
    resetNodeForm()
  },
)

/**
 * 显式标记"用户已改动"，避免用 watch 监听整个 reactive 对象
 * （那样 resetNodeForm 里的赋值也会被误判为用户输入）。
 */
function onFieldChange(fieldId, value) {
  formValues[fieldId] = value
  formDirty.value = true
}

function markMissing(fields) {
  missingIds.value = fields.map((f) => f.id)
}

async function saveOnly() {
  if (!project.value || !currentNode.value) return
  saving.value = true
  try {
    const result = await workspace.saveNodeValues(project.value.id, clone(formValues))
    handleSaveResult(result, '已保存本阶段信息（未推进）。')
  } finally {
    saving.value = false
  }
}

async function advance() {
  if (!project.value || !currentNode.value) return
  const missing = findMissingRequiredFields(currentNode.value, formValues)
  if (missing.length) {
    markMissing(missing)
    ui.warn(`还有 ${missing.length} 个必填项没填，无法推进。`)
    return
  }
  saving.value = true
  try {
    const result = await workspace.submitNode(project.value.id, clone(formValues))
    if (result.ok) {
      missingIds.value = []
      // 注意顺序：store 修改 currentNodeId 时 Vue 的 watcher 会在 await 之前就触发，
      // 那一刻 formDirty 仍为 true，于是会误报"被他人推进"。所以成功之后必须：
      // 先清 dirty、再清提示、最后按新节点重置表单。
      formDirty.value = false
      nodeChangedNotice.value = ''
      resetNodeForm()
      ui.success(result.closed ? '项目已关闭。' : `已推进到「${result.advancedTo}」。`)
    } else if (result.missing?.length) {
      markMissing(result.missing)
      ui.warn('还有必填项没填，无法推进。')
    } else if (result.queued) {
      ui.info('当前离线，改动已存为草稿，联网后可在顶部一键补交。')
    } else {
      handleSaveResult(result)
    }
  } finally {
    saving.value = false
  }
}

function handleSaveResult(result, successMessage) {
  if (result.ok) {
    if (result.queued) ui.info('当前离线，改动已存为草稿，联网后可在顶部一键补交。')
    else if (successMessage) ui.success(successMessage)
    formDirty.value = false
    return
  }
  if (result.conflict) {
    ui.warn('该项目已被他人修改，请在弹出的窗口中处理冲突。')
    return
  }
  ui.error(result.error?.message || String(result.error || '保存失败'))
}

async function saveBasic() {
  if (!project.value) return
  if (!basicForm.name.trim()) {
    ui.warn('项目名称不能为空。')
    return
  }
  savingBasic.value = true
  try {
    const result = await workspace.updateProjectFields(project.value.id, {
      name: basicForm.name.trim(),
      customerId: basicForm.customerId,
      nextFollowUpAt: basicForm.nextFollowUpAt || '',
      remark: basicForm.remark.trim(),
    })
    handleSaveResult(result, '基本信息已保存。')
  } finally {
    savingBasic.value = false
  }
}

function openRollback() {
  rollbackForm.toNodeId = rollbackTargets.value[rollbackTargets.value.length - 1]?.id || ''
  rollbackForm.type = ROLLBACK_TYPE_OPTIONS[0].value
  rollbackForm.reason = ''
  rollbackError.value = ''
  showRollback.value = true
}

async function submitRollback() {
  if (!project.value) return
  if (!rollbackForm.toNodeId) {
    rollbackError.value = '请选择要回退到的节点。'
    return
  }
  if (!rollbackForm.reason.trim()) {
    rollbackError.value = '回退原因不能为空。'
    return
  }
  saving.value = true
  try {
    const result = await workspace.rollbackProject(project.value.id, {
      toNodeId: rollbackForm.toNodeId,
      type: rollbackForm.type,
      reason: rollbackForm.reason,
    })
    if (result.ok) {
      showRollback.value = false
      formDirty.value = false
      nodeChangedNotice.value = ''
      resetNodeForm()
      ui.success('已回退，原因已记录。')
    } else if (result.conflict) {
      showRollback.value = false
      ui.warn('该项目已被他人修改，请先处理冲突。')
    } else {
      rollbackError.value = result.error?.message || String(result.error || '回退失败')
    }
  } finally {
    saving.value = false
  }
}

/** 把节点记录里的字段值映射成「字段名 → 值」。 */
function recordEntries(record) {
  const nodes = getFlowNodes(project.value)
  const node = nodes.find((n) => n.id === record.nodeId)
  const fields = node?.fields || []
  return fields
    .filter((field) => {
      const value = record.values?.[field.id]
      return value !== null && value !== undefined && value !== ''
    })
    .map((field) => ({ label: field.name, value: record.values[field.id] }))
}

const flowHistory = computed(() => {
  const records = project.value?.nodeRecords || []
  return [...records].sort((a, b) => new Date(b.enteredAt || 0) - new Date(a.enteredAt || 0))
})

const rollbackHistory = computed(() =>
  [...(project.value?.rollbackHistory || [])].sort(
    (a, b) => new Date(b.at || 0) - new Date(a.at || 0),
  ),
)

const customerOptions = computed(() => workspace.customerList)

const backToList = () => router.push({ name: 'projects' })
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-4">
    <p v-if="!project" class="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
      找不到该项目。<button class="ml-1 text-sky-600 underline" @click="backToList">返回项目列表</button>
    </p>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          @click="backToList"
        >
          ← 返回
        </button>
        <h1 class="text-lg font-semibold text-slate-900">{{ project.name }}</h1>
        <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {{ PROJECT_STATUS_LABEL[project.status] }}
        </span>
        <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          流程 v{{ project.templateVersion }}
        </span>
        <span
          v-if="workspace.projectDirty(project.id)"
          class="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700"
        >
          有未保存的改动
        </span>
        <span
          v-if="workspace.drafts[project.id]"
          class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
        >
          离线草稿未提交
        </span>
      </div>

      <!-- 区块 1：流转轨迹条（FR-24） -->
      <FlowTimeline :project="project" class="mb-3" />

      <p
        v-if="nodeChangedNotice"
        class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        {{ nodeChangedNotice }}
      </p>

      <!-- 区块 3：当前节点信息 -->
      <section v-if="currentNode" class="mb-3 rounded-xl border border-slate-200 bg-white p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-slate-900">
            当前阶段：{{ currentNode.name }}
          </h2>
          <span v-if="nextNode" class="text-xs text-slate-400">
            下一阶段：{{ nextNode.name }}
          </span>
          <span v-else class="text-xs text-amber-600">这是最后一个阶段，填完即可关闭项目</span>
        </div>

        <div v-if="(currentNode.fields || []).length" class="grid gap-3 sm:grid-cols-2">
          <FieldInput
            v-for="field in currentNode.fields"
            :key="field.id"
            :model-value="formValues[field.id]"
            :field="field"
            :invalid="missingIds.includes(field.id)"
            @update:model-value="onFieldChange(field.id, $event)"
          />
        </div>
        <p v-else class="text-sm text-slate-400">本阶段没有配置字段。</p>

        <p v-if="missingIds.length" class="mt-3 text-sm text-rose-600">
          还有 {{ missingIds.length }} 个必填项没有填写。
        </p>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            :disabled="saving"
            @click="advance"
          >
            {{ saving ? '提交中…' : nextNode ? `推进到「${nextNode.name}」` : '完成并关闭项目' }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            :disabled="saving"
            @click="saveOnly"
          >
            仅保存，不推进
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-300 px-3.5 py-2 text-sm text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
            :disabled="saving || !rollbackTargets.length"
            :title="rollbackTargets.length ? '' : '已经是第一个节点，无法回退'"
            @click="openRollback"
          >
            回退
          </button>
        </div>
      </section>

      <!-- 区块 2：基本信息 -->
      <section class="mb-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">基本信息</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">项目名称</label>
            <input
              v-model="basicForm.name"
              type="text"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">所属客户</label>
            <select
              v-model="basicForm.customerId"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            >
              <option value="">未指派</option>
              <option v-for="customer in customerOptions" :key="customer.id" :value="customer.id">
                {{ customer.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">下次跟进日期</label>
            <input
              v-model="basicForm.nextFollowUpAt"
              type="date"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">负责销售</label>
            <p class="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              {{ project.updatedByName || project.createdByName || '未知' }}
            </p>
          </div>
          <div class="sm:col-span-2">
            <label class="mb-1 block text-sm font-medium text-slate-700">备注</label>
            <textarea
              v-model="basicForm.remark"
              rows="2"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <p class="mt-1 text-xs text-slate-400">
              请勿填写报价金额、客户联系人等敏感信息——数据将对全组可见且永久留存。
            </p>
          </div>
        </div>
        <button
          type="button"
          class="mt-3 rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          :disabled="savingBasic"
          @click="saveBasic"
        >
          {{ savingBasic ? '保存中…' : '保存基本信息' }}
        </button>
      </section>

      <!-- 区块 4：流转历史 -->
      <section class="mb-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">流转历史</h2>
        <ol class="space-y-3">
          <li v-for="record in flowHistory" :key="`${record.nodeId}-${record.enteredAt}`" class="border-l-2 border-slate-200 pl-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-slate-800">{{ record.nodeName }}</span>
              <span class="text-xs text-slate-400">
                进入 {{ formatDateTime(record.enteredAt) }}
                <template v-if="record.enteredByName">（{{ record.enteredByName }}）</template>
              </span>
              <span
                v-if="record.leftAt"
                class="text-xs text-slate-400"
              >
                · 离开 {{ formatDateTime(record.leftAt) }}
                <template v-if="record.leftByName">（{{ record.leftByName }}）</template>
              </span>
              <span v-else class="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">当前</span>
            </div>
            <dl v-if="recordEntries(record).length" class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              <div v-for="entry in recordEntries(record)" :key="entry.label" class="text-xs">
                <dt class="inline text-slate-400">{{ entry.label }}：</dt>
                <dd class="inline break-all text-slate-700">{{ entry.value }}</dd>
              </div>
            </dl>
          </li>
        </ol>
      </section>

      <!-- 区块 5：回退历史 -->
      <section class="mb-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">
          回退历史
          <span v-if="rollbackHistory.length" class="ml-1 text-xs font-normal text-slate-400">
            共 {{ rollbackHistory.length }} 次
          </span>
        </h2>
        <p v-if="!rollbackHistory.length" class="text-sm text-slate-400">没有回退记录。</p>
        <ol v-else class="space-y-2.5">
          <li v-for="item in rollbackHistory" :key="`${item.at}-${item.reason}`" class="border-l-2 border-rose-300 pl-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">
                {{ ROLLBACK_TYPE_LABEL[item.type] || '回退' }}
              </span>
              <span class="text-sm text-slate-700">
                {{ item.fromNodeName }} → {{ item.toNodeName }}
              </span>
              <span class="text-xs text-slate-400">
                {{ formatDateTime(item.at) }}
                <template v-if="item.byName">（{{ item.byName }}）</template>
              </span>
            </div>
            <p class="mt-1 whitespace-pre-wrap text-sm text-slate-600">{{ item.reason }}</p>
          </li>
        </ol>
      </section>
    </template>

    <!-- FR-07 回退弹窗 -->
    <ModalDialog v-if="showRollback" title="回退到之前的节点" @close="showRollback = false">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            回退到 <span class="text-rose-500">*</span>
          </label>
          <select
            v-model="rollbackForm.toNodeId"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          >
            <option value="">请选择节点</option>
            <option v-for="node in rollbackTargets" :key="node.id" :value="node.id">
              {{ node.order }}. {{ node.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            回退类型 <span class="text-rose-500">*</span>
          </label>
          <select
            v-model="rollbackForm.type"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          >
            <option v-for="option in ROLLBACK_TYPE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            回退原因 <span class="text-rose-500">*</span>
          </label>
          <textarea
            v-model="rollbackForm.reason"
            rows="3"
            placeholder="例如：客户要求重新报价，目标价下调 8%"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <p class="mt-1 text-xs text-slate-400">
            原因不可为空，且会永久保留在回退历史中，全组可见。
          </p>
        </div>

        <p v-if="rollbackError" class="text-sm text-rose-600">{{ rollbackError }}</p>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            @click="showRollback = false"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            :disabled="saving"
            @click="submitRollback"
          >
            {{ saving ? '提交中…' : '确认回退' }}
          </button>
        </div>
      </template>
    </ModalDialog>
  </div>
</template>
