// PRD 6.3 / 6.4 定义的枚举。全部集中在此，避免散落在各组件中。

export const CUSTOMER_TYPE = {
  OEM: 'oem',
  TIER1: 'tier1',
  DEALER: 'dealer',
  OTHER: 'other',
}

export const CUSTOMER_TYPE_OPTIONS = [
  { value: CUSTOMER_TYPE.OEM, label: '主机厂' },
  { value: CUSTOMER_TYPE.TIER1, label: '一级供应商' },
  { value: CUSTOMER_TYPE.DEALER, label: '经销商' },
  { value: CUSTOMER_TYPE.OTHER, label: '其他' },
]

export const CUSTOMER_STATUS = {
  DEVELOPING: 'developing',
  COOPERATING: 'cooperating',
  PAUSED: 'paused',
  TERMINATED: 'terminated',
}

export const CUSTOMER_STATUS_OPTIONS = [
  { value: CUSTOMER_STATUS.DEVELOPING, label: '开发中' },
  { value: CUSTOMER_STATUS.COOPERATING, label: '合作中' },
  { value: CUSTOMER_STATUS.PAUSED, label: '暂停' },
  { value: CUSTOMER_STATUS.TERMINATED, label: '已终止' },
]

export const PROJECT_STATUS = {
  ACTIVE: 'active',
  CLOSED_WON: 'closed_won',
  CLOSED_LOST: 'closed_lost',
}

export const PROJECT_STATUS_LABEL = {
  [PROJECT_STATUS.ACTIVE]: '进行中',
  [PROJECT_STATUS.CLOSED_WON]: '成交关闭',
  [PROJECT_STATUS.CLOSED_LOST]: '丢单关闭',
}

// PRD FR-09：字段类型固定 5 种，无 currency（金额已确认不入库）
export const FIELD_TYPE = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  DATE: 'date',
  SELECT: 'select',
}

export const FIELD_TYPE_OPTIONS = [
  { value: FIELD_TYPE.TEXT, label: '单行文本' },
  { value: FIELD_TYPE.TEXTAREA, label: '多行文本' },
  { value: FIELD_TYPE.NUMBER, label: '数字' },
  { value: FIELD_TYPE.DATE, label: '日期' },
  { value: FIELD_TYPE.SELECT, label: '单选下拉' },
]

// PRD 4.3：回退类型必须二选一
export const ROLLBACK_TYPE = {
  CUSTOMER_REJECT: 'customer_reject',
  SELF_ERROR: 'self_error',
}

export const ROLLBACK_TYPE_OPTIONS = [
  { value: ROLLBACK_TYPE.CUSTOMER_REJECT, label: '客户打回来了' },
  { value: ROLLBACK_TYPE.SELF_ERROR, label: '我们自己填错了' },
]

export const ROLLBACK_TYPE_LABEL = {
  [ROLLBACK_TYPE.CUSTOMER_REJECT]: '客户打回',
  [ROLLBACK_TYPE.SELF_ERROR]: '自己填错',
}

export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
}

// PRD FR-15：超过该分钟数，"最后同步"转为警示色
export const STALE_SYNC_MINUTES = 10

// PRD FR-17：多行文本字段的固定提示文案
export const SENSITIVE_INPUT_HINT =
  '请勿填写报价金额、客户联系人等敏感信息——数据将对全组可见且永久留存。'
