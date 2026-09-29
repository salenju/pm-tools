<script setup>
import { computed } from 'vue'
import { FIELD_TYPE, SENSITIVE_INPUT_HINT } from '../constants/enums'

/*
 * PRD FR-09：按字段类型渲染输入控件。
 * 验收项 4：所有多行文本字段下方固定展示敏感信息提示。
 */
const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { type: null, default: null },
  invalid: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const value = computed({
  get: () => props.modelValue ?? (props.field.type === FIELD_TYPE.NUMBER ? '' : ''),
  set: (next) => emit('update:modelValue', next),
})

function onNumberInput(event) {
  const raw = event.target.value
  if (raw === '') {
    emit('update:modelValue', null)
    return
  }
  const parsed = Number(raw)
  emit('update:modelValue', Number.isNaN(parsed) ? null : parsed)
}

const baseClass = computed(() => [
  'w-full rounded-lg border px-3 py-2 text-sm outline-none transition',
  props.invalid
    ? 'border-rose-400 bg-rose-50 focus:border-rose-500'
    : 'border-slate-300 bg-white focus:border-slate-500',
  props.disabled ? 'cursor-not-allowed bg-slate-100 text-slate-500' : '',
])
</script>

<template>
  <div>
    <label class="mb-1 block text-sm font-medium text-slate-700">
      {{ field.name }}
      <span v-if="field.required" class="text-rose-500">*</span>
    </label>

    <template v-if="field.type === FIELD_TYPE.TEXTAREA">
      <textarea
        v-model="value"
        :maxlength="field.maxLength || undefined"
        :disabled="disabled"
        rows="3"
        :class="baseClass"
      />
    </template>

    <template v-else-if="field.type === FIELD_TYPE.NUMBER">
      <input
        :value="modelValue ?? ''"
        type="number"
        inputmode="decimal"
        :min="field.min ?? undefined"
        :max="field.max ?? undefined"
        :disabled="disabled"
        :class="baseClass"
        @input="onNumberInput"
      />
    </template>

    <template v-else-if="field.type === FIELD_TYPE.DATE">
      <input v-model="value" type="date" :disabled="disabled" :class="baseClass" />
    </template>

    <template v-else-if="field.type === FIELD_TYPE.SELECT">
      <select v-model="value" :disabled="disabled" :class="baseClass">
        <option value="">请选择</option>
        <option v-for="option in field.options || []" :key="option" :value="option">
          {{ option }}
        </option>
      </select>
    </template>

    <template v-else>
      <input
        v-model="value"
        type="text"
        :maxlength="field.maxLength || undefined"
        :disabled="disabled"
        :class="baseClass"
      />
    </template>

    <!-- PRD FR-09 验收项 4 -->
    <p v-if="field.type === FIELD_TYPE.TEXTAREA" class="mt-1 text-xs leading-relaxed text-slate-400">
      {{ SENSITIVE_INPUT_HINT }}
    </p>
    <p v-else-if="invalid" class="mt-1 text-xs text-rose-600">此项为必填</p>
  </div>
</template>
