import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as auth from '../services/auth'
import * as gh from '../services/githubClient'
import * as repoStore from '../services/repoStore'

/*
 * 会话：PAT、数据仓库配置、当前账号。
 *
 * PRD FR-01（v1.4）：授权方式为 fine-grained PAT 手动粘贴。
 * 原因：GitHub 的 /login/device/code 与 /login/oauth/access_token 不允许浏览器跨域
 * （已实测无 Access-Control-Allow-Origin，且为 GitHub 刻意设计），Device Flow 无法
 * 在纯前端完成。Token 只存于本机浏览器，不经过任何第三方。
 *
 * v1.5：GET /repos/{owner}/{repo} 的 404 有三种完全不同的成因，且 GitHub 不会区分。
 * 因此提供 diagnose()，把「仓库不存在」「Token 未覆盖该仓库」「无权限」拆开说明。
 */
export const useSessionStore = defineStore('session', () => {
  const token = ref(auth.loadToken())
  const repoConfig = ref(auth.loadRepoConfig())
  const user = ref(auth.loadCachedUser())
  const repoInfo = ref(null)
  const connecting = ref(false)
  const error = ref('')
  /** 'not-found' | 'auth' | 'forbidden' | 'other' | '' */
  const errorKind = ref('')

  const isReady = computed(
    () => Boolean(token.value && repoConfig.value.owner && repoConfig.value.repo && user.value),
  )

  const actorId = computed(() => (user.value?.id ? `gh:${user.value.id}` : ''))
  const actorName = computed(() => user.value?.name || user.value?.login || '未知用户')
  const repoLabel = computed(() =>
    repoConfig.value.owner ? `${repoConfig.value.owner}/${repoConfig.value.repo}` : '',
  )

  /** 数据仓库必须是 private（PRD 1.3 / 第 9 章）。 */
  const repoIsPublic = computed(() => repoInfo.value?.private === false)

  function hydrate() {
    gh.setToken(token.value)
    repoStore.configure(repoConfig.value)
  }

  function classifyError(err) {
    if (err instanceof gh.NotFoundError) return 'not-found'
    if (err instanceof gh.AuthError) return 'auth'
    if (err instanceof gh.ForbiddenError) return 'forbidden'
    return 'other'
  }

  /**
   * 连接并校验：Token 有效性 + 仓库可访问性 + 写权限。
   * @param {{token: string, owner: string, repo: string, branch?: string}} payload
   */
  async function connect(payload) {
    connecting.value = true
    error.value = ''
    errorKind.value = ''
    try {
      const nextToken = String(payload.token || '').trim()
      const owner = String(payload.owner || '').trim()
      const repo = String(payload.repo || '').trim()
      if (!nextToken) throw new Error('请填写 GitHub Token。')
      if (!owner || !repo) throw new Error('请填写数据仓库地址。')

      gh.setToken(nextToken)
      const account = await gh.getUser()
      const repoMeta = await gh.getRepository(owner, repo)

      // permissions 字段在部分 Token 类型下不返回，缺失时不做硬性拦截。
      if (repoMeta?.permissions && repoMeta.permissions.push === false) {
        throw new gh.ForbiddenError(
          '当前 Token 对该仓库只有读权限。请把 Token 的 Contents 权限设为 Read and write；如果仓库在别人名下，还需要对方把你加为 collaborator。',
        )
      }

      const nextConfig = {
        owner,
        repo,
        branch: payload.branch?.trim() || repoMeta?.default_branch || 'main',
      }

      token.value = nextToken
      repoConfig.value = nextConfig
      user.value = {
        id: account.id,
        login: account.login,
        name: account.name || account.login,
        avatar_url: account.avatar_url || '',
      }
      repoInfo.value = {
        private: Boolean(repoMeta?.private),
        default_branch: repoMeta?.default_branch || '',
        permissions: repoMeta?.permissions || null,
      }

      auth.saveToken(nextToken)
      auth.saveRepoConfig(nextConfig)
      auth.saveCachedUser(user.value)
      repoStore.configure(nextConfig)
      return true
    } catch (err) {
      error.value = err?.message || '连接失败'
      errorKind.value = classifyError(err)
      return false
    } finally {
      connecting.value = false
    }
  }

  /**
   * 连接失败时的自助诊断。
   *
   * 把 GitHub 的 404 拆成可区分的原因，尤其是 fine-grained Token 最常见的
   * 「仓库没有被加入 Repository access」——它与「仓库不存在」返回完全一样的 404。
   *
   * @param {{owner: string, repo: string}} payload
   * @returns {Promise<{items: Array<{level: string, title: string, detail: string}>}>}
   */
  async function diagnose({ owner, repo }) {
    const items = []
    const target = `${owner}/${repo}`
    const lowerTarget = target.toLowerCase()

    // 1) Token 是否有效
    let account = null
    try {
      account = await gh.getUser()
      items.push({ level: 'ok', title: 'Token 有效', detail: `属于 ${account.login}。` })
    } catch (err) {
      items.push({
        level: 'error',
        title: 'Token 无效或已过期',
        detail: err?.message || '无法用该 Token 读取账号信息。请重新生成一个 Token。',
      })
      return { items }
    }

    // 2) owner 与 Token 账号是否一致（不一致本身不一定是错误）
    if (account.login.toLowerCase() !== String(owner).toLowerCase()) {
      items.push({
        level: 'info',
        title: 'owner 与 Token 账号不是同一个',
        detail: `Token 属于 ${account.login}，而你要连的 owner 是 ${owner}。组织仓库、别人共享给你的仓库都会这样，属正常；但要先确认 ${owner} 这个名字没写错。`,
      })
    }

    // 3) Token 实际能访问的仓库清单
    let accessible = null
    try {
      accessible = await gh.listUserRepos()
    } catch {
      accessible = null
    }

    if (accessible) {
      const exact = accessible.some((r) => String(r.full_name).toLowerCase() === lowerTarget)
      if (exact) {
        items.push({
          level: 'ok',
          title: `Token 有权访问 ${target}`,
          detail: '该仓库在 Token 的可访问清单中，说明权限层面没问题。',
        })
      } else {
        items.push({
          level: 'error',
          title: `Token 的可访问清单里没有 ${target}`,
          detail: `该 Token 目前只能访问 ${accessible.length} 个仓库，其中不包含 ${target}。`,
        })

        const repoName = String(repo).toLowerCase()
        const similar = accessible
          .filter((r) => {
            const name = String(r.name).toLowerCase()
            return (
              name === repoName ||
              name.startsWith(repoName.slice(0, 5)) ||
              repoName.startsWith(name.slice(0, 5))
            )
          })
          .slice(0, 6)
          .map((r) => r.full_name)

        if (similar.length) {
          items.push({
            level: 'warn',
            title: '找到名字相近的仓库',
            detail: `${similar.join('、')}。如果其中某个才是你要连的，请直接改成它的地址。`,
          })
        }
      }
    } else {
      items.push({
        level: 'info',
        title: '无法列出 Token 可访问的仓库',
        detail: '该 Token 类型不允许查询仓库清单，这一项检查被跳过。',
      })
    }

    // 4) 匿名探测，用于判断仓库是否是公开仓库
    const isPublic = await gh.probePublicRepository(owner, repo)
    if (isPublic === true) {
      items.push({
        level: 'warn',
        title: `${target} 可以匿名访问（它是公开仓库）`,
        detail: '公开仓库用任何有效 Token 都能读到。如果连接仍然失败，请确认地址没写错。',
      })
    } else if (isPublic === false) {
      items.push({
        level: 'info',
        title: `匿名访问 ${target} 同样是 404`,
        detail: '这与「它是私有仓库」相符，但无法据此判断它到底存不存在——请以上面那一项的清单结果为准。',
      })
    }

    // 5) 结论
    const failed = items.some((i) => i.level === 'error')
    if (!failed && accessible) {
      items.push({
        level: 'ok',
        title: '上面几项都没发现问题',
        detail: '如果仍然连不上，请到 GitHub 仓库页面复制地址，直接粘贴过来，避免手输。',
      })
    }

    return { items }
  }

  async function refreshRepoInfo() {
    if (!repoConfig.value.owner) return null
    try {
      const repoMeta = await gh.getRepository(repoConfig.value.owner, repoConfig.value.repo)
      repoInfo.value = {
        private: Boolean(repoMeta?.private),
        default_branch: repoMeta?.default_branch || '',
        permissions: repoMeta?.permissions || null,
      }
      return repoInfo.value
    } catch {
      return null
    }
  }

  function disconnect() {
    auth.clearAuth()
    token.value = ''
    user.value = null
    repoInfo.value = null
    error.value = ''
    errorKind.value = ''
    gh.setToken('')
    repoStore.configure({ owner: '', repo: '', branch: '' })
  }

  return {
    token,
    repoConfig,
    user,
    repoInfo,
    connecting,
    error,
    errorKind,
    isReady,
    actorId,
    actorName,
    repoLabel,
    repoIsPublic,
    hydrate,
    connect,
    diagnose,
    refreshRepoInfo,
    disconnect,
  }
})
