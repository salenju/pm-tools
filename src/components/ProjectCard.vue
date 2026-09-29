<script setup>
import { computed } from 'vue'
import { isCurrentNodeComplete, isStale, getStaleDays, getCurrentNode } from '../utils/flow'
import { PROJECT_STATUS_LABEL } from '../constants/enums'

const props = defineProps({
  project: { type: Object, required: true },
  customerLabel: { type: String, default: '' },
  columnName: { type: String, default: '' },
  dirty: { type: Boolean, default: false },
  hasDraft: { type: Boolean, default: false },
  draggable: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'advance', 'dragstart', 'dragend'])

const stale = computed(() => isStale(props.project))
const staleDays = computed(() => getStaleDays(props.project))
const complete = computed(() => isCurrentNodeComplete(props.project))
const node = computed(() => getCurrentNode(props.project))

/** 该项目使用的流程版本与看板列不一致时，在卡片上标出它自己的节点名。 */
const nodeNameDiffers = computed(
  () => Boolean(node.value?.name) && node.value.name !== props.columnName,
)

const ownerInitial = computed(() => {
  const name = props.project.updatedByName || props.project.createdByName || ''
  return name ? name.slice(0, 1) : '?'
})
</script>

<template>
  <div
    class="cursor-pointer rounded-lg border bg-white p-2.5 shadow-sm transition hover:border-slate-300 hover:shadow"
    :class="stale ? 'border-rose-200' : 'border-slate-200'"
    :draggable="draggable"
    @click="emit('open', project)"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend', $event)"
  >
    <div class="flex items-start gap-2">
      <p class="line-clamp-2 flex-1 text-sm font-medium leading-snug text-slate-900">
        {{ project.name }}
      </p>
      <span v-if="hasDraft" class="mt-0.5 shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
        草稿
      </span>
      <span v-else-if="dirty" class="mt-0.5 shrink-0 rounded bg-sky-100 px-1 text-[10px] text-sky-800">
        未保存
      </span>
    </div>

    <p class="mt-1 truncate text-xs text-slate-500">{{ customerLabel }}</p>

    <p v-if="nodeNameDiffers" class="mt-1 truncate text-[11px] text-slate-400">
      实际节点：{{ node?.name }}
    </p>

    <div class="mt-2 flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <span
          class="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[10px] font-medium text-slate-600"
          :title="project.updatedByName || ''"
        >
          {{ ownerInitial }}
        </span>
        <span
          v-if="stale"
          class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
        >
          滞留 {{ staleDays }} 天
        </span>
        <span
          v-else-if="project.status !== 'active'"
          class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
        >
          {{ PROJECT_STATUS_LABEL[project.status] }}
        </span>
      </div>

      <button
        type="button"
        class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition"
        :class="
          complete
            ? 'border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white'
            : 'border-slate-200 text-slate-400'
        "
        :title="complete ? '推进到下一节点' : '还有必填项未填写'"
        @click.stop="emit('advance', project)"
      >
        推进
      </button>
    </div>
  </div>
</template>
