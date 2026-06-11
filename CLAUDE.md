# remote-ide - AI 协作契约

## 硬性约束

- **禁止写 memory 文件**：`~/.claude/projects/*/memory/` 下的文件不受 git 管理，不可写入。所有需要跨对话保留的知识一律写入本文件（`CLAUDE.md`）或 `projects/` 下的项目文件。
- **改 web 源码必须 rebuild**：server 用 `@fastify/static` 直接托管 `web/dist`，浏览器拿到的是构建产物。改完 `web/src/**` 后必须 `pnpm --filter web build` 才能在浏览器看到效果——只跑 `tsc --noEmit` 不会更新 dist。
- **server 由 launchd 托管**：本机 server 进程由 `~/Library/LaunchAgents/com.eric.remote-ide.plist` 管理，不是 `pnpm dev:server`。改完 server 源码后用 `launchctl kickstart -k gui/$(id -u)/com.eric.remote-ide` 重启；状态用 `launchctl list | grep com.eric.remote-ide` 查（第一列 PID，第二列上次退出码）。**不要建议用户手动 Ctrl+C / `pnpm dev:server`**——会和 launchd 冲突。日志在 `~/Library/Logs/remote-ide.{log,err}`。
- **AI 跑在 remote-ide 子进程里时 kickstart 前要心里有数**：用户经常通过 remote-ide 的 Claude tab 跟 AI 对话，此时 claude CLI 是 server 派生的子进程；kickstart 会杀掉整个进程树包括当前会话。**不是禁止**，而是动手前先：(a) 把要保留的改动 commit 落地，避免重启时丢工作区；(b) 跟用户对齐"接下来会断线、请在浏览器里 reload 接上新 server"——或者由用户在浏览器外的终端代执行 kickstart；(c) 也可以先看 `launchctl list` 的 PID 配合 `ps -o etime` 是否已经晚于源码 mtime，launchd KeepAlive 触发的自然重启可能已经让新代码生效，那就不必再动手。
- **新增带 native build script 的依赖（sharp/esbuild/canvas 等）必须同步加入 `pnpm-workspace.yaml` 的 `allowBuilds:`，值必须是 boolean `true`**。pnpm v11 把未授权 build script 视为 fatal error，launchd 启动用的 `pnpm --filter server start` 会拒绝执行，service 直接挂。pnpm 自动 emit 的 `set this to true or false` 字符串占位符不算授权，必须改成 `true`。

## 工作模式（每次对话必须执行）

本文件是知识库入口，也是工作模式的执行保障。**核心原则：持续更新，贯穿整个对话。**

### 对话开始时

判断当前模式：
- **通用模式**：不针对具体项目 → 依赖本文件
- **项目模式**：用户说明在做某个项目 → 执行以下流程：
  1. 检查 `projects/<name>/` 是否存在
  2. **已有项目**：读取 `overview.md`、`tasks.md`、`log.md`，了解目标、任务状态和历史后再开始工作
  3. **新项目**：先与用户交互补全 `overview.md`（项目目标是必须有的），再创建 `tasks.md` 和 `log.md`，然后才开始工作

### 对话过程中

随时更新，**对话结束前必须主动确认日志已是最新**。按知识性质分层落位（详见 `knowledge-structure.md`）：

- **核心常驻约束**（每次对话都需要的规则） → `CLAUDE.md`，保持精简
- **参考数据 / 业务规则**（按需引用的数据、映射、配置） → 独立文件（如 `docs/<topic>.md`），`CLAUDE.md` 仅放一行指针
- **低频操作流程**（步骤序列） → `.claude/skills/<name>.md`
- **项目（initiative）内进展**（任务状态、踩坑、决策） → `projects/<name>/{tasks,log}.md`

不确定该放哪？停下来与用户确认。

### 项目文件结构

`projects/<name>/` 下：
- `overview.md` — 项目目标（必有）
- `design.md` — 设计方案（可选，涉及系统改动、平滑发布等需要提前规划时创建）
- `tasks.md` — 任务列表，每个任务下可有注意事项；状态图标：`🔘` 待办 `🚀` 进行中 `✅` 完成
- `log.md` — `YYYY-MM-DD HH:MM` + 做了什么；成功不加说明，失败要写原因

### 知识库结构约束

本工程本身就是一个知识库，目录结构必须保持用户可理解、可审查。

- 添加或修改任何目录（新建顶级目录、重组、改变约定）必须先与用户确认
- 目录约定记录在 `knowledge-structure.md`，新人读完即能理解工程组织
- 修改 `knowledge-structure.md` 也需先与用户确认

## 系统建模方法论（DCDDP v6.2）

讨论系统现状、变更前对齐、实现拆解时，统一按本方法论的语言进行。

### 核心约定（摘要）

- **4 视图分层**：业务视图（参与方/业务用例/系统用例）、领域模型视图（实体/关系/状态机/规则）、系统逻辑视图（应用/拓扑/应用用例/页面）、系统部署视图。
- **Overview / Details 递归**：每个视图先一份精简 overview，再按需展开 details，层数不限。
- **三层用例**：业务用例（价值主张）→ 系统用例（系统对外能力，无规则）→ 应用用例（实现，含规则与 Include/Extend 链）。
- **声明式**：模型表达 What 与约束，AI 推导 How；配置量应远小于代码量。

### 模型存放

模型默认路径：`./docs/modeling/`，按 DCDDP 多文件目录约定组织。如需调整，直接编辑本段中的路径即可。

### 本地路径配置

下面引用的 `<aie-root>` 是 ai-excellence 仓库在本机的绝对路径，存放在 `.claude/settings.local.json` 的 `aie_root` 字段（gitignored，每台机器自己配）。**AI 在 Read 方法论文件前先读取该字段获取实际路径前缀，把 `<aie-root>` 替换成它再做拼接**。

### 方法论真身（按需 Read 阅读完整内容；`<aie-root>` 见上）

- 总览与定位：`<aie-root>/methodology/vision.md`
- 建模约定：`<aie-root>/methodology/modeling-conventions.md`
- 元模型 schema：`<aie-root>/methodology/meta-model.schema.yaml`
- AI 建模 prompt：`<aie-root>/methodology/system-modeling-prompt.md`
- 参考样板：`<aie-root>/methodology/examples/chargable-proxy/`

### 模型 / 代码一致性（硬约束）

模型是 source of truth；代码必须完整反映模型。**这条 override 任何"分阶段做"、"先改一部分"的建议**。

1. **代码反映模型，不是相反**。命名、类型签名、模块边界都跟模型一致——模型说 `Peer`，代码就不能叫 `PeerRoute`。
2. **改模型 = 同步改代码**。模型变更（重命名 / 字段重组 / 关系调整 / 状态机 / archetype 调整）必须**同一次工作**内带代码改动落地，不允许"模型先改，代码下次再排期"。
3. **改代码 = 先对齐模型**。系统变更必须先在模型层讨论清楚（涉及的实体 / 用例 / 规则 / 关系），再动代码——不允许先改代码再回头补模型。
4. **不分阶段、不留半成品**。改动量大时先把模型改完整再让代码一次性追上；不允许"模型半重构"或"代码半重构"。
5. 模型与代码不一致即债务，下个 commit 优先消除。

### AI 行为指引

| 用户说 | AI 应该 |
|--------|---------|
| "改下代码 X" | 先看模型，X 在模型里叫什么？模型未表达 → 先补模型再写代码 |
| "加个新功能" | 先回到用例层（业务 → 系统 → 应用）对齐入口，再涉及实体/规则，最后才进代码 |
| "重命名 X" | 模型 + 代码 + 文档/测试/配置 一次同步改；单点改视为不完整 |
| "这块大改怎么排期？" | **不要主动提议阶段拆分**；用户没要求时默认一次性彻底重构 |

补充：
- 用户讨论"某模块/功能/流程"时，先用 4 视图框架反问：当前在哪个视图层？涉及的用例是哪一层？是否已有相关模型文件？
- 模型已存在 → 动手前先读 `./docs/modeling/`；不存在 → 引导用户从最适合的视图（需求驱动从业务用例 / 技术驱动从系统架构 / 数据中心型从领域模型）开始。
- 用模型推动 AI 写代码（声明式），不是绕过模型直接 prompt。
- **例外**：明确说"我在探讨方向"或"这是一次性 PoC"时可绕过约束；探讨产物不进 main 分支。

集成入口：`<aie-root>/docs/system-modeling-methodology.md`

## ai-excellence 可选规范

> 本工程对各项可选规范的选择。由 /aie-apply 维护。如需更改，重新运行 /aie-apply 并在意图中表达。

- ✅ system-modeling — 已启用 DCDDP 系统建模方法论
- ✅ team-mode — 已启用 AI 团队工作模式（PM + 6 角色）
