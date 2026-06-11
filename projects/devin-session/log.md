# Devin Session 集成 — 工作日志

> 格式：`YYYY-MM-DD HH:MM` + 内容。成功不加说明，失败要写原因。

## 2026-05-18 20:30

- 与用户确认实现方向：**Devin 作为新 tab type `'devin'` 实现**，与 Claude session 完全隔离，互不复用
- 与用户对齐 4 个关键设计决策：
  - WS 协议：原样透传 ACP
  - 权限：spawn 时加 `--permission-mode dangerous`
  - 子进程粒度：每 session 一进程
  - 恢复方式：`session/load`（Agent 回放历史）
- 输出 `design.md` 和 `tasks.md`，准备进入 Phase 0 / Phase 1

## 2026-05-18 20:35 — Phase 0 验证

`devin --permission-mode dangerous acp` initialize + session/new 实测通过。修正 research.md 几处过时信息：

- Agent name 实际为 `affogato`（不是 `devin`）；version `0.0.0-dev`
- Mode IDs：`accept-edits` / `ask` / `plan` / `bypass`（不是 `normal/plan/bypass`，默认 accept-edits）
- Session ID 是人类可读 slug（如 `purrfect-opinion`），不是 UUID
- session/new 的 response 到达**之前**会先发若干 notifications（`config_option_update` / `current_mode_update` / `available_commands_update`） → 客户端需要能容忍这种乱序
- `authMethods` 非空（`windsurf-api-key`），但已登录情况下不必走 authenticate
- Model 列表非常长（70+ 个），默认 `swe-1-6-fast`。常用：`claude-opus-4-7-medium`、`claude-opus-4-6`、`claude-sonnet-4-6`、`gpt-5-5-medium`、`adaptive`
- agentCapabilities 还多了 `additionalDirectories` 和两个 `_meta` 标记（multiRootWorkspace、sessionRename）
- stderr 输出 `chisel::acp` 日志，量比较大；不会污染 stdout 但需要单独收集

## 2026-05-18 20:38 — Phase 1 开始

开始写 `server/src/devin.ts`。

## 2026-05-18 20:55 — Phase 1–4 完成

- 服务端：`server/src/devin.ts`（约 380 行），独立的 ACP 桥；`/ws/devin` + `/api/projects/:id/devin-sessions`
- 前端：`web/src/components/DevinPanel.tsx`（约 460 行），独立于 ChatPanel
- 类型/路由：types.ts、api.ts、App.tsx、TabBar.tsx、store.ts 全部加 `devin` tab type
- 顺手修复 session.ts 第 149 行 `raw` 隐式 any 的存量构建错误（与 devin.ts 同样改动）
- 全 monorepo `pnpm -r build` 通过

待人工验证：`pnpm dev` 启动后在浏览器走一遍主流程（新建/发消息/工具/取消/重开恢复）。当前 9991 端口跑的是 `tsx`（非 watch），需要重启服务端才能加载新代码。

## 2026-05-18 21:05 — 部署细节修正

- 本机 remote-ide 服务由 launchd agent `com.eric.remote-ide` 托管（`~/Library/LaunchAgents/com.eric.remote-ide.plist`，PID 文件用 `KeepAlive`+`RunAtLoad`，日志在 `~/Library/Logs/remote-ide.{log,err}`），不是手动 `pnpm dev`。重启方式：`launchctl kickstart -k gui/$(id -u)/com.eric.remote-ide`
- 该 plist 的 `EnvironmentVariables.PATH = /usr/local/bin:/usr/bin:/bin`，不含 `~/.local/bin`
- 后果：`claude` 在 `/usr/local/bin` 能找到，但 `devin` 在 `~/.local/bin/devin`，spawn 报 `ENOENT`
- 修复：`server/src/devin.ts` 新增 `devinEnv()`，对 devin 的两处 spawn 都 prepend `$HOME/.local/bin` 和 `$HOME/bin` 到 PATH。不改 plist，code 自给自足，换机也不破

## 2026-05-18 21:15 — ACP Rust SDK 拒绝负数 JSON-RPC id

切换 model 触发的 stderr：
```
WARN agent_client_protocol::jsonrpc::incoming_actor: Transport parse error,
sending error notification error=Error { code: -32700: Parse error, ... }
data: line="{\"jsonrpc\":\"2.0\",\"id\":-1,\"method\":\"session/set_config_option\",...}"
```

- Devin 的 ACP server 用 Rust SDK，整行被解析失败丢弃。原因：**JSON-RPC id 不能用负整数**
- 我最初用 `--entry.rpcSeq`（从 0 起算所以输出 -1, -2 ...）想跟 bootstrap 的正 id 0/1 区分，结果踩雷
- 修复：`nextRpcId` 改为从 100 起算的正整数（给 bootstrap 0/1 留位）。stdout 端识别 prompt response 的判断也从 `id < 0 && stopReason` 改成 `id >= 100 && stopReason`
- 注意点：JSON-RPC 2.0 规范没明说要正数，但实际 Rust ACP SDK 走的是更严格的 schema 校验，**未来给 ACP 发请求一律用非负整数 id**

## 2026-05-18 21:30 — UI 对齐 + 杂项

- DevinPanel 布局改成与 ChatPanel 一致：底部状态栏 + 末尾 thinking 三点 + Send 旁的 Stop 按钮
- mode picker 之前不显示：根因是 `result.modes.availableModes` 只在 session/new|load response 里出现一次，reattach 时拿不到。改成**优先从 configOptions 里 `id=mode` 的 option 派生 available modes**，configOptions 是 attach/resume/任何 config 变化时都广播的，更可靠
- 窄屏（手机模式）下两个 select 被挤换行：`.chat-status-model-wrap` 改为 flex container + gap，`.chat-status > span`（label）允许 ellipsis 优先压缩，`.chat-status-model` 加 `max-width: 40vw`（窄屏 `32vw`）
- Devin 给的 model 列表顺序没有 UX 意义（按它内部 family 分组），客户端按 display name 字母排序一次

## 2026-05-18 21:35 — 冒烟通过

主流程（新建 session / 发消息 / 流式输出 / mode + model 切换 / 移动端 UI）已经由用户在浏览器走通。Phase 5 标记 ✅。

## 2026-05-18 22:00 — Phase 6 Task 1-5 落地

一波打完 5 项：

- **Task 4 (sessions.db 直读)**：用 Node 26 内置的 `node:sqlite` 的 `DatabaseSync(readOnly:true)` 直接查 `~/.local/share/devin/cli/sessions.db` 的 sessions 表。比之前 spawn `devin acp` 跑 `session/list` 快几十倍。DB 不存在时优雅回退到 `oneShotRpc`
- **Task 2 (Settings devinModel 默认值)**：Settings 面板加 "Default Devin model"，精选 10 个常用 model（不是 75 全列）。DevinPanel 接 `defaultModel` prop；判断"brand-new session"（`!activeSessionIdRef.current` 时）在拿到 sessionId 后发 `session/set_config_option` 应用
- **Task 5 (权限请求 UI，保留 dangerous)**：服务端区分对待 agent→client RPC：`session/request_permission` 透传给客户端 + `pendingAgentRpcs` 跟踪 + 5min timeout 后自动 cancelled；其他（fs/* / terminal/*）保持 auto-reject。客户端弹模态框列出 ACP options，选完 `{type:'permission_response', id, optionId}` 回写
- **Task 3 (Tool 卡片精修)**：加 `summarizeDevinTool(kind, rawInput, title)` 按 kind 取关键字段（file_path / command / query 等）做 80 字摘要；`ToolFields` 组件按 key 分组展示 rawInput，对齐 ChatPanel 样式
- **Task 1 (图片输入)**：服务端把 `msg.images` 翻成 ACP `{type:'image', mimeType, data}` content block（注意是 `mimeType` 不是 Anthropic 的 `media_type`）；客户端复用 ChatPanel 的 paste/attach/fileInputRef 思路，pending strip + lightbox

注意点：
- `node:sqlite` API：构造函数 `new DatabaseSync(path, { readOnly: true })`，`prepare(sql).all(params)` 同步返回，Node 22+ 稳定可用
- ACP `session/request_permission` outcome shape：`{outcome: 'selected', optionId}` 或 `{outcome: 'cancelled'}`
- ACP image block 用 `mimeType`（不是 `media_type`）——和 Anthropic 私有 stream-json 协议不同

## 2026-05-18 22:15 — Re-attach 历史空白修复

用户报告"Resume Devin session 选中后打开 tab 是空的"。根因：

- 用户首次开 session：server spawn devin acp，devin 自动 replay 历史 `session/update` notifications → client 看到
- 用户关 tab：server 5min grace 内保留 entry
- 用户再次开同 sessionId：server 走 attach 分支（`bySessionId.has(resumeId)`），只发 `started`，**没有重放 devin 已经发过的历史**，新 client 看到空白

修法：
- 服务端：entry 上加 `history: any[]` 环形缓存（cap 5000），所有 `session/update` notifications 入 buffer；attach 分支在 `started` 之后把 history 依次 send 给新 client
- 客户端：收到 `started` 时无条件清空 msgs，让 history replay 重建。这同时也修了 WS auto-reconnect 时消息可能重复的潜在问题（reconnect 也会触发 started）

注意点：5000 条 cap 对超长 session 会丢前面的历史。后续可以改成"丢失时 client 提示 + 提供选项重新 spawn 走完整 devin replay"

## 2026-05-18 22:45 — 用户提交的消息在 history 丢失修复

上一个修复（history 缓存 + 重连清空 msgs）暴露了第二个 bug：用户在当前 turn 提交的消息**不在** `entry.history` 里 → re-attach 重放时丢失。

**根因**：Devin 的 ACP 流只在 `session/load` replay 时回放历史 `user_message_chunk`；当前 turn 内 client 提交的 prompt 通过 stdin 进入 devin 后，devin **不会**通过 stdout 把 user message 回显回来。所以 server 的 `entry.history`（缓存 stdout 来的 session/update）漏了用户消息。

**修法**：server 端收到 `{type:'user'}` 时，**自己合成** `user_message_chunk` notification（per content block）：
- push 进 `entry.history`（re-attach 重放就有）
- broadcast 给其他 client（**除发送者**——sender 已经在 submit() 里乐观 append 过）

参考 session.ts (Claude 端)：那边 claude 的 stream-json 会把 user event 回写 stdout，所以 server 就只 forward。Devin 不回写，必须 server 自己生成。

**配套客户端改动**：`user_message_chunk` 处理改成 coalesce 模式——多 chunk（text + image）合并到同一个 user bubble，`streamingMsgIdRef.kind` 扩展支持 `'user'`。这样图片输入的 re-attach 重放也能正确显示 text + 多图。

## 2026-05-19 09:30 — 空白 Devin Tab 修复（三个 bug）

用户报告"偶尔打开 devin tab 加载不出内容"。日志分析发现三个独立 bug 合力导致空白：

**Bug 1：auth 过期 → 无限重连**
- 日志显示 `gleaming-galette` 以 10s 间隔累积了 4000+ 次 WS 请求，全部被 `onRequest` auth hook 以 401 拒绝
- 原因：Fastify 的 auth hook 在 WS 升级前返回 401 HTTP，WebSocket 客户端无法区分"auth 失败"和"网络错误"
- 浏览器端 `ws.onclose` 触发但 `sessionExitedRef` 为 false → `scheduleReconnect()` → 无限循环
- 修法：追踪连续 `onopen` 未触发的次数，3 次后停止重连并显示"session may have expired"
- 同步修了 ChatPanel（Claude session 同样脆弱）

**Bug 2：zombie entry 导致 attach 到已死进程**
- 竞态窗口：proc SIGTERM → exit event 之间，新 WS 连接发现 `bySessionId.has(resumeId)` 为 true
- attach 到已退出进程的 entry → history 为空 → 空白 tab
- 修法：attach 前检查 `entry.proc.exitCode !== null`，是则清除 zombie；另加 INIT_TIMEOUT 检测（>30s 未 initialize 且无 client 时 kill）

**Bug 3：`load_failed` 后 `exit` 阻止 fresh spawn**
- `load_failed` 清除 resumeId、期望 `onclose → scheduleReconnect` 开新 session
- 但 server kill proc → `exit` 消息先到 → 设 `sessionExitedRef = true` → 阻止重连
- 修法：`load_failed` 设 `wantFreshSpawnRef = true`；`exit` handler 检到后 yield，让 `onclose` 正常触发重连

## 2026-05-19 10:00 — Devin transcript 持久化 + HTTP pre-fetch + 分页

对比 Claude 端和 Devin 端后发现最大差异：Claude 的历史从磁盘 JSONL 读取（HTTP pre-fetch + 分页），Devin 的历史纯内存 ring buffer（WS replay）。将 Devin 改为与 Claude 对齐的架构。

**探查发现**：Devin 的 `sessions.db` 有 `message_nodes` 表，存了完整对话树（user/assistant/tool，含 `tool_call_id`、`chisel/tool_call_content` 等 ACP 元数据）。每条消息有 `message_id`，分支节点会有相同 `message_id` 的多个 `node_id`（取最大的为活跃分支）。

**Server 改动**：
- `readDevinTranscript(slug, {limit, before})` — 从 sessions.db 读 message_nodes，按 `message_id` 去重，提取 user/assistant/tool_call/tool_result 四种事件
- `GET /api/projects/:id/devin-sessions/:slug/transcript?limit=N&before=M` — 分页 HTTP 接口

**Client 改动（DevinPanel）**：
- 新增 `'replaying'` 状态（"Loading history…"）
- `buildFromDevinTranscript(events)` — DB 事件 → Msg[]，含 tool output 拼接
- Resume 流程改为：pre-fetch transcript → 渲染 → openWs（用户立刻看到历史）
- Reconnect 也先 refetchTranscript 再重连
- `loadOlder()` 分页加载 + scroll 位置恢复

**附带**：session.ts 反向补丁 zombie entry 检测（`proc.exitCode` 检查）

## 2026-05-21 22:35

Bug 分析：Devin 会话过一段时间后自动切回 code 模式 + SWE-1.6 Fast → 详见 `bug-config-reset-on-reconnect.md`

## 2026-05-24

Bug 分析：devin tab 久不用后 UI 凝固，必须关 tab 重 resume → 详见 `bug-stale-ws-after-idle.md`。两端加 ping/pong 心跳 + 客户端 visibilitychange 主动健康检查；ChatPanel/session.ts 同步打补丁。

## 2026-05-27 — Devin CLI 2026.5.26-0 两个 breaking change

升级 Devin CLI 到 2026.5.26-0 后前端 Devin 对话完全不工作。排查发现两个独立问题：

**问题 1：session/new 不再返回正式 JSON-RPC response**

- 旧版（2026.5.6-x）：`session/new` (id=1) → 先发若干 notifications → 再发 `{id:1, result:{sessionId, modes, configOptions}}`
- 新版（2026.5.26）：只发 notifications（`config_option_update` / `current_mode_update` / `available_commands_update`），**id=1 response 永远不来**
- 后果：`wireProcess` 等 `msg.id === 1 && msg.result` 来翻 `entry.initialized = true`，等不到 → 所有客户端消息堆在 `pendingClientReqs` 里永远不投递
- 修法：在 notification 处理路径中，检测到 `initSeen && !entry.initialized && entry.sessionId && entry.configOptions` 时，自动翻转为 initialized 并合成一个 id=1 response 广播给前端。旧版 CLI 的正式 response 仍由原代码先匹配，不冲突

**问题 2：ACP session/prompt 返回 Permission denied**

- initialize + session/new 正常，但 session/prompt (id=101) 返回 `{code:-32013, message:"Permission denied: Permission denied: an internal error occurred (trace ID: ...)", data:{errorKind:"internal", retryable:true}}`
- 排除了环境差异（在完整交互 shell 下复现）、凭证传递方式（env var / initialize params / 默认 credentials.toml 均失败）
- `devin -p "say hi"` 正常，`devin` 交互模式正常，**仅 `devin acp` 的 session/prompt 有问题**
- 确认旧版 2026.5.6-12 的 ACP 完全正常
- 结论：2026.5.26-0 的 ACP prompt 路由有 regression
- 临时修法：`spawnDevin()` 和 `oneShotRpc()` pin 到 `~/.local/share/devin/cli/_versions/2026.5.6-12/bin/devin`，存在则用，否则 fallback 到 PATH 上的 devin

**待办**：等 Devin 修复后解除 pin（搜索 `DEVIN_BIN`）。问题 1 的补丁保留，因为新版协议确实改了。
