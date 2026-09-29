import { daysSince } from './time'

// 流程推导逻辑。全部为纯函数，便于单测与在 store / 组件中复用。
// 关键原则（PRD 6.4）：节点定义一律来自项目的 flowSnapshot，**不是**当前最新模板。

/** 按 order 升序返回节点。 */
export function sortNodes(nodes = []) {
  return [...nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** 项目的流程节点（来自快照）。 */
export function getFlowNodes(project) {
  const nodes = project?.flowSnapshot?.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return []
  return sortNodes(nodes)
}

export function getCurrentIndex(project, nodes = getFlowNodes(project)) {
  return nodes.findIndex((n) => n.id === project?.currentNodeId)
}

export function getCurrentNode(project) {
  return getFlowNodes(project).find((n) => n.id === project?.currentNodeId) || null
}

export function getNodeById(project, nodeId) {
  return getFlowNodes(project).find((n) => n.id === nodeId) || null
}

/** 某节点当前记录（未离开的最新一条）。 */
export function getActiveRecord(project, nodeId) {
  const records = (project?.nodeRecords || []).filter((r) => r.nodeId === nodeId)
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (!records[i].leftAt) return records[i]
  }
  return records[records.length - 1] || null
}

/** 某节点已填写的字段值。 */
export function getNodeValues(project, nodeId) {
  return getActiveRecord(project, nodeId)?.values || {}
}

/**
 * 返回所有未填的必填字段（PRD FR-09 验收 2 / FR-06 验收 1）。
 * @param {object} node 快照中的节点定义
 * @param {Record<string, unknown>} values
 */
export function findMissingRequiredFields(node, values = {}) {
  if (!node) return []
  return (node.fields || []).filter((field) => {
    if (!field.required) return false
    const value = values[field.id]
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim() === ''
    return false
  })
}

/** 下一节点；已在末节点返回 null（PRD 4.2 不允许跳节点）。 */
export function getNextNode(project) {
  const nodes = getFlowNodes(project)
  const index = getCurrentIndex(project, nodes)
  if (index < 0 || index >= nodes.length - 1) return null
  return nodes[index + 1]
}

/** 可回退的目标节点（PRD FR-07 验收 1：只含当前节点之前的节点）。 */
export function getRollbackTargets(project) {
  const nodes = getFlowNodes(project)
  const index = getCurrentIndex(project, nodes)
  if (index <= 0) return []
  return nodes.slice(0, index)
}

/** 当前节点已停留天数。 */
export function getStaleDays(project, nowMs = Date.now()) {
  const record = getActiveRecord(project, project?.currentNodeId)
  const from = record?.enteredAt || project?.createdAt
  return daysSince(from, nowMs)
}

/** 是否停滞超期（用于看板标红）。 */
export function isStale(project, nowMs = Date.now()) {
  const node = getCurrentNode(project)
  const threshold = node?.staleDays ?? 0
  if (!threshold) return false
  return getStaleDays(project, nowMs) > threshold
}

/** 当前节点必填是否齐全。 */
export function isCurrentNodeComplete(project) {
  const node = getCurrentNode(project)
  if (!node) return false
  return findMissingRequiredFields(node, getNodeValues(project, node.id)).length === 0
}

/**
 * PRD FR-24：构造流转轨迹条所需的每个节点状态。
 * @returns {Array<{node: object, status: 'done'|'current'|'pending', wasRolledBack: boolean, staleDays: number, isStale: boolean}>}
 */
export function buildNodeStates(project, nowMs = Date.now()) {
  const nodes = getFlowNodes(project)
  const currentIndex = getCurrentIndex(project, nodes)
  const rolledTo = new Set((project?.rollbackHistory || []).map((r) => r.toNodeId))
  const rollbackFroms = new Set((project?.rollbackHistory || []).map((r) => r.fromNodeId))

  return nodes.map((node, index) => {
    let status = 'pending'
    if (currentIndex >= 0) {
      if (index < currentIndex) status = 'done'
      else if (index === currentIndex) status = 'current'
    }
    const stale = index === currentIndex ? getStaleDays(project, nowMs) : 0
    return {
      node,
      status,
      wasRolledBack: rolledTo.has(node.id),
      wasRollbackSource: rollbackFroms.has(node.id),
      staleDays: stale,
      isStale: index === currentIndex && (node.staleDays ?? 0) > 0 && stale > node.staleDays,
    }
  })
}

/**
 * 根据"已关闭"节点的填写内容推导项目状态（PRD 4.4）。
 * 关闭原因是「成交」→ closed_won，否则 closed_lost。
 */
export function deriveClosedStatus(project, closedNode) {
  if (!closedNode) return null
  const values = getNodeValues(project, closedNode.id)
  const reasonField = (closedNode.fields || []).find((f) => f.name.includes('关闭原因'))
  const reason = reasonField ? values[reasonField.id] : null
  if (reason === '成交') return 'closed_won'
  if (reason === '丢单') return 'closed_lost'
  return 'closed_lost'
}

/** 项目是否处于关闭态（关闭态从看板主视图移出，PRD TBD-04）。 */
export function isClosed(project) {
  return project?.status === 'closed_won' || project?.status === 'closed_lost'
}
