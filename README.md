# pm-tools

汽车配件供应商销售小组的**项目跟进工具**。

纯前端（Vue 3 + Vite + Tailwind CSS），数据存放在你自己的 **GitHub 私有仓库**里，无需后端、无任何付费依赖。

- 需求文档：[`docs/0929-BRD.md`](docs/0929-BRD.md)
- 产品需求文档：[`docs/0929-PRD.md`](docs/0929-PRD.md)

---

## 快速开始

### 1. 准备一个私有数据仓库

在 GitHub 建一个 **private** 仓库（例如 `pm-tools-data`），不需要放任何初始文件。

数据仓库**必须私有**——里面会存全组的客户名、项目进度和回退原因。工具检测到公开仓库会给出醒目警告。

组内其他成员需要被加为该仓库的 **collaborator**（Write 权限），否则读不到数据。

### 2. 每人生成一个 Token

打开 <https://github.com/settings/personal-access-tokens/new>，注意要选 **Fine-grained token**：

| 配置项 | 值 |
| --- | --- |
| Repository access | `Only select repositories` → 只勾选上面那个数据仓库 |
| Permissions → Repository permissions → Contents | `Read and write` |
| Expiration | 按团队安全策略设置 |

> 为什么不用 OAuth 一键登录：GitHub 的 `/login/oauth/access_token` 与 `/login/device/code`
> **不允许浏览器跨域调用**（实测无 `Access-Control-Allow-Origin`，且为 GitHub 刻意设计），
> 所以纯前端无法完成 OAuth 或 Device Flow。走 fine-grained PAT 反而更安全——
> 可以只授权**单个仓库的 Contents**，而 OAuth 的 `repo` scope 是全账号所有仓库。
> 详见 PRD 7.2。

### 3. 本地开发

```bash
pnpm install
pnpm dev             # http://localhost:5173
```

> 本项目使用 **pnpm**（仓库里只有 `pnpm-lock.yaml`）。用 npm 也能跑起来，但请不要提交 `package-lock.json`，否则 CI 会装出另一套依赖树。

打开页面后填写 Token，然后**直接粘贴 GitHub 仓库地址**（工具自动拆分 owner 与 repo）。

> 为什么只收地址、不收手填的 owner：`owner` 是仓库地址的前半段。手抄错时，如果错的地址恰好指向**另一个真实存在的仓库**，GitHub 不会报任何错，工具会把数据静默写进别人的仓库。粘贴地址可以从根上消除这个错误。

**组里第一个人**点击「初始化数据仓库」写入默认的 7 节点流程模板，其他人直接连上即可。

### 4. 部署到 GitHub Pages

把前端代码推到一个 **public** 仓库（代码公开无所谓，数据在另一个私有仓库），推送到 `main` 分支即自动部署。

工作流会自动处理三件事：

1. **自动启用 Pages**（`configure-pages` 的 `enablement: true`），不需要你先进 Settings 把 Source 改成 GitHub Actions
2. **自动解析 `base`** 为 `/<仓库名>/`（用户/组织站点 `xxx.github.io` 则用 `/`）
3. **用 pnpm 安装并构建**（`--frozen-lockfile`，锁文件不一致会直接失败而不是悄悄装出别的版本）

> 如果部署失败提示 "Get Pages site failed" 或类似的权限错误，再去
> **Settings → Pages → Build and deployment → Source** 手动选一次 `GitHub Actions`。

构建产物不含任何凭证（Token 只存在使用者本机浏览器），因此前端仓库可以放心公开。

---

## 连不上数据仓库？

GitHub 的 `GET /repos/{owner}/{repo}` 对下面三种完全不同的情况**返回的都是 404**，光看报错分不出是哪种：

| 原因 | 怎么确认 | 怎么修 |
| --- | --- | --- |
| 仓库还没建 | 打开 `https://github.com/你的用户名?tab=repositories` 看有没有 | 建一个 **private** 仓库 |
| fine-grained Token 没覆盖这个仓库 | Token 设置里 `Repository access` 的列表中没有它 | 把该仓库勾进 `Only select repositories` 并保存 |
| Token 是 classic 且缺 `repo` 范围 | Token 是否以 `ghp_` 开头（fine-grained 是 `github_pat_`） | 改用 fine-grained Token，或补上 `repo` 范围 |

**连接失败时工具会自动跑一次诊断**，把这三类拆开逐项告诉你，并列出名字相近的仓库（用来抓拼写错误和 owner 填错）。也可以手动点「连不上？点这里逐项诊断」。

> 最常见的误判：仓库建在**组织**下，但你习惯性地填了自己的用户名。去仓库页面复制地址粘贴过来最稳。

---

## 数据仓库结构

```
data-repo/                       (private)
├─ config.json                   流程模板、管理员名单
├─ customers/
│  └─ cus_k3m9x2.json            一个客户一个文件
└─ projects/
   └─ prj_20260929_a1b2c3.json   一个项目一个文件
```

**为什么一个对象一个文件**：GitHub 内容 API 的写入粒度是**整个文件**。如果所有项目挤在一个大文件里，任何两个人同时保存都会互相覆盖。拆成单文件后，改不同项目 = 改不同文件 = 天然无冲突。

**顺带白拿的好处**：每次保存就是一次 git commit。所以你自动获得完整的修改历史、谁在什么时候改了什么、任意时间点回滚。GitHub 当数据库最大的价值不是存储，是它自带版本史。

---

## 已实现 / 未实现

对照 PRD，v0.1 的完成情况：

| 需求 | 状态 |
| --- | --- |
| FR-01 连接与授权（fine-grained PAT） | 已实现 |
| FR-02 数据仓库初始化 | 已实现 |
| FR-03 客户管理 | 已实现 |
| FR-04 项目管理 | 已实现 |
| FR-05 项目详情（五个区块） | 已实现 |
| FR-06 节点正向推进（末节点即关闭项目） | 已实现 |
| FR-07 节点回退（必填原因 + 历史留痕） | 已实现 |
| FR-08 流程模板配置 + 实时预览 | 已实现 |
| FR-09 自定义字段（5 种类型 / 必填校验 / 敏感信息提示） | 已实现 |
| FR-10 看板视图（分列 / 拖拽推进 / 停滞标红 / 筛选） | 已实现 |
| FR-11 列表视图 | 已实现 |
| FR-12 全组可见 | 已实现（架构上天然全组可见） |
| FR-13 响应式布局 | 已实现 |
| FR-14 多端同步与刷新触发 | 已实现 |
| FR-15 同步状态指示器 | 已实现 |
| FR-16 写入冲突处理（三方合并 + 逐字段选择） | 已实现 |
| FR-17 离线草稿与离线可用 | 已实现 |
| FR-24 流转轨迹条（P1） | 已实现 |
| FR-20 我的待办（P1） | **部分实现**：跟进到期与停滞超期已实现；**手动待办未实现**（需先定义待办数据文件与并发规则） |
| FR-21 PWA 安装（P1） | **部分实现**：manifest 已提供，可添加到主屏；安装体验引导未做 |
| FR-22 版本历史与回滚（P1） | 未实现 |
| FR-23 甘特 / 时间轴（P1） | 未实现 |
| FR-30 / FR-31 统计报表与导出（P2） | 未实现 |

---

## 技术决策记录

| 决策 | 原因 |
| --- | --- |
| 代码仓库 public + 数据仓库 private | GitHub Free 版**不能给私有仓库开 Pages**。数据根本不经过 Pages，只走 API，所以这个组合既零成本又安全。 |
| 授权用 fine-grained PAT | GitHub OAuth 端点不允许浏览器跨域，Device Flow 纯前端不可实现（PRD 7.2 有实测记录）。 |
| 一个业务对象一个文件 | GitHub 写入粒度是整个文件，共用大文件必然并发覆盖（PRD 6.1）。 |
| `flowSnapshot` 深拷贝 | 项目创建时把当时的模板定义复制一份，之后改模板不影响老项目（PRD FR-08）。 |
| 只读事件驱动同步，不做定时轮询 | 数据无变化时增量同步成本 = 1 次请求；移动端轮询耗电且无收益（PRD 7.9.2）。 |
| 冲突不用 OT / CRDT | 小团队各管各的项目，但"冲突要少"和"冲突了不能丢数据"是两件事——用三方合并 + 让用户逐字段选（PRD 7.9.3）。 |
| 图形用手写 SVG，不上图布局库 | 流程拓扑是**单链**，坐标可常量时间手算；引入 Vue Flow / X6 是过度设计（PRD 7.8）。 |
| 只在生产环境注册 Service Worker | 开发环境让 SW 和 Vite HMR 抢请求会互相干扰。 |

---

## 安全须知

这是纯前端架构，请务必了解以下限制（PRD 第 8 章与第 10 章）：

1. **不存在真正的权限隔离。** 所有数据都会下载到浏览器，Token 也存在浏览器里。任何能打开这个页面并拿到 Token 的人都能读写整个数据仓库。模板配置的"仅管理员可见"**只是界面层面的隐藏**，不是安全边界。
2. **不要把机密信息写进备注类字段。** 工具已按 PRD 决策不提供金额字段，但多行文本框里手写的报价金额一旦提交，就**全组可见且在 git 历史中永久留存，事后删除也抹不掉**。
3. **不要把站点部署到公开可访问的地址。** 前端仓库公开没问题（不含数据、不含凭证），但 Pages 站点本身是公开 URL——想限制访问应使用私有仓库 Pages 或企业版的 access control。
4. **Token 有有效期。** 到期后工具会报 401，重新生成并粘贴即可。

### 工具内置的几道保护

这些是刻意做的，不是可有可无的提示：

| 保护 | 为什么需要 |
| --- | --- |
| 连接界面只收一个「仓库地址」，自动拆分 owner / repo | owner 手抄错时，若错的地址恰好指向另一个真实存在的仓库，**GitHub 不会报任何错**，工具会把数据静默写进去 |
| 顶栏常驻显示当前 `owner/repo`，异常时变红 | 让"我现在连的是哪个仓库"随时可自查。藏在 tooltip 里等于没有——手机没有悬浮 |
| 检测到公开仓库 → 全站红色告警 | 公开仓库等于把所有客户与项目数据对全世界公开 |
| 远端 `config.json` 结构与本工具不符 → 阻止初始化 | 避免在别人的仓库里写入本工具的数据文件 |
| 远端有文件但找不到 `config.json` → 初始化前二次确认 | 提示你很可能连错了仓库 |

---

## 常用命令

```bash
pnpm dev       # 开发服务器
pnpm build     # 生产构建，产物在 dist/
pnpm preview   # 本地预览生产构建
```
