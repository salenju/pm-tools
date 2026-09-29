import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import * as repoStore from '../services/repoStore'
import { ConflictError } from '../services/githubClient'
import { fileCache, drafts as draftStore, meta, META_KEYS } from '../storage/localDb'
import { createDefaultTemplate, cloneTemplate } from '../constants/defaultTemplate'
import { CUSTOMER_STATUS, CUSTOMER_TYPE, PROJECT_STATUS, ROLLBACK_TYPE, SYNC_STATUS } from '../constants/enums'
import { useSessionStore } from './session'
import { describeRemoteChanges, mergeProject } from '../utils/diff'
import {
  deriveClosedStatus,
  findMissingRequiredFields,
  getActiveRecord,
  getCurrentNode,
  getFlowNodes,
  getNextNode,
  getNodeValues,
  isClosed,
} from '../utils/flow'
import { collectFieldIds, newCustomerId, newProjectId, nextSeqId } from '../utils/id'
import { nowIso, todayString } from '../utils/time'

const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * 工作区：全部业务数据 + 同步引擎（PRD 7.9）。
 *
 * 每个对象都保存两份：data（本地工作副本）与 base（最后一次成功同步到的远端版本）。
 * base 是三方合并（FR-16）的基准，绝不能省。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const session = useSessionStore()

  const booted = ref(false)
  const booting = ref(false)
  const configLoaded = ref(false)
  const configSha = ref(null)
  const configEtag = ref(null)
  const config = ref(null)
  /** 远端是否存在 config.json（即便内容无法解析）。用于阻止在错误的仓库上初始化。 */
  const configFileExists = ref(false)
  /** 远端仓库的真实文件总数（不限本工具的数据路径），用于识别"连错仓库"。 */
  const remoteFileCount = ref(0)

  const customers = reactive({})
  const projects = reactive({})

  const syncStatus = ref(SYNC_STATUS.IDLE)
  const syncError = ref('')
  const lastSyncAt = ref('')
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

  const pendingConflict = ref(null)
  const drafts = reactive({})
  const savingIds = reactive({})

  /* ------------------------------ 派生数据 ------------------------------ */

  const activeTemplate = computed(() => {
    const templates = config.value?.flowTemplates || []
    if (!templates.length) return null
    const active = templates.find((t) => t.version === config.value?.activeTemplateVersion)
    return active || templates[templates.length - 1]
  })

  const templateHistory = computed(() =>
    [...(config.value?.flowTemplates || [])].sort((a, b) => b.version - a.version),
  )

  const customerList = computed(() =>
    Object.values(customers)
      .map((entry) => entry.data)
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')),
  )

  const projectList = computed(() => Object.values(projects).map((entry) => entry.data).filter(Boolean))

  const activeProjectList = computed(() => projectList.value.filter((p) => !isClosed(p)))

  const closedProjectList = computed(() => projectList.value.filter((p) => isClosed(p)))

  const customerById = computed(() => {
    const map = new Map()
    for (const customer of customerList.value) map.set(customer.id, customer)
    return map
  })

  const projectById = computed(() => {
    const map = new Map()
    for (const project of projectList.value) map.set(project.id, project)
    return map
  })

  const isAdmin = computed(() => {
    const admins = config.value?.admins || []
    return Boolean(session.actorId) && admins.includes(session.actorId)
  })

  /**
   * config.json 是否真的是本工具的数据结构。
   *
   * 用途：用户填错 owner 时，若该地址恰好指向另一个真实存在的仓库，
   * GitHub 不会有任何报错，工具会静默把数据写进去。这是本项目最隐蔽的风险，
   * 所以在初始化前必须校验结构。
   */
  const configShapeValid = computed(() => {
    const current = config.value
    if (!current || typeof current !== 'object') return false
    const templates = current.flowTemplates
    if (!Array.isArray(templates) || templates.length === 0) return false
    const active =
      templates.find((t) => t.version === current.activeTemplateVersion) ||
      templates[templates.length - 1]
    return Array.isArray(active?.nodes) && active.nodes.length > 0
  })

  const draftList = computed(() =>
    Object.entries(drafts)
      .map(([projectId, value]) => ({
        projectId,
        savedAt: value.savedAt,
        name: projects[projectId]?.data?.name || projectId,
      }))
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)),
  )

  function customerName(id) {
    return customerById.value.get(id)?.shortName || customerById.value.get(id)?.name || '未指派客户'
  }

  function projectDirty(id) {
    return Boolean(projects[id]?.dirty)
  }

  /* ------------------------------ 本地缓存 ------------------------------ */

  function applyRemoteFile(path, data, sha, etag) {
    if (path === repoStore.paths.config) {
      config.value = data
      configSha.value = sha
      configEtag.value = etag ?? null
      configLoaded.value = true
      return
    }
    const id = repoStore.idFromPath(path)
    if (repoStore.isCustomerPath(path)) {
      customers[id] = { data: clone(data), base: clone(data), sha, dirty: false }
      return
    }
    if (repoStore.isProjectPath(path)) {
      const item = projects[id]
      // PRD 7.9.3：本地有未提交修改时，后台同步**不得**覆盖它，
      // 交由保存时的 409 冲突流程处理。
      if (item?.dirty) {
        item.remoteSha = sha
        return
      }
      projects[id] = { data: clone(data), base: clone(data), sha, dirty: false }
    }
  }

  async function cacheFile(path, data, sha, etag) {
    await fileCache.put({ key: path, sha, etag: etag ?? null, content: clone(data), fetchedAt: nowIso() })
  }

  /** 从 IndexedDB 秒开（PRD 7.5）。 */
  async function hydrateFromCache() {
    try {
      const rows = await fileCache.getAll()
      for (const row of rows) {
        applyRemoteFile(row.key, row.content, row.sha, row.etag)
      }
      lastSyncAt.value = (await meta.get(META_KEYS.lastSyncAt)) || ''
      const draftRows = await draftStore.getAll()
      for (const row of draftRows) {
        drafts[row.projectId] = { savedAt: row.savedAt }
        // 草稿内容也恢复，保证断网刷新后不丢（FR-17 验收 1、3）
        if (row.content && projects[row.projectId]) {
          projects[row.projectId].data = clone(row.content)
          projects[row.projectId].dirty = true
        }
      }
    } catch (error) {
      console.warn('[pm-tools] 本地缓存读取失败：', error)
    }
  }

  /* ------------------------------ 同步 ------------------------------ */

  function knownSha(path) {
    if (path === repoStore.paths.config) return configSha.value
    const id = repoStore.idFromPath(path)
    return (repoStore.isCustomerPath(path) ? customers[id] : projects[id])?.sha ?? null
  }

  async function fetchAndApply(path, { force = false } = {}) {
    const cached = await fileCache.get(path)
    const result = await repoStore.fetchJson(path, { etag: force ? undefined : cached?.etag })
    if (result.notModified) return false
    await cacheFile(path, result.data, result.sha, result.etag)
    applyRemoteFile(path, result.data, result.sha, result.etag)
    return true
  }

  /**
   * 增量同步（PRD 7.9.1 / 7.9.2）。
   * 数据无变化时成本 = 1 次目录树请求。
   */
  async function sync({ force = false } = {}) {
    if (!repoStore.isConfigured()) return { ok: false, reason: 'not-configured' }
    if (syncStatus.value === SYNC_STATUS.SYNCING) return { ok: false, reason: 'busy' }

    syncStatus.value = SYNC_STATUS.SYNCING
    syncError.value = ''
    try {
      const { files, totalFiles } = await repoStore.fetchTree()
      remoteFileCount.value = totalFiles
      configFileExists.value = files.has(repoStore.paths.config)

      // 远端已不存在的文件 → 从本地状态与缓存移除
      const knownPaths = [
        repoStore.paths.config,
        ...Object.keys(customers).map((id) => repoStore.paths.customer(id)),
        ...Object.keys(projects).map((id) => repoStore.paths.project(id)),
      ]
      for (const path of knownPaths) {
        if (files.has(path)) continue
        if (path === repoStore.paths.config) {
          config.value = null
          configLoaded.value = false
          configSha.value = null
        } else if (repoStore.isCustomerPath(path)) {
          delete customers[repoStore.idFromPath(path)]
        } else {
          delete projects[repoStore.idFromPath(path)]
        }
        await fileCache.remove(path)
      }

      const toFetch = []
      for (const [path, sha] of files) {
        if (force || knownSha(path) !== sha) toFetch.push(path)
      }

      let changed = 0
      for (const path of toFetch) {
        // 顺序拉取，避免瞬时并发过高
        // eslint-disable-next-line no-await-in-loop
        if (await fetchAndApply(path, { force })) changed += 1
      }

      lastSyncAt.value = nowIso()
      await meta.put(META_KEYS.lastSyncAt, lastSyncAt.value)
      syncStatus.value = SYNC_STATUS.IDLE
      return { ok: true, changed, total: files.size }
    } catch (error) {
      syncStatus.value = SYNC_STATUS.ERROR
      syncError.value = error?.message || '同步失败'
      return { ok: false, error }
    }
  }

  /** 首次进入：先用缓存渲染，再后台增量同步。 */
  async function boot() {
    if (booted.value) return
    booting.value = true
    session.hydrate()
    await hydrateFromCache()
    booted.value = true
    booting.value = false
    if (online.value) sync()
  }

  /* ------------------------------ 初始化仓库 ------------------------------ */

  /** PRD FR-02：数据仓库为空时写入默认模板。 */
  async function initializeRepository() {
    if (!repoStore.isConfigured()) return { ok: false, reason: 'not-configured' }

    // 关键保护：远端已有 config.json 却不是本工具的结构，说明很可能连错了仓库。
    // 直接拦下，绝不在别人的仓库上"初始化"。
    if (configFileExists.value && !configShapeValid.value) {
      throw new Error(
        '该仓库里已经有一个 config.json，但不是 pm-tools 的数据结构，已阻止初始化以免覆盖别人的文件。请先确认上面的仓库地址是否填对。',
      )
    }

    const template = createDefaultTemplate({
      createdBy: session.actorId,
      createdAt: nowIso(),
    })
    const data = {
      schemaVersion: 1,
      initializedAt: nowIso(),
      admins: session.actorId ? [session.actorId] : [],
      members: session.actorId
        ? [{ ghId: session.actorId, name: session.actorName, avatar: session.user?.avatar_url || '' }]
        : [],
      flowTemplates: [template],
      activeTemplateVersion: template.version,
    }
    let sha
    try {
      ;({ sha } = await repoStore.saveJson(repoStore.paths.config, data, {
        message: '初始化数据仓库与默认流程模板',
      }))
    } catch (error) {
      // 写入时不带 sha，GitHub 对已存在的文件返回 409：给出可执行的处理说明
      if (error instanceof ConflictError) {
        throw new Error(
          '该仓库已存在 config.json，无法直接覆盖。如果这确实是本工具的数据仓库，请先在 GitHub 上删除该文件，再回来初始化。',
        )
      }
      throw error
    }
    config.value = data
    configSha.value = sha
    configEtag.value = null
    configLoaded.value = true
    await cacheFile(repoStore.paths.config, data, sha, null)
    return { ok: true }
  }

  /* ------------------------------ 客户 ------------------------------ */

  function findCustomerByName(name) {
    const target = String(name || '').trim()
    if (!target) return null
    return customerList.value.find((c) => c.name === target) || null
  }

  async function createCustomer(payload) {
    const name = String(payload?.name || '').trim()
    if (!name) throw new Error('客户名称不能为空。')
    if (findCustomerByName(name)) throw new Error(`客户「${name}」已存在。`)

    const id = newCustomerId()
    const at = nowIso()
    const data = {
      schemaVersion: 1,
      id,
      name,
      shortName: String(payload.shortName || '').trim(),
      type: payload.type || CUSTOMER_TYPE.OEM,
      status: payload.status || CUSTOMER_STATUS.DEVELOPING,
      ownerId: payload.ownerId || session.actorId,
      remark: String(payload.remark || '').trim(),
      createdAt: at,
      createdBy: session.actorId,
      createdByName: session.actorName,
      updatedAt: at,
      updatedBy: session.actorId,
      updatedByName: session.actorName,
    }
    const { sha } = await repoStore.saveJson(repoStore.paths.customer(id), data, {
      message: `新增客户「${name}」`,
    })
    customers[id] = { data, base: clone(data), sha, dirty: false }
    await cacheFile(repoStore.paths.customer(id), data, sha, null)
    return data
  }

  async function updateCustomer(id, patch) {
    const item = customers[id]
    if (!item) throw new Error('客户不存在。')
    const name = patch.name !== undefined ? String(patch.name).trim() : item.data.name
    if (!name) throw new Error('客户名称不能为空。')
    const duplicated = customerList.value.find((c) => c.name === name && c.id !== id)
    if (duplicated) throw new Error(`客户「${name}」已存在。`)

    item.data = {
      ...item.data,
      ...patch,
      name,
      updatedAt: nowIso(),
      updatedBy: session.actorId,
      updatedByName: session.actorName,
    }
    const { sha } = await repoStore.saveJson(repoStore.paths.customer(id), item.data, {
      sha: item.sha,
      message: `更新客户「${item.data.name}」`,
    })
    item.sha = sha
    item.base = clone(item.data)
    item.dirty = false
    await cacheFile(repoStore.paths.customer(id), item.data, sha, null)
    return item.data
  }

  /** 新建项目时允许直接输入客户名，不存在则自动建档（PRD 3 章约定）。 */
  async function ensureCustomerByName(name) {
    const existing = findCustomerByName(name)
    if (existing) return existing.id
    const created = await createCustomer({ name, status: CUSTOMER_STATUS.COOPERATING })
    return created.id
  }

  /* ------------------------------ 项目 ------------------------------ */

  async function createProject(payload) {
    const name = String(payload?.name || '').trim()
    if (!name) throw new Error('项目名称不能为空。')
    const template = activeTemplate.value
    if (!template) throw new Error('尚未配置流程模板，请先初始化数据仓库。')

    let customerId = payload.customerId || ''
    if (!customerId && payload.customerName) {
      customerId = await ensureCustomerByName(payload.customerName)
    }
    if (!customerId) throw new Error('请选择或填写所属客户。')

    const snapshot = cloneTemplate(template)
    const firstNode = [...snapshot.nodes].sort((a, b) => a.order - b.order)[0]
    const id = newProjectId()
    const at = nowIso()

    const data = {
      schemaVersion: 1,
      id,
      name,
      customerId,
      ownerId: payload.ownerId || session.actorId,
      status: PROJECT_STATUS.ACTIVE,
      nextFollowUpAt: payload.nextFollowUpAt || '',
      remark: String(payload.remark || '').trim(),
      templateVersion: snapshot.version,
      flowSnapshot: snapshot,
      currentNodeId: firstNode.id,
      nodeRecords: [
        {
          nodeId: firstNode.id,
          nodeName: firstNode.name,
          enteredAt: at,
          enteredBy: session.actorId,
          enteredByName: session.actorName,
          leftAt: null,
          leftBy: null,
          leftByName: '',
          values: {},
        },
      ],
      rollbackHistory: [],
      createdAt: at,
      createdBy: session.actorId,
      createdByName: session.actorName,
      updatedAt: at,
      updatedBy: session.actorId,
      updatedByName: session.actorName,
    }

    const { sha } = await repoStore.saveJson(repoStore.paths.project(id), data, {
      message: `新增项目「${name}」`,
    })
    projects[id] = { data, base: clone(data), sha, dirty: false }
    await cacheFile(repoStore.paths.project(id), data, sha, null)
    return data
  }

  /** 保存单个项目，含 409 冲突与离线草稿处理。 */
  async function persistProject(id, message) {
    const item = projects[id]
    if (!item) return { ok: false, error: '项目不存在。' }

    item.data.updatedAt = nowIso()
    item.data.updatedBy = session.actorId
    item.data.updatedByName = session.actorName

    // PRD FR-17：断网时先存草稿，联网后再补交
    if (!online.value) {
      const at = nowIso()
      await draftStore.put({ projectId: id, content: clone(item.data), savedAt: at })
      drafts[id] = { savedAt: at }
      item.dirty = true
      return { ok: true, queued: true }
    }

    savingIds[id] = true
    try {
      const { sha } = await repoStore.saveJson(repoStore.paths.project(id), item.data, {
        sha: item.sha,
        message: message || `更新项目「${item.data.name}」`,
      })
      item.sha = sha
      item.base = clone(item.data)
      item.dirty = false
      await cacheFile(repoStore.paths.project(id), item.data, sha, null)
      if (drafts[id]) {
        delete drafts[id]
        await draftStore.remove(id)
      }
      return { ok: true }
    } catch (error) {
      if (error instanceof ConflictError) {
        await prepareConflict(id)
        return { ok: false, conflict: true }
      }
      return { ok: false, error }
    } finally {
      delete savingIds[id]
    }
  }

  /** PRD FR-16 第 1~3 步：保留本地输入，拉取远端，生成差异摘要与合并结果。 */
  async function prepareConflict(id) {
    const item = projects[id]
    if (!item) return
    const remote = await repoStore.fetchJson(repoStore.paths.project(id))
    const remoteData = remote.data
    const nodes = getFlowNodes(remoteData)
    const summary = describeRemoteChanges(item.base, remoteData, nodes)
    const { merged, conflicts } = mergeProject({
      base: item.base,
      local: item.data,
      remote: remoteData,
      nodes,
    })
    pendingConflict.value = {
      projectId: id,
      projectName: remoteData?.name || item.data?.name || '',
      remote: remoteData,
      remoteSha: remote.sha,
      remoteEtag: remote.etag,
      nodes,
      summary,
      merged,
      conflicts,
    }
  }

  /** 用户已选好每个冲突的取向，执行合并提交。 */
  async function resolveConflict(decisions = {}) {
    const ctx = pendingConflict.value
    if (!ctx) return { ok: false, error: '没有待处理的冲突。' }
    const { merged, conflicts, projectId, remoteSha, remoteEtag } = ctx

    for (const conflict of conflicts) {
      const source = decisions[conflict.id] || 'remote'
      const value = source === 'local' ? conflict.localValue : conflict.remoteValue
      if (conflict.scope === 'meta' || conflict.scope === 'flow') {
        merged[conflict.key] = value
      } else if (conflict.scope === 'field') {
        const record = (merged.nodeRecords || []).find(
          (r) => r.nodeId === conflict.nodeId && r.enteredAt === conflict.enteredAt,
        )
        if (record) {
          record.values = { ...(record.values || {}), [conflict.fieldId]: value }
        }
      }
    }

    merged.updatedAt = nowIso()
    merged.updatedBy = session.actorId
    merged.updatedByName = session.actorName

    try {
      const { sha } = await repoStore.saveJson(repoStore.paths.project(projectId), merged, {
        sha: remoteSha,
        message: `合并冲突并更新项目「${merged.name}」`,
      })
      const item = projects[projectId]
      item.data = merged
      item.base = clone(merged)
      item.sha = sha
      item.dirty = false
      await cacheFile(repoStore.paths.project(projectId), merged, sha, remoteEtag)
      if (drafts[projectId]) {
        delete drafts[projectId]
        await draftStore.remove(projectId)
      }
      pendingConflict.value = null
      return { ok: true }
    } catch (error) {
      if (error instanceof ConflictError) {
        // 又被别人改了：重新走一遍冲突流程
        await prepareConflict(projectId)
        return { ok: false, conflict: true }
      }
      return { ok: false, error }
    }
  }

  /** 放弃本地修改，直接采用远端版本。 */
  async function discardLocalChanges() {
    const ctx = pendingConflict.value
    if (!ctx) return { ok: false }
    const { projectId, remote, remoteSha, remoteEtag } = ctx
    const item = projects[projectId]
    item.data = clone(remote)
    item.base = clone(remote)
    item.sha = remoteSha
    item.dirty = false
    await cacheFile(repoStore.paths.project(projectId), remote, remoteSha, remoteEtag)
    if (drafts[projectId]) {
      delete drafts[projectId]
      await draftStore.remove(projectId)
    }
    pendingConflict.value = null
    return { ok: true }
  }

  function dismissConflict() {
    pendingConflict.value = null
  }

  async function updateProjectFields(id, patch) {
    const item = projects[id]
    if (!item) throw new Error('项目不存在。')
    item.data = {
      ...item.data,
      ...patch,
      updatedAt: nowIso(),
      updatedBy: session.actorId,
      updatedByName: session.actorName,
    }
    item.dirty = true
    return persistProject(id, `更新项目「${item.data.name}」基本信息`)
  }

  /* ------------------------------ 节点流转 ------------------------------ */

  /**
   * PRD FR-06：推进当前节点（末节点则为"完成并关闭"）。
   * 必填校验不通过时直接返回，绝不推进。
   */
  async function submitNode(projectId, values) {
    const item = projects[projectId]
    if (!item) return { ok: false, error: '项目不存在。' }
    const project = item.data
    const node = getCurrentNode(project)
    if (!node) return { ok: false, error: '当前节点定义缺失。' }

    const missing = findMissingRequiredFields(node, values)
    if (missing.length) return { ok: false, missing }

    const next = getNextNode(project)
    const at = nowIso()
    const record = getActiveRecord(project, node.id)
    if (record) {
      record.values = clone(values)
      record.leftAt = at
      record.leftBy = session.actorId
      record.leftByName = session.actorName
    }

    if (!next) {
      project.status = deriveClosedStatus(project, node) || PROJECT_STATUS.CLOSED_LOST
    } else {
      project.currentNodeId = next.id
      project.nodeRecords.push({
        nodeId: next.id,
        nodeName: next.name,
        enteredAt: at,
        enteredBy: session.actorId,
        enteredByName: session.actorName,
        leftAt: null,
        leftBy: null,
        leftByName: '',
        values: {},
      })
    }
    item.dirty = true
    const result = await persistProject(
      projectId,
      next ? `推进项目「${project.name}」至 ${next.name}` : `关闭项目「${project.name}」`,
    )
    return { ...result, advancedTo: next?.name || null, closed: !next }
  }

  /** 保存当前节点草稿（不推进），用于"先填一半"。 */
  async function saveNodeValues(projectId, values) {
    const item = projects[projectId]
    if (!item) return { ok: false, error: '项目不存在。' }
    const node = getCurrentNode(item.data)
    if (!node) return { ok: false, error: '当前节点定义缺失。' }
    const record = getActiveRecord(item.data, node.id)
    if (record) record.values = clone(values)
    item.dirty = true
    return persistProject(projectId, `保存项目「${item.data.name}」的「${node.name}」阶段信息`)
  }

  /** PRD FR-07：回退到之前任意节点，必须填原因。 */
  async function rollbackProject(projectId, { toNodeId, type, reason }) {
    const item = projects[projectId]
    if (!item) return { ok: false, error: '项目不存在。' }
    const project = item.data
    const nodes = getFlowNodes(project)
    const from = getCurrentNode(project)
    const to = nodes.find((n) => n.id === toNodeId)
    if (!from || !to) return { ok: false, error: '节点不存在。' }

    const fromIndex = nodes.indexOf(from)
    const toIndex = nodes.indexOf(to)
    if (toIndex >= fromIndex) return { ok: false, error: '只能回退到当前节点之前的节点。' }

    const trimmed = String(reason || '').trim()
    if (!trimmed) return { ok: false, error: '回退原因不能为空。' }

    const at = nowIso()
    const active = getActiveRecord(project, from.id)
    if (active) {
      active.leftAt = at
      active.leftBy = session.actorId
      active.leftByName = session.actorName
    }

    project.rollbackHistory.push({
      at,
      by: session.actorId,
      byName: session.actorName,
      fromNodeId: from.id,
      fromNodeName: from.name,
      toNodeId: to.id,
      toNodeName: to.name,
      type: type || ROLLBACK_TYPE.CUSTOMER_REJECT,
      reason: trimmed,
    })

    // PRD FR-07 验收 3：已填内容保留，重新进入该节点继续编辑
    project.nodeRecords.push({
      nodeId: to.id,
      nodeName: to.name,
      enteredAt: at,
      enteredBy: session.actorId,
      enteredByName: session.actorName,
      leftAt: null,
      leftBy: null,
      leftByName: '',
      values: { ...getNodeValues(project, to.id) },
    })
    project.currentNodeId = to.id
    if (isClosed(project)) project.status = PROJECT_STATUS.ACTIVE

    item.dirty = true
    return persistProject(projectId, `回退项目「${project.name}」至 ${to.name}`)
  }

  /* ------------------------------ 离线草稿 ------------------------------ */

  /** PRD FR-17：联网后一键补交全部草稿。 */
  async function submitDraft(projectId) {
    const draft = await draftStore.get(projectId)
    if (!draft) return { ok: false, error: '草稿不存在。' }
    const item = projects[projectId]
    if (!item) return { ok: false, error: '项目不存在。' }
    item.data = clone(draft.content)
    item.dirty = true
    return persistProject(projectId, `补交离线修改：项目「${item.data.name}」`)
  }

  async function submitAllDrafts() {
    const results = []
    for (const { projectId } of draftList.value) {
      // eslint-disable-next-line no-await-in-loop
      results.push({ projectId, ...(await submitDraft(projectId)) })
    }
    return results
  }

  async function discardDraft(projectId) {
    delete drafts[projectId]
    await draftStore.remove(projectId)
    const item = projects[projectId]
    if (item) {
      item.dirty = false
      await sync({ force: true })
    }
  }

  /* ------------------------------ 流程模板 ------------------------------ */

  /** PRD FR-08：模板变更生成新版本；老项目继续按自己的快照运行。 */
  async function saveTemplate(nodes, templateName) {
    if (!config.value) throw new Error('尚未初始化数据仓库。')
    const existing = config.value.flowTemplates || []
    const nextVersion = existing.reduce((max, t) => Math.max(max, t.version || 0), 0) + 1
    const nextTemplate = {
      version: nextVersion,
      name: templateName || activeTemplate.value?.name || '默认流程',
      createdAt: nowIso(),
      createdBy: session.actorId,
      nodes: clone(nodes),
    }

    const nextConfig = {
      ...config.value,
      flowTemplates: [...existing, nextTemplate],
      activeTemplateVersion: nextVersion,
    }

    try {
      const { sha } = await repoStore.saveJson(repoStore.paths.config, nextConfig, {
        sha: configSha.value,
        message: `发布流程模板 v${nextVersion}（共 ${nextTemplate.nodes.length} 个节点）`,
      })
      config.value = nextConfig
      configSha.value = sha
      await cacheFile(repoStore.paths.config, nextConfig, sha, null)
      return nextTemplate
    } catch (error) {
      if (error instanceof ConflictError) {
        // config.json 仅管理员写入，冲突极罕见：重新拉取后重试一次
        const latest = await repoStore.fetchJson(repoStore.paths.config)
        config.value = latest.data
        configSha.value = latest.sha
        await cacheFile(repoStore.paths.config, latest.data, latest.sha, latest.etag)
        throw new Error('模板配置刚被修改过，已刷新到最新版本，请确认后再保存一次。')
      }
      throw error
    }
  }

  function makeNodeId(nodes) {
    return nextSeqId('n', nodes.map((n) => n.id))
  }

  function makeFieldId(nodes) {
    return nextSeqId('f', collectFieldIds(nodes))
  }

  /* ------------------------------ 其它 ------------------------------ */

  function setOnline(value) {
    online.value = value
  }

  function actorRef() {
    return { id: session.actorId, name: session.actorName }
  }

  return {
    // state
    booted,
    booting,
    configLoaded,
    configFileExists,
    remoteFileCount,
    configShapeValid,
    config,
    configSha,
    customers,
    projects,
    syncStatus,
    syncError,
    lastSyncAt,
    online,
    pendingConflict,
    drafts,
    savingIds,
    // getters
    activeTemplate,
    templateHistory,
    customerList,
    projectList,
    activeProjectList,
    closedProjectList,
    customerById,
    projectById,
    isAdmin,
    draftList,
    // helpers
    customerName,
    projectDirty,
    actorRef,
    findCustomerByName,
    // actions
    boot,
    sync,
    initializeRepository,
    createCustomer,
    updateCustomer,
    ensureCustomerByName,
    createProject,
    persistProject,
    prepareConflict,
    resolveConflict,
    discardLocalChanges,
    dismissConflict,
    updateProjectFields,
    submitNode,
    saveNodeValues,
    rollbackProject,
    submitDraft,
    submitAllDrafts,
    discardDraft,
    saveTemplate,
    makeNodeId,
    makeFieldId,
    setOnline,
    defaultFollowUpDate: todayString,
  }
})
