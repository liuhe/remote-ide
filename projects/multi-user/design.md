# 多用户 — 设计方案

## 存储布局

```
~/.config/remote-ide/
├── users.json                # [{ id, name, passwordHash, salt, createdAt }]
└── users/
    └── <user-id>/
        ├── projects.json     # 之前的全局 projects.json
        ├── workspace.json    # 之前的全局 workspace.json
        └── settings.json     # 之前的全局 settings.json
```

`users.json` 示例：
```json
[
  {
    "id": "a8f3e2b1-...",
    "name": "eric",
    "passwordHash": "<scrypt hash hex>",
    "salt": "<random hex>",
    "createdAt": 1779100000000
  }
]
```

- `id` 是 UUID，cookie 里只放 id，name 用作登录输入和显示
- `name` 唯一约束（CLI 加用户时校验）
- `passwordHash` 用 Node 内置 `crypto.scrypt`（不引入 bcrypt 依赖）：cost 参数固定（N=2^15, r=8, p=1），32 字节输出

## 认证流程

### 登录

```
POST /api/auth/login
Body: { username: "eric", password: "..." }
```

1. 找 users.json 里 name 匹配的 user
2. `scrypt(password, salt) === passwordHash` ? 验证通过
3. 同当前 cookie 流程：set cookie `ride_session=<random-token>`，token 服务端 in-memory map → userId
4. 失败返 401

### 验证

每个请求 / WS 连接进来，中间件读 cookie → token → userId。把 userId 挂到 req.user。任何 store / route 操作都拿 userId 作 key。

### 登出

清 cookie + 从 in-memory token map 删除。

### Cookie 设计

- 沿用现有 cookie 名 `ride_session`，值改为 32 字节 hex token
- 服务端 token → userId 映射**持久化**到 `~/.config/remote-ide/sessions.json`
  - 形状：`{ "<token>": { userId, createdAt, lastSeenAt } }`
  - 启动时加载到 in-memory Map；每次成功认证更新 lastSeenAt 并节流写盘（≥30s 间隔，避免高频 IO）
  - 启动时顺手清理 60 天没活动的 token
  - 写法：tmp + rename 原子化，复用 `writeJson` helper
- launchd 偶尔重启服务时，已登录用户不掉线

## 路由改动

### Auth 路由

- `POST /api/auth/login` — body 加 `username` 字段
- `GET /api/auth/status` — 返回 `{ required, authenticated, userName? }`
- `POST /api/auth/logout` — 不变

### 业务路由（全部加 userId 维度）

所有读 / 写 projects.json / workspace.json / settings.json 的地方都加 userId：

- `GET /api/projects` → 读 `users/<uid>/projects.json`
- `POST /api/projects` → 写 `users/<uid>/projects.json`
- `DELETE /api/projects/:id` → 同上
- `GET /api/projects/:id/...` → **先校验 project 属于 uid**，再走原逻辑
- `GET /api/workspace` / `PUT /api/workspace` → 用户级
- `GET /api/settings` / `PUT /api/settings` → 用户级

### WS 路由

- `/ws/session?project=<id>` — 拿 userId，校验 project 属于该 userId，再走原逻辑
- `/ws/devin?project=<id>` — 同上

注意：因为 Claude / Devin session 内容是全局共享的，不同用户在同一 cwd 下能看到彼此的 sessionId 并 resume —— 这是需求。`/api/projects/:id/sessions` 和 `/api/projects/:id/devin-sessions` 的实现不变（只校验 project 属于当前 user）。

## store.ts 改动

- 引入 `getCurrentUser(req)` helper
- 现有 `listProjects()` / `addProject()` / `getProject()` / `getWorkspace()` / `putWorkspace()` / `getSettings()` / `putSettings()` 全部加 `userId` 参数
- 文件路径从 `PROJECTS_FILE` 变成 `usersDir(uid)/projects.json` 函数

## 迁移

启动时检测：
- 如果 `users.json` 不存在但旧的 `projects.json` 在：
  - 创建一个默认 user，name=`eric`，password 来自 `REMOTE_IDE_PASSWORD` env var（兼容现有部署）
  - 把旧的 `projects.json` / `workspace.json` / `settings.json` 搬到 `users/<default-id>/` 下
  - 在日志里 print 一次"Migrated single-user state → multi-user"
- 如果 `users.json` 不存在且没有旧文件：
  - 提示用户跑 `pnpm --filter server adduser <name>` 创建第一个用户

## CLI 工具

新文件 `server/src/cli/adduser.ts`：
```bash
pnpm --filter server adduser <name>
# 提示输入密码（不回显）
# 写入 users.json
```

`server/package.json` 加 script: `"adduser": "tsx src/cli/adduser.ts"`

可选后续：`removeuser <name>`、`passwd <name>`。

## 登录 UI 改动

`web/src/components/Login.tsx`：
- 加 username 输入框
- 错误提示按响应区分（"User not found" 还是 "Wrong password"）—— 还是统一返 "Invalid credentials" 避免 enum 攻击

## 安全注意

1. scrypt 是 CPU-bound，注意如果有人对 /api/auth/login 做暴力枚举，每次 ~50ms 验证。需要简单的 rate limit（每 IP 每分钟最多 N 次失败）。后续可加，不在本期。
2. cookie 必须 `httpOnly: true`，已经是。
3. password 错误不区分 "user not found" 和 "wrong password"
4. password 不进 log
5. CLI 工具读 password 时用 `process.stdin` raw mode 关 echo

## 不在本期

- Web 端的 user 管理 UI
- 改 cookie 为 JWT
- 持久化 session token（重启不掉线）
- rate limit
- audit log（谁在什么时候做了什么）