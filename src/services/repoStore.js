import * as gh from './githubClient'

/*
 * 数据仓库领域层（PRD 6.1 / 7.3）。
 *
 * 文件布局：
 *   config.json                 全局单文件（仅管理员写）
 *   customers/{cus_id}.json     一个客户一个文件
 *   projects/{prj_id}.json      一个项目一个文件
 *
 * "一个业务对象一个文件"是硬规则：GitHub 的写入粒度是整个文件，
 * 共用大文件必然导致并发覆盖。
 */

const CONFIG_PATH = 'config.json'
const CUSTOMERS_DIR = 'customers/'
const PROJECTS_DIR = 'projects/'

let config = { owner: '', repo: '', branch: '' }

export function configure(next) {
  config = { ...config, ...next }
}

export function getConfig() {
  return { ...config }
}

export function isConfigured() {
  return Boolean(config.owner && config.repo)
}

export const paths = {
  config: CONFIG_PATH,
  customer: (id) => `${CUSTOMERS_DIR}${id}.json`,
  project: (id) => `${PROJECTS_DIR}${id}.json`,
}

export function isDataPath(path) {
  return path === CONFIG_PATH || path.startsWith(CUSTOMERS_DIR) || path.startsWith(PROJECTS_DIR)
}

export function isCustomerPath(path) {
  return path.startsWith(CUSTOMERS_DIR) && path.endsWith('.json')
}

export function isProjectPath(path) {
  return path.startsWith(PROJECTS_DIR) && path.endsWith('.json')
}

export function idFromPath(path) {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '')
}

export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** 校验账号对数据仓库的访问权限。 */
export async function assertAccess() {
  return gh.getRepository(config.owner, config.repo)
}

/**
 * 一次请求取回全部数据文件的 sha 列表（PRD 7.3 / 7.9.1）。
 *
 * 同时返回 totalFiles（仓库里所有文件的真实数量，不限本工具的数据路径）：
 * 用于识别"连到了一个已存在内容、但不是本工具数据仓库"的情况，
 * 避免在错误仓库上执行初始化。
 */
export async function fetchTree() {
  const { entries, truncated } = await gh.getTree({
    owner: config.owner,
    repo: config.repo,
    ref: config.branch || 'HEAD',
  })
  const files = new Map()
  let totalFiles = 0
  for (const entry of entries) {
    totalFiles += 1
    if (isDataPath(entry.path)) files.set(entry.path, entry.sha)
  }
  return { files, truncated, totalFiles }
}

/**
 * 读取单个 JSON 文件。传入 etag 时可能返回 notModified（304，不计限流）。
 */
export async function fetchJson(path, options = {}) {
  const result = await gh.getFile({
    owner: config.owner,
    repo: config.repo,
    path,
    etag: options.etag,
    ref: config.branch || undefined,
  })
  if (result.notModified) {
    return { notModified: true, sha: null, data: null, etag: result.etag }
  }
  let data = null
  if (result.content && result.content.trim()) {
    try {
      data = JSON.parse(result.content)
    } catch {
      throw new gh.GithubError(`文件 ${path} 不是合法 JSON，可能已被手工破坏。`)
    }
  }
  return { notModified: false, sha: result.sha, data, etag: result.etag }
}

/** 写入单个 JSON 文件。未传 sha 视为新建；sha 过期抛 ConflictError。 */
export async function saveJson(path, data, options = {}) {
  return gh.putFile({
    owner: config.owner,
    repo: config.repo,
    path,
    content: serialize(data),
    sha: options.sha,
    message: options.message || `更新 ${path}`,
    branch: config.branch || undefined,
  })
}

export async function listCommits(path) {
  return gh.listCommits({ owner: config.owner, repo: config.repo, path })
}

export { gh }
