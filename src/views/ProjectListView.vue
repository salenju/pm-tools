<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import ModalDialog from '../components/ModalDialog.vue'
import { getCurrentNode, getStaleDays, isClosed, isStale } from '../utils/flow'
import { formatDay, todayString } from '../utils/time'
import { PROJECT_STATUS_LABEL } from '../constants/enums'

/* PRD FR-11 列表视图 + FR-04 项目 CRUD。 */
const router = useRouter()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const keyword = ref('')
const nodeFilter = ref('')
const statusFilter = ref('active')
const showCreate = ref(false)
const creating = ref(false)
const formError = ref('')

const form = reactive({
  name: '',
  customerId: '',
  newCustomerName: '',
  nextFollowUpAt: todayString(),
  remark: '',
})

const nodeOptions = computed(() => {
  const template = workspace.activeTemplate
  return template ? [...template.nodes].sort((a, b) => a.order - b.order) : []
})

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return workspace.projectList
    .filter((project) => {
      if (statusFilter.value === 'active' && isClosed(project)) return false
      if (statusFilter.value === 'closed' && !isClosed(project)) return false
      if (nodeFilter.value) {
        const node = getCurrentNode(project)
        if (!node || String(node.order) !== nodeFilter.value) return false
      }
      if (!kw) return true
      const customer = workspace.customerById.get(project.customerId)
      return (
        project.name.toLowerCase().includes(kw) ||
        (customer?.name || '').toLowerCase().includes(kw)
      )
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
})

function openCreate() {
  form.name = ''
  form.customerId = ''
  form.newCustomerName = ''
  form.nextFollowUpAt = todayString()
  form.remark = ''
  formError.value = ''
  showCreate.value = true
}

async function submitCreate() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = '项目名称不能为空。'
    return
  }
  if (!form.customerId && !form.newCustomerName.trim()) {
    formError.value = '请选择已有客户，或填写新客户名称。'
    return
  }
  creating.value = true
  try {
    const project = await workspace.createProject({
      name: form.name.trim(),
      customerId: form.customerId,
      customerName: form.newCustomerName.trim(),
      nextFollowUpAt: form.nextFollowUpAt,
      remark: form.remark,
    })
    showCreate.value = false
    ui.success(`项目「${project.name}」已创建。`)
    router.push({ name: 'project-detail', params: { id: project.id } })
  } catch (error) {
    formError.value = error?.message || '创建失败'
  } finally {
    creating.value = false
  }
}

function openProject(project) {
  router.push({ name: 'project-detail', params: { id: project.id } })
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索项目或客户…"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 sm:w-56"
      />
      <select
        v-model="nodeFilter"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      >
        <option value="">全部阶段</option>
        <option v-for="node in nodeOptions" :key="node.id" :value="String(node.order)">
          {{ node.order }}. {{ node.name }}
        </option>
      </select>
      <select
        v-model="statusFilter"
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      >
        <option value="active">进行中</option>
        <option value="closed">已关闭</option>
        <option value="all">全部</option>
      </select>
      <button
        type="button"
        class="ml-auto rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        @click="openCreate"
      >
        新建项目
      </button>
    </div>

    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th class="px-3 py-2 font-medium">项目</th>
            <th class="px-3 py-2 font-medium">客户</th>
            <th class="px-3 py-2 font-medium">当前阶段</th>
            <th class="hidden px-3 py-2 font-medium sm:table-cell">下次跟进</th>
            <th class="px-3 py-2 font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="project in rows"
            :key="project.id"
            class="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
            @click="openProject(project)"
          >
            <td class="px-3 py-2.5">
              <span class="font-medium text-slate-900">{{ project.name }}</span>
              <span
                v-if="workspace.drafts[project.id]"
                class="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-800"
              >
                草稿
              </span>
            </td>
            <td class="px-3 py-2.5 text-slate-600">{{ workspace.customerName(project.customerId) }}</td>
            <td class="px-3 py-2.5 text-slate-600">
              {{ getCurrentNode(project)?.name || '—' }}
              <span
                v-if="isStale(project)"
                class="ml-1.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700"
              >
                滞留 {{ getStaleDays(project) }} 天
              </span>
            </td>
            <td class="hidden px-3 py-2.5 text-slate-500 sm:table-cell">
              {{ formatDay(project.nextFollowUpAt) || '—' }}
            </td>
            <td class="px-3 py-2.5">
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="
                  project.status === 'active'
                    ? 'bg-sky-50 text-sky-700'
                    : project.status === 'closed_won'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                "
              >
                {{ PROJECT_STATUS_LABEL[project.status] }}
              </span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="5" class="px-3 py-10 text-center text-sm text-slate-400">
              没有符合条件的项目。
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ModalDialog v-if="showCreate" title="新建项目" @close="showCreate = false">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            项目名称 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            placeholder="例如：长城 H6 前保险杠"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">选择已有客户</label>
          <select
            v-model="form.customerId"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          >
            <option value="">请选择</option>
            <option v-for="customer in workspace.customerList" :key="customer.id" :value="customer.id">
              {{ customer.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            或直接输入新客户名（会自动建档）
          </label>
          <input
            v-model="form.newCustomerName"
            type="text"
            :disabled="Boolean(form.customerId)"
            placeholder="仅在未选择已有客户时生效"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:bg-slate-100"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">下次跟进日期</label>
          <input
            v-model="form.nextFollowUpAt"
            type="date"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">备注</label>
          <textarea
            v-model="form.remark"
            rows="2"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <p class="mt-1 text-xs text-slate-400">
            请勿填写报价金额、客户联系人等敏感信息——数据将对全组可见且永久留存。
          </p>
        </div>

        <p v-if="formError" class="text-sm text-rose-600">{{ formError }}</p>
        <p class="text-xs text-slate-400">
          创建时会按当前流程模板 v{{ workspace.activeTemplate?.version }} 生成快照，
          之后模板变动不会影响这个项目。
        </p>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            @click="showCreate = false"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            :disabled="creating"
            @click="submitCreate"
          >
            {{ creating ? '创建中…' : '创建项目' }}
          </button>
        </div>
      </template>
    </ModalDialog>
  </div>
</template>
