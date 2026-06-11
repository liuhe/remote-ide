# Claude 会话回溯（Rewind）

## 目标

让用户在 Claude tab 里选某条历史 user 消息，修改后重发，丢弃后续所有轮（assistant/tool/user 全部）。等价于"重写历史那一刻的提问"。

范围限定在 Claude（stream-json）端；Devin 用的是 ACP，单独立项再做。

## 关键决策

- **语义**：edit-and-resend。选中 user 消息 → 改文本 → Send。后续轮从 JSONL **物理删除**，不保留分支。
- **文件回滚**：跟着 rewind 一起还原。Claude 自己在 JSONL 里写 `file-history-snapshot` 记录（含 `trackedFileBackups: { 路径 → { backupFileName, backupTime, version } }`），实际备份在 `~/.claude/file-history/`。我们要把 rewind 点之后被 claude 改过的文件全部回写到 rewind 点的版本。
- **触发 UX**：每条 user 气泡角落始终可见的小 ✎ 图标，触屏 hit area ≥ 28×28。点击把气泡变 textarea + Send / Cancel 按钮。
- **范围**：只 Claude tab。Devin 后续单独项目。

## 不解决

- 多分支可视化（用户不想要）
- 编辑 assistant / tool 消息
- 撤销 rewind（删了就没了，与用户对齐）
- **未 track 的文件变更**：claude 在 tool_use 之外（例如用户手动改）的修改不在 `trackedFileBackups` 里，rewind 不会动它们。

## 实现路径（已定型）

1. **文件回滚**：`claude --resume <sid> --rewind-files <U.uuid>` 一次性子进程（claude 自己处理备份还原逻辑）
2. **JSONL 截断**：服务端读 JSONL，定位 `uuid == U` 的那一行，物理 truncate 到该行之前（U 本身一起删）
3. **重发**：先 kill 当前 session 的活跃 claude 子进程，再 spawn `claude --resume <sid>`，把编辑后的 user 消息 stdin 送入

理由：纯 claude 控制协议没找到原生 rewind 入口（不像 `/rewind` 给 TUI 用）；`--rewind-files` 只动文件不动 JSONL；`--resume-session-at` 只控内存不动磁盘，配合后续写入会留孤儿尾巴。

## 并发与边界

- rewind 期间，session 上活跃 claude 子进程必须先 interrupt + 退出，避免它继续写 JSONL 污染截断点
- 同 session 多 WS 客户端：rewind 中其他客户端要 freeze 提交，rewind 完成后广播让他们 refetchTranscript
- 编辑 session 第一条 user 消息：等价于清空整个 session — 用户已明确要这种行为，不做额外确认
