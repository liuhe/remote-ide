# Log — MVP

## 2026-05-17

### 23:00 模型选择再补

**初始延迟显示模型**：之前 attach 已修，新 spawn 仍要等 1-2s 才有 model 显示。三层 hint 串起来：
- Resume：client fetch transcript 后扫最后一条 assistant 消息的 `message.model` 立即 setModel
- 新 spawn：server `started` 加 `requestedModel`（settings.model），client 没有 confirmed model 时用它占位
- system.init 到达后覆盖为权威值（claude 实际跑的模型 id）
- 三种入场（new / resume-from-JSONL / attach）都即刻可见

**给选择而非自由输入**：
- 用户没法记完整 model id（`claude-haiku-4-5-20251001` 没人记得住）
- Settings 改回 radio list，7 个候选 + Default：3 个 alias（auto-upgrade）+ 4 个具体 snapshot（pin）
- 每行 label + monospace 显示 model id，用户能直接看到自己选的是什么
- 状态栏 picker 同样列出全套，当前在用的高亮
- 去掉自由文本输入 — 维护成本：新 family/snapshot 出现时改 `Settings.tsx` `MODEL_OPTIONS` 和 `ChatPanel.tsx` `SWITCHABLE_MODELS` 两个常量

### 22:30 模型选择补两块

**Attach 时模型显示**：
- 原实现 model state 只由 client 收到 `system.init` 时设置；attach 到已存活的 entry（grace 期内 resume）时 claude 不再发 init → model 一直 null
- 修：SessionEntry 新增 `model: string | null` 字段，每条 init 时更新；`started` payload 把 entry.model 带给 client；client `started` handler 拿到就 setModel
- 现在新 spawn 仍要等 1-2s init 才有 model 显示（claude 冷启动），但 grace 期内 reconnect/resume 是立刻

**自定义 model id**：
- Alias 只暴露每族 latest，无法选 specific snapshot（如 `claude-opus-4-7[1m]` 1M-context Opus）
- Settings 把 radio 改成 chips + 自由 text input；chip 是 quick-select，input 接受完整 id；两者绑同一字段
- 状态栏 inline picker 也加 input row（form submit 走相同 set_model 路径）
- CLI 验证：`--model` 接受 alias 也接受完整 id

### 21:50 模型选择（全局默认 + 会话内切换）

claude CLI 调研：
- `--model <alias|full-id>` 启动参数：`opus` / `sonnet` / `haiku` 或完整 ID（如 `claude-sonnet-4-6`）
- stream-json 控制协议 `{type:'control_request', request:{subtype:'set_model', model}}`：**支持会话内切换**，验证流程：发出后 claude 回 `control_response success`，紧接 `system.init` 事件携带新 model id，下一 turn 即用新模型；`result.modelUsage` 字段会分别记录每个模型的 token 用量
- 自我认知滞后：切到 haiku 后问"你是什么模型"，模型基于训练数据答 Opus；但 metadata 层 (`message.model`) 是准确的，UI 显示以 metadata 为准

实现：
- **全局默认**（Settings → `model: string`，'' = 不传 `--model`）
  - Server 在 spawn 时 `await getSettings()` 拿到 model 并加进 args
  - 影响：新 session 生效；已存在的 resume 走 claude 自己的 session 模型
- **会话内切换**（状态栏模型名变可点按钮，弹三项 alias 菜单）
  - Client → WS `{type:'set_model', model}`
  - Server → claude stdin `control_request` 转发
  - 后续 `system.init` 自动驱动 UI 模型显示更新

取舍：
- 没做"完整 ID 自由输入"，只暴露三个 alias；后续如果要用 specific snapshot 再加
- 没做"切换前确认"，因为换到 haiku 出错就再切回 opus，成本很低；想加确认很容易

### 19:30 修 /assets/* 全部 404 的回归

- 现象：浏览器报 `/assets/index-Dm8JQ9sK.js 404`，文件本地真实存在
- 之前误判为浏览器缓存问题，让用户强刷——错的
- 根因：上一次给 fastify-static 加缓存 setHeaders 时同时设了 `wildcard: false`。在 @fastify/static 9.x 下，`wildcard: false` 只注册 `/:filename` 单层 route，**不递归子目录** → Vite 输出的 `/assets/*` 全部 404
- 修法：去掉 `wildcard: false`，默认 wildcard=true 注册 `/*`
- 验证：真实 hash JS 200、不存在 hash JS 404、SPA route 200、index.html 200
- 经验：fastify-static 的 wildcard 默认就是对的，没特殊需要不要碰

### 19:05 修流式输出重复

- 现象：每条 assistant 消息渲染两次（增量一次 + 完整一次）
- 根因：完整 `assistant` 事件常在 `message_stop` **之前**到达；我原本在 `message_stop` 时才把 anthropic msg_id 加入 `streamedAssistantIdsRef` 去重，所以完整事件到达时集合还是空 → renderEvent 把整段又 append 一遍
- 修法：把"加入集合"的时机提前到 `message_start`（已知 message_id 的最早时点）；`message_stop` 只清 `currentAssistantIdRef`
- 防御：去重命中后**不再 delete**（避免 replay / 重广播路径漏过去）；集合加 LRU 上限 256，长会话不积累

### 18:45 静态资源缓存策略

- 用户报：浏览器 console `GET .../assets/index-XXX.js 404`
- 根因（区别于上一条的 MIME 错）：旧 `index.html` 仍在浏览器缓存里，引用的 JS hash 在新构建中已失效；fallback 改对了所以 404 是真 404，但用户体验仍是页面坏掉
- 通用做法：把 `index.html` 和 hashed assets 拆成两套缓存策略
  - `index.html`：`Cache-Control: no-cache, must-revalidate` — 每次都问 server，新构建立即生效
  - `/assets/*`（Vite hash 化输出）：`Cache-Control: public, max-age=31536000, immutable` — hash 是内容寻址，永远不变；浏览器可以无限期缓存
  - 其它：`no-cache` 保守兜底
- 实现：`@fastify/static` register 时 `cacheControl: false`（关掉默认 `max-age=0`）+ `setHeaders(res, p)` 按路径分流；fallback handler 单独 set `index.html` 的 header
- 一次性迁移：旧用户需要强刷一次清掉旧 index.html，之后部署平滑

### 18:30 状态栏策略 + SPA fallback 修 MIME 错

**状态栏策略**：
- 第一版改成只 toast 才显示 → 用户反馈断连/closed 等异常状态需要可见
- 第二版改成仅"异常状态"显示 → 用户反馈 ready 也要显示（一致性 + 避免布局跳动）
- 最终：状态栏常驻；只在 `thinking` 时隐藏（底部三点动画接管）
- 颜色：ready accent、reconnecting/closed danger、其余 muted；toast 仍优先覆盖

**SPA fallback MIME 错**：
- 现象：浏览器控制台 `Failed to load module script: Expected ... MIME type of "text/html"`
- 触发：浏览器缓存了旧 `index.html`，引用旧 hash JS（如 `index-EshljYXO.js`）；新构建后该文件已删；server `setNotFoundHandler` 把所有非 `/api/*` `/ws/*` 的 404 都兜成 `index.html` → JS 请求得到 `text/html` → 严格 MIME 检查报错
- 修法：fallback 前判断路径末段是否含 `.`；含 `.` 视为资源请求，返回真 404；否则才认为是 SPA 路由兜底
- 顺带剥掉 query string（避免 `/foo?x=y.js` 这种奇怪情况误判，虽然实际不会发生）

### 17:20 流式输出 + Stop 协议级中断 + 运行中可输入 + Thinking 指示器位置

通过 PoC（直接 spawn claude 测试 stream-json 协议）摸清几个关键能力：
- **`--include-partial-messages`**：开启后 stdout 出 `stream_event` 包裹的 Anthropic SDK 事件（`message_start` / `content_block_start` / `content_block_delta {text_delta | input_json_delta}` / `content_block_stop` / `message_stop`）；最终还会出完整 `assistant` 事件（双轨）。JSONL 只存完整事件（不含 stream_event），所以 replay 路径不变
- **`control_request {subtype:'interrupt'}`** 写到 stdin：claude 停掉当前 turn 但进程不死，返回 `control_response` + `result(subtype=error_during_execution, terminal_reason=aborted_streaming)`，下一条 user 消息照常处理。这才是 claude code 里 ESC 的等价物
- stream-json 输入天然支持运行中追加：stdin 持续打开

改动：

**Server (`session.ts`)**：
- spawn args 加 `--include-partial-messages`
- `stop` 消息从 `kill('SIGINT')` 改为往 stdin 写 `{type:'control_request', request_id:..., request:{subtype:'interrupt'}}`

**Client (`ChatPanel.tsx`)** — live 路径双轨化：
- 维护 `currentAssistantIdRef`（当前正在流的 anthropic message_id；单线）+ `streamBlocksRef: Map<assistantId#blockIdx, {ourMsgId, kind, toolName?, toolUseId?, jsonBuf?}>`
- `processStreamEvent` 增量更新：text block start → push 空 assistant msg；text_delta → 追加文本；tool_use block start → push tool msg；input_json_delta → 缓冲 partial JSON；content_block_stop（tool_use）→ JSON.parse buffer 落到 `input`
- `streamedAssistantIdsRef: Set` 在 `message_stop` 时加 anthropic msg_id；后续收到完整 `assistant` 事件若 id 在集合中 → 跳过（已渲染）
- `result` 事件清 `currentAssistantIdRef`、置 status=ready
- 取舍：tool_use 的 input 只在 content_block_stop 才显示完整；中途展开 tool 详情会看到空 input。可接受，常规交互不会在流到一半时去展开 tool

**Thinking 指示器位置**：
- 移除 status bar 上的 thinking 文字 + 浮动 stop 按钮
- 在 `msgs.map(...)` 后挂一个 `.msg-thinking`（三个 CSS 动画点），thinking 时显示
- 自然落在对话流末尾，跟着 sticky-bottom 滚动，跟其他消息视觉对齐
- status bar 现在只在有 toast 时显示

**Stop 按钮位置 + 行为**：
- 从 status bar 的 `<button style={float:right}>` 改为输入框右侧 `.chat-stop`（红底，丹格调），thinking 时才出现
- 协议级中断，进程不死

**运行中可输入**：
- `send()` 拦截条件改为 `status === 'closed' | 'connecting' | 'reconnecting'`，thinking 状态放行
- placeholder thinking 时显示 "Claude is working — type to queue / send another"
- Send 按钮 disabled 条件同步放宽

## 2026-05-16

### 22:00 Transcript 分页（tail 20 + load older）

- 思路升级：与其优化加载 9MB JSONL，不如根本就不加载——只取最近 20 条事件，需要历史时按需往回拉
- **Server**（`projects.ts`）：transcript 接口加 `?limit=N&before=<absoluteIdx>` 查询参数；返回 `{ events, startIndex, endIndex, total }`。`startIndex` 是当前 slice 在过滤后 user/assistant 事件列表中的起始偏移，client 用它做"是否还能往回加载"判断
- **Client**（`ChatPanel.tsx`）：
  - 初始 / refetch 路径只拉 `?limit=20`
  - `oldestIdx` state 表示"我已加载的最早事件位置"，>0 时顶部显示 `↑ Load older (N above)` 按钮
  - `loadOlder()` 用 `?before=${oldestIdx}&limit=20`，build 后 prepend，更新 `oldestIdx`
- **跨批次 tool_use ↔ tool_result 拼接**：
  - 边界场景：tool_use 在事件 #1500（older 批次未加载），tool_result 在 #1510（在 tail 里）。build tail 时 `kind: 'tool_result'` 找不到对应 pending 的 tool msg → 之前会被丢弃
  - 引入 `orphanResultsRef: Map<toolUseId, output>`，跨 build 调用持久化；找不到 pending 时 stash 进 map；后续 build 老批次见到该 toolUseId 的 tool_use 时立即 fill output 并 delete
- **滚动位置保持**：
  - 改 `useEffect` → `useLayoutEffect`，在 React commit 后但浏览器 paint 前调整 scrollTop（避免闪烁）
  - `beforePrependRef` 在 `loadOlder` 调用前快照 `{height, top}`；layoutEffect 检测到该 ref 有值，`scrollTop = top + (newScrollHeight - oldScrollHeight)`，把用户视口锚回原位
  - 顺手实现 sticky-bottom：`onScroll` 维护 `stickyBottomRef`（离底 < 50px 视为粘），只在粘底状态自动滚到底；用户主动滚上去看历史时不再强制拉回
- 副作用 / 取舍：
  - tool 展开 state 按 msg.id 索引，msg.id 是 `shortId()` 随机的；refetchTranscript 走 reset 路径（清空 orphan map），用户已展开的 tool 会被收起。可接受
  - 默认 limit=20 在事件数量层面，1 个 assistant 事件可能渲染成多条 msg（text + tool_use 块），实际 UI 上能看到的"条数"会多于 20。差不多够"打开就看到上下文"
- 体验差距：刷新从"等几秒 9MB"变成"几十 KB 几乎瞬时"

### 21:42 加速刷新 replay + grace 策略升级

**策略升级**（用户改）：grace 从 30s 拉到 **5min**，并抽出 `scheduleKillIfIdle(entry)`：
- timer 触发时若 `entry.thinking` 仍为 true 就 bail，等 `result` 事件触发重新 schedule
- `result` 处理路径在 `clients.size === 0` 时主动 schedule
- 含义：长任务（claude 跑很久，用户走开）不会因为没有观察者被杀；只在真正 idle 5min 后才回收
- 副作用：内存里可能积累多个 idle entry，但每个对应一个 claude 进程，本来就该被持有。可接受

**Replay 慢**（9MB JSONL → 1578 个 events）瓶颈：
1. **客户端 O(N²)**：`applyDeltas` 走 immutable 模式，`arr = [...arr, msg]` 每次 O(N) 拷贝，`arr.map(...)` 每次 O(N) 全表扫一遍 tool_use_id；1500 事件 + 上百个 tool_result 累积上千万次操作
2. **网络**：9MB JSON 经 DDNS/反代到手机，4G 上几秒

修法：
- 抽 `buildFromEvents(events): Msg[]`，**mutable 单次构建**：用 `pendingByToolUseId: Map<string, Msg>` O(1) 查找 tool_use 等待 output，原地写回；保留 `applyDeltas` 给 live 路径（增量小，immutable 更安全）
- Server `@fastify/compress` 注册 gzip/deflate（threshold 默认 1KB）；9MB JSON 压到 ~1MB，wire 时间几倍提升；`Vary: accept-encoding` 反代友好
- 经验：immutable React state 在 replay/批量重建场景就是反模式；应该 mutable 构建 + 末尾 setState 一次

### 20:10 刷新页面不打断 AI + thinking 状态保留

- 用户反馈刷新页面会：(1) 中断 claude 正在做的事 (2) 即使是 thinking 状态也丢
- 定位：`session.ts:108` 最后一个 client 断开就立即 `SIGTERM` 杀 claude；刷新 = 唯一 client 断 → 进程秒杀。客户端 `started` 也总是设 `ready`，不管 server 端是否还在生成
- 修法（server）：
  - `SessionEntry` 加 `killTimer`，`socket.on('close')` 走宽限期路径：clients 清空后 `setTimeout` 30s 再 kill；任何 `attachClientHandlers` 调用先 `clearTimeout`，所以刷新窗口（~1s）远小于宽限期，子进程不会被打断
  - `SessionEntry` 加 `thinking: boolean`，`message:'user'` 输入分支置 `true`，stdout rl 检测到 `event.type==='result'` 置 `false`
  - `started` payload（attach 和 spawn 两路）都带 `thinking` 字段
  - `entry.proc.on('exit')` 顺手清理 `killTimer`
- 修法（client）：`handleWsMsg` 收到 `started` 时 `setStatus(m.thinking ? 'thinking' : 'ready')`
- 中间事件丢失边界：transcript fetch → WS attach 之间若 claude 产新事件，可能既不在 transcript 里也没被 WS 收到。窗口极短（~100ms），实际表现就是"突然跳到下一段"，可接受；要根治得做 attach 后 transcript diff，暂不做
- 旁支：原本 WS 自动重连用的是网络层重连，跟 page refresh 是两个路径但同样受益于本次 grace timer（重连成功 → attach 取消 timer → 进程保活）

### 19:52 launchd 守护 + 停掉 dev 流程

- 选 **LaunchAgent**（`~/Library/LaunchAgents/`）而非 LaunchDaemon：`claude` CLI 依赖 `~/.claude/...` 用户凭据，root 跑不动；其它 root 网络监控服务是 LaunchDaemon，跟本场景不同
- plist `com.eric.remote-ide`：
  - `pnpm --filter server start` 作为入口（WorkingDirectory=repo 根，让 `.env` 加载和 pnpm filter 都对得上）
  - `RunAtLoad` + `KeepAlive` + `ThrottleInterval=5`（防止 crashloop 烧端口）
  - PATH 显式给 `/usr/local/bin:/usr/bin:/bin`（launchd 不继承登录 shell 的 PATH，pnpm + node + claude 都在 /usr/local/bin）
- 操作序列：写 plist → `kill -TERM` 旧 `pnpm dev` 顶层 PID（cascade 把 vite + tsx watch + esbuild + server 全清掉）→ 等端口 9991 释放 → `launchctl bootstrap gui/501 <plist>` → 等端口重新被绑 → curl 验证 /api/health + / 都 200
- 调试备忘：`launchctl print gui/501/com.eric.remote-ide` 看状态；`launchctl kickstart -k gui/501/com.eric.remote-ide` 重启进程；日志 `~/Library/Logs/remote-ide.{log,err}`
- 生命周期：web 改动 → `pnpm --filter web build`，server **不用重启**（静态直接读盘）；server 代码改动 → `kickstart -k`
- vite dev 流程整条退役：HMR WS 抖动导致 reload 的原因也随之消失

### 19:48 生产构建与单进程托管

- 上一条排查到的"HMR WS 抖动触发 reload"靠生产部署根除：去掉 vite dev → 反代直接打到 server → 没有 HMR client → 没那条易断的 WS
- 改动：
  - `pnpm add @fastify/static` 加入 server 依赖
  - `server/src/index.ts`：默认端口 5174 → 9991（用户指定对外端口）；解析 `web/dist` 绝对路径（从 `import.meta.url` 出发，dev 跑 tsx 和编译产物都对得上）；`fs.existsSync(WEB_DIST)` 检查后再注册 static，dev 模式没构建也能照常跑
  - SPA fallback：`setNotFoundHandler` 里 `/api/*` `/ws/*` 维持 404，其它路径回退 `index.html`（SPA client-side routing 留余地，目前没用也无副作用）
  - `web/vite.config.ts`：dev proxy `5174 → 9991` 同步
  - 鉴权与静态不冲突：`auth.ts` onRequest hook 只拦 `/api/*` 和 `/ws/*`，静态资源放行；前端 mount 时拉 `/api/auth/status` 触发登录流程不变
- 验证：单进程跑 server，curl `/` `/assets/*.js` `/some/path` 都 200 text/html，`/api/health` `/api/auth/status` 200 json
- 单点托管的工程价值：web 改动只需 `pnpm --filter web build`，server 进程不用重启（直接读盘）；反代上游从两套（vite + server）收敛成一套
- 待办：反代上游切到 server:9991；server 守护方式（launchd 优先，跟现有 macOS 主机风格一致）

### 12:15 排查"使用过程中整页随机刷新"

- 用户报告手机端使用时偶尔整页刷新，怀疑是新加的 WS 自动重连副作用
- 排查：全代码搜 `location.reload` 只有 Login 成功一处；WS 重连路径只有 `new WebSocket()` + `setMsgs`，不会刷页面
- 真凶：**Vite HMR 客户端在 dev 模式下自带一条 WebSocket（部署里走 wss:443 反代），这条 HMR WS 断开重连时 Vite 内置 `location.reload()` 行为**
- 触发场景：手机 WiFi/蜂窝切换、反代 idle 超时砍连接、dev server 进程重启
- 验证方法：浏览器控制台看 `[vite] server connection lost. polling for restart…` / `[vite] page reload`
- 解决：走生产构建（pnpm build → server 静态托管 dist），生产产物没有 HMR client 不存在这条 WS，问题根除
- 这同时也是 tasks.md 里"生产构建与部署"那条待办的紧迫性来源

### 11:57 WS 自动重连 + 字体大小设置

**WS 自动重连**：
- 之前 `ws.onclose` 直接进 `closed` 状态，server 重启或网络抖动后用户必须手动关 tab 再开
- 加 `closedByUsRef` / `sessionExitedRef` 两个标记区分"应重连 vs 真终止"，前者只在组件卸载时置位，后者在收到 `exit` 事件时置位
- 指数退避 `500ms × 2^attempt`，封顶 10s，`onopen` 时重置计数
- 重连前若有 `activeSessionIdRef`（即 server 已下发过 `system.init` 的 session_id），先 `refetchTranscript` 把可能漏掉的消息补齐，再用该 id 作为 resume 重开 WS
- Server 那边 `byResumeId` 已有逻辑：若 entry 还活着就 attach（多 client 共享），否则 spawn 新 claude 并 `--resume`，无需改动
- status 新增 `'reconnecting'`，textarea 仍可打字（只 send 按钮 disabled），状态栏显示状态
- toast：重连成功显示 "Reconnected"；不再 append "connection error" 系统消息（状态栏已可见）

**字体大小设置**：
- 设计取舍：只缩放阅读内容（`.msg`、`.viewer-markdown`、`.viewer-markdown code`、`pre`、`.msg-tool`、`.tool-field-value`、`.msg-assistant code/h1-h4`），不缩放 UI chrome 与 `.chat-input textarea`
  - textarea 保留固定 16px，避免 iOS Safari focus 时自动放大
  - 状态栏、按钮、tree-item 等保持触摸热区一致
- 用 `--font-scale` CSS 变量 + `:root[data-font-scale="..."]` 选择器实现：0.88 / 1 / 1.18 / 1.35
- px 用 `calc(<base>px * var(--font-scale))`，因为 font-size 不复合传递（不是 em/%），所以每个被缩放的元素都得显式写 calc
- 写入 `~/.config/remote-ide/settings.json`，跨设备同步
- Settings modal 加 Font size 区块，放在 Theme 下方 / Send key 上方

- 对齐技术选型：CLI 子进程方案、信任内网、只读 + 多类型渲染
- brew 装 node 26 + pnpm 11
- 搭起 monorepo：server（Fastify + WS）+ web（Vite + React + TS）
- Server：FS API（list/file/stat）+ WS session（spawn claude，stream-json 转发）
- Web：三栏布局，文件树 / Viewer / Chat
- 端到端跑通：`claude -p --input-format stream-json --output-format stream-json` 子进程响应 ≈2.5s

### 08:40 重构为多 Project + Tab 模型

- 用户给出 Project ──< Tab 数据模型
- 确认：(b) UI 添加 project / 服务端记 tabs（跨设备一致，不用 localStorage）/ 关 tab 杀进程 / 支持新建或 resume
- Server：`store.ts` + `projects.ts`，CRUD + Workspace（JSON 文件持久化在 `~/.config/remote-ide/`）
- Server：FS 与 WS 改为 per-project，`/api/projects/:id/sessions` 枚举可 resume 的 claude 会话
- Web：项目侧栏 + TabBar + 内容路由，所有 tab 状态 debounced PUT 到 server
- 端到端验证：add project → list fs → put workspace → restart 后恢复 ✓

### 08:46 跨重启的 session 恢复

- 问题：server 重启后 tab 还在但 claude 子进程没了，重连开新会话内容丢
- 方案：claude 第一条 `system.init` 事件带 `session_id`，前端捕获后写回 `tab.resumeId`，下次连接自动 `--resume`
- claude 自己把每条会话写到 `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`，这是事实来源
- 已知限制：UI 聊天面板恢复后是空的（state 在内存），只显示一条 "resumed session" 提示

### 08:53 修两个 dev 模式的副作用

- 浏览器截图显示一条 session 触发了"connection error → started → model → resumed session"四条消息
- 原因 1：`useEffect` 依赖里有 `resumeId`，`onSessionId` 把 uuid 写回后 effect 重跑，关旧 WS 又开新 WS 用 `--resume` 重连 → 修：用 `initialResumeIdRef` 在 mount 时锁住，effect 只依赖 `projectId`
- 原因 2：React StrictMode 在 dev 双重 mount 也会多 spawn 一次子进程 → 修：直接关掉 StrictMode（生产无影响）

### 09:00 补 project 文档

- 按 CLAUDE.md 项目模式要求，创建 `projects/mvp/{overview,tasks,log}.md`

### 10:10 Tab 管理整合到溢出菜单

- 手机上 `+ Session` 和 `↻ Resume` 两个文字按钮占掉一半 TabBar，挤压可视 tab 条
- 合并为右侧单个 `⋮` 按钮，点击弹出菜单：上面两个 action（New / Resume），下面列出所有 tab（点切换、× 关闭）
- 这样既给 tab 切换提供了下拉视图（很多 tab 时不用横向滚），又把次要 action 折叠起来
- 菜单外点击 / touchstart 自动关闭

### 14:10 多域名 HTTPS 部署

- 部署在个人工作站上，通过反代暴露到两个私有域名
- Vite 7 默认拒绝未列入 `allowedHosts` 的域名 → 两个都加进去
- HTTPS 页面访问时出现 mixed-content（"Not Secure"）：Vite HMR 默认走 `ws://hostname:5173`，被 HTTPS 页拒绝
- 修法：`server.hmr = { protocol: 'wss', clientPort: 443 }`，**不**写 host，让 Vite 客户端用 `location.host` → 同份配置两个域名都能用
- TLS 在反代终止；上游 Vite 仍跑 HTTP 是 OK 的

### 14:00 生成随机密码 + .env 自动加载

- 生成 16 字节随机密码（base64url），写入 `/Users/eric/git/remote-ide/.env`（gitignored）
- server 启动时手写一个迷你 dotenv 加载器：先尝试 `./.env`，再尝试 `../.env`（覆盖 `server/` 子目录跑的情况）
- ESM imports 是 hoisted，所以加载器代码必须放在 imports 之后；为此把 `auth.ts` 里的 `PASSWORD` 常量改成 `getPassword()` 惰性读，确保 .env 加载完毕后才取值
- 不引第三方 dotenv 依赖，正则简单解析 `KEY=VALUE`，支持引号

### 13:45 共享密码鉴权

- 通过 `REMOTE_IDE_PASSWORD` 环境变量启用；未设则禁用，保持原"信任内网"行为
- 实现：
  - `@fastify/cookie` 处理 HttpOnly cookie
  - `auth.ts` 维护 `sessions: Record<token, expiresAt>`，30 天 TTL，持久化到 `~/.config/remote-ide/sessions.json`（server 重启不丢登录态）
  - `onRequest` 全局 hook 拦截非 `/api/auth/*`、非 `/api/health` 的 `/api/*` 与 `/ws/*` 请求，无效 cookie 返回 401
  - `timingSafeEqual` 做密码比较，防时序攻击
- 端点：
  - `GET /api/auth/status` → `{required, authenticated}`
  - `POST /api/auth/login` 接 `{password}` → 成功 set-cookie
  - `POST /api/auth/logout`
- 客户端：
  - App mount 先拉 status，未登录则渲染 `<Login>` 单页
  - fetch 默认走 same-origin（cookie 自动带），WS 也是同源，cookie 跟着 upgrade 请求一起发
  - CORS 加 `credentials: true`（生产部署若同源则可不需要）
- 端到端测试：401→login→200 通过

### 13:20 状态消息改为 transient toast

- 之前 `— resumed —` / `— external change detected, refreshing —` / `model=...` / `started · cwd=...` 都作为 system msg 永久留在聊天历史里，刷新累积一堆
- 改成挂在底部 status bar 的 toast：触发时短暂显示（2.5s 后自动消失），不进 msgs
- 还保留为持久消息的：`stderr` / `exit` / `error`（这些代表问题，用户需要追溯）
- 顺手简化 `refetchTranscript`：之前为了保住 system 消息做了个 systemTail 拼接，现在 toast 化后不需要了

### 13:10 主题切换（dark / light / dim）

- styles.css 全面改用 CSS 变量（约 25 个语义 token：bg、bg-elevated、fg、accent、tool-bg 等）
- 三套主题：`:root[data-theme="dark|light|dim"]` 各自定义同一组变量
  - **dark**：当前 VSCode 风
  - **light**：GitHub 浅色风（#ffffff bg、#1f2328 fg、#0969da accent strong）
  - **dim**：GitHub Dim 风（#22272e bg、#adbac7 fg、#6cb6ff accent）
- Settings：增加 Theme 单选；写入 `~/.config/remote-ide/settings.json`（已带 sendKey）
- App 用 useEffect 把 `settings.theme` 同步到 `document.documentElement.dataset.theme`
- 语法高亮：Viewer + ChatPanel 的 MarkdownText 接 `theme` prop，light 主题切到 `oneLight`，dark/dim 都用 `vscDarkPlus`
- Tool 块的青绿色调因为是其品牌色（与 accent 重叠），单独保留 `--tool-*` 一组 token（在 light 主题里改成浅青绿）

### 12:50 Tool 详情浮层

- 保留原有点 header 行内展开/折叠，右边再加 `⛶` 按钮触发全屏浮层
- 浮层里去掉行内的 max-height/滚动限制，长输入输出完整可读
- 关闭：点背景 / × / Esc

### 12:40 图片 lightbox

- 点缩略图（pending 或历史消息里的）打开全屏浮层查看原图
- 关闭：点背景 / × 按钮 / Esc 键
- 实现：ChatPanel 局部 state `lightbox: string | null` 存当前展示的 src

### 12:30 图片输入

- 调查 JSONL：claude 把图片存成 `{type:'base64', media_type, data}` 直接嵌入。这套客户端/服务端用同样的 base64 编码就能闭环
- Client：
  - 📎 按钮 + 隐藏 `<input type="file" accept="image/*" multiple>` 触发系统文件选择器（手机也能拍照/相册）
  - PC paste：textarea `onPaste` 监听 clipboardData.items，过滤 `kind=file && type=image/*`，自动加入 pending
  - Pending images 在输入框上方显示小缩略图，× 删除
  - 发送时打包成 base64，通过 WS 发出
- Server：扩展 `{type:'user', text, images?}` 协议，把 text + image blocks 拼成 stream-json content 数组，转发给 claude stdin 并广播给其他 client
- 历史 replay：`renderEvent` 处理 user 消息时把 text 和 image blocks 合并到一条 user msg，image blocks 转成 `data:${mediaType};base64,${data}` URL 直接 `<img>` 渲染
- Msg 结构：user msg 增加可选 `images: string[]`（每项是可渲染的 src）

### 12:05 发送键改默认 + 设置页

- 用户反馈：默认 Enter 直接发送容易误触；要改默认行为 + 提供设置页
- 默认改成 `cmd-enter`（⌘/Ctrl+Enter 发送，Enter 换行），符合 Claude 系工具习惯
- Server 加 `GET/PUT /api/settings`，存 `~/.config/remote-ide/settings.json`，跨设备同步
- 新增 `Settings` modal：3 个 radio（cmd-enter / shift-enter / enter）+ 每项 hint
- 入口：ProjectPicker 下拉底部 `⚙ Settings`
- ChatPanel 接 `sendKey` prop，textarea onKeyDown 按设置分支；考虑 IME composition（`isComposing` 时不发送，防止中文输入法回车被劫持）

### 11:50 修 external_change 误报

- 现象：刚 resume 完一个 idle session，没人操作也连刷 3 条 "external change detected"
- 原因：claude 自己会在会话间隔写 housekeeping 记录（`permission-mode` / `file-history-snapshot` / `queue-operation` 等），1.5s 自身活动窗口太短，过窗后被 fs.watch 视为外部写
- 修法：
  1. 窗口拉到 30s（idle 阈值更保守）
  2. 同时纳入 `lastInput`（任一 client 发消息时间）作为活动证据
  3. 加 `externalNotified` 标志：同一 idle 期内最多触发一次，直到再次出现自身活动才 reset

### 11:35 Session 复用 + 外部修改检测

**问题 1**：多设备打开同一个 session tab 会各自 spawn claude 子进程，并发写同一 JSONL 文件，导致历史错乱

**方案 1：Server 端 session 注册表 + WS 多播**
- `byResumeId: Map<sessionId, SessionEntry>`，第二个连接同一 resumeId 时复用现有 subprocess，把它加入 `entry.clients`
- 新建 session 时 resumeId 未知，先放 `pending`；`system.init` 携带 `session_id` 后注册进 `byResumeId`
- 任一 client 输入 → broadcast 给其他 client（让对方实时看到对方在打字）+ 写 stdin
- 所有 events 广播给 entry.clients
- 最后一个 client 断开时才 kill 子进程
- 预注册（spawn 之前先 `byResumeId.set`），防并发 resume 重复 spawn

**问题 2**：外部 terminal 跑 `claude --resume <uuid>` 我们检测不到，依然会并发写 JSONL

**方案 2（部分缓解）**：fs.watch JSONL 文件
- `lastSelfWrite` 时间戳：每条 stdout event 更新；watch 触发时若距离 lastSelfWrite < 1.5s 则忽略（认为是自己写的）
- 否则 debounce 400ms 后向所有 client 推 `{type: 'external_change'}`
- Client 收到 → 自动 refetch transcript 重建消息列表 + 显示一条系统提示
- 边界：JSONL 文件创建之前 fs.watch 会失败，spawn 后没立刻有文件就 setTimeout 1s 重试

### 11:15 三处微调

1. **AI session 标题加上 ID 前缀**：`tabLabel` 现在返回 `<idShort> · <title>`。ID 帮助区分同名标题；空 title 时退化为只显示 ID
2. **PC 模式恢复多 tab 栏**：JSX 同时渲染 `.tab-current`（移动端）和 `.tab-list`（桌面），媒体查询切换可见。手机仍只显示当前 tab，桌面横排所有 tab
3. **Claude 启动加 `--dangerously-skip-permissions`**：替换原来的 `--permission-mode bypassPermissions`，更彻底地跳过权限提示（远程 IDE 场景信任前端，不应该有阻塞确认）

### 11:05 修 Markdown 视图宽度异常

- `.viewer-markdown` 设了 `max-width: 900px`，导致容器只占 900px 横向，右侧大块留白，且容器自带的滚动条出现在屏幕中间像分隔线
- 改成容器宽度撑满（仅 padding），内部各段落元素 `max-width: 880px; margin: 0 auto` 居中限制阅读宽度 → 既不浪费空间又保持可读

### 10:55 当前 tab 加刷新按钮

- 场景：在别的设备改了文件 / 推进了 AI 会话，本设备需要手动同步
- TabBar 在 ⋮ 左边加 `↻` 按钮，仅当存在 active tab 时显示
- 实现：App 维护 `refreshKey: Record<tabId, number>`，点 ↻ 时递增；Viewer / ChatPanel 用 `key={tabId}-${refreshKey}` 渲染 → 强制 remount → 重跑 useEffect → 重新 fetch
- 副作用预防：server 的 `fs/file` 响应加 `Cache-Control: no-store`，避免浏览器缓存把刷新吃掉

### 10:45 PC 模式合并左侧两栏

- 之前 PC 三栏：Projects | Files | Main，用户反馈两个左栏没必要同时存在
- 改成两栏：Files | Main。Project 切换/添加/删除全部走 Files 面板标题里的 `ProjectPicker`（按钮 + 下拉）
- ProjectPicker 下拉用 `position: fixed` 锚定按钮位置，绕开父级 overflow:hidden
- 移动端抽屉也跟着简化为单面板（只有 Files + 顶部 picker），不再有 Projects 单独分区
- 删掉不再使用的 `ProjectList.tsx`

### 10:35 AI session 标题更直观

- 之前 tab 上显示 `0878093d` 这种 UUID 前缀，用户认不出在做什么
- 三层兜底：
  1. **首选**：tab.title — 拿首条用户消息的前 40 字（resume 历史时 ChatPanel 回放后自动抓取并 `onTitle` 回填；新会话首次发送时也回填）
  2. **次选**：openSessionTab 创建时给个时间戳 `Chat HH:MM` 作为默认 title，避免空白
  3. **兜底**：什么都没有就显示 "AI session"，不再露 UUID
- Server preview：从 4KB 头部扩到 64KB，全行扫描 `type=user` 取第一条 text（之前只看前 5 行，碰到 permission-mode / file-history-snapshot 等记录占满头部会拿不到）
- 用 `titleSetFromMsg` ref 防止重复回填，但允许默认时间戳被实际内容覆盖（默认时间戳是放在 tab.title 上的，ChatPanel 的 ref 独立追踪"是否已从消息派生过标题"）

### 10:25 TabBar 只显示当前 tab

- 用户反馈：上方横向 tab 列表没必要，多 tab 管理已经走 ⋮ 菜单
- 改为顶栏只显示 active tab（icon + 名字 + 关闭），其它 tab 全部在 ⋮ 菜单里访问
- 无 active tab 时显示 "No tab" 占位

### 10:20 修复 ⋮ 菜单不显示

- 现象：点 ⋮ 没反应。本质是 `.tab-bar`、`.panel`、`.app` 一路上都有 `overflow: hidden`，绝对定位的菜单往下展开被父级裁掉了
- 改用 `position: fixed`，按钮点击时 `getBoundingClientRect()` 计算 `top/right`，菜单脱离所有父级裁剪
- 顺手去掉 `.tab-bar` 的 `overflow: hidden`（多余的，tab-list 自己有 overflow-x: auto）

### 10:00 移动端友好化

- 实际使用场景是手机浏览器，桌面三栏布局在窄屏不可用
- 改成响应式：`@media (max-width: 768px)` 触发抽屉模式
  - Projects + Files 包在 `.drawer` 里，桌面 `display: contents` 不影响 grid，移动端变成左侧滑出
  - TabBar 在移动端显示 `☰` 按钮触发抽屉，桌面端隐藏
  - 点文件后自动关抽屉（节省一次操作）
- iOS Safari 输入框 font-size 必须 ≥ 16px 才不会 focus 时自动放大，textarea / input 改成 16px
- 触摸热区：tree-item / project-item / tab 内边距加大，tab-close 按钮放大到 16px / padding 2px 8px
- `100vh` 改成 `100dvh`（动态视口，避免 iOS Safari 底栏遮挡）
- `-webkit-tap-highlight-color: transparent` + `overscroll-behavior: none` 减少移动端杂讯
- Resume 历史的 `prompt()` 对话框在手机也能用，先不换 UI

### 09:45 Assistant 消息 markdown 渲染

- Claude 的 text 输出本来就是 markdown，之前当纯文本贴出去 → 看到 ``` 围栏、` 反引号、列表符号都是字面值
- 复用 Viewer 已有的 `react-markdown` + `remark-gfm` + `react-syntax-highlighter`，封一个 `MarkdownText` 给 `msg-assistant` 用
- CSS 微调：headings 缩小、`<pre>` 代码块更紧凑、保持气泡感
- user / system / tool 消息保持纯文本（user 一般不打 markdown，tool 已经按字段渲染了）

### 09:35 Tool 调用展示优化

- 之前每个 tool 消息把 `JSON.stringify(input, null, 2)` 整坨贴出来，遇到 Write/Edit 的 `content` 字段就是横向一长条（JSON 字符串里 `\n` 是转义符不会换行）
- 改成默认折叠 + 一行摘要（per-tool 类型决定显示哪个字段：file_path / command / pattern / url / ...）
- 展开后按字段分块：每个 key 一个标签 + 对应 `<pre>`；string 值直接走 pre-wrap，多行内容自然换行
- 每块 max-height + 滚动，避免巨大文件撑爆面板

### 09:15 Resume 后聊天历史回放

- 调查 JSONL 格式：每行一条记录，类型有 user/assistant/system/permission-mode/file-history-snapshot/queue-operation/last-prompt/attachment；只有 user/assistant 是用户可见的
- Server 新端点 `GET /api/projects/:id/sessions/:uuid/transcript` 返回过滤后的事件数组
- ChatPanel 重构：抽 `renderEvent(ev) → deltas[]` 纯函数 + `applyDeltas(prev, deltas)`，live 与 replay 复用
- tool_result 改用 `tool_use_id` 精确匹配（之前找"最近一个无 output 的 tool msg"，并发或乱序会错位）
- live 模式不会有 user 文本重复：claude 默认不 echo 用户消息（除非 `--replay-user-messages`，我们没开）
- 顺序：replay 完后才连 WS，新 session 的 system.init / "— resumed —" 标记自然落在历史之后，分界清楚
