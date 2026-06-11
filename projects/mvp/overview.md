# remote-ide — MVP

## 目标

通过浏览器远程访问一台机器，完成两件事：

- 浏览/查看该机器上的文件（多种类型直观渲染：markdown、代码高亮、图片、PDF、音视频）
- 在指定目录下与 Claude Code 对话（开启新会话或 resume 历史会话）

## 范围（MVP）

- 多 Project：每个 project = 一个目录
- 每个 project 内可开多个 Tab（File / AI Session），tabs 由 server 持久化（跨设备一致）
- AI Session 通过 spawn `claude` CLI 子进程实现，stream-json 双向流
- Session 自动捕获 claude `session_id` 写回 `tab.resumeId`，重启 server / 换设备 / 关 tab 重开都能 resume

## 非目标（MVP 不做）

- 编辑文件（只读）
- 多用户隔离

## 鉴权

- 默认无鉴权（启动时未设密码即信任所有请求，仅本机/内网用）
- 设置 `REMOTE_IDE_PASSWORD=<密码>` 启动后，所有 `/api/*` 和 `/ws/*` 需要 HttpOnly cookie session
- 登录页：前端启动会拉 `/api/auth/status`，若 `required && !authenticated` 渲染登录页
- session 持久化在 `~/.config/remote-ide/sessions.json`，TTL 30 天，server 重启不丢

## 使用场景

- 主要从**手机浏览器**访问（通过局域网 IP 或 DDNS / 隧道）。布局以移动端为基线，桌面用三栏展开。

## 技术栈

- Server：Node + Fastify + `@fastify/websocket`，TypeScript via tsx
- Web：React 19 + Vite + TypeScript，`react-markdown` + `react-syntax-highlighter`
- 配置存储：`~/.config/remote-ide/{projects,workspace}.json`（手动可读写的 JSON）

## 关键模型

```
Project ──< Tab
  id           id
  name         type: 'file' | 'session'
  path         path (file) | resumeId (session)
```

- Workspace 状态：`{ projects: { [projectId]: { tabs, activeTabId } }, activeProjectId }`
- 关 Tab = 杀对应 WS 的 claude 子进程
- claude 自己把每个会话写到 `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`，这是事实来源

## 端口

- Web (Vite dev)：5173，绑 `0.0.0.0`
- Server：5174，绑 `0.0.0.0`，`/api` 与 `/ws` 经 Vite 代理
