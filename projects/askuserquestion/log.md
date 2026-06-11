# askuserquestion 日志

## 2026-06-07 — 首次尝试，因 CLI 层阻塞 revert

实现了一版前端 + server 改动：

- `web/src/components/ChatPanel.tsx` 加 `AskUserQuestionForm`（单/多选共用 `Set<string>`，每题带 Other 自由文本），在 `m.name === 'AskUserQuestion' && m.output === undefined` 时挂载。
- `server/src/session.ts` 加 `type:'tool_answer'` 分支，合成 `tool_result` block 按 claude CLI 的训练格式 `"<q>"="<a>"; …` 拼接，broadcast + stdin 喂回 CLI。
- `web/src/styles.css` 加 `.ask-form` 系列样式。

浏览器实测**表单根本不渲染**，工具消息直接显示 `OUTPUT: Answer questions?` 走折叠态。

**根因排查**：grep 全仓 "Answer questions" 零匹配，确认不是自己代码。翻 chargable-proxy session 5a5e6d7c 的 jsonl，看到：

```
09:20:42.877  assistant  tool_use     AskUserQuestion  id=toolu_01FCB…
09:20:42.878  user       tool_result  content="Answer questions?"  is_error=true  tool_use_id=toolu_01FCB…
                                       toolUseResult="Error: Answer questions?"
```

1ms 间隔——是 claude CLI 自己塞的 stub。version 2.1.149 在 `-p --input-format stream-json` 模式下对 AskUserQuestion 的设计兜底：没有 SDK harness 接管就立刻 error 关闭，让模型继续。session 末尾模型生成的"看来你没回答 T0 的三个决策。我先暂停…"就是模型读到 `Error: Answer questions?` 后自然反应。

**自验证**：我自己调用 AskUserQuestion 工具想让用户选 A/B/C，也吃了一模一样的 `Answer questions?` 错误回包——双重佐证。

**结论**：纯 host-side 改不动。CLI 已经关闭 tool_use，前端再 render 表单也没人在等回包；就算把 stub 隐藏掉，模型已经基于 error 生成了下一轮文本，race 兜不住。三条修复路径见 overview.md，未决。

revert 命令：

```bash
git checkout HEAD -- server/src/session.ts web/src/components/ChatPanel.tsx web/src/styles.css
```

（注意 `server/src/devin.ts` 和 `projects/devin-session/log.md` 不在 revert 范围——那是 5/27 修 Devin CLI 2026.5.26-0 breaking change 的独立工作。）

## 2026-06-07 — 同日采纳 C 方案：屏蔽 AskUserQuestion

revert 后立刻上 C 方案：`server/src/session.ts` 的 `spawnClaude` args 加 `--disallowedTools AskUserQuestion`，让 CLI 完全不暴露这个工具，模型自动退化为 markdown 列选项 + 用户文字回复。零交互改动，避开 stub race。

代价：失去结构化选项 UI。可接受——overview.md 里 A/B 两条路径以后想做仍可做，C 只是把"模型直接报 error 然后误以为用户拒答"的体验先消掉。

