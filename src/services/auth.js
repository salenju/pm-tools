/*
 * 认证与数据仓库配置。
 *
 * PRD FR-01（v1.4 修订）：因 GitHub OAuth 端点不允许浏览器跨域，
 * 改用 fine-grained PAT 手动粘贴。Token 仅存于本地，不经过任何第三方。
 */

const TOKEN_KEY = 'pmtools.pat'
const REPO_KEY = 'pmtools.dataRepo'
const USER_KEY = 'pmtools.user'

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式下写入可能失败，静默降级为"本次会话有效" */
  }
}

export function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function saveToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{owner: string, repo: string, branch: string}}
 */
export function loadRepoConfig() {
  const saved = readJson(REPO_KEY)
  return {
    owner: saved?.owner || '',
    repo: saved?.repo || '',
    branch: saved?.branch || '',
  }
}

export function saveRepoConfig(config) {
  writeJson(REPO_KEY, {
    owner: config?.owner?.trim() || '',
    repo: config?.repo?.trim() || '',
    branch: config?.branch?.trim() || '',
  })
}

export function loadCachedUser() {
  return readJson(USER_KEY)
}

export function saveCachedUser(user) {
  writeJson(USER_KEY, user)
}

/** 清除全部本地凭证（退出登录）。 */
export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  writeJson(USER_KEY, null)
}
