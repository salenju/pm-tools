<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import { getCurrentNode, isStale, getStaleDays } from '../utils/flow'
import { CUSTOMER_STATUS_OPTIONS, CUSTOMER_TYPE_OPTIONS } from '../constants/enums'
import { formatDateTime } from '../utils/time'

const route = useRoute()
const router = useRouter()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const customer = computed(() => workspace.customerById.get(route.params.id) || null)

const form = reactive({
  name: '',
  shortName: '',
  type: CUSTOMER_TYPE_OPTIONS[0].value,
  status: CUSTOMER_STATUS_OPTIONS[0].value,
  remark: '',
})
const saving = ref(false)
const errorMessage = ref('')

watch(
  () => customer.value?.id,
  () => {
    if (!customer.value) return
    form.name = customer.value.name || ''
    form.shortName = customer.value.shortName || ''
    form.type = customer.value.type || CUSTOMER_TYPE_OPTIONS[0].value
    form.status = customer.value.status || CUSTOMER_STATUS_OPTIONS[0].value
    form.remark = customer.value.remark || ''
  },
  { immediate: true },
)

const projects = computed(() =>
  workspace.projectList
    .filter((project) => project.customerId === route.params.id)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
)

async function save() {
  errorMessage.value = ''
  if (!form.name.trim()) {
    errorMessage.value = '客户名称不能为空。'
    return
  }
  saving.value = true
  try {
    await workspace.updateCustomer(route.params.id, { ...form, name: form.name.trim() })
    ui.success('客户信息已保存。')
  } catch (error) {
    errorMessage.value = error?.message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-4">
    <p
      v-if="!customer"
      class="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
    >
      找不到该客户。
      <button class="ml-1 text-sky-600 underline" @click="router.push({ name: 'customers' })">
        返回客户列表
      </button>
    </p>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          @click="router.push({ name: 'customers' })"
        >
          ← 返回
        </button>
        <h1 class="text-lg font-semibold text-slate-900">{{ customer.name }}</h1>
        <span class="text-xs text-slate-400">
          更新于 {{ formatDateTime(customer.updatedAt) }}
          <template v-if="customer.updatedByName">· {{ customer.updatedByName }}</template>
        </span>
        <span
          v-if="workspace.projectDirty(customer.id)"
          class="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700"
        >
          有未保存的改动
        </span>
      </div>

      <section class="mb-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">客户信息</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">客户名称</label>
            <input
              v-model="form.name"
              type="text"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
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
          <div class="sm:col-span-2">
            <label class="mb-1 block text-sm font-medium text-slate-700">备注</label>
            <textarea
              v-model="form.remark"
              rows="2"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
        </div>
        <p v-if="errorMessage" class="mt-2 text-sm text-rose-600">{{ errorMessage }}</p>
        <button
          type="button"
          class="mt-3 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-slate-900">
          该客户的项目
          <span class="ml-1 text-xs font-normal text-slate-400">{{ projects.length }} 个</span>
        </h2>
        <p v-if="!projects.length" class="text-sm text-slate-400">还没有关联的项目。</p>
        <ul v-else class="divide-y divide-slate-100">
          <li
            v-for="project in projects"
            :key="project.id"
            class="flex cursor-pointer flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50"
            @click="router.push({ name: 'project-detail', params: { id: project.id } })"
          >
            <span class="flex-1 text-sm font-medium text-slate-900">{{ project.name }}</span>
            <span class="text-xs text-slate-500">{{ getCurrentNode(project)?.name || '—' }}</span>
            <span
              v-if="isStale(project)"
              class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700"
            >
              滞留 {{ getStaleDays(project) }} 天
            </span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
