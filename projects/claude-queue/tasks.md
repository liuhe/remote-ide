# Claude Queue — 任务列表

> 状态：⛔ 整个项目暂停。下面所有 🔘 都是"理论上要做"但未完成、且当前方案路径已被证伪的待办。

## Phase 0 — 重新调研（重启时必做）

- 🔘 抓 claude code TUI 实际队列状态机：未插入 vs 已插入的 UX 细节、转换时机
- 🔘 在 `-p stream-json` 模式下找一个可靠的 in-flight 信号源（stdout 上的 stream_event、control_response、或别的）
- 🔘 用静态 mock 把 UX 给用户确认（避免又一次实现完才发现不对）

## Phase 1 — 服务端（路径未定）

- 🔘 队列状态追踪机制（不再走 JSONL tail）
- 🔘 broadcast 到 client，含完整 text+images 便于刷新还原

## Phase 2 — 前端（路径未定）

- 🔘 layout：是用 inline badge 还是两段式 queue zone，等 UX mock 定下来再说

## 已经证伪 / 不要再走

- ❌ Tail `queue-operation` JSONL 记录 — `-p` 模式不写
- ❌ 仅靠 `entry.thinking + result` 代理 + 两段式 layout — 实测仍不对（具体原因未深挖）
