# Devin ACP 集成调研文档

> 本文档记录通过 `devin acp` 接入 Devin AI session 的完整技术细节，供后续实现时参考。

## 1. `devin acp` 概述

### 启动方式

```bash
devin acp
```

- 以 ACP server 模式运行，通过 stdin/stdout 通信
- JSON-RPC 2.0 协议，消息以换行 (`\n`) 分隔
- 不可交互——专为 IDE/编辑器作为子进程调用设计
- 凭证来源：`WINDSURF_API_KEY` 环境变量 > `devin auth login` 存储的 credentials > 运行时 ACP `authenticate` 请求

### 可选参数

```bash
devin acp [--agent-type <AGENT_TYPE>]
```

- `--agent-type summarizer` — 无工具的摘要 agent（特殊用途）
- 不传则运行默认的完整 coding agent

---

## 2. ACP 协议完整流程

### 2.1 Transport

- **stdio transport**：Client spawn Agent 子进程，通过 stdin 写请求、stdout 读响应/通知
- 消息格式：每行一个完整 JSON-RPC message，以 `\n` 分隔
- **不允许**在 stdout 写非 ACP 消息；stderr 可用于日志

### 2.2 连接初始化 (`initialize`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": true
    },
    "clientInfo": {
      "name": "remote-ide",
      "title": "Remote IDE",
      "version": "0.1.0"
    }
  }
}
```

Agent → Client (response):
```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "image": true,
        "audio": true,
        "embeddedContext": true
      },
      "sessionCapabilities": {
        "list": {},
        "resume": {},
        "close": {}
      },
      "mcpCapabilities": {
        "http": true,
        "sse": true
      }
    },
    "agentInfo": {
      "name": "devin",
      "title": "Devin",
      "version": "2026.5.6-8"
    },
    "authMethods": []
  }
}
```

**关键 capabilities:**
- `loadSession: true` — 支持恢复旧 session（replay 历史）
- `sessionCapabilities.list` — 支持枚举 session 列表
- `sessionCapabilities.resume` — 支持 resume（不 replay）
- `sessionCapabilities.close` — 支持显式关闭 session
- `promptCapabilities.image` — 支持图片输入

### 2.3 认证 (`authenticate`)

如果 `authMethods` 非空，Client 需要先认证。Devin 通常从存储凭证读取，无需额外认证步骤。

### 2.4 创建新 Session (`session/new`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {
    "cwd": "/Users/eric/git/some-project",
    "mcpServers": []
  }
}
```

Agent → Client (response):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "sess_abc123def456",
    "modes": {
      "currentModeId": "normal",
      "availableModes": [
        { "id": "normal", "name": "Normal", "description": "Full autonomy" },
        { "id": "plan", "name": "Plan", "description": "Read-only planning" },
        { "id": "bypass", "name": "Bypass", "description": "Auto-approve all" }
      ]
    },
    "configOptions": [
      {
        "id": "mode",
        "name": "Mode",
        "category": "mode",
        "type": "select",
        "currentValue": "normal",
        "options": [...]
      },
      {
        "id": "model",
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": "claude-sonnet-4",
        "options": [
          { "value": "claude-sonnet-4", "name": "Sonnet 4" },
          { "value": "claude-opus-4.6", "name": "Opus 4.6" },
          { "value": "opus", "name": "Opus (latest)" }
        ]
      }
    ]
  }
}
```

**注意**: `cwd` 必须是绝对路径，决定 agent 工作目录。

### 2.5 列出历史 Sessions (`session/list`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/list",
  "params": {
    "cwd": "/Users/eric/git/some-project"
  }
}
```

Agent → Client (response):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessions": [
      {
        "sessionId": "9ae8282d-e25f-4891-85b3-354819cd1313",
        "cwd": "/Users/eric/git/remote-ide",
        "title": "Devin AI 会话集成可行性研究",
        "updatedAt": "2025-05-18T11:30:19Z"
      }
    ],
    "nextCursor": null
  }
}
```

支持 cursor-based 分页；可按 `cwd` 过滤。

### 2.6 恢复 Session (`session/load` 或 `session/resume`)

#### 方式 A: `session/load` — 回放完整历史

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/load",
  "params": {
    "sessionId": "sess_abc123",
    "cwd": "/Users/eric/git/some-project",
    "mcpServers": []
  }
}
```

Agent 会先通过 `session/update` notifications 逐条回放历史消息（user_message_chunk + agent_message_chunk + tool_call 等），然后才返回 response。

#### 方式 B: `session/resume` — 不回放历史

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/resume",
  "params": {
    "sessionId": "sess_abc123",
    "cwd": "/Users/eric/git/some-project",
    "mcpServers": []
  }
}
```

直接恢复 context，不 replay。适合 Client 已经有缓存的场景。

### 2.7 发送用户消息 (`session/prompt`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123def456",
    "prompt": [
      {
        "type": "text",
        "text": "帮我重构这个函数"
      }
    ]
  }
}
```

支持的 content 类型:
- `text` — 纯文本
- `image` — base64 图片 `{ "type": "image", "mimeType": "image/png", "data": "..." }`
- `resource` — 嵌入文件内容 `{ "type": "resource", "resource": { "uri": "file:///...", "text": "...", "mimeType": "..." } }`
- `resource_link` — 文件引用（Agent 自行读取）

**重要**: `session/prompt` 是一个长 pending 的 RPC 调用——Agent 在处理完整个 turn 之前不会返回 response。期间通过 `session/update` notifications 推送中间状态。

最终 response:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "stopReason": "end_turn"
  }
}
```

`stopReason` 可能值: `end_turn` | `max_tokens` | `max_turn_requests` | `refusal` | `cancelled`

### 2.8 流式输出 (`session/update` notifications)

Agent 在处理过程中持续发送 notifications:

#### Agent 文本输出（流式 chunk）:
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "让我分析一下这个函数..."
      }
    }
  }
}
```

#### Tool Call 开始:
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "call_001",
      "title": "Reading file src/main.ts",
      "kind": "read",
      "status": "pending",
      "rawInput": { "file_path": "/path/to/file" }
    }
  }
}
```

#### Tool Call 更新:
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call_update",
      "toolCallId": "call_001",
      "status": "completed",
      "content": [
        {
          "type": "content",
          "content": { "type": "text", "text": "File contents: ..." }
        }
      ]
    }
  }
}
```

#### Tool Call 内容类型:
- `{ "type": "content", "content": { "type": "text", ... } }` — 文本结果
- `{ "type": "diff", "path": "/abs/path", "oldText": "...", "newText": "..." }` — 文件 diff
- `{ "type": "terminal", "terminalId": "term_xyz" }` — 终端输出引用

#### Tool Kind 枚举:
| kind | 含义 |
|------|------|
| `read` | 读文件/数据 |
| `edit` | 修改文件 |
| `delete` | 删除文件 |
| `move` | 移动/重命名 |
| `search` | 搜索 |
| `execute` | 执行命令 |
| `think` | 内部推理 |
| `fetch` | 获取外部数据 |
| `other` | 其他（默认） |

#### Tool Call 状态枚举:
| status | 含义 |
|--------|------|
| `pending` | 等待开始或等审批 |
| `in_progress` | 执行中 |
| `completed` | 成功完成 |
| `failed` | 执行失败 |

#### Plan 更新:
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "plan",
      "entries": [
        { "content": "Read the file", "priority": "high", "status": "completed" },
        { "content": "Refactor function", "priority": "high", "status": "in_progress" },
        { "content": "Run tests", "priority": "medium", "status": "pending" }
      ]
    }
  }
}
```

#### Session Info 更新 (标题自动生成):
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "session_info_update",
      "title": "重构 authentication 模块"
    }
  }
}
```

#### Config Option 更新 (model/mode 变化):
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "config_option_update",
      "configOptions": [...]
    }
  }
}
```

### 2.9 中断 (`session/cancel`)

Client → Agent (notification, 无 response):
```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "sess_abc123def456"
  }
}
```

Agent 收到后应尽快中止，然后将 pending 的 `session/prompt` 返回 `{ "stopReason": "cancelled" }`。

### 2.10 关闭 Session (`session/close`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/close",
  "params": {
    "sessionId": "sess_abc123def456"
  }
}
```

取消进行中的工作 + 释放资源。

### 2.11 切换 Mode (`session/set_mode`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "session/set_mode",
  "params": {
    "sessionId": "sess_abc123def456",
    "modeId": "bypass"
  }
}
```

Devin 支持的 mode: `normal` | `plan` | `bypass`

### 2.12 切换 Model / Config (`session/set_config_option`)

Client → Agent:
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "sess_abc123def456",
    "configId": "model",
    "value": "opus"
  }
}
```

Agent 返回完整的 configOptions 列表（可能有联动变化）。

### 2.13 权限请求 (`session/request_permission`)

Agent → Client (RPC request, 需要 Client 回复):
```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "session/request_permission",
  "params": {
    "sessionId": "sess_abc123def456",
    "toolCall": {
      "toolCallId": "call_002",
      "title": "Execute: rm -rf ./dist",
      "kind": "execute",
      "status": "pending"
    },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "allow-always", "name": "Always allow", "kind": "allow_always" },
      { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
    ]
  }
}
```

Client → Agent (response):
```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

**注意**: 如果希望跳过所有权限提示（类似 Claude 的 `--dangerously-skip-permissions`），可以在 spawn 时加 `--permission-mode dangerous`，或者 Client 自动回复所有 permission request 为 "allow-once"。

### 2.14 Client-side 方法（Agent 回调 Client）

ACP 是双向 RPC。Agent 可能调用 Client 的方法:

#### `fs/read_text_file` (Agent 请求 Client 读文件):
```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "method": "fs/read_text_file",
  "params": {
    "path": "/absolute/path/to/file.ts"
  }
}
```

Client response:
```json
{
  "jsonrpc": "2.0",
  "id": 100,
  "result": {
    "text": "file content here..."
  }
}
```

#### `fs/write_text_file` (Agent 请求 Client 写文件):
```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "fs/write_text_file",
  "params": {
    "path": "/absolute/path/to/file.ts",
    "text": "new content..."
  }
}
```

#### `terminal/create` (Agent 请求 Client 创建终端):
```json
{
  "jsonrpc": "2.0",
  "id": 102,
  "method": "terminal/create",
  "params": {
    "command": "npm test",
    "cwd": "/path/to/project"
  }
}
```

**实现选择**:
- 如果 `clientCapabilities.fs` 设为 `false`，Agent 不会调用这些方法（用自己内置的文件操作）
- 如果 `clientCapabilities.terminal` 设为 `false`，Agent 不会调用 terminal 方法
- 对于 remote-ide 的场景，可以先不支持这些回调（设 capabilities 为 false），让 Devin 用自己的内置工具

---

## 3. Devin 特定行为

### 3.1 Spawn 命令

```bash
devin acp
```

等效于对 Claude 的:
```bash
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions
```

如果想跳过权限提示，可以用:
```bash
devin --permission-mode dangerous acp
```

### 3.2 认证

- 需要先 `devin auth login` 或设置 `WINDSURF_API_KEY` 环境变量
- ACP 也支持运行时 `authenticate` 方法传入凭证

### 3.3 Devin 的 Modes

Devin 支持 3 种 mode（通过 ACP `session/set_mode` 或 `session/set_config_option`）:

| Mode ID | 名称 | 行为 |
|---------|------|------|
| `normal` | Normal | 完整能力，正常权限检查 |
| `plan` | Plan | 只读工具，仅规划不实施 |
| `bypass` | Bypass | 自动批准所有操作 |

### 3.4 Devin 的 Models

通过 `configOptions` 的 `category: "model"` 选项暴露可用模型。具体可用模型取决于用户的 subscription 和配置。常见:
- `claude-sonnet-4` / `sonnet`
- `claude-opus-4.6` / `opus`
- `codex`

### 3.5 Session 存储

Devin 的 session 数据存储在本地：
- **`~/.local/share/devin/cli/sessions.db`**（SQLite）— session 主表
- `~/.local/share/devin/cli/transcripts/<uuid>.json` — 部分老 session 的完整 transcript（slug session 不一定有）
- `~/.local/share/devin/cli/session_locks/<id>.lock` — 当前活跃 session 的锁文件
- `~/.local/share/devin/cli/summaries/<id>.md` — summarizer agent 产物
- `~/.cache/devin/cli/{model_configs,team_settings}.bin` — 模型/团队配置缓存
- `~/.config/devin/config.json` — 用户配置
- `~/Library/Application Support/devin/credentials.toml` — 凭证

`sessions` 表 schema 关键字段:
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,             -- slug 或 uuid
  working_directory TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  model TEXT NOT NULL,
  agent_mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,     -- unix seconds
  last_activity_at INTEGER NOT NULL,
  title TEXT,                      -- 默认 'Untitled'，agent 起标题后会更新
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_activity ON sessions(last_activity_at DESC);
```

Session ID 格式：早期是 UUID（如 `9ae8282d-e25f-4891-85b3-354819cd1313`），新版用 slug（如 `purrfect-opinion`、`gleaming-galette`）。

直接读 SQLite 比 ACP `session/list` 快得多（不需要 spawn 子进程 + 等 initialize）。Node 22+ 自带 `node:sqlite`（`DatabaseSync`），无需 native 依赖。

### 3.5.1 ⚠ session/new 不立即落库 — phantom slug 陷阱

实测发现的重要行为：**Devin 的 `session/new` 立刻返回 sessionId（slug），但并不立即往 sessions.db 写 row**。Devin 只在用户**真正发了第一条 prompt** 时才一并 INSERT。

观察证据：
- 跑了几十次 `session/new` 后，sessions.db 里的行数 << 真实接收到的 slug 数
- `session_locks/<slug>.lock` 存在（spawn 时就创建），但 sessions 表里查不到这个 id
- chisel 日志里 `Created new session: X` 这一行只出现在用户**发消息之后**
- DB 里没有任何 0-message 的 session 行（因为没消息就不会 INSERT）

后果（坑过我们一次）：
- 客户端如果在 `session/new` 响应一回来就把 slug 存到 workspace，那么用户开了 tab 不发消息直接关 → workspace 里留下 phantom slug
- 下次 resume 走 `session/load` 这个 slug → Devin 返回 `{error:-32602, "Session not found"}`

修复策略：
1. **源头**：客户端推迟保存 sessionId，等用户的第一次 `session/prompt` 时才写到 workspace
2. **兜底**：服务端识别 `id=1` 的 `error` 响应（session/load failed），杀掉 devin 进程清理 entry；客户端收到对应通知后清掉 stale resumeId 并重连一个新 session

### 3.6 `/debug-echo` 测试

Devin insiders 版有 `/debug-echo <json>` 命令，可直接写 raw JSON-RPC body 到 stdout，方便测试 ACP Client 对特定消息的处理。

---

## 4. 完整 `session/update` 类型汇总

| sessionUpdate 值 | 含义 | 关键字段 |
|-----------------|------|----------|
| `agent_message_chunk` | Agent 文本输出 chunk | `content: ContentBlock` |
| `user_message_chunk` | 用户消息回放（load 时） | `content: ContentBlock` |
| `thought_message_chunk` | Agent 内部思考 | `content: ContentBlock` |
| `tool_call` | 新 tool call 开始 | `toolCallId, title, kind, status, rawInput?` |
| `tool_call_update` | tool call 状态更新 | `toolCallId, status?, content?, locations?` |
| `plan` | Agent 计划 | `entries: [{content, priority, status}]` |
| `session_info_update` | Session 元数据变化 | `title?, updatedAt?` |
| `config_option_update` | 配置变化 | `configOptions: ConfigOption[]` |
| `current_mode_update` | Mode 切换 | `modeId` |
| `available_commands_update` | Slash commands 变化 | 命令列表 |

---

## 5. TypeScript SDK

官方提供 `@agentclientprotocol/sdk` npm 包:

```bash
npm install @agentclientprotocol/sdk
```

关键类:
- `ClientSideConnection` — 作为 Client 连接 Agent
- `AgentSideConnection` — 作为 Agent 接受 Client 连接

GitHub: https://github.com/agentclientprotocol/typescript-sdk

---

## 6. 与 Claude stream-json 协议的对比

| 维度 | Claude stream-json | Devin ACP |
|------|-------------------|-----------|
| 传输 | spawn + stdin/stdout JSONL | spawn + stdin/stdout JSON-RPC |
| 协议格式 | Anthropic 私有 | JSON-RPC 2.0 标准 |
| 创建 session | spawn 时自动创建 | 先 `initialize` 再 `session/new` |
| Session ID 获取 | 从 `system.init` 事件中捕获 | `session/new` response 直接返回 |
| 恢复 session | `--resume <id>` (spawn 参数) | `session/load` 或 `session/resume` |
| 枚举 sessions | 扫描 JSONL 文件 | `session/list` RPC |
| 发消息 | stdin write JSON + `\n` | `session/prompt` RPC |
| 流式输出 | stdout JSONL 事件 | `session/update` notifications |
| 文本 chunk | `stream_event` → `content_block_delta` | `agent_message_chunk` |
| Tool 报告 | `assistant` 事件中的 `tool_use` block | `tool_call` + `tool_call_update` |
| Tool 结果 | `user` 事件中的 `tool_result` block | `tool_call_update` with `status: completed` |
| 中断 | `control_request {subtype: interrupt}` | `session/cancel` notification |
| 切模型 | `control_request {subtype: set_model}` | `session/set_config_option` |
| Turn 结束 | `result` 事件 | `session/prompt` response (`stopReason`) |
| 权限 | `--dangerously-skip-permissions` | `--permission-mode dangerous` 或 auto-reply |
| 进程退出 | exit event | 进程退出 |

---

## 7. 实现时需要注意的点

### 7.1 双向 RPC

ACP 是双向的——Agent 会主动调用 Client 方法（`session/request_permission`, `fs/*`, `terminal/*`）。server 端需要监听 stdout 不仅是 notifications，也可能是 RPC requests（有 `id` 和 `method` 字段的）。

**最简策略**: 初始化时 `clientCapabilities` 设为 `{ "fs": {}, "terminal": false }`，这样 Agent 不会调用文件系统和终端回调，全部用内置工具完成。权限请求则统一自动批准。

### 7.2 消息区分

stdout 中的 JSON-RPC 消息有三种:
1. **Response** — 有 `id` + `result`/`error`，是对 Client 请求的回复
2. **Notification** — 有 `method` 但无 `id`，单向推送（如 `session/update`）
3. **Request** — 有 `method` + `id`，Agent 主动调用 Client（如 `session/request_permission`）

需要根据这三种类型分别处理。

### 7.3 长 pending 的 prompt 调用

`session/prompt` 的 response 要等整个 turn 完成才返回。这意味着:
- 发了 prompt 后，可能要等几十秒甚至几分钟
- 期间通过 notifications 获取中间状态
- 如果要中断，发 `session/cancel` notification，等 prompt response 返回 `cancelled`

### 7.4 一个 ACP 进程管理多个 session

ACP 协议支持在单个连接中管理多个 session（通过 `sessionId` 区分）。但实际实现中:
- 可以为每个 project spawn 一个 `devin acp` 进程
- 也可以一个进程管理多个 session（需要 Devin 实现支持）
- 建议先做最简单的：每 session 一个进程

### 7.5 Session 恢复策略

两种恢复方式选择:
- `session/load` — Agent 回放所有历史（Client 不需要缓存），但大 session 可能很慢
- `session/resume` — 不回放，Client 自己管历史展示。更快，但需要 Client 有自己的持久化

建议: 用 `session/load` 简单起步，后续优化再考虑 `session/resume`。

### 7.6 Model/Mode 切换

不同于 Claude 的 `control_request`，ACP 用 `session/set_config_option`:
- 切模型: `{ "configId": "model", "value": "opus" }`
- 切 mode: `{ "configId": "mode", "value": "bypass" }` 或 `session/set_mode`

Response 返回完整 configOptions，可能有联动变化。
