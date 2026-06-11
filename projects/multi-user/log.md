# 多用户 — 工作日志

> 格式：`YYYY-MM-DD HH:MM` + 内容。

## 2026-05-18 23:00

- 新 initiative 启动：在 remote-ide 加多用户支持，做 projects / workspace / settings 三处隔离
- 与用户对齐决策：
  - 认证：username + password（scrypt hash）
  - 用户创建：CLI / 手动编辑 users.json
  - 隔离粒度：projects + workspace + settings；session 内容（jsonl / sqlite）保持共享
- 写好 overview.md / design.md / tasks.md，等待用户 review design 后开 Phase 1

## 2026-05-18 23:15

用户确认 3 个设计点：
- Cookie token 持久化到 `~/.config/remote-ide/sessions.json`（launchd 重启不掉线）
- 迁移默认 user name = `eric`
- 登录失败不区分"用户不存在"和"密码错误"，统一 "Invalid credentials"（防 user enum）

进入 Phase 1：CLI adduser。

## 2026-05-18 23:45 — Phase 1–6 落地

一波打完：

- **Phase 1**: `server/src/users.ts`（scrypt + users.json 增删查）+ `server/src/cli/adduser.ts`（raw-mode stdin 关 echo）+ `package.json` 加 `adduser` script
- **Phase 2**: store.ts 全部 `*(uid, ...)` 化；新增 `migrateLegacyIfNeeded()`
- **Phase 3**: 启动迁移：旧 `projects.json` / `workspace.json` / `settings.json` 搬到 `users/<uid>/`，默认 user name=`eric`，密码用 `REMOTE_IDE_PASSWORD`。会在没旧文件 or 已有 users.json 时 noop
- **Phase 4**: auth.ts 重写。`SessionRecord = { userId, expiresAt }`，60 天过期，持久化到 `sessions.json`（节流写盘 250ms 防抖）；旧的纯 `token → expiresAt` 格式 silent 丢弃。`getUserId(req)` 暴露给 route 层
- **Phase 5**: projects.ts / session.ts / devin.ts / fs.ts 全部 `getProject(uid, id)`
- **Phase 6**: Login.tsx 加 username 字段，错误统一 "Invalid credentials"。api.ts `login(username, password)` 签名变

注意点：
- **scrypt 默认 maxmem = 32MB**，`N=2^15 r=8` 算下来正好 32MB 超界（Node 26 抛 ERR_CRYPTO_INVALID_SCRYPT_PARAMS）。改 `N=2^14`（~25ms verify、~16MB 内存），无需 maxmem 配置
- 迁移要求 `REMOTE_IDE_PASSWORD` 长度 ≥ 6，否则 throw 不动数据（避免被锁死）
- 旧 cookie token 一律 invalidated（数据格式变了），已登录用户需重登

## 2026-05-18 23:55 — 冒烟通过

- eric 账号迁移成功，登录正常，4 个原 project 全保留
- 新建 user phoebe（password 一次性给到用户）— 登录看到空 project 列表，符合预期
- Settings 加 Sign out 按钮 + Saved ✓ 闪烁反馈
- 配套 polish：
  - DevinPanel 默认 model：response 里的 configOptions 总是同步（修了切模型 UI 不刷新）
  - FileTree 自动刷新（3s 轮询根 + 已展开目录，state 提升到顶层后保留展开状态）
  - 字体增加 2 档（huge 1.65x / xhuge 2.0x）
  - ProjectPicker 的 X 对齐到最右（SessionPicker 的 picker-item class 重命名加 `session-` 前缀解决 CSS 冲突）
- 已知未解决（间歇性）：刷新页面后第一个 Devin tab 偶尔不显示历史 —— 怀疑是 spawn 分支 vs attach 分支的时序窗口。下次必现时抓 console + WS frame 再定位