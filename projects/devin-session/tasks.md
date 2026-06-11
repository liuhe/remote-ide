# Devin Session 集成 — 任务列表

> 状态：`🔘` 待办 `🚀` 进行中 `✅` 完成。每个任务下可附注意事项。

## Phase 0：准备

- ✅ **本地验证 `devin acp` 可用**
  - `devin --version` = 2026.5.6-8 ✓
  - `devin --permission-mode dangerous acp` initialize + session/new 实测通过
  - 修正项见 log.md 2026-05-18 20:35 条目

## Phase 1：服务端 ACP 桥

- ✅ **新增 `server/src/devin.ts`**
  - DevinSessionEntry + bySessionId / pending 注册表（独立于 session.ts）
  - readline 解析 stdout，区分 response / notification / agent→client request
  - initialize (id=0) → session/new 或 session/load (id=1) 流程
  - WS 入站 user/cancel/set_mode/set_config → ACP JSON-RPC
  - WS 出站 acp / started / exit / error / stderr
  - idle-kill 5min grace
  - 自动 reject fs/* / terminal/* / 其他 agent→client RPC

- ✅ **`GET /api/projects/:id/devin-sessions`**（oneShotRpc + session/list，30s 超时）

- ✅ **注册路由**：`index.ts` 加 `registerDevinRoutes(app)`

## Phase 2：前端类型与 workspace

- ✅ **`types.ts`** 加 `DevinTab` + `ResumableDevinSession`
- ✅ **`api.ts`** 加 `listDevinSessions(projectId)`
- ✅ **`Settings`** 加 `devinModel?` 字段（前端 types + 服务端 store 都已更新）
- 🔘 Settings UI 加 Devin model select（可选；首版用 Devin 默认即可，已经在 DevinPanel 顶部 toolbar 暴露 model 切换）

## Phase 3：DevinPanel

- ✅ **新增 `web/src/components/DevinPanel.tsx`**
  - WS `/ws/devin?project=X&resume=Y`，断线指数退避重连
  - 渲染：agent_message_chunk / thought_message_chunk / user_message_chunk(replay) / tool_call / tool_call_update / plan / session_info_update / current_mode_update / config_option_update
  - 顶部 toolbar：状态、mode select、model select、Stop 按钮
  - 输入框（文本；图片留作 Phase 6）
  - `onTitle` 接收 session_info_update 或首条用户消息
  - `onSessionId` 上报 sessionId（来自 session/new 或 session/load response）

## Phase 4：TabBar + App 集成

- ✅ **`TabBar.tsx`**
  - 三种 tab 图标（📄 / 🤖 / 🧬）
  - overflow 菜单四入口（new claude / resume claude / new devin / resume devin）
  - props 加 `onNewDevinSession` / `onResumeDevinSession`

- ✅ **`App.tsx`**
  - `openDevinTab(resumeId?, title?)`
  - 渲染分支 devin → DevinPanel
  - `pickDevinSessionDialog` 用 prompt() 选择待恢复 session

## Phase 5：构建与本地验证

- ✅ **`pnpm -r build`** 通过（server + web 都干净）
- ✅ 启动 `pnpm dev`，手工浏览器验证：
  - 新建 Devin session → 收到 sessionId / mode / model 显示
  - 发消息 → 看到 agent_message_chunk 流式输出
  - 触发 tool call → 看到卡片状态变化
  - Stop → session/cancel 生效，最终得 cancelled stopReason
  - 关闭/重开 tab（同 resumeId）→ session/load 回放历史
  - Devin 与 Claude tab 并存，互不影响
  - **服务端需要重启**：当前 `tsx`（非 watch）跑的，需要手动 kill + 重启 `pnpm dev:server`

## Phase 6（当前批次：1-4 + 5）

- ✅ **Task 1：图片输入**
  - DevinPanel: paste / attach（参考 ChatPanel 的 fileInputRef / addFiles）
  - WS 消息：`{type:'user', text, images:[{mediaType, data}]}`
  - 服务端：把 image 翻成 ACP content block `{type:'image', mimeType, data}`
  - 用户消息渲染：支持 images 数组 + lightbox

- ✅ **Task 2：Settings UI 暴露 devinModel 默认值**
  - Settings.tsx 加 Devin 区段，列一个**精简**model 列表（不是 75 个全列出）
  - DevinPanel 接 settings.devinModel；session/new response 返回后如 settings 有值，发 `session/set_config_option` 应用

- ✅ **Task 3：Tool 卡片精修 / summarizeTool 等价物**
  - summarizeDevinTool(kind, rawInput) — 按 kind 取关键字段做 80 字内总结
  - ToolFields 风格的 input 展开
  - diff 内容专门样式（read/edit/delete kind）
  - popout modal（共享 ChatPanel 的样式）

- ✅ **Task 4：sessions.db 直读**
  - 替换 `oneShotRpc('session/list')`
  - 用 `node:sqlite` 的 `DatabaseSync` 查 `sessions.db`，WHERE working_directory = cwd AND hidden = 0
  - 没 sessions.db 文件时 graceful fallback 到 oneShotRpc

- ✅ **Task 5：权限请求 UI（保留 --permission-mode dangerous）**
  - 服务端：移除 fs/terminal/permission 的统一自动 reject；改成只对 fs/terminal reject（capabilities 已声明 false），对 `session/request_permission` 透传给 client
  - 客户端：弹模态框列出 options（Allow once / Always allow / Reject），用户点选后回送
  - WS 协议：`{type:'permission_response', id, optionId}` → 服务端拼回 `{jsonrpc, id, result:{outcome:{outcome:'selected', optionId}}}`
  - 保留 `--permission-mode dangerous`：实际上不会经常触发，是防御性的兜底
  - 如果 client 离线，服务端兜底 timeout 后自动 reject（避免 agent 永远 hang）

## Phase 7（后续，再后期不做）

- 🔘 fs/terminal capabilities 完整支持
- 🔘 MCP server 配置
- 🔘 `session/resume` 优化（前端持久化 transcript，避免每次 load 回放历史）
