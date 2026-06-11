# Devin Session 集成 — 设计方案

## 设计原则

**完全隔离**：Devin 支持作为新的 tab type `'devin'` 加入，与现有 `'session'`（=Claude）并列。不复用 `ChatPanel`，不复用 `session.ts`。两个 agent 的代码、状态、生命周期、协议解析互不相关；任一边的 bug 不波及另一边。

## 关键决策（已与用户确认）

| 决策点 | 选择 |
|--------|------|
| 服务端 WS ↔ 客户端协议 | **原样透传 ACP**。服务端把 stdout 上的 JSON-RPC message 包装成 `{type:'acp', data:<rpc-message>}` 转发；前端按 ACP 字段渲染。客户端发的 user/cancel/set_mode 等也按 ACP shape 上行，服务端落到 stdin |
| 权限请求 | spawn 时加 `--permission-mode dangerous`，跳过所有 `session/request_permission`。后续如需 UI 审批再迭代 |
| 子进程粒度 | **每个 session 一进程**（对齐当前 Claude 的做法） |
| Session 恢复 | `session/load`（Agent 回放历史），前端不持久化 transcript |

## 架构

### 服务端

新文件 `server/src/devin.ts`，独立于 `session.ts`：

```
DevinSessionEntry {
  proc: ChildProcessWithoutNullStreams       // `devin --permission-mode dangerous acp`
  cwd: string
  sessionId: string | null                   // ACP 的 sessionId（来自 session/new 或 session/load）
  clients: Set<WebSocket>
  initialized: boolean                       // initialize 已完成
  pendingInitResume?: string                 // 等 initialize done 后要 load 的 session id
  rpcSeq: number                             // 自增 id 池
  pendingRpcs: Map<id, ws>                   // 跟踪每个 RPC 是哪个 ws 发起的
  killTimer?, ...
}
```

- 新 WS 路由 `/ws/devin?project=X&resume=Y`
- 连接流程：
  1. spawn `devin --permission-mode dangerous acp`（cwd = project.path）
  2. 发 `initialize`，等 response
  3. `resume` 存在 → 发 `session/load`；否则 → 发 `session/new`
  4. 期间收到的 `session/update` notifications 一律 broadcast 给所有 clients
  5. ACP 子进程退出 → 通知客户端
- 复用 `byResumeId` 风格的注册表，但用独立的 `Map`。同一 sessionId 共享一进程，多 client 共享 broadcast
- Idle-kill 策略沿用 `session.ts` 的 5min grace 模式
- WS 入站消息：
  - `{type:'user', content:[...]}` → 发 `session/prompt`
  - `{type:'cancel'}` → 发 `session/cancel` notification
  - `{type:'set_mode', modeId}` → 发 `session/set_mode`
  - `{type:'set_config', configId, value}` → 发 `session/set_config_option`
- WS 出站消息（统一 envelope）：
  - `{type:'acp', data: <raw JSON-RPC message>}` — 透传 ACP response/notification/request
  - `{type:'started', cwd, resumed, attached, clients, ...}` — 连接初始化反馈
  - `{type:'exit', code}` / `{type:'error', message}` / `{type:'stderr', data}`

### 新 HTTP 路由

`GET /api/projects/:id/devin-sessions` — 列出可恢复的 Devin sessions。
- 实现方式 A：spawn 一个临时 `devin acp` 进程，调用 `session/list`，关闭进程。准确但慢
- 实现方式 B：扫描 Devin 本地 session 存储目录（类似 `~/.claude/projects/...`），从文件名/内容提取 metadata。需要先调研 Devin 的存储位置
- **起步用方式 A**，可接受

### 前端

新文件 `web/src/components/DevinPanel.tsx`：
- 完全独立于 `ChatPanel`，可以共享小工具函数（如 markdown 渲染、image lightbox），但 state machine 是 ACP-shape 而非 Anthropic-shape
- 消息模型：
  - `agent_message_chunk` → 累积到当前 assistant 消息
  - `thought_message_chunk` → 单独样式（折叠）
  - `tool_call` → 新工具卡片，状态 pending/in_progress
  - `tool_call_update` → 更新已有卡片状态/输出
  - `plan` → plan 面板
  - `session_info_update` → 反馈 title 给上层
- 顶部状态条显示：connect 状态、当前 mode（normal/plan/bypass）、当前 model（来自 configOptions）、interrupt 按钮
- 输入框：发送文本（图片支持后置）

### types.ts 改动

```ts
export type DevinTab = { id: string; type: 'devin'; resumeId?: string; title?: string };
export type Tab = FileTab | SessionTab | DevinTab;
```

### TabBar 改动

- 图标区分：`📄` file、`🤖` claude session、`🧬`（或其他）devin
- overflow 菜单从「+ New session / ↻ Resume session」扩展为四项：
  - `+ New Claude session`
  - `+ New Devin session`
  - `↻ Resume Claude session`
  - `↻ Resume Devin session`

### App.tsx 改动

- 新增 `openDevinTab(resumeId?, title?)`，对应现有 `openSessionTab`
- 渲染分支扩展：file → Viewer、session → ChatPanel、devin → DevinPanel
- workspace 持久化天然支持（types.ts 联合类型扩展后 JSON 形状不变）

### Settings 改动

- 加 `devinModel: string`（独立于 `model`，互不影响）
- Settings UI 加一个 select 区段，列 Devin 常见 model（`sonnet` / `opus` / `codex` 等）

## 不在本期范围

- 权限请求 UI（用 dangerous 模式）
- ACP `fs/*`、`terminal/*` 回调：initialize 时设 `clientCapabilities.fs={readTextFile:false,writeTextFile:false}`、`terminal:false`，让 Devin 用内置工具
- MCP server 集成（`mcpServers: []`）
- `session/resume`（用 load 起步）
- Devin session 本地 metadata 扫描（用 `session/list` RPC 起步）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Devin CLI 未安装 / 未登录 | spawn 失败时把 stderr 透传给 client，UI 引导用户运行 `devin auth login` |
| `session/list` 启动慢 | 必要时改后端缓存 + 后台刷新；起步先直接调 |
| 长 pending 的 `session/prompt` 响应丢失（进程死掉） | 沿用 `session.ts` 的 exit 广播 + client 重连逻辑 |
| ACP 协议版本升级 | initialize 阶段已有 protocolVersion 协商，记录 agent 返回的 capabilities 决定可用功能 |
