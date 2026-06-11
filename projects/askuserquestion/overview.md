# askuserquestion — AskUserQuestion 前端表单支持

## 目标

让 Claude 调用内置 `AskUserQuestion` 工具时，浏览器渲染交互式表单（单/多选 + Other 自由文本），用户提交后把答案以 `tool_result` 形式喂回 Claude，体验对齐 Claude Code 桌面端。

## 现状

**已暂停。2026-06-07 首次尝试 revert，原因是触达 CLI 层阻塞，host-side 改不动。**

根因：本仓库 server 用 `spawn('claude', ['-p', '--input-format', 'stream-json', ...])` 跑裸 CLI 二进制（version 2.1.149）。该模式下 CLI 对 `AskUserQuestion` 的处理是：tool_use 发出后 ~1ms 内 CLI **自己** 在 stdout 塞一条 `{ tool_result, content: "Answer questions?", is_error: true }`，立刻关闭这个 tool_use 让模型继续推理。前端表单还没来得及挂载，`m.output` 已经被 stub 填了，渲染条件 `output === undefined` 永远不成立。session jsonl 里能直接看到这一对 1ms 间隔的记录。

这是 CLI 设计行为：AskUserQuestion 是 SDK 内置工具，正确接管路径在 `@anthropic-ai/claude-agent-sdk` 的 `canUseTool` callback；裸 CLI 二进制没有暴露这个 hook，stub 是兜底防止对话卡死。

## 已知修复路径（三选一，未决）

- **A. 拦 stub + interrupt + 答案改投 user/text**：server 解析 stdout 时识别 AskUserQuestion 的 stub tool_result 丢弃不广播；同时发 `control_request: interrupt` 切掉 CLI 后续推理；用户提交后用普通 `user/text` 喂回答案（tool_use_id 已 errored 不能复用）。改动小但有 race（interrupt 可能晚于模型出 token），且 CLI 历史里永久留一条 `Error: Answer questions?`。
- **B. 切换到 `@anthropic-ai/claude-agent-sdk` Node API**：放弃 spawn 二进制，改 SDK runtime 并注册 `canUseTool` callback 真正接管。最干净，但 `server/src/session.ts` 整体 refactor，stream-json/control_request/--resume/checkpoint/--dangerously-skip-permissions 都要在 SDK 层重新对齐。Weekend-scale。
- **C. 放弃工具，让模型走文本提问**：`--disallowedTools AskUserQuestion` 屏蔽，模型自动退化为 markdown 选项 + 用户文字回复。零工程代价，失去结构化 UI。

下次启动这个项目时直接看 [log.md](log.md) 里 2026-06-07 的根因记录，不要再从前端排查。
