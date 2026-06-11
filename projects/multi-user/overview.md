# 多用户 + 隔离

## 目标

让 remote-ide 支持多个有独立身份的用户登录使用，**用户级隔离 projects 列表、workspace（打开的 tab）和 settings**。文件系统、Claude session（`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`）、Devin session（`~/.local/share/devin/cli/sessions.db`）**保持全局共享** —— 同一路径下的 session 任何用户都能看到并 resume（不在本次需求范围内做过滤）。

## 设计决策（与用户对齐结果）

| 决策点 | 选择 |
|--------|------|
| 认证模型 | username + password（passwordHash 存 users.json） |
| 用户创建 | CLI 脚本 / 手动编辑 users.json（admin 模型，无 web 注册） |
| 隔离粒度 | projects 列表 + workspace 状态 + settings；**不隔离** session 内容 |
| Session 存储 | 保持现状（共享） |

## 非目标

- Web 端的用户管理界面
- 自助注册
- 用户权限分级（admin / member 等 role）
- Session 内容（jsonl / sqlite）按用户过滤
- OAuth / SSO
- 多机部署 / 分布式 session 存储