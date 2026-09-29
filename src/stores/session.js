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
 */
export const useSessionStore = defineStore('session', () => {
  const token = ref(auth.loadToken())
  const repoConfig = ref(auth.loadRepoConfig())
  const user = ref(auth.loadCachedUser())
  const repoInfo = ref(null)
  const connecting = ref(false)
  const error = ref('')

  const isReady = computed(
    () => Boolean(token.value && repoConfig.value.owner && repoConfig.value.repo && user.value),
  )

  /** PRD 6.4：数据中记录的操作人标识。 */
  const actorId = computed(() => (user.value?.id ? `gh:${user.value.id}` : ''))

  /** 界面展示用姓名。 */
  const actorName = computed(() => user.value?.name || user.value?.login || '未知用户')

  const repoLabel = computed(() =>
    repoConfig.value.owner ? `${repoConfig.value.owner}/${repoConfig.value.repo}` : '',
  )

  /** 数据仓库必须是 private（PRD 1.3 / 第 9 章）。 */
  const repoIsPublic = computed(() => repoInfo.value?.private === false)

  /** 启动时把已保存的凭证注入底层客户端。 */
  function hydrate() {
    gh.setToken(token.value)
    repoStore.configure(repoConfig.value)
  }

  /**
   * 连接并校验：Token 有效性 + 仓库可访问性 + 写权限。
   * @param {{token: string, owner: string, repo: string, branch?: string}} payload
   */
  async function connect(payload) {
    connecting.value = true
    error.value = ''
    try {
      const nextToken = String(payload.token || '').trim()
      const owner = String(payload.owner || '').trim()
      const repo = String(payload.repo || '').trim()
      if (!nextToken) throw new Error('请填写 GitHub Token。')
      if (!owner || !repo) throw new Error('请填写数据仓库的 owner 与 repo。')

      gh.setToken(nextToken)
      const account = await gh.getUser()
      const repoMeta = await gh.getRepository(owner, repo)

      // permissions 字段在部分 Token 类型下不返回，缺失时不做硬性拦截。
      if (repoMeta?.permissions && repoMeta.permissions.push === false) {
        throw new Error('当前账号对该数据仓库没有写权限，请让管理员把你加为该私有仓库的 collaborator。')
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
      return false
    } finally {
      connecting.value = false
    }
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
    isReady,
    actorId,
    actorName,
    repoLabel,
    repoIsPublic,
    hydrate,
    connect,
    refreshRepoInfo,
    disconnect,
  }
})
