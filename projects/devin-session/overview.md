# Devin AI Session 集成

## 目标

在 remote-ide 中加入 Devin 版本的 AI session 支持，让用户可以选择使用 Devin（通过 ACP 协议）或 Claude（通过 stream-json 协议）作为后端 agent。

## 接入方式

通过 `devin acp` 子命令以 ACP (Agent Client Protocol) 协议接入。ACP 是一个标准化的 JSON-RPC 2.0 over stdio 协议，专为 IDE/编辑器与 coding agent 之间的通信设计。

## 关键发现

- Devin CLI v2026.5.6 新增 `devin acp` 子命令，提供 JSON-RPC over stdio 的程序化接口
- ACP 是一个标准化协议（类似 LSP），有 TypeScript SDK (`@agentclientprotocol/sdk`)
- 协议支持流式输出（`session/update` notifications）、session resume、tool call 报告、mode 切换等
- 接入难度和现有 Claude stream-json 集成在同一量级
