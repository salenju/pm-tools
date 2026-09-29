import { getFlowNodes, sortNodes } from './flow'
import { formatDateTime } from './time'

/*
 * PRD FR-16 / 7.9.3：写入冲突的三方合并。
 *
 * GitHub 的写入粒度是**整个文件**，字段级合并必须在这里自行实现。
 * 三方定义为：
 *   base   = 本端最后一次成功同步到的远端版本（乐观锁的基准）
 *   local  = 本端当前正在编辑的内容
 *   remote = 冲突发生时重新拉取到的远端最新版本
 *
 * 合并规则（逐字段）：
 *   local === base          → 采用 remote（只有对方改）
 *   remote === base         → 采用 local （只有我改）
 *   local === remote        → 双方改成一样，无冲突
 *   三者互不相同            → 真冲突，默认采用 remote，并交给用户逐字段选择
 */

const META_FIELDS = [
  { key: 'name', label: '项目名称' },
  { key: 'customerId', label: '所属客户' },
  { key: 'ownerId', label: '负责销售' },
  { key: 'nextFollowUpAt', label: '下次跟进日期' },
  { key: 'remark', label: '备注' },
  { key: 'status', label: '项目状态' },
]

export function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** 标量三方合并。 */
function mergeScalar(baseVal, localVal, remoteVal) {
  const b = baseVal ?? null
  const l = localVal ?? null
  const r = remoteVal ?? null
  if (l === b && r === b) return { value: b, conflict: false }
  if (l === b) return { value: r, conflict: false }
  if (r === b) return { value: l, conflict: false }
  if (l === r) return { value: l, conflict: false }
  return { value: r, conflict: true }
}

function nodeIndexMap(nodes = []) {
  const map = new Map()
  sortNodes(nodes).forEach((node, index) => map.set(node.id, index))
  return map
}

function nodeName(nodes = [], nodeId) {
  return nodes.find((n) => n.id === nodeId)?.name || nodeId || '(未知节点)'
}

/** 取某节点最新一条记录（含未离开与已离开）。 */
function latestRecord(project, nodeId) {
  const records = (project?.nodeRecords || []).filter((r) => r.nodeId === nodeId)
  if (!records.length) return null
  return records.reduce((acc, r) => {
    if (!acc) return r
    return new Date(r.enteredAt || 0) >= new Date(acc.enteredAt || 0) ? r : acc
  }, null)
}

function valuesOf(project, nodeId) {
  return latestRecord(project, nodeId)?.values || {}
}

function recordKey(record) {
  return `${record.nodeId}::${record.enteredAt}`
}

function toRecordMap(records = []) {
  const map = new Map()
  for (const record of records) map.set(recordKey(record), record)
  return map
}

/** 合并单个节点记录的 values，逐字段检测冲突。 */
function mergeRecordValues(baseValues, localValues, remoteValues, node, conflicts, recordRef, enteredAt) {
  const merged = {}
  const fieldIds = new Set([
    ...Object.keys(baseValues || {}),
    ...Object.keys(localValues || {}),
    ...Object.keys(remoteValues || {}),
  ])
  for (const fieldId of fieldIds) {
    const field = (node?.fields || []).find((f) => f.id === fieldId)
    const label = field?.name || fieldId
    const result = mergeScalar(baseValues?.[fieldId], localValues?.[fieldId], remoteValues?.[fieldId])
    merged[fieldId] = result.value
    if (result.conflict) {
      conflicts.push({
        id: `field:${recordRef}:${fieldId}`,
        scope: 'field',
        nodeId: node?.id || '',
        nodeName: node?.name || '',
        enteredAt: enteredAt || '',
        fieldId,
        label: `「${node?.name || ''}」的「${label}」`,
        baseValue: baseValues?.[fieldId] ?? null,
        localValue: localValues?.[fieldId] ?? null,
        remoteValue: remoteValues?.[fieldId] ?? null,
        resolved: false,
      })
    }
  }
  return merged
}

function resolveRecord(baseRec, localRec, remoteRec, nodes, conflicts) {
  const nodeId = localRec?.nodeId || remoteRec?.nodeId || baseRec?.nodeId
  const node = nodes.find((n) => n.id === nodeId)
  const enteredAt = localRec?.enteredAt || remoteRec?.enteredAt || baseRec?.enteredAt || ''
  const ref = `${nodeId}:${enteredAt}`

  // 只有一端存在该记录：说明是该端新增的，直接采用
  if (!localRec) return { ...remoteRec }
  if (!remoteRec) return { ...localRec }

  const left = mergeScalar(baseRec?.leftAt, localRec?.leftAt, remoteRec?.leftAt)
  const leftBy = mergeScalar(baseRec?.leftBy, localRec?.leftBy, remoteRec?.leftBy)

  const merged = {
    ...remoteRec,
    leftAt: left.value,
    leftBy: leftBy.value,
    values: mergeRecordValues(
      baseRec?.values || {},
      localRec?.values || {},
      remoteRec?.values || {},
      node,
      conflicts,
      ref,
      enteredAt,
    ),
  }
  return merged
}

/**
 * 三方合并一个项目。
 * @param {{base: object, local: object, remote: object, nodes?: object[]}} input
 * @returns {{merged: object, conflicts: object[]}}
 */
export function mergeProject({ base, local, remote, nodes }) {
  const flowNodes = nodes || getFlowNodes(remote || local || base)
  const conflicts = []

  const merged = { ...remote }

  // 1. 标量字段
  for (const meta of META_FIELDS) {
    const result = mergeScalar(base?.[meta.key], local?.[meta.key], remote?.[meta.key])
    merged[meta.key] = result.value
    if (result.conflict) {
      conflicts.push({
        id: `meta:${meta.key}`,
        scope: 'meta',
        key: meta.key,
        label: meta.label,
        baseValue: base?.[meta.key] ?? null,
        localValue: local?.[meta.key] ?? null,
        remoteValue: remote?.[meta.key] ?? null,
        resolved: false,
      })
    }
  }

  // 2. 当前节点（正向/回退都体现在这里）
  const nodeMerge = mergeScalar(base?.currentNodeId, local?.currentNodeId, remote?.currentNodeId)
  merged.currentNodeId = nodeMerge.value
  if (nodeMerge.conflict) {
    conflicts.push({
      id: 'flow:currentNodeId',
      scope: 'flow',
      key: 'currentNodeId',
      label: '当前节点',
      baseValue: base?.currentNodeId ?? null,
      baseLabel: nodeName(flowNodes, base?.currentNodeId),
      localValue: local?.currentNodeId ?? null,
      localLabel: nodeName(flowNodes, local?.currentNodeId),
      remoteValue: remote?.currentNodeId ?? null,
      remoteLabel: nodeName(flowNodes, remote?.currentNodeId),
      resolved: false,
    })
  }

  // 3. 节点记录（按 nodeId + enteredAt 做并集）
  const baseMap = toRecordMap(base?.nodeRecords)
  const localMap = toRecordMap(local?.nodeRecords)
  const remoteMap = toRecordMap(remote?.nodeRecords)
  const allKeys = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()])
  const records = []
  for (const key of allKeys) {
    records.push(
      resolveRecord(baseMap.get(key), localMap.get(key), remoteMap.get(key), flowNodes, conflicts),
    )
  }
  const indexMap = nodeIndexMap(flowNodes)
  records.sort((a, b) => {
    const t = new Date(a.enteredAt || 0) - new Date(b.enteredAt || 0)
    if (t !== 0) return t
    return (indexMap.get(a.nodeId) ?? 0) - (indexMap.get(b.nodeId) ?? 0)
  })
  merged.nodeRecords = records

  // 4. 回退历史（append-only，取并集）
  const rollbackKeys = new Set()
  const rollbacks = []
  for (const item of [...(base?.rollbackHistory || []), ...(local?.rollbackHistory || []), ...(remote?.rollbackHistory || [])]) {
    const key = `${item.at}::${item.by}::${item.fromNodeId}::${item.toNodeId}::${item.reason}`
    if (rollbackKeys.has(key)) continue
    rollbackKeys.add(key)
    rollbacks.push(item)
  }
  rollbacks.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0))
  merged.rollbackHistory = rollbacks

  // 5. flowSnapshot：项目创建时定死，原则不参与变更；若远端有则以远端为准
  merged.flowSnapshot = remote?.flowSnapshot || local?.flowSnapshot || base?.flowSnapshot

  return { merged, conflicts }
}

/**
 * 生成"对方改了什么"的差异摘要（PRD FR-16 第 3 步）。
 * @returns {{by: string, at: string, entries: Array<{type: string, text: string}>}}
 */
export function describeRemoteChanges(base, remote, nodes) {
  const flowNodes = nodes || getFlowNodes(remote)
  const indexMap = nodeIndexMap(flowNodes)
  const entries = []

  if (base?.currentNodeId !== remote?.currentNodeId && remote?.currentNodeId) {
    const fromName = nodeName(flowNodes, base?.currentNodeId)
    const toName = nodeName(flowNodes, remote?.currentNodeId)
    const fromIndex = indexMap.get(base?.currentNodeId)
    const toIndex = indexMap.get(remote?.currentNodeId)
    const action = fromIndex !== undefined && toIndex !== undefined && toIndex < fromIndex ? '回退到' : '推进到'
    entries.push({ type: 'flow', text: `把节点从「${fromName}」${action}「${toName}」` })
  }

  for (const node of sortNodes(flowNodes)) {
    const before = valuesOf(base, node.id)
    const after = valuesOf(remote, node.id)
    for (const field of node.fields || []) {
      const nextValue = after[field.id]
      if (sameValue(before[field.id], nextValue)) continue
      if (nextValue === null || nextValue === undefined || nextValue === '') continue
      entries.push({
        type: 'field',
        text: `填写了「${node.name}」的「${field.name}」为 ${formatValue(nextValue)}`,
      })
    }
  }

  const baseRollbacks = base?.rollbackHistory || []
  const remoteRollbacks = remote?.rollbackHistory || []
  if (remoteRollbacks.length > baseRollbacks.length) {
    for (const item of remoteRollbacks.slice(baseRollbacks.length)) {
      entries.push({
        type: 'rollback',
        text: `把「${item.fromNodeName}」回退到「${item.toNodeName}」，原因：${item.reason}`,
      })
    }
  }

  for (const meta of META_FIELDS) {
    if (sameValue(base?.[meta.key], remote?.[meta.key])) continue
    if (remote?.[meta.key] === undefined) continue
    entries.push({ type: 'meta', text: `修改了${meta.label}` })
  }

  return {
    by: remote?.updatedBy || '其他成员',
    at: remote?.updatedAt || '',
    atText: formatDateTime(remote?.updatedAt),
    entries,
  }
}

export function formatValue(value) {
  if (value === null || value === undefined || value === '') return '（空）'
  if (typeof value === 'number') return String(value)
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}
