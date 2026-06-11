# Devin vs Claude Code — 连接状态管理 & 会话数据管理对比

> 2026-05-19 分析。基于 `server/src/devin.ts` / `server/src/session.ts` / `web/src/components/DevinPanel.tsx` / `web/src/components/ChatPanel.tsx` 四个文件的逐行对比。

---

## 1. 会话数据持久化：最大差异

| | Claude (session.ts / ChatPanel) | Devin (devin.ts / DevinPanel) |
|--|--|--|
| **数据源** | JSONL 文件（`~/.claude/projects/…/{session_id}.jsonl`），磁盘持久化 | 内存 ring buffer（`entry.history`，cap 5000） |
| **服务端重启** | 无损——JSONL 在磁盘上 | **全丢**——history 随进程消亡 |
| **恢复历史的方式** | **先 HTTP fetch 再开 WS**（两阶段） | WS 连通后由 server 在 WS 通道里 replay（单通道） |
| **分页** | 有 `loadOlder()`，infinite scroll，按 20 条分页 | 无——一口气全部 replay |
| **长会话** | 无限（JSONL 多大都能分页加载） | 5000 条上限，旧消息丢弃 |

### Claude 的关键做法

**resume 先走 HTTP：**
```ts
// ChatPanel.tsx — start()
async function start() {
  const initialResume = initialResumeIdRef.current;
  if (initialResume) {
    setStatus('replaying');                          // ← 独立的"加载历史"状态
    const r = await fetch(
      `/api/projects/${projectId}/sessions/${initialResume}/transcript?limit=20`,
    );
    if (r.ok) {
      const { events, startIndex } = await r.json();
      setMsgs(buildFromEvents(events, orphanResultsRef.current));
      setOldestIdx(startIndex ?? 0);
    }
  }
  openWs();                                           // ← 历史已显示，再开 WS
}
```

用户**立刻**看到历史，不用等 WS 握手 + server replay。

**reconnect 也先刷新历史再重连 WS：**
```ts
// ChatPanel.tsx — scheduleReconnect()
reconnectTimerRef.current = window.setTimeout(async () => {
  const sid = activeSessionIdRef.current;
  if (sid) await refetchTranscript(sid);              // ← 先 HTTP 刷新
  openWs();                                           // ← 再重连 WS
}, delay);
```

**Devin 的历史获取完全走 WS in-band replay：**
```ts
// devin.ts — attach path
send(socket, { type: 'started', ... });
for (const m of entry.history) send(socket, { type: 'acp', data: m });
```

### 影响

| 场景 | Claude | Devin |
|------|--------|-------|
| 刷新页面 | 瞬间看到历史（HTTP pre-fetch） | 等 WS 连接 → attach → replay |
| 服务端重启后打开 tab | JSONL 完好，照常显示 | **空白**——内存 buffer 丢失 |
| 5000+ 条超长会话 | 分页，随时加载 | 只保留最后 5000 条 |
| 弱网 reconnect | HTTP 先刷新内容，WS 追增量 | WS 断了就什么都看不到 |

---

## 2. 初始化协议

| | Claude | Devin |
|--|--|--|
| 协议 | stream-json（行分隔 JSON 事件） | JSON-RPC / ACP |
| 启动握手 | 无——spawn 后 claude 直接吐 `system.init` | 两阶段：`initialize`(id=0) → `session/new\|load`(id=1) |
| 消息门控 | 无——client 可立即发消息 | `initialized` flag + `pendingClientReqs` 队列 |
| Session ID 来源 | `system.init.session_id`（一次性事件） | `session/new\|load` response 或 notification 中提前嗅探 |

Claude 不需要 `initialized` 门控是因为 stream-json 协议本身是无状态的——spawn 后 stdin 随时可写。Devin 的 ACP 要求 initialize handshake 完成后才能发其他 RPC。

这导致 Devin 需要额外的复杂度：
- `entry.initialized` boolean
- `entry.pendingClientReqs` 队列
- `wireProcess()` 里对 id=0 / id=1 响应的特殊嗅探
- `nextRpcId()` 要避开 bootstrap id 范围

---

## 3. Re-attach / Reconnect 策略

| | Claude | Devin |
|--|--|--|
| re-attach 数据源 | HTTP transcript（持久文件） | 内存 history buffer |
| 显示时机 | **WS 建立前**就已渲染 | WS 建立后才开始 replay |
| 有 `replaying` 状态 | 有——`'replaying'` = 正在 fetch 历史 | 无——统一用 `'connecting'` |
| 外部变更检测 | 有——FSWatcher 监控 JSONL | 无 |
| model hint（启动前） | 有——`peekRecentModel()` 扫描最近 JSONL | 无——等 configOptions 到达 |

### Claude 的 FSWatcher

Claude 在 `session.ts` 里用 `nodeFs.watch()` 监控 JSONL 文件，能检测"用户在终端直接跑 claude CLI"的场景：

```ts
// session.ts — startWatcher()
entry.watcher = nodeFs.watch(file, () => {
  const now = Date.now();
  if (now - entry.lastSelfWrite < EXTERNAL_QUIET_MS) return;  // 过滤自己的写入
  if (now - entry.lastInput < EXTERNAL_QUIET_MS) return;
  if (entry.externalNotified) return;
  // 通知客户端刷新
  broadcast(entry, { type: 'external_change', sessionId: entry.resumeId });
});
```

对 Devin 来说这个需求较弱——ACP 子进程是我们独占的，不太会有"外部"修改。

### Claude 的 peekRecentModel

启动新 session 时，Claude 扫描最近的 JSONL 文件拿到上次用的 model id：

```ts
// session.ts
const requestedModel = settings.model || await peekRecentModel(project.path);
```

这避免了"model 字段空白直到 system.init 到达"的 UI 闪烁。Devin 当前启动时 model 字段空白，直到 `config_option_update` notification 到达。

---

## 4. Entry 健壮性

| | Claude | Devin |
|--|--|--|
| zombie entry 检测 | **没有**（同一个漏洞） | 刚修了——`proc.exitCode` + stale init 检查 |
| stale init timeout | 无 | 刚加了——`_createdAt` + `INIT_TIMEOUT_MS` |

Claude 的 attach 路径**也没有检查 `proc.exitCode`**：

```ts
// session.ts — attach path (当前代码)
if (resumeId && byResumeId.has(resumeId)) {
  const entry = byResumeId.get(resumeId)!;
  attachClientHandlers(entry, socket);       // ← 没检查进程是否还活着
  send(socket, { type: 'started', ... });
  return;
}
```

这跟 Devin 之前的 bug 一模一样——进程退出但 entry 还在 `byResumeId` 里，新 client attach 到死 entry 上看到空白。**需要反向补丁。**

---

## 5. 状态机对比

```
Claude:  connecting → replaying → ready ⇄ thinking → reconnecting → closed
                        ↑
                  HTTP fetch 历史

Devin:   connecting ──────────→ ready ⇄ thinking → reconnecting → closed
              ↑
        WS 连接 + server replay（混在一起）
```

Claude 多了 `replaying`（HTTP fetch 历史中），给用户"Loading history…"提示。Devin 把这段时间混在 `connecting` 里，用户看到的是"Connecting…"而不是更精确的加载提示。

---

## 6. 协议消息类型对比

### Claude server → client

| 消息 | 用途 |
|------|------|
| `started` | 连接建立，携带 `thinking` / `model` / `resumed` |
| `event` | 包裹 claude stream-json 事件（`system.init` / `assistant` / `user` / `result` / `stream_event`） |
| `exit` | 子进程退出 |
| `stderr` | 标准错误 |
| `error` | 应用层错误 |
| `external_change` | JSONL 文件被外部修改 |

### Devin server → client

| 消息 | 用途 |
|------|------|
| `started` | 连接建立，携带 `promptPending` / `sessionId` / `currentModeId` / `configOptions` |
| `acp` | 包裹 ACP JSON-RPC（notification / response / agent request） |
| `exit` | 子进程退出 |
| `stderr` | 标准错误 |
| `error` | 应用层错误 |
| `load_failed` | session/load 返回错误（phantom slug） |
| `permission_timeout` | 权限请求超时自动拒绝 |

Devin 多了 `load_failed` 和 `permission_timeout`——这些是 ACP 特有的场景（Claude 的 stream-json 没有对应需求）。

---

## 7. 可借鉴的改进（按优先级排序）

### A. 持久化历史 + HTTP transcript API ⭐⭐⭐

**当前痛点：**
- 服务端重启 → history 全丢 → 空白 tab
- 5000 条 cap → 长会话丢失早期消息
- 所有历史通过 WS replay → 慢、且 WS 未建立前看不到

**可行方案：**

Devin 的 `~/.local/share/devin/cli/sessions.db` 可能有 transcript 数据（我们已经用 `node:sqlite` 读 session list 了）。如果 sessions.db 里也有 transcript 数据，可以直接建 `GET /api/projects/:id/devin-sessions/:slug/transcript` 端点。

如果 sessions.db 没有 transcript，可以在 server 端把 `entry.history` 追加写入一个 JSONL 文件（如 `~/.config/remote-ide/devin-history/{slug}.jsonl`），类似 Claude 的做法。

### B. WS 建立前 pre-fetch 历史 ⭐⭐⭐

配合 A，DevinPanel 的 resume 流程改为：

```
1. setStatus('replaying')
2. fetch transcript via HTTP → 立刻渲染
3. openWs() → server 只推增量（或 attach 后跳过 history replay）
```

需要一个增量同步机制——server 端记录 history 的 index，client 上报"我已经有到 index N 的历史"，server 只推 N+1 起的增量。

### C. session.ts 反向补丁 zombie 检测 ⭐⭐

刚给 Devin 做的 zombie entry 检测（`proc.exitCode !== null` check），需要搬到 `session.ts` 的 attach 路径。两端用完全相同的模式，否则 Claude 端也有同样的空白 tab 风险。

### D. 分页加载历史 ⭐

配合 A+B，对长会话支持 `loadOlder()` infinite scroll。Claude 的实现可以几乎原样搬过来（`orphanResultsRef` + `beforePrependRef` scroll 保持逻辑）。

### E. `replaying` 状态 ⭐

简单改动——DevinPanel 的 Status 类型加 `'replaying'`，resume 时先进入该状态，HTTP fetch 完成后再转 `connecting`→`ready`。对用户体验有帮助，改动量很小。

---

## 总结

Claude 端最大的架构优势是**数据持久化在磁盘**（JSONL），使得：
- 历史不受进程生命周期影响
- 可以 HTTP 独立获取（不依赖 WS）
- 支持分页
- reconnect 体验好（先显示内容再重连）

Devin 端当前是**纯内存 + 纯 WS**模式，简单但脆弱。核心改进方向是引入类似的持久化层 + HTTP transcript API，把"显示历史"和"建立实时连接"解耦。

反过来，Devin 端刚做的 zombie entry 检测需要**反向移植到 Claude 端**（session.ts 有完全相同的漏洞）。
