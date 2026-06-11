# Claude Rewind — 任务列表

> 状态：🔘 待办 🚀 进行中 ✅ 完成

## Phase 0 — 调研

- ✅ 找到 claude CLI 隐藏 flag `--rewind-files <uuid>`（要 --resume，单次操作）
- ✅ 确认 JSONL 树结构 + file-history-snapshot 机制
- ✅ 定型实现路径：claude 原生回滚文件 + 服务端 truncate JSONL + 重 spawn

## Phase 1 — 服务端

- ✅ 新接口 `POST /api/projects/:id/sessions/:sid/rewind` body=`{ messageUuid, newText, images? }`
- ✅ 实现：interrupt+SIGTERM 老 proc → 跑 `--rewind-files` → truncate JSONL → 重 spawn + 写新 user 消息
- ✅ 广播 `{type:'rewind'}` 给所有 WS 客户端
- ✅ 错误路径：messageUuid 不在 JSONL / 不是 user 类型 / 没有活跃 entry → 400/409

## Phase 2 — 前端

- ✅ ChatPanel 每条 user 气泡角落加 ✎ 图标（28×28 触屏友好），点击展开 inline 编辑
- ✅ 编辑态：textarea + Resend / Cancel；保留原图片自动随新文本一并发送
- ✅ Send → POST rewind；收到 broadcast `rewind` 后清空 msgs → refetchTranscript
- ✅ 失败 toast，编辑器保持开着
- ⚠️ 局限：刚发出的 user 消息（无 JSONL uuid）暂时没法编辑 → 下次 refetch / 重 attach 后才能编辑

## Phase 3 — 联调与边界

- 🔘 rewind 时 claude 正在 thinking → interrupt + SIGTERM + 重 spawn 链路走通
- 🔘 多 client 同时观察一个 session：一端发 rewind，另一端的 UI 也得正确刷新
- 🔘 rewind 第一条 user 消息：JSONL 被清空到只剩头部 housekeeping，确认 claude --resume 还能起来；否则改为拒绝
- 🔘 编辑空文本 / 仅 whitespace → 客户端拒绝（不发请求）
