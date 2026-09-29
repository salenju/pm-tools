/*
 * 数据仓库地址解析。
 *
 * 在连接界面让用户直接粘贴 GitHub 仓库地址，由程序拆分 owner 与 repo，
 * 从根上消灭"手抄 owner 抄错"这个最高频、且后果最隐蔽的错误
 * （填错一个存在的仓库时，工具会静默把数据写进去，不会报任何错）。
 *
 * 支持的输入形态：
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main      （多余路径会被忽略）
 *   http://github.com/owner/repo
 *   github.com/owner/repo
 *   git@github.com:owner/repo.git
 *   owner/repo
 *   /owner/repo/
 */

/**
 * @param {string} raw 用户粘贴的内容
 * @returns {{owner: string, repo: string} | null} 解析失败返回 null
 */
export function parseRepoInput(raw) {
  let text = String(raw ?? '').trim()
  if (!text) return null

  // 去掉协议头
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  // git@github.com:owner/repo → github.com/owner/repo
  text = text.replace(/^[^\s@/]+@([^/:]+):/i, '$1/')
  // 去掉域名前缀（含 github.com 之外的自定义域名，统一只保留路径）
  text = text.replace(/^[^\s/]+\.[^\s/]+\//i, '')
  // 去掉 query 与 hash
  text = text.split(/[?#]/)[0]
  // 去掉开头的斜杠
  text = text.replace(/^\/+/, '')
  // 去掉尾部 .git 与斜杠
  text = text.replace(/\.git$/i, '').replace(/\/+$/, '')

  const segments = text.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const [owner, repo] = segments
  if (!isValidOwner(owner) || !isValidRepo(repo)) return null
  return { owner, repo }
}

/**
 * GitHub 账号（用户或组织）名：只允许字母数字与单连字符，不能用下划线或点。
 *
 * 这里刻意收紧：不允许点，既符合 GitHub 的真实规则，也能避免
 * 「域名.后缀/owner/repo」这类输入被误切成以域名当 owner。
 */
function isValidOwner(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value)
}

/** 仓库名：字母数字与 . _ -，不能以 . 开头，长度上限 100。 */
function isValidRepo(value) {
  return value.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

/** 组装用于展示的仓库标识。 */
export function formatRepo(owner, repo) {
  if (!owner || !repo) return ''
  return `${owner}/${repo}`
}

/** 生成仓库在 GitHub 上的地址。 */
export function repoWebUrl(owner, repo) {
  if (!owner || !repo) return ''
  return `https://github.com/${owner}/${repo}`
}
