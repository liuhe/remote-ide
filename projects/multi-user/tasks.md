# 多用户 — 任务列表

> 状态：`🔘` 待办 `🚀` 进行中 `✅` 完成。

## Phase 0：与用户确认 design

- 🔘 用户 review `design.md`，确认或调整

## Phase 1：CLI 工具

- 🔘 `server/src/cli/adduser.ts`
  - 读 name 参数 + 提示输入 password（关 echo）
  - 用 `crypto.scrypt` 生成 salt + hash
  - 追加到 `users.json`（重名检测）
- 🔘 `server/package.json` 加 `adduser` script

## Phase 2：store 层重构

- 🔘 引入 `User` 类型 + `users.json` 读写
- 🔘 `listProjects(uid)` / `addProject(uid, ...)` / `getProject(uid, id)` / `deleteProject(uid, id)`
- 🔘 `getWorkspace(uid)` / `putWorkspace(uid, ws)`
- 🔘 `getSettings(uid)` / `putSettings(uid, s)`
- 🔘 路径函数：`userDir(uid)` / `userFile(uid, name)`

## Phase 3：迁移逻辑

- 🔘 启动时检测 `users.json` 不存在 + 旧 projects.json 存在
- 🔘 创建默认 user（name=admin，password 来自 `REMOTE_IDE_PASSWORD` env）
- 🔘 搬运旧文件到 `users/<default-id>/`
- 🔘 log 一次迁移完成

## Phase 4：auth.ts 重构

- 🔘 cookie token 服务端 in-memory map → userId
- 🔘 `POST /api/auth/login` body 加 username，校验 username + scrypt(password)
- 🔘 `GET /api/auth/status` 返回 username（便于 UI 显示）
- 🔘 middleware: 拿 cookie → userId 挂到 req

## Phase 5：route 层加 userId

- 🔘 `projects.ts` 所有 route 用 req 上的 userId
- 🔘 `/api/projects/:id/...` 加属主校验
- 🔘 `session.ts` (Claude) / `devin.ts` WS 路由加 userId 校验

## Phase 6：前端

- 🔘 `Login.tsx` 加 username 输入框
- 🔘 错误提示统一 "Invalid credentials"
- 🔘 可选：标题栏 / settings 显示当前 username + 注销按钮（如还没的话）

## Phase 7：测试

- 🔘 启动时迁移：现有 .env REMOTE_IDE_PASSWORD 登录走通
- 🔘 `pnpm --filter server adduser bob` 添加新用户、可登录
- 🔘 两个用户分别登录看到独立 projects 列表
- 🔘 两个用户同时添加同一路径作为 project，互不影响，但 session list 互通可 resume
- 🔘 settings / workspace 隔离验证