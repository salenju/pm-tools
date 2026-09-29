<script setup>
import { computed } from 'vue'
import { buildNodeStates } from '../utils/flow'
import { ROLLBACK_TYPE_LABEL } from '../constants/enums'
import { formatDateTime } from '../utils/time'

/*
 * PRD FR-24 流转轨迹条。
 *
 * 实现约定（见 PRD 7.8 与 FR-24 渲染约定）：
 *   - 零依赖：线性流程用「HTML 节点 + CSS 连线 + 一层 SVG 覆盖」实现，
 *     不引入任何图布局库。单链布局可常量时间手算坐标。
 *   - 有限动效：只有"当前活跃的那一条边"在流动，其余静止。
 *   - 尊重 prefers-reduced-motion（全局样式已统一处理）。
 *   - 数据自足：只读项目自身的 flowSnapshot / nodeRecords / rollbackHistory。
 */

// 尺寸常量：节点宽 128，间距 32，步长 160
const NODE_W = 128
const STEP = 160
const NODE_CENTER = NODE_W / 2

const props = defineProps({
  project: { type: Object, required: true },
})

const states = computed(() => buildNodeStates(props.project))

const stripWidth = computed(() =>
  states.value.length ? states.value.length * NODE_W + (states.value.length - 1) * (STEP - NODE_W) : 0,
)

const currentIndex = computed(() => states.value.findIndex((s) => s.status === 'current'))

/** 最近一次回退，用于绘制红色反向流动路径。 */
const latestRollback = computed(() => {
  const history = props.project.rollbackHistory || []
  if (!history.length) return null
  return history[history.length - 1]
})

const rollbackGeometry = computed(() => {
  const rollback = latestRollback.value
  if (!rollback) return null
  const fromIndex = states.value.findIndex((s) => s.node.id === rollback.fromNodeId)
  const toIndex = states.value.findIndex((s) => s.node.id === rollback.toNodeId)
  if (fromIndex < 0 || toIndex < 0) return null
  const fromX = fromIndex * STEP + NODE_CENTER
  const toX = toIndex * STEP + NODE_CENTER
  return {
    d: `M ${fromX} 10 C ${fromX} 54, ${toX} 54, ${toX} 10`,
    labelX: (fromX + toX) / 2,
    label: `${ROLLBACK_TYPE_LABEL[rollback.type] || '回退'}：${rollback.reason}`,
    rollback,
  }
})

function connectorClass(index) {
  // 连接节点 index → index+1
  const left = states.value[index]
  const right = states.value[index + 1]
  if (!left || !right) return ''
  if (right.status === 'done') return 'connector connector--done'
  if (left.status === 'current') return 'connector connector--active'
  return 'connector connector--pending'
}

function markerClass(state) {
  if (state.status === 'done') return 'bg-emerald-500 text-white border-emerald-500'
  if (state.status === 'current') {
    return state.isStale
      ? 'bg-rose-500 text-white border-rose-500 ring-4 ring-rose-100'
      : 'bg-sky-500 text-white border-sky-500 ring-4 ring-sky-100'
  }
  return 'bg-white text-slate-400 border-slate-300'
}
</script>

<template>
  <section class="rounded-xl border border-slate-200 bg-white p-3">
    <div class="mb-2 flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-slate-900">流转轨迹</h3>
      <span
        v-if="latestRollback"
        class="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
        :title="`${latestRollback.byName || ''} ${formatDateTime(latestRollback.at)}`"
      >
        共 {{ (project.rollbackHistory || []).length }} 次回退
      </span>
    </div>

    <div class="thin-scrollbar overflow-x-auto pb-1">
      <div class="relative" :style="{ width: `${stripWidth}px`, minWidth: '100%' }">
        <!-- 节点行 -->
        <div class="relative flex items-start">
          <template v-for="(state, index) in states" :key="state.node.id">
            <div class="flex-none" :style="{ width: `${NODE_W}px` }">
              <div class="flex flex-col items-center gap-1.5 px-1">
                <span
                  class="grid h-9 w-9 place-items-center rounded-full border-2 text-xs font-semibold transition"
                  :class="markerClass(state)"
                >
                  <template v-if="state.status === 'done'">✓</template>
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <span
                  class="text-center text-xs leading-tight"
                  :class="
                    state.status === 'current'
                      ? 'font-semibold text-slate-900'
                      : state.status === 'done'
                        ? 'text-slate-600'
                        : 'text-slate-400'
                  "
                >
                  {{ state.node.name }}
                </span>
                <span
                  v-if="state.isStale"
                  class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700"
                >
                  滞留 {{ state.staleDays }} 天
                </span>
                <span
                  v-else-if="state.wasRolledBack"
                  class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600"
                >
                  曾被退回
                </span>
              </div>
            </div>

            <div
              v-if="index < states.length - 1"
              class="flex-none self-start"
              :style="{ width: `${STEP - NODE_W}px`, marginTop: '17px' }"
              aria-hidden="true"
            >
              <div :class="connectorClass(index)" />
            </div>
          </template>
        </div>

        <!-- 回退路径：红色反向流动虚线 -->
        <svg
          v-if="rollbackGeometry"
          class="pointer-events-none absolute left-0"
          :style="{ top: '38px', width: `${stripWidth}px`, height: '62px' }"
          :width="stripWidth"
          height="62"
          :viewBox="`0 0 ${stripWidth} 62`"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="rollback-arrow"
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#e11d48" />
            </marker>
          </defs>
          <!--
            路径方向为「当前节点 → 目标节点」，因此虚线沿路径正方向流动，
            视觉上就是"往回流"，与看板整体的从左到右正向流动相反。
          -->
          <path
            class="rollback-path"
            :d="rollbackGeometry.d"
            marker-end="url(#rollback-arrow)"
          />
          <text
            :x="rollbackGeometry.labelX"
            y="52"
            text-anchor="middle"
            class="fill-rose-600"
            style="font-size: 10px"
          >
            {{ rollbackGeometry.label.slice(0, 24) }}
          </text>
        </svg>
      </div>
    </div>
  </section>
</template>

<style scoped>
.connector {
  height: 2px;
  border-radius: 9999px;
}

.connector--done {
  background-color: #a7f3d0;
}

.connector--pending {
  background-color: #e2e8f0;
}

/* 只有当前活跃的这一条边流动（FR-24 渲染约定 3） */
.connector--active {
  background-image: repeating-linear-gradient(
    90deg,
    #0ea5e9 0 8px,
    transparent 8px 16px
  );
  animation: connector-flow 0.8s linear infinite;
}

@keyframes connector-flow {
  to {
    background-position: 16px 0;
  }
}

.rollback-path {
  fill: none;
  stroke: #e11d48;
  stroke-width: 2;
  stroke-dasharray: 6 6;
  animation: rollback-dash 1s linear infinite;
}

@keyframes rollback-dash {
  to {
    stroke-dashoffset: -12;
  }
}
</style>
