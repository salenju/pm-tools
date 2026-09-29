/*
 * GitHub REST API 客户端（PRD 7.3）。
 *
 * 已实测确认的前提：
 *   - api.github.com 返回 access-control-allow-origin: *，预检允许
 *     Authorization / If-None-Match / X-GitHub-Api-Version，ETag 通过
 *     access-control-expose-headers 暴露，预检缓存 86400 秒。
 *   - 因此条件请求（304 不计入速率限制）可在浏览器直接使用。
 *   - 但 github.com/login/* 下的 OAuth 端点不允许跨域，故本项目使用 PAT 授权
 *     （见 PRD FR-01 与 7.2）。
 */

const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const CONTENT_LIMIT_BYTES = 1024 * 1024

let token = ''

export function setToken(value) {
  token = value || ''
}

export function getToken() {
  return token
}

export class GithubError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'GithubError'
    this.status = options.status ?? 0
    this.detail = options.detail ?? ''
  }
}

export class AuthError extends GithubError {
  constructor(message = 'Token 无效或已过期，请重新配置。', options = {}) {
    super(message, options)
    this.name = 'AuthError'
  }
}

export class ForbiddenError extends GithubError {
  constructor(message = '没有该仓库的访问权限。', options = {}) {
    super(message, options)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends GithubError {
  constructor(
    message = '找不到该仓库。GitHub 对以下三种情况返回的都是 404，无法区分：① 仓库不存在或名字写错；② 这是 fine-grained Token，但没有把该仓库加入 Repository access；③ Token 是 classic 且缺少 repo 权限。请点下方「诊断一下」逐项排查。',
    options = {},
  ) {
    super(message, options)
    this.name = 'NotFoundError'
  }
}

/** PRD 6.6 / FR-16：写入时 sha 不一致。 */
export class ConflictError extends GithubError {
  constructor(message = '数据已被他人修改。', options = {}) {
    super(message, options)
    this.name = 'ConflictError'
  }
}

export class RateLimitError extends GithubError {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'RateLimitError'
    this.resetAt = options.resetAt ?? null
  }
}

export class NetworkError extends GithubError {
  constructor(message = '网络请求失败，请检查网络连接。', options = {}) {
    super(message, options)
    this.name = 'NetworkError'
  }
}

function buildHeaders({ etag, hasBody, anonymous }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  }
  if (token && !anonymous) headers.Authorization = `Bearer ${token}`
  if (etag) headers['If-None-Match'] = etag
  if (hasBody) headers['Content-Type'] = 'application/json'
  return headers
}

/**
 * 统一请求入口。
 * @param {{method?: string, body?: any, etag?: string|null, signal?: AbortSignal, anonymous?: boolean}} [options]
 * @returns {{notModified: boolean, data: any, etag: string|null}}
 */
async function request(path, options = {}) {
  const { method = 'GET', body, etag, signal, anonymous = false } = options
  const hasBody = body !== undefined

  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: buildHeaders({ etag, hasBody, anonymous }),
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new NetworkError(undefined, { detail: String(error?.message || error) })
  }

  // 304：内容未变化，PRD 7.3 —— 不计入速率限制
  if (response.status === 304) {
    return { notModified: true, data: null, etag: etag || null }
  }

  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  const responseEtag = response.headers.get('etag')

  if (response.ok) {
    return { notModified: false, data, etag: responseEtag }
  }

  const remaining = response.headers.get('x-ratelimit-remaining')
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset') || 0)
  const message = typeof data === 'object' && data?.message ? data.message : text || response.statusText

  if (response.status === 401) {
    throw new AuthError(undefined, { status: 401, detail: message })
  }
  if (response.status === 409) {
    throw new ConflictError(undefined, { status: 409, detail: message })
  }
  if (response.status === 404) {
    throw new NotFoundError(undefined, { status: 404, detail: message })
  }
  if (response.status === 403 && remaining === '0') {
    throw new RateLimitError(
      resetSeconds
        ? `GitHub 接口调用已达上限，将在 ${new Date(resetSeconds * 1000).toLocaleTimeString()} 后恢复。`
        : 'GitHub 接口调用已达上限，请稍后再试。',
      { status: 403, detail: message, resetAt: resetSeconds ? resetSeconds * 1000 : null },
    )
  }
  if (response.status === 403) {
    throw new ForbiddenError(undefined, { status: 403, detail: message })
  }
  throw new GithubError(message || 'GitHub 请求失败。', { status: response.status, detail: message })
}

function encodePath(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function decodeBase64Utf8(base64) {
  const clean = String(base64 || '').replace(/[\r\n]/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 当前 Token 对应的账号信息。 */
export async function getUser() {
  const { data } = await request('/user')
  return data
}

/** 仓库元信息，用于校验存在性、可见性与写权限。 */
export async function getRepository(owner, repo) {
  const { data } = await request(`/repos/${owner}/${repo}`)
  return data
}

/**
 * 当前 Token 能够访问的仓库清单。
 *
 * 用途：fine-grained PAT 最常见的失败原因是「仓库没有被加入 Repository access」，
 * 此时 GET /repos/{owner}/{repo} 返回 404，与"仓库不存在"完全无法区分。
 * 列出 Token 实际能看到的仓库，就能把这个原因单独识别出来。
 *
 * 注意：并非所有 Token 类型都允许调用此接口，调用方需容错。
 */
export async function listUserRepos({ perPage = 100 } = {}) {
  const { data } = await request(
    `/user/repos?per_page=${perPage}&affiliation=owner,collaborator,organization_member&sort=updated`,
  )
  return Array.isArray(data) ? data : []
}

/**
 * 匿名探测仓库是否公开存在。
 * @returns {boolean|null} true=公开可访问; false=不存在或私有; null=无法判断
 */
export async function probePublicRepository(owner, repo) {
  try {
    await request(`/repos/${owner}/${repo}`, { anonymous: true })
    return true
  } catch (error) {
    if (error instanceof NotFoundError) return false
    return null
  }
}

/**
 * 一次请求取回整棵目录树的 sha 列表（PRD 7.3 / 7.9.1）。
 * @param {{owner: string, repo: string, ref?: string}} params
 */
export async function getTree({ owner, repo, ref = 'HEAD' }) {
  const { data } = await request(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  const entries = (data?.tree || []).filter((entry) => entry.type === 'blob')
  return { entries, truncated: Boolean(data?.truncated) }
}

/**
 * 读取单个文件。传入 etag 时命中 304 直接返回 notModified。
 */
export async function getFile({ owner, repo, path, etag, ref }) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const result = await request(`/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`, { etag })
  if (result.notModified) return { notModified: true, sha: null, content: null, etag: result.etag }
  const file = result.data
  if (file?.size > CONTENT_LIMIT_BYTES) {
    throw new GithubError(`文件 ${path} 超过 1MB，无法通过内容 API 读取。`)
  }
  const content =
    file?.encoding === 'base64' ? decodeBase64Utf8(file.content) : typeof file?.content === 'string' ? file.content : ''
  return { notModified: false, sha: file?.sha || null, content, etag: result.etag }
}

/**
 * 写入单个文件。未提供 sha 表示新建；sha 不一致时抛 ConflictError。
 */
export async function putFile({ owner, repo, path, content, sha, message, branch }) {
  const body = { message, content: encodeBase64Utf8(content) }
  if (sha) body.sha = sha
  if (branch) body.branch = branch
  const { data } = await request(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body,
  })
  return {
    sha: data?.content?.sha || null,
    commitSha: data?.commit?.sha || null,
  }
}

/**
 * 提交历史。PRD 7.9.5：排序与"先后"判断以提交顺序为权威，而非客户端时钟。
 */
export async function listCommits({ owner, repo, path, perPage = 30 }) {
  const query = new URLSearchParams({ per_page: String(perPage) })
  if (path) query.set('path', path)
  const { data } = await request(`/repos/${owner}/${repo}/commits?${query}`)
  return Array.isArray(data) ? data : []
}
