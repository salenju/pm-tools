<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'
import { useWorkspaceStore } from '../stores/workspace'
import { useUiStore } from '../stores/ui'
import { SYNC_STATUS } from '../constants/enums'
import { formatRepo, parseRepoInput, repoWebUrl } from '../utils/repoUrl'

/*
 * PRD FR-01（v1.4 修订）+ FR-02 初始化。
 *
 * 授权方式已由 Device Flow 改为 fine-grained PAT：
 * GitHub 的 OAuth 端点不允许浏览器跨域，纯前端跑不通 Device Flow。
 * 走 PAT 反而权限更小 —— 可以只授权这一个数据仓库的 Contents 读写。
 *
 * owner 不是"备注"而是仓库地址的前半段。填错一个真实存在的仓库时，
 * GitHub 不会报任何错，工具会静默把数据写到别人的仓库里。因此：
 *   1. 用「粘贴仓库地址」代替手填 owner，从根上消除抄错；
 *   2. 连接后校验远端 config.json 的结构，不像本工具就明确报警并阻止初始化。
 */
const router = useRouter()
const session = useSessionStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()

function initialRepoInput() {
  if (session.repoConfig.owner && session.repoConfig.repo) {
    return formatRepo(session.repoConfig.owner, session.repoConfig.repo)
  }
  const envOwner = import.meta.env.VITE_DATA_OWNER
  const envRepo = import.meta.env.VITE_DATA_REPO
  if (envOwner && envRepo) return formatRepo(envOwner, envRepo)
  return ''
}

const form = reactive({
  token: session.token || '',
  repoInput: initialRepoInput(),
  branch: session.repoConfig.branch || '',
})

const connecting = ref(false)
const checking = ref(false)
const editing = ref(false)
const initError = ref('')

const parsedRepo = computed(() => parseRepoInput(form.repoInput))
const repoInputHasError = computed(() => Boolean(form.repoInput.trim()) && !parsedRepo.value)
const canSubmit = computed(() => Boolean(form.token.trim() && parsedRepo.value))

const diagnosing = ref(false)
const diagnostic = ref(null)

const LEVEL_STYLES = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
}

/**
 * 自助诊断。
 * GitHub 对「仓库不存在」「Token 没覆盖该仓库」「无权限」一律返回 404，
 * 光看报错无法判断，所以这里把三种成因拆开逐项检查。
 */
async function runDiagnose() {
  if (!parsedRepo.value) {
    ui.warn('请先填写一个可识别的仓库地址。')
    return
  }
  diagnosing.value = true
  diagnostic.value = null
  try {
    diagnostic.value = await session.diagnose({
      owner: parsedRepo.value.owner,
      repo: parsedRepo.value.repo,
    })
  } catch (error) {
    diagnostic.value = {
      items: [{ level: 'error', title: '诊断过程出错', detail: error?.message || '未知错误' }],
    }
  } finally {
    diagnosing.value = false
  }
}

const showForm = computed(() => !session.isReady || editing.value)

/** 远端有文件、但没有可解析的 config.json → 可能连到了别的仓库。 */
const looksLikeForeignRepo = computed(
  () => !workspace.configLoaded && workspace.remoteFileCount > 0,
)

/** 远端有 config.json，但不是本工具的结构 → 极可能连错仓库。 */
const badConfigShape = computed(
  () => workspace.configFileExists && !workspace.configShapeValid,
)

const syncFailed = computed(() => workspace.syncStatus === SYNC_STATUS.ERROR)

const needsInit = computed(() => session.isReady && !workspace.configLoaded && !badConfigShape.value)

const initializedSummary = computed(() => {
  if (!workspace.configLoaded || !workspace.configShapeValid) return null
  return {
    templates: workspace.config?.flowTemplates?.length || 0,
    activeVersion: workspace.config?.activeTemplateVersion || 0,
    customers: workspace.customerList.length,
    projects: workspace.projectList.length,
    initializedAt: workspace.config?.initializedAt || '',
  }
})

const currentRepoUrl = computed(() =>
  repoWebUrl(session.repoConfig.owner, session.repoConfig.repo),
)

async function refreshState() {
  checking.value = true
  try {
    await session.refreshRepoInfo()
    await workspace.sync({ force: true })
  } finally {
    checking.value = false
  }
}

async function connect() {
  if (!canSubmit.value) {
    ui.warn('请把 Token 和仓库地址都填写完整。')
    return
  }
  connecting.value = true
  initError.value = ''
  diagnostic.value = null
  try {
    const ok = await session.connect({
      token: form.token,
      owner: parsedRepo.value.owner,
      repo: parsedRepo.value.repo,
      branch: form.branch,
    })
    if (!ok) {
      ui.error(session.error || '连接失败')
      // 404 有三种互不相同的成因，直接自动跑一次诊断，省得用户自己猜
      if (session.errorKind === 'not-found' || session.errorKind === 'forbidden') {
        await runDiagnose()
      }
      return
    }
    ui.success(`已连接为 ${session.actorName}`)
    form.branch = session.repoConfig.branch
    if (!workspace.booted) await workspace.boot()
    else await workspace.sync({ force: true })
    await refreshState()
    editing.value = false
    if (workspace.configLoaded && workspace.configShapeValid) {
      router.push({ name: 'kanban' })
    }
  } finally {
    connecting.value = false
  }
}

async function initialize() {
  initError.value = ''
  try {
    const result = await workspace.initializeRepository()
    if (result.ok) {
      ui.success('数据仓库已初始化，已写入默认流程模板。')
      await refreshState()
      router.push({ name: 'kanban' })
    }
  } catch (error) {
    initError.value = error?.message || '初始化失败'
    ui.error(initError.value)
  }
}

function startEditing() {
  editing.value = true
  form.token = session.token || ''
  form.repoInput = formatRepo(session.repoConfig.owner, session.repoConfig.repo)
  form.branch = session.repoConfig.branch || ''
  initError.value = ''
}

function cancelEditing() {
  editing.value = false
  form.repoInput = formatRepo(session.repoConfig.owner, session.repoConfig.repo)
}

function disconnect() {
  session.disconnect()
  form.token = ''
  form.repoInput = ''
  form.branch = ''
  editing.value = false
  initError.value = ''
  ui.info('已退出登录，本地凭证已清除。')
}

function openRepo() {
  if (currentRepoUrl.value) window.open(currentRepoUrl.value, '_blank', 'noopener')
}

onMounted(async () => {
  session.hydrate()
  if (session.isReady) {
    if (!workspace.booted) await workspace.boot()
    await refreshState()
  }
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-900">
        {{ showForm ? '连接数据仓库' : '同步与账号' }}
      </h1>
      <p class="mt-1 text-sm text-slate-500">
        数据全部存放在你自己的 GitHub 私有仓库里，工具本身不经过任何第三方服务器。
      </p>
    </header>

    <div
      v-if="session.repoIsPublic"
      class="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"
    >
      <strong>危险：这个仓库是公开的。</strong>
      数据仓库必须是 private，否则任何人（包括搜索引擎）都能读到全部客户与项目数据。
      请先去 GitHub 把仓库改为私有。
    </div>

    <!-- ============ 连接表单 ============ -->
    <section v-if="showForm" class="space-y-5">
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <h2 class="text-sm font-semibold text-slate-900">第一步：生成 Token</h2>
        <ol class="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            打开
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener"
              class="text-sky-600 underline"
            >
              GitHub → Fine-grained tokens
            </a>
            （注意选 fine-grained，不要选 classic）
          </li>
          <li>
            <strong>Repository access</strong> 选 <em>Only select repositories</em>，只勾选你的数据仓库
          </li>
          <li>
            <strong>Permissions → Repository permissions → Contents</strong> 设为
            <em>Read and write</em>
          </li>
          <li>生成后复制 Token（只显示一次），粘贴到下面</li>
        </ol>
      </div>

      <form class="space-y-3 rounded-lg border border-slate-200 bg-white p-4" @submit.prevent="connect">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            GitHub Token <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.token"
            type="password"
            autocomplete="off"
            placeholder="github_pat_..."
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">
            数据仓库地址 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.repoInput"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://github.com/你的用户名/pm-tools-data"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            :class="
              repoInputHasError
                ? 'border-rose-400 bg-rose-50 focus:border-rose-500'
                : 'border-slate-300 focus:border-slate-500'
            "
          />

          <p v-if="parsedRepo" class="mt-1.5 text-xs text-emerald-700">
            将连接到
            <code class="rounded bg-emerald-50 px-1 py-0.5 font-medium">{{ parsedRepo.owner }}/{{ parsedRepo.repo }}</code>
            <span class="text-slate-400">（owner = {{ parsedRepo.owner }}）</span>
          </p>
          <p v-else-if="repoInputHasError" class="mt-1.5 text-xs text-rose-600">
            无法识别。请直接粘贴 GitHub 仓库页面的地址，或按 <code>owner/repo</code> 格式填写。
          </p>
          <p v-else class="mt-1.5 text-xs text-slate-400">
            直接粘贴仓库地址最省事，避免手抄出错。
          </p>

          <p class="mt-1.5 text-xs leading-relaxed text-slate-400">
            地址里的 owner 可以是你的用户名、组织名，也可以是<strong>别人的账号</strong>（只要你的 Token
            有权访问那个仓库）。不用和 Token 的账号一致——去仓库页面看一眼
            <code>github.com/</code> 后面那一段是什么就填什么。
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">分支（可留空）</label>
          <input
            v-model="form.branch"
            type="text"
            placeholder="留空则自动使用仓库默认分支"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </div>

        <div class="flex gap-2">
          <button
            type="submit"
            class="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            :disabled="connecting || !canSubmit"
          >
            {{ connecting ? '连接中…' : '连接并校验' }}
          </button>
          <button
            v-if="session.isReady"
            type="button"
            class="rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            @click="cancelEditing"
          >
            取消
          </button>
        </div>

        <p v-if="session.error" class="text-sm text-rose-600">{{ session.error }}</p>

        <button
          type="button"
          class="text-xs text-sky-600 underline disabled:opacity-50"
          :disabled="diagnosing || !parsedRepo"
          @click="runDiagnose"
        >
          {{ diagnosing ? '诊断中…' : '连不上？点这里逐项诊断' }}
        </button>
      </form>

      <!-- 诊断报告 -->
      <div v-if="diagnostic" class="space-y-2">
        <h2 class="text-sm font-semibold text-slate-900">
          诊断结果
          <span class="ml-1 font-normal text-slate-400">
            针对 {{ parsedRepo?.owner }}/{{ parsedRepo?.repo }}
          </span>
        </h2>
        <div
          v-for="(item, index) in diagnostic.items"
          :key="index"
          class="rounded-lg border px-3 py-2.5 text-sm"
          :class="LEVEL_STYLES[item.level] || LEVEL_STYLES.info"
        >
          <p class="font-medium">{{ item.title }}</p>
          <p class="mt-0.5 leading-relaxed opacity-90">{{ item.detail }}</p>
        </div>

        <div class="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
          <p class="mb-1 font-medium text-slate-700">404 的三种常见成因，逐一对照：</p>
          <ol class="list-decimal space-y-0.5 pl-4">
            <li>
              <strong>仓库还没建</strong>：去
              <a
                href="https://github.com/new"
                target="_blank"
                rel="noopener"
                class="text-sky-600 underline"
              >GitHub 新建一个 private 仓库</a>。
            </li>
            <li>
              <strong>Token 没覆盖这个仓库</strong>（fine-grained Token 最常见）：打开
              <a
                href="https://github.com/settings/personal-access-tokens"
                target="_blank"
                rel="noopener"
                class="text-sky-600 underline"
              >Token 设置</a>，在
              <em>Repository access → Only select repositories</em> 里把该仓库勾上并保存。
            </li>
            <li>
              <strong>Token 是 classic 且缺权限</strong>：classic Token 需要 <code>repo</code> 范围；
              建议直接改用 fine-grained Token。
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- ============ 已连接 ============ -->
    <section v-else class="space-y-4">
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <div class="flex flex-wrap items-center gap-3">
          <img
            v-if="session.user?.avatar_url"
            :src="session.user.avatar_url"
            alt=""
            class="h-9 w-9 rounded-full"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-slate-900">{{ session.actorName }}</p>
            <p class="mt-0.5 break-all text-xs text-slate-500">
              当前数据仓库：
              <code class="rounded bg-slate-100 px-1 py-0.5 text-slate-700">
                {{ session.repoLabel }}
              </code>
              <span class="text-slate-400">（{{ session.repoConfig.branch }}）</span>
            </p>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              :disabled="checking"
              @click="refreshState"
            >
              {{ checking ? '检测中…' : '重新检测' }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              @click="openRepo"
            >
              打开仓库
            </button>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400">
          每次打开页面都会自动同步到这个仓库。如果下面提示异常，多半是仓库地址填错了。
        </p>
      </div>

      <!-- 连错仓库：结构不符 -->
      <div
        v-if="badConfigShape"
        class="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900"
      >
        <p class="font-semibold">连错仓库了？这个仓库里的 config.json 不是 pm-tools 的数据结构。</p>
        <p class="mt-1.5">
          当前地址 <code class="rounded bg-white/70 px-1">{{ session.repoLabel }}</code>
          里已经有一个 <code>config.json</code>，但它不是本工具写的。
        </p>
        <p class="mt-1.5">
          已<strong>阻止初始化</strong>，避免覆盖别人的文件。请确认仓库地址是否填对——
          owner 是组织名还是你的用户名，很容易混。
        </p>
        <button
          type="button"
          class="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          @click="startEditing"
        >
          换一个仓库地址
        </button>
      </div>

      <!-- 同步失败（例如文件损坏、token 失效） -->
      <div
        v-else-if="syncFailed"
        class="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900"
      >
        <p class="font-medium">同步失败</p>
        <p class="mt-1">{{ workspace.syncError }}</p>
        <p class="mt-1.5 text-xs">
          如果是 401，说明 Token 已过期或被撤销，重新生成一个粘贴进来即可；
          如果是文件损坏，需要去 GitHub 上检查对应的 JSON 文件。
        </p>
        <button
          type="button"
          class="mt-3 rounded-lg border border-rose-400 px-3 py-2 text-sm text-rose-800 hover:bg-rose-100"
          @click="startEditing"
        >
          重新配置 Token
        </button>
      </div>

      <!-- 需要初始化 -->
      <div
        v-else-if="needsInit"
        class="rounded-lg border p-4 text-sm"
        :class="
          looksLikeForeignRepo
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : 'border-slate-200 bg-white text-slate-700'
        "
      >
        <p class="font-medium">
          {{ looksLikeForeignRepo ? '请先确认：这确实是你要用的数据仓库吗？' : '这个数据仓库还没有初始化。' }}
        </p>
        <p v-if="looksLikeForeignRepo" class="mt-1.5">
          它里面已经有 <strong>{{ workspace.remoteFileCount }}</strong> 个文件，
          但没有找到本工具的 <code>config.json</code>。
          继续初始化会在里面写入 pm-tools 的数据文件。如果这不是你要用的仓库，请先换地址。
        </p>
        <p v-else class="mt-1.5">
          点击下方按钮会写入 <code>config.json</code> 并生成默认的 7 节点流程模板。
          组里第一个人初始化一次即可，其他人直接使用。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            @click="initialize"
          >
            {{ looksLikeForeignRepo ? '确认无误，初始化' : '初始化数据仓库' }}
          </button>
          <button
            v-if="looksLikeForeignRepo"
            type="button"
            class="rounded-lg border border-amber-400 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
            @click="startEditing"
          >
            换一个仓库地址
          </button>
        </div>
        <p v-if="initError" class="mt-2 text-sm text-rose-700">{{ initError }}</p>
      </div>

      <!-- 一切正常 -->
      <div
        v-else-if="initializedSummary"
        class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
      >
        <p class="font-medium">数据仓库已就绪</p>
        <ul class="mt-1.5 space-y-0.5">
          <li>流程模板：{{ initializedSummary.templates }} 个版本（当前 v{{ initializedSummary.activeVersion }}）</li>
          <li>客户：{{ initializedSummary.customers }} 个</li>
          <li>项目：{{ initializedSummary.projects }} 个</li>
        </ul>
        <p v-if="initializedSummary.initializedAt" class="mt-1.5 text-xs text-emerald-700">
          初始化于 {{ initializedSummary.initializedAt.slice(0, 10) }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            @click="router.push({ name: 'kanban' })"
          >
            进入看板
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            @click="startEditing"
          >
            更换 Token 或仓库
          </button>
        </div>
      </div>

      <button
        type="button"
        class="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-50"
        @click="disconnect"
      >
        退出登录（清除本地 Token）
      </button>
    </section>

    <p class="mt-6 text-xs leading-relaxed text-slate-400">
      关于安全：Token 只保存在本机浏览器，不会上传到任何服务器。但本工具是纯前端架构，
      任何能打开这个页面并拿到 Token 的人都能读写数据仓库，因此不要把它部署到公开可访问的地址上，
      也不要在里面存放报价金额一类的机密信息（见 PRD R-01 / R-02）。
    </p>
  </div>
</template>
