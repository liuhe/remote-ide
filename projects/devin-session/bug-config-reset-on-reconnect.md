# Bug 分析：Devin 会话过一段时间后自动切回 code 模式 + SWE-1.6 Fast

> 2026-05-21 | 状态：✅ 已修复（方案 B）

## 现象

用户在 remote-ide 中选好 model 和 mode 后，过一段时间会发现被重置回 Devin 默认值（model=`swe-1-6-fast`，mode=`code`）。

## 根因

WS 断线 → 子进程被回收 → 重连时 spawn 新进程 → Devin 默认值覆盖用户选择。

### 完整链路

```
1. WS 断线（网络抖动 / 浏览器休眠 / 服务端重启）
       ↓
2. server: ws.onclose → entry.clients 变空 → scheduleKillIfIdle()
   [server/src/devin.ts: scheduleKillIfIdle, 第 101 行]
       ↓
3. 5 分钟无人重连（CLIENT_DRAIN_GRACE_MS = 5min）
   [server/src/devin.ts 第 49 行]
       ↓
4. server: kill devin proc → bySessionId.delete(sessionId)
   [server/src/devin.ts 第 108-110 行]
       ↓
5. client: scheduleReconnect() → openWs(resume=旧slug)
   [web/src/components/DevinPanel.tsx 第 433-450 行]
       ↓
6. server: bySessionId 已无此 slug → spawnDevin + session/load(旧slug)
   [server/src/devin.ts 第 743-766 行]
       ↓
7. session/load 成功恢复对话历史，但 configOptions 是新进程的默认值
   （ACP session/load 不负责恢复 model/mode，只恢复消息）
       ↓
8. 用户看到 model=swe-1-6-fast、mode=code
```

## 代码层问题（3 个）

### 问题 1：defaultModel 仅在 `wasFresh` 时应用，重连不触发

`web/src/components/DevinPanel.tsx` 第 642-651 行：

```ts
// Apply the user's default model only for brand-new sessions — resumed
// sessions keep whatever model they were created with.
if (wasFresh && defaultModel) {
  const modelCfg = data.result.configOptions?.find?.((c: any) => c.id === 'model');
  if (modelCfg && modelCfg.currentValue !== defaultModel) {
    changeConfig('model', defaultModel);
  }
}
```

`wasFresh = !activeSessionIdRef.current`（第 622 行）。

WS 重连时 `activeSessionIdRef` 仍持有旧 slug（`scheduleReconnect` 路径不会清它），所以 `wasFresh = false`，defaultModel **不会被应用**。

唯一能 `wasFresh = true` 的路径是 `load_failed`（第 759 行手动清 `activeSessionIdRef`），但那是 session 彻底不存在的极端情况。正常的"子进程被回收后 session/load 成功"走不到。

### 问题 2：mode 没有任何"恢复用户偏好"的逻辑

代码只对 model 做了 `defaultModel` → `changeConfig('model', ...)` 处理（Phase 6 Task 2 实现）。

mode 完全没有对应逻辑——无论新建还是恢复，mode 永远由 Devin 新进程决定（默认 `code`）。相关代码只做了被动接收：

```ts
// DevinPanel.tsx 第 595-596 行
case 'current_mode_update':
  if (typeof update.currentModeId === 'string') setCurrentModeId(update.currentModeId);
  return;
```

没有"如果用户有偏好 mode，主动下发 `set_config`"的逻辑。

### 问题 3：session/load 成功也不保留上次的 model/mode

ACP 的 `session/load` 设计上只恢复对话历史（message_nodes），不恢复 session 级配置。新 spawn 的 devin 进程自己的 configOptions 永远是默认值。

服务端虽然在 `entry` 上缓存了 `currentModeId` / `configOptions`（第 284-288 行），但这只在进程存活期间有效。进程被 kill 后 entry 也被删除，缓存全丢。

## 涉及文件

| 文件 | 关键位置 |
|------|----------|
| `server/src/devin.ts` | `scheduleKillIfIdle`（第 101 行）、`CLIENT_DRAIN_GRACE_MS`（第 49 行）、`sendSessionNewOrLoad`（第 408 行） |
| `web/src/components/DevinPanel.tsx` | `wasFresh && defaultModel` 条件（第 644 行）、`handleAcpUpdate`（第 595 行）、`handleWsMsg` started（第 700 行） |
| `web/src/components/Settings.tsx` | `DEVIN_MODEL_OPTIONS`（第 32 行）— 目前只有 model，没有 mode |
| `web/src/App.tsx` | `defaultModel={settings.devinModel}`（第 325 行）— 只传了 model |
| `web/src/types.ts` | `Settings` 类型 — 只有 `devinModel`，没有 `devinMode` |

## 修复方案

### 方案 A：重连后无条件应用用户偏好（推荐）

去掉 `wasFresh` 条件，收到 `session/new` 或 `session/load` response 后**总是**检查并应用 defaultModel / defaultMode。

改动点：
1. **DevinPanel.tsx** — 去掉 `wasFresh &&`，改为 `if (defaultModel) { ... }`
2. **types.ts** — `Settings` 加 `devinMode?: string`
3. **Settings.tsx** — 加 "Default Devin mode" 选择（从 ACP 拿到的 modes 里选）
4. **App.tsx** — 传 `defaultMode={settings.devinMode}` 给 DevinPanel
5. **DevinPanel.tsx** — session response 后加 mode 的 `changeConfig('mode', defaultMode)` 逻辑

优点：简单可靠，不依赖服务端状态持久化。
缺点：每次 load 后都会多发一次 `set_config_option` RPC（代价很小）。

### 方案 B：服务端持久化 session 的最后 model/mode

entry 被 kill 前把 `currentModeId` + model 写入 workspace store（或 sessions.db），新进程 load 后读回来下发。

优点：语义更准确（恢复的是"这个 session 上次用的"，而不是"全局偏好"）。
缺点：需要额外的持久化逻辑；sessions.db 是 Devin 自己管理的，不适合我们写入。

### 方案 C：session 响应后总是应用（不区分 new/load）

和 A 类似，但通过判断 RPC id=1 来触发，不依赖 `wasFresh`。

优点：精确匹配 session 建立时机。
缺点：仍然需要 Settings 加 mode 字段，和 A 的工作量相当。

### 采用：方案 B（内存 Map + 磁盘持久化）

改动仅限 `server/src/devin.ts`：

**数据结构**：`savedSessionConfig: Map<sessionId, {model, modeId, ts}>`
- 内存 Map 为热路径
- 磁盘文件 `~/.config/remote-ide/devin-config-cache.json` 为持久化后备，服务端重启后自动恢复
- 7 天 TTL 自动清理过期条目

**保存**：
1. `persistSessionConfig(entry)` — 从 `entry.configOptions` 提取 model、从 `entry.currentModeId` 提取 mode，写入内存 Map 并 flush 到磁盘
2. `scheduleKillIfIdle` / `proc.on('exit')` — kill 前调用 `persistSessionConfig`

**恢复**：
3. `restoreSessionConfig(entry)` — session/load 成功后查 Map，若 model/mode 与新进程默认值不同则下发 `set_config_option` / `set_mode` RPC
4. 在 id=1 response 处理后调用 `restoreSessionConfig`

**启动**：模块加载时 `loadSavedConfigFromDisk()` 从磁盘读入内存 Map（含 TTL 过滤）。
