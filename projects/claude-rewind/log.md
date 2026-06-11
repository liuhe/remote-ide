# Claude Rewind — 工作日志

> 格式：`YYYY-MM-DD HH:MM` + 内容。成功不加说明，失败要写原因。

## 2026-05-24 — Phase 0 调研

确认 rewind 是 claude code 自带功能。CLI 有隐藏 flag：

- `--rewind-files <user-message-id>` — 把文件还原到该 user 消息时的状态，跑完就退；要求 `--resume`，不能配 prompt
- `--resume-session-at <message id>` — 内存层面限定历史到某 assistant 消息为止，磁盘 JSONL 不动

JSONL 记录字段：`uuid` / `parentUuid` 构成树；`file-history-snapshot` 类型记录里 `trackedFileBackups: { 路径 → { backupFileName, backupTime, version } }`，备份实际在 `~/.claude/file-history/`。

binary string `Rewinding does not affect files edited manually or via bash.` — 只回滚 claude 自己改过的文件。

**实现路径定型（B+claude 原生）**：

1. **文件回滚** — `claude --resume <sid> --rewind-files <U.uuid>` 一次性子进程。
2. **JSONL 截断** — 服务端读文件、定位 uuid==U 的行，物理 truncate 到该行之前（包括 U 本身一起删）。`--resume-session-at` 不用，避免磁盘 / 内存不一致。
3. **重发** — 先 kill 当前活跃 claude，再 spawn `--resume <sid>`，把编辑后的 user 消息 stdin 送入。

## 2026-05-24 — Phase 1+2 完成

服务端 `POST /api/projects/:id/sessions/:sid/rewind` 走通，401/409 错误码就位。前端 ChatPanel：

- 加 `uuid?: string` 到 user Msg，从 `ev.uuid` 提
- 用户气泡右上角 28×28 ✎ 按钮（仅 uuid 存在时显示）
- inline textarea + Cancel/Resend；原图片自动随新文本一起发
- WS 收 `{type:'rewind'}` → 清 msgs → refetchTranscript

**已知局限**：刚发出的 user 消息从 WS 优化路径 append 进来时没 uuid（claude 不 echo），✎ 不会出现，要等下次 refetch（刷新 / reconnect）才能编辑。要彻底解决得加 `--replay-user-messages` 到 spawnClaude，但要先去掉服务端的乐观广播避免重复——v1 先不做。

## 2026-05-24 — checkpointing feature gate（关键发现）

第一次实测 rewind 报 `File rewinding is not enabled`。逆向二进制找到 gate：

```js
function OO() {                               // checkpoint gate
  if (RA()) return false;                     // RA: workspace==="remote" → 强制关
  if (NA()) return xv4();                     // NA: !isInteractive → 走 xv4
  return _5("fileCheckpointingEnabled", true).value
      && !env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING;
}
function xv4() {
  return !!env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING
      && !env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING;
}
```

我们用 `claude -p`（非交互）→ `NA()=true` → 走 `xv4()` → 要看 **env var**，跟 `fileCheckpointingEnabled` settings.json 完全无关。

修复：spawnClaude / runRewindFiles 的 env 注入 `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`。实测后报错变成 `No file checkpoint found for this message`——对老 turn 而言意料之中，新 turn 启动时已带 env，会写 snapshot 可正常回滚。

**额外失败恢复**：rewind 任一步骤失败要重 spawn claude proc，否则 entry 死进程引用残留，session 卡死。已加 `recoverWithoutRewind` 路径。

待人工验证：浏览器发一条新消息，让 claude 改文件，再 rewind 那条新消息。
