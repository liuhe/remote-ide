# Claude Queue 状态可视化

> 状态：⛔ **暂停 / 未完成**，2026-05-24 尝试一轮后回滚（git HEAD = a941030）。

## 目标（原始）

复刻 claude code TUI 的 prompt queue UX：当 claude 正在 thinking 时用户追加输入，UI 要清晰显示

- 这条消息有没有被 claude 真正接收进队列
- 在队列里的位置（第几个）
- 何时被 claude 出队开始处理

claude code TUI 的实际行为（用户描述）：**未插入的消息堆在最下面的"等待区"，插入时跳到对话流里的真实位置**——视觉位置就直接告诉用户"插入到哪里"。

范围限定 Claude tab。Devin 单独立项。

## 已知不可行的路径

### ❌ Path A — Tail JSONL 拿 queue-operation 记录

老的 JSONL 里有 `queue-operation enqueue/dequeue` 记录，看似可以直接消费。**实测后发现**：

- **本机 claude v2.1.133 `-p --output-format stream-json` 模式根本不写 queue-operation 记录到 JSONL**
- 用户 session 早期有 12 条记录，全是早先用 claude code TUI 留下的——`-p` 模式不产生
- enqueue 记录在某些版本带 `content` 字段，新版本不带——content 匹配方案也不稳

### ❌ Path B — Server 自跟 `thinking` + `result` 事件代理

放弃 JSONL 改为：
- user 消息到达时若 thinking=true → push 到 `entry.pendingQueue`，广播 snapshot
- 收到 `result` event → pop head，broadcast queue_dequeued + 新 snapshot
- snapshot 携带完整 text+images，刷新页面能从 server 还原

**配合两段式 layout**：客户端把 `queue` 状态的 msg 抽出来挂到对话下方的"待发"区，出队时回到主对话流。

**实测仍然不行**，用户反馈 "还是不对"。具体什么不对没深挖就回滚了。怀疑点：

- claude 实际触发 `result` 的时机和我们假设的"轮结束"不完全一致（partial vs final）
- 多 client 场景或 race condition 没覆盖
- 视觉表现和 TUI 仍有差异

## 教训

1. **不要假设 JSONL 里的字段在所有模式下都会写**。同一份 JSONL 文件可被 TUI / `-p` 两种模式追加，字段差异巨大。要用 `-p` 模式跑一遍亲眼确认。
2. **stream-json stdout 才是 SDK 模式的 source of truth**，不要试图绕到 JSONL 去拿 protocol 层的信号。
3. **没把"用户期望的 UX"写够细就动工**。光说"显示是否插进去 + 位置"我以为靠 badge 就够，实际用户要的是 claude code TUI 的两段式 layout——这俩需求差距很大。下次先用语言或草图把目标 UX 复刻清楚。
4. **回滚比将就好**。改了 80+ 行只为这一个特性，发现不对就果断回 baseline，避免污染其它正常功能。

## 如果重启，建议

- 先去翻 claude code 开源版（如果有）或抓 TUI 实际的状态机：什么时候是 "queued"、什么时候 "inserted"
- 找到一个 claude 自己暴露的、可靠的 in-flight 信号（也许是某个 stream_event subtype，需要详查）
- UX 先做静态 mock 让用户确认效果再写代码
