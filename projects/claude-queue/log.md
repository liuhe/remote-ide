# Claude Queue — 工作日志

> 格式：`YYYY-MM-DD HH:MM` + 内容。

## 2026-05-24 — 第一轮尝试 + 全回滚

实测确认 claude `-p --output-format stream-json` **不发**任何 queue 相关事件到 stdout（只见 system/assistant/result/stream_event/rate_limit_event）。

**Path A（tail JSONL queue-operation）**：写完代码后发现，本机 v2.1.133 在 `-p` 模式下根本不向 JSONL 写 queue-operation 记录。用户 session 里早期 12 条都是 TUI 时代留下的。tail 方案完全空跑。

**Path B（server thinking + result 代理 + 两段式 layout）**：
- entry.pendingQueue 维护服务端 mirror
- user 消息到达且 thinking=true → 入队 + broadcast snapshot（含 text/images）
- 收到 `result` event → pop head + broadcast queue_dequeued + 新 snapshot
- 客户端按 `queue` 字段把 msg 抽到"待发"区，出队后回到主对话流
- 实测用户反馈"还是不对"，未定位具体原因前用户决定暂停

**回滚**：`git checkout -- server/src/session.ts web/src/components/ChatPanel.tsx web/src/styles.css` + `rm -rf projects/claude-queue/`，HEAD 回到 `a941030`，服务重启验证 health 200。

## 关键事实记录（重启时直接复用）

- claude `-p stream-json` 输出的 event types（用户实测）：`system / assistant / result / stream_event / rate_limit_event`
- `--replay-user-messages` flag 可让 claude 把 user 消息从 stdin 回显到 stdout（默认关）
- claude 二进制（v2.1.133）内 `--rewind-files <uuid>` 隐藏 flag 可用（仅供参考，本项目不需要）
- file checkpointing 在 `-p` 模式靠 `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` env var 开启，跟 settings.json 无关（已记在 claude-rewind/log.md）
