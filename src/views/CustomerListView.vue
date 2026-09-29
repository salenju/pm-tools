<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import ModalDialog from '../components/ModalDialog.vue'
import { CUSTOMER_STATUS_OPTIONS, CUSTOMER_TYPE_OPTIONS } from '../constants/enums'

/* PRD FR-03 客户管理。 */
const router = useRouter()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const keyword = ref('')
const showCreate = ref(false)
const creating = ref(false)
const formError = ref('')

const form = reactive({
  name: '',
  shortName: '',
  type: CUSTOMER_TYPE_OPTIONS[0].value,
  status: CUSTOMER_STATUS_OPTIONS[0].value,
  remark: '',
})

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return workspace.customerList
  return workspace.customerList.filter(
    (c) => c.name.toLowerCase().includes(kw) || (c.shortName || '').toLowerCase().includes(kw),
  )
})

function projectCountOf(customerId) {
  return workspace.projectList.filter((p) => p.customerId === customerId).length
}

function openCreate() {
  form.name = ''
  form.shortName = ''
  form.type = CUSTOMER_TYPE_OPTIONS[0].value
  form.status = CUSTOMER_STATUS_OPTIONS[0].value
  form.remark = ''
  formError.value = ''
  showCreate.value = true
}

async function submitCreate() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = '客户名称不能为空。'
    return
  }
  creating.value = true
  try {
    await workspace.createCustomer({ ...form })
    showCreate.value = false
    ui.success(`客户「${form.name}」已创建。`)
  } catch (error) {
    formError.value = error?.message || '创建失败'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索客户…"
        class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 sm:w-64"
      />
      <span class="text-xs text-slate-400">共 {{ rows.length }} 个客户</span>
      <button
        type="button"
        class="ml-auto rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        @click="openCreate"
      >
        新建客户
      </button>
    </div>

    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="customer in rows"
        :key="customer.id"
        type="button"
        class="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm"
        @click="router.push({ name: 'customer-detail', params: { id: customer.id } })"
      >
        <div class="flex items-start justify-between gap-2">
          <p class="font-medium text-slate-900">{{ customer.name }}</p>
          <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            {{ CUSTOMER_STATUS_OPTIONS.find((o) => o.value === customer.status)?.label || customer.status }}
          </span>
        </div>
        <p class="mt-1 text-xs text-slate-500">
          {{ CUSTOMER_TYPE_OPTIONS.find((o) => o.value === customer.type)?.label || customer.type }}
          <template v-if="customer.shortName"> · {{ customer.shortName }}</template>
        </p>
        <p class="mt-2 text-xs text-slate-400">{{ projectCountOf(customer.id) }} 个项目</p>
      </button>

      <p
        v-if="!rows.length"
        class="col-span-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400"
      >
        还没有客户。可以先新建一个，或者在新建项目时直接输入客户名自动建档。
      </p>
    </div>

    <ModalDialog v-if="showCreate" title="新建客户" @close="showCreate = false">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            客户名称 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            placeholder="例如：长城汽车"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">简称</label>
            <input
              v-model="form.shortName"
              type="text"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">类型</label>
            <select
              v-model="form.type"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            >
              <option v-for="option in CUSTOMER_TYPE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">状态</label>
          <select
            v-model="form.status"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          >
            <option v-for="option in CUSTOMER_STATUS_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">备注</label>
          <textarea
            v-model="form.remark"
            rows="2"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>
        <p v-if="formError" class="text-sm text-rose-600">{{ formError }}</p>
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
            {{ creating ? '创建中…' : '创建客户' }}
          </button>
        </div>
      </template>
    </ModalDialog>
  </div>
</template>
