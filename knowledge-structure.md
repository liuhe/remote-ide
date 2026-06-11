# remote-ide 知识库结构

> 本工程的目录组织方式。新增/修改任何目录需先与用户确认。修改本文件也需先确认。

## 顶级目录

- `server/` — 后端服务（pnpm workspace 子包）【建议，待用户确认】
- `web/` — 前端应用（pnpm workspace 子包）【建议，待用户确认】
- `docs/modeling/` — DCDDP 系统建模模型（启用 system-modeling 后使用，按需创建）
- `projects/` — 项目模式 initiative 容器（按需创建）

## 顶级文件

- `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` — pnpm workspace 根配置
- `CLAUDE.md` — AI 协作契约
- `knowledge-structure.md` — 本文件

## projects/<name>/ 文件约定（若使用项目模式）

- `overview.md` — 项目目标
- `tasks.md` — 任务列表
- `log.md` — 日志
- `design.md` — 设计（可选）
