<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import ProjectCard from '../components/ProjectCard.vue'
import { getCurrentNode, isClosed, isCurrentNodeComplete, getNodeValues } from '../utils/flow'

/*
 * PRD FR-10 看板视图。
 *
 * 关于流程版本：模板变更不影响老项目（FR-08），因此看板可能出现
 * 不同流程版本的项目。这里按「节点 order（位置）」归列，
 * 并在卡片上标出该项目自己的实际节点名，避免假装它们一致。
 */
const router = useRouter()
const workspace = useWorkspaceStore()
const session = useSessionStore()
const ui = useUiStore()

const keyword = ref('')
const ownerFilter = ref('')
const showClosed = ref(false)
const draggingId = ref('')
const dragOverIndex = ref(-1)

const projectsForBoard = computed(() => {
  const source = showClosed.value ? workspace.projectList : workspace.activeProjectList
  const kw = keyword.value.trim().toLowerCase()
  return source.filter((project) => {
    if (ownerFilter.value && project.ownerId !== ownerFilter.value) return false
    if (!kw) return true
    const customer = workspace.customerById.get(project.customerId)
    return (
      project.name.toLowerCase().includes(kw) ||
      (customer?.name || '').toLowerCase().includes(kw) ||
      (customer?.shortName || '').toLowerCase().includes(kw)
    )
  })
})

const board = computed(() => {
  const template = workspace.activeTemplate
  const nodes = template ? [...template.nodes].sort((a, b) => a.order - b.order) : []
  const columns = nodes.map((node) => ({ ...node, projects: [] }))
  const unplaced = []

  for (const project of projectsForBoard.value) {
    const node = getCurrentNode(project)
    if (!node) {
      unplaced.push(project)
      continue
    }
    let column = columns.find((c) => c.order === node.order)
    if (!column) column = columns[columns.length - 1]
    if (column) column.projects.push(project)
    else unplaced.push(project)
  }
  return { columns, unplaced }
})

/* ---------- 移动端：节点快速跳转 ---------- */

const scrollerRef = ref(null)
const columnRefs = ref([])
const activeColumnIndex = ref(0)

function setColumnRef(index, el) {
  columnRefs.value[index] = el
}

/** 点节点胶囊 → 把对应列滚到可视区左侧。 */
function scrollToColumn(index) {
  const el = columnRefs.value[index]
  if (!el) return
  activeColumnIndex.value = index
  el.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
}

/** 滚动时更新胶囊高亮：取最靠近左侧的那一列。 */
function onBoardScroll() {
  const scroller = scrollerRef.value
  if (!scroller) return
  const left = scroller.getBoundingClientRect().left
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  columnRefs.value.forEach((el, index) => {
    if (!el) return
    const distance = Math.abs(el.getBoundingClientRect().left - left)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  activeColumnIndex.value = best
}

/** 使用了非当前模板版本的项目数量。 */
const legacyCount = computed(() => {
  const activeVersion = workspace.activeTemplate?.version
  return projectsForBoard.value.filter((p) => p.templateVersion !== activeVersion).length
})

const owners = computed(() => {
  const map = new Map()
  for (const project of workspace.projectList) {
    if (project.ownerId) {
      map.set(project.ownerId, project.updatedByName || project.createdByName || project.ownerId)
    }
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }))
})

function openProject(project) {
  router.push({ name: 'project-detail', params: { id: project.id } })
}

function projectDirty(id) {
  return workspace.projectDirty(id)
}

function hasDraft(id) {
  return Boolean(workspace.drafts[id])
}

/** 拖拽与点击"推进"走完全相同的校验逻辑（FR-10 验收 1）。 */
async function tryAdvance(project) {
  const node = getCurrentNode(project)
  if (!node) {
    ui.error('该项目的当前节点定义缺失，请检查流程模板。')
    return
  }
  if (!isCurrentNodeComplete(project)) {
    ui.warn('还有必填项未填写，已为你打开该项目的表单。')
    router.push({ name: 'project-detail', params: { id: project.id }, query: { advance: '1' } })
    return
  }
  const result = await workspace.submitNode(project.id, getNodeValues(project, node.id))
  if (result.ok) ui.success(result.closed ? '项目已关闭。' : `已推进到「${result.advancedTo}」。`)
  else if (result.conflict) ui.warn('该项目已被他人修改，请在弹出的窗口中处理冲突。')
  else if (result.missing?.length) ui.warn('还有必填项未填写。')
  else if (result.error) ui.error(result.error?.message || String(result.error))
}

function onDragStart(project, event) {
  draggingId.value = project.id
  event.dataTransfer.effectAllowed = 'move'
  try {
    event.dataTransfer.setData('text/plain', project.id)
  } catch {
    /* 某些浏览器限制，忽略 */
  }
}

function onDragEnd() {
  draggingId.value = ''
  dragOverIndex.value = -1
}

function onDragOver(index, event) {
  event.preventDefault()
  dragOverIndex.value = index
}

function onDragLeave(index) {
  if (dragOverIndex.value === index) dragOverIndex.value = -1
}

async function onDrop(index) {
  const project = workspace.projectList.find((p) => p.id === draggingId.value)
  const targetColumn = board.value.columns[index]
  dragOverIndex.value = -1
  draggingId.value = ''
  if (!project || !targetColumn) return

  const node = getCurrentNode(project)
  if (!node) return
  if (targetColumn.order === node.order) return
  if (targetColumn.order !== node.order + 1) {
    ui.warn('只能推进到下一个节点，不能跨节点跳转。')
    return
  }
  await tryAdvance(project)
}

function clearFilters() {
  keyword.value = ''
  ownerFilter.value = ''
}
</script>

<template>
  <div class="mx-auto max-w-[1600px] px-4 py-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索项目或客户…"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 sm:w-64"
      />
      <select
        v-model="ownerFilter"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      >
        <option value="">全部负责人</option>
        <option v-for="owner in owners" :key="owner.id" :value="owner.id">{{ owner.name }}</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-slate-600">
        <input v-model="showClosed" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
        显示已关闭（{{ workspace.closedProjectList.length }}）
      </label>
      <button
        v-if="keyword || ownerFilter"
        type="button"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        @click="clearFilters"
      >
        重置
      </button>
      <span class="ml-auto text-xs text-slate-400">
        共 {{ projectsForBoard.length }} 个项目
      </span>
    </div>

    <p
      v-if="legacyCount"
      class="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
    >
      有 {{ legacyCount }} 个项目仍在沿用旧版流程（节点定义不随模板变更而改变）。
      它们按节点位置归列，卡片上会标出各自的实际节点名。
    </p>

    <p
      v-if="!workspace.activeTemplate"
      class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-6 text-center text-sm text-amber-900"
    >
      尚未加载到流程模板。请检查数据仓库配置，或点击右上角进入「同步与账号」初始化数据仓库。
    </p>

    <template v-else>
      <!--
        移动端：节点快速跳转。
        看板有 7 列、总宽近 1900px，手机上盲划很难受；这里点一下就能跳到指定列。
      -->
      <div class="thin-scrollbar -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:hidden">
        <button
          v-for="(column, index) in board.columns"
          :key="column.id"
          type="button"
          class="shrink-0 rounded-full border px-2.5 py-1 text-xs transition"
          :class="
            activeColumnIndex === index
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-600'
          "
          @click="scrollToColumn(index)"
        >
          {{ column.name }}
          <span class="opacity-60">{{ column.projects.length }}</span>
        </button>
      </div>

      <div
        ref="scrollerRef"
        class="thin-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:snap-none"
        @scroll.passive="onBoardScroll"
      >
        <div class="flex items-start gap-3">
          <section
            v-for="(column, index) in board.columns"
            :key="column.id"
            :ref="(el) => setColumnRef(index, el)"
            class="flex w-[82vw] max-w-[20rem] flex-none snap-start flex-col rounded-xl border bg-slate-50/80 transition sm:w-64 sm:max-w-none"
            :class="dragOverIndex === index ? 'border-sky-400 bg-sky-50' : 'border-slate-200'"
            @dragover="onDragOver(index, $event)"
            @dragleave="onDragLeave(index)"
            @drop.prevent="onDrop(index)"
          >
          <header class="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <h2 class="truncate text-sm font-semibold text-slate-800">
              <span class="mr-1 text-xs text-slate-400">{{ column.order }}</span>{{ column.name }}
            </h2>
            <span class="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
              {{ column.projects.length }}
            </span>
          </header>

          <div class="flex max-h-[calc(100vh-16rem)] flex-col gap-2 overflow-y-auto p-2">
            <ProjectCard
              v-for="project in column.projects"
              :key="project.id"
              :project="project"
              :column-name="column.name"
              :customer-label="workspace.customerName(project.customerId)"
              :dirty="projectDirty(project.id)"
              :has-draft="hasDraft(project.id)"
              draggable
              @open="openProject"
              @advance="tryAdvance"
              @dragstart="onDragStart(project, $event)"
              @dragend="onDragEnd"
            />
            <p v-if="!column.projects.length" class="px-2 py-6 text-center text-xs text-slate-400">
              暂无项目
            </p>
          </div>
        </section>

          <section
            v-if="board.unplaced.length"
            class="flex w-[82vw] max-w-[20rem] flex-none flex-col rounded-xl border border-dashed border-slate-300 bg-white sm:w-64 sm:max-w-none"
          >
          <header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500">
            未归位（{{ board.unplaced.length }}）
          </header>
          <div class="flex flex-col gap-2 p-2">
            <ProjectCard
              v-for="project in board.unplaced"
              :key="project.id"
              :project="project"
              :customer-label="workspace.customerName(project.customerId)"
              :dirty="projectDirty(project.id)"
              :has-draft="hasDraft(project.id)"
              @open="openProject"
              @advance="tryAdvance"
            />
          </div>
        </section>
        </div>
      </div>
    </template>

    <p class="mt-1 text-xs text-slate-400">
      提示：电脑端可把卡片拖到下一个节点列；手机端用上方节点胶囊快速跳列，点开卡片即可推进。
    </p>
  </div>
</template>
