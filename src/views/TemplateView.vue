<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import { FIELD_TYPE, FIELD_TYPE_OPTIONS } from '../constants/enums'
import { formatDateTime } from '../utils/time'

/*
 * PRD FR-08 流程模板配置 + 实时预览图。
 *
 * 关键约束：模板变更生成新版本号，**不影响**已存在的项目
 * （老项目继续按自己创建时的 flowSnapshot 运行）。
 */
const workspace = useWorkspaceStore()
const ui = useUiStore()

const draftNodes = ref([])
const selectedNodeId = ref('')
const templateName = ref('')
const saving = ref(false)
const optionsDraft = reactive({})

const selectedNode = computed(
  () => draftNodes.value.find((node) => node.id === selectedNodeId.value) || null,
)

const selectedIndex = computed(() =>
  draftNodes.value.findIndex((node) => node.id === selectedNodeId.value),
)

function renumber() {
  draftNodes.value.forEach((node, index) => {
    node.order = index + 1
  })
}

function ensureOptionsDraft() {
  for (const node of draftNodes.value) {
    for (const field of node.fields || []) {
      if (field.type === FIELD_TYPE.SELECT && optionsDraft[field.id] === undefined) {
        optionsDraft[field.id] = (field.options || []).join('\n')
      }
    }
  }
}

function loadDraft() {
  const template = workspace.activeTemplate
  draftNodes.value = template
    ? JSON.parse(JSON.stringify([...template.nodes].sort((a, b) => a.order - b.order)))
    : []
  templateName.value = template?.name || '默认流程'
  renumber()
  ensureOptionsDraft()
  if (!draftNodes.value.some((node) => node.id === selectedNodeId.value)) {
    selectedNodeId.value = draftNodes.value[0]?.id || ''
  }
}

watch(
  () => workspace.activeTemplate?.version,
  () => loadDraft(),
  { immediate: true },
)

watch(selectedNodeId, () => ensureOptionsDraft())

function addNode() {
  const node = {
    id: workspace.makeNodeId(draftNodes.value),
    name: '新节点',
    order: draftNodes.value.length + 1,
    staleDays: 7,
    fields: [],
  }
  draftNodes.value.push(node)
  renumber()
  selectedNodeId.value = node.id
}

function removeNode(node) {
  if (draftNodes.value.length <= 1) {
    ui.warn('至少需要保留一个节点。')
    return
  }
  draftNodes.value = draftNodes.value.filter((item) => item.id !== node.id)
  renumber()
  if (selectedNodeId.value === node.id) {
    selectedNodeId.value = draftNodes.value[0]?.id || ''
  }
}

function moveNode(index, delta) {
  const target = index + delta
  if (target < 0 || target >= draftNodes.value.length) return
  const list = [...draftNodes.value]
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  draftNodes.value = list
  renumber()
}

function addField(node) {
  if (!node.fields) node.fields = []
  const field = {
    id: workspace.makeFieldId(draftNodes.value),
    name: '新字段',
    type: FIELD_TYPE.TEXT,
    required: false,
  }
  node.fields.push(field)
  optionsDraft[field.id] = ''
}

function removeField(node, field) {
  node.fields = (node.fields || []).filter((item) => item.id !== field.id)
  delete optionsDraft[field.id]
}

function applyOptions(field) {
  field.options = String(optionsDraft[field.id] || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function validate() {
  if (!draftNodes.value.length) return '至少需要一个节点。'
  for (const node of draftNodes.value) {
    if (!String(node.name || '').trim()) return '有节点的名称为空。'
    for (const field of node.fields || []) {
      if (!String(field.name || '').trim()) return `「${node.name}」下有字段没有填写名称。`
      if (field.type === FIELD_TYPE.SELECT && !(field.options || []).length) {
        return `「${node.name}」的「${field.name}」是下拉字段，至少要有一个选项。`
      }
    }
  }
  return ''
}

async function save() {
  const error = validate()
  if (error) {
    ui.warn(error)
    return
  }
  for (const node of draftNodes.value) {
    for (const field of node.fields || []) {
      if (field.type === FIELD_TYPE.SELECT) applyOptions(field)
    }
  }
  saving.value = true
  try {
    const template = await workspace.saveTemplate(draftNodes.value, templateName.value)
    ui.success(
      `已发布流程模板 v${template.version}。新项目将使用新流程，已有项目不受影响。`,
    )
  } catch (error2) {
    ui.error(error2?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const dirty = computed(() => {
  const original = workspace.activeTemplate
  if (!original) return true
  const a = JSON.stringify([...original.nodes].sort((x, y) => x.order - y.order))
  const b = JSON.stringify(draftNodes.value)
  return a !== b || templateName.value !== (original.name || '')
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h1 class="text-lg font-semibold text-slate-900">流程模板</h1>
      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
        当前 v{{ workspace.activeTemplate?.version || '—' }}
      </span>
      <span v-if="dirty" class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
        有未发布的改动
      </span>
    </div>

    <div
      v-if="!workspace.isAdmin"
      class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p class="font-medium">你没有流程模板的编辑权限。</p>
      <p class="mt-1">
        模板属全组共享的全局定义，仅管理员可改（PRD 第 8 章：这是界面层面的软权限，不是安全边界）。
      </p>
      <p class="mt-1 text-xs">
        当前账号：{{ workspace.actorRef().id || '未识别' }}；管理员：
        {{ (workspace.config?.admins || []).join('、') || '未设置' }}
      </p>
    </div>

    <template v-else>
      <div class="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        改动只影响<strong>之后新建</strong>的项目。已存在的项目继续按各自创建时的流程快照运行
        （FR-08 变更隔离），不会因为这次修改而变化。
      </div>

      <!--
        min-w-0 是必需的：grid/flex 子项默认 min-width:auto，会以"内容最小宽度"为准。
        实时预览里那排节点（7 × 128px ≈ 1088px）会把整列顶宽，导致整页横向溢出。
        给子项加 min-w-0 后，内部那个 overflow-x-auto 才能正常接管滚动。
      -->
      <div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <!-- 节点列表 -->
        <section class="min-w-0 rounded-xl border border-slate-200 bg-white">
          <header class="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <h2 class="text-sm font-semibold text-slate-900">节点</h2>
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
              @click="addNode"
            >
              ＋ 新增
            </button>
          </header>
          <ul class="max-h-[60vh] overflow-y-auto p-1.5">
            <li v-for="(node, index) in draftNodes" :key="node.id">
              <div
                class="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm"
                :class="node.id === selectedNodeId ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'"
              >
                <button
                  type="button"
                  class="flex-1 truncate text-left"
                  @click="selectedNodeId = node.id"
                >
                  {{ node.order }}. {{ node.name }}
                </button>
                <span class="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
                  <button
                    type="button"
                    class="px-1 disabled:opacity-30"
                    :disabled="index === 0"
                    title="上移"
                    @click="moveNode(index, -1)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="px-1 disabled:opacity-30"
                    :disabled="index === draftNodes.length - 1"
                    title="下移"
                    @click="moveNode(index, 1)"
                  >
                    ↓
                  </button>
                  <button type="button" class="px-1" title="删除" @click="removeNode(node)">✕</button>
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- 节点详情 -->
        <section class="min-w-0 space-y-4">
          <div v-if="!selectedNode" class="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">
            请先在左侧选择一个节点。
          </div>

          <div v-else class="rounded-xl border border-slate-200 bg-white p-4">
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="sm:col-span-2">
                <label class="mb-1 block text-sm font-medium text-slate-700">节点名称</label>
                <input
                  v-model="selectedNode.name"
                  type="text"
                  class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-slate-700">停滞阈值（天）</label>
                <input
                  v-model.number="selectedNode.staleDays"
                  type="number"
                  min="0"
                  class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
                <p class="mt-1 text-xs text-slate-400">停留超过此天数在看板标红，0 表示不提醒。</p>
              </div>
            </div>

            <div class="mt-4 flex items-center justify-between">
              <h3 class="text-sm font-semibold text-slate-900">字段</h3>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                @click="addField(selectedNode)"
              >
                ＋ 新增字段
              </button>
            </div>

            <p v-if="!(selectedNode.fields || []).length" class="mt-2 text-sm text-slate-400">
              本节点还没有字段。没有字段时，流转不需要填写任何内容。
            </p>

            <div v-else class="mt-2 space-y-3">
              <div
                v-for="field in selectedNode.fields"
                :key="field.id"
                class="rounded-lg border border-slate-200 p-3"
              >
                <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_6rem_auto]">
                  <input
                    v-model="field.name"
                    type="text"
                    placeholder="字段名称"
                    class="min-w-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                  />
                  <select
                    v-model="field.type"
                    class="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                  >
                    <option v-for="option in FIELD_TYPE_OPTIONS" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                  <label class="flex items-center gap-1.5 text-xs text-slate-600">
                    <input v-model="field.required" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
                    必填
                  </label>
                  <button
                    type="button"
                    class="rounded border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                    @click="removeField(selectedNode, field)"
                  >
                    删除
                  </button>
                </div>

                <div v-if="field.type === FIELD_TYPE.SELECT" class="mt-2">
                  <label class="mb-1 block text-xs text-slate-500">下拉选项（一行一个）</label>
                  <textarea
                    :value="optionsDraft[field.id]"
                    rows="3"
                    class="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                    @input="optionsDraft[field.id] = $event.target.value"
                    @blur="applyOptions(field)"
                  />
                </div>

                <div
                  v-else-if="field.type === FIELD_TYPE.TEXT || field.type === FIELD_TYPE.TEXTAREA"
                  class="mt-2 flex items-center gap-2"
                >
                  <label class="text-xs text-slate-500">最大长度</label>
                  <input
                    v-model.number="field.maxLength"
                    type="number"
                    min="1"
                    class="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 实时预览图（FR-08） -->
          <div class="rounded-xl border border-slate-200 bg-white p-4">
            <h3 class="mb-3 text-sm font-semibold text-slate-900">实时预览</h3>
            <div class="thin-scrollbar overflow-x-auto pb-1">
              <div class="flex items-start">
                <template v-for="(node, index) in draftNodes" :key="node.id">
                  <div
                    class="w-32 flex-none rounded-lg border px-2 py-2 text-center"
                    :class="
                      node.id === selectedNodeId
                        ? 'border-sky-400 bg-sky-50'
                        : 'border-slate-200 bg-slate-50'
                    "
                  >
                    <p class="truncate text-xs font-medium text-slate-800">{{ node.name }}</p>
                    <p class="mt-0.5 text-[10px] text-slate-400">
                      {{ (node.fields || []).length }} 个字段 · 阈值 {{ node.staleDays }} 天
                    </p>
                  </div>
                  <div
                    v-if="index < draftNodes.length - 1"
                    class="mt-5 h-0.5 w-8 flex-none rounded bg-slate-200"
                  />
                </template>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <input
              v-model="templateName"
              type="text"
              placeholder="模板名称"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              :disabled="saving || !dirty"
              @click="save"
            >
              {{ saving ? '发布中…' : `发布为新版本 v${(workspace.activeTemplate?.version || 0) + 1}` }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
              :disabled="saving"
              @click="loadDraft"
            >
              放弃改动
            </button>
          </div>
        </section>
      </div>

      <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">版本历史</h2>
        <ul class="space-y-2">
          <li
            v-for="template in workspace.templateHistory"
            :key="template.version"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span
              class="rounded px-1.5 py-0.5 text-xs"
              :class="
                template.version === workspace.activeTemplate?.version
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'
              "
            >
              v{{ template.version }}
            </span>
            <span class="text-slate-700">{{ template.name }}</span>
            <span class="text-xs text-slate-400">
              {{ template.nodes?.length || 0 }} 个节点 · {{ formatDateTime(template.createdAt) }}
            </span>
            <span
              v-if="template.version === workspace.activeTemplate?.version"
              class="text-xs text-emerald-600"
            >
              当前在用（新建项目使用此版本）
            </span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
