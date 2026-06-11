# Bug 分析：devin tab 久不用后无法刷新，必须关 tab 重开

> 2026-05-24 | 状态：🚀 修复中（两端加 ping）

## 现象

devin tab 开着但很久没操作，回来发现 UI 像凝固了——切 model / 切 mode / 发消息都没反应，也不会自动重连。唯一办法：关掉 tab，再从历史里 resume 同一个 session。

## 根因

**WS 没有心跳，TCP 静默断连后两端都不知道。**

DevinPanel.tsx 与 server/devin.ts 都没有 ping/pong 机制（grep `ping|pong|heartbeat|setInterval|visibility` 命中 0）。叠加 commit `f05ac74`（保留所有 tab 的 mount，仅 `display:none` 隐藏），WS 在后台一直挂着，进一步暴露问题。

### 完整链路

```
1. devin tab 切走，WS 不再关闭（display:none，组件仍挂载）
       ↓
2. 后台静置若干分钟
   - 浏览器节流后台 timer + 网络
   - NAT / 路由器 / OS 休眠 → 静默回收 TCP
       ↓
3. TCP 死了，但 WS 没收到 close 帧：
   - ws.readyState 仍是 OPEN
   - server 的 entry.clients 仍含此 socket
   - 双方都以为对端在线
       ↓
4. 用户切回 tab：
   - send() 进黑洞（不报错，因为 OS 缓冲未满）
   - 没有任何 incoming → UI 不更新
   - onclose 不烧 → scheduleReconnect 不触发
       ↓
5. 用户关 tab + resume：
   - useEffect cleanup: closedByUsRef=true; wsRef.close()（走本地状态机）
   - 重新 mount 走 start() → HTTP refetchTranscript（独立 TCP）+ 新 WS
   - 一切正常
```

## 修复方案

两端加 ping，并在 tab 可见时主动健康检查。

### 服务端（devin.ts / session.ts）

- 每 socket 绑定一个 30s 间隔的 WS ping 帧（`socket.ping()`）。
- `socket.on('pong', ...)` 标记 `isAlive=true`。
- 下一轮 ping 前若 `isAlive` 仍是 false，`socket.terminate()` 释放 entry，让 `scheduleKillIfIdle` 正常 drain。
- socket close 时清 interval。
- 客户端发 `{type:'ping'}` 时直接 `{type:'pong'}` 回，路径在 initialize/session 之前也能走。

### 客户端（DevinPanel / ChatPanel）

- 每 25s 发 app-level `{type:'ping'}`。
- 追踪 `lastMessageAt`（任何 incoming 消息更新）。超过 60s 无任何消息 → 主动 `ws.close()` 触发 `scheduleReconnect`。
- `visibilitychange` → 可见时，若 `lastMessageAt` 已超过 30s 或 `readyState !== OPEN`，立即 close → reconnect，缩短用户感知延迟。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `server/src/devin.ts` | 新增 ping interval 工具 + `{type:'ping'}` 响应 |
| `server/src/session.ts` | 同上 |
| `web/src/components/DevinPanel.tsx` | 客户端 ping + visibilitychange |
| `web/src/components/ChatPanel.tsx` | 同上 |
