# Tasks — MVP

## 已完成

- ✅ 搭建 monorepo（pnpm workspace：server + web）
- ✅ Server FS API：`/api/fs/{list,file,stat}`，per-project 路径校验防越界，20MB 文件上限
- ✅ Server WebSocket `/ws/session`：spawn `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode bypassPermissions`，支持 `?resume=<uuid>`
- ✅ Server Project CRUD + Workspace 持久化（`~/.config/remote-ide/`）
- ✅ Server 枚举可 resume 的 claude 会话（扫 `~/.claude/projects/<encoded-cwd>/*.jsonl`，按 mtime 排序，附 preview）
- ✅ Web 三栏布局：Projects / Files / Main（TabBar + 内容）
- ✅ Web 项目侧栏：列表 / 添加（输入路径）/ 删除
- ✅ Web 文件树（懒加载子目录）
- ✅ Web Viewer：markdown / 代码（Prism vscDarkPlus）/ 图片 / PDF / video / audio / 纯文本
- ✅ Web Tab 系统：文件点击开 file tab、+ Session 开新会话、↻ Resume 选历史会话、关 tab 杀子进程
- ✅ Server-synced tabs：所有 tab 变更 PUT 到 `/api/workspace`（debounced 250ms），刷新/换设备恢复
- ✅ AI session 自动捕获 `system.init.session_id` → 写回 `tab.resumeId`，重启 server 后 tab 重连自动 `--resume`
- ✅ 修复 resumeId 触发 useEffect 重跑导致的双连接（用 ref 锁住 mount 时的 resumeId）
- ✅ 关闭 React StrictMode（避免 dev 模式双重 mount 造成多余的 claude 子进程）
- ✅ HTTPS 多域名部署：`allowedHosts` + `hmr.{protocol:'wss', clientPort:443}` 共用 location.host
- ✅ `.env` 自动加载（server 启动时手写迷你 dotenv，无第三方依赖）
- ✅ 共享密码鉴权（`REMOTE_IDE_PASSWORD` env，HttpOnly cookie session 30 天 TTL）
- ✅ 主题切换：dark / light / dim，CSS 变量 + data-theme，syntax highlighter 同步切换
- ✅ Tool 详情浮层：点 ⛶ 全屏看完整 input/output
- ✅ 图片输入：PC 粘贴 / 手机文件选择，base64 走 WS 转给 claude，历史 replay 也能显示
- ✅ 设置页：发送键可选 `cmd-enter` / `shift-enter` / `enter`，默认 cmd-enter，服务端持久化
- ✅ Server 共享 session（多 WS client 复用同一 claude 子进程，避免 JSONL 并发写坏）
- ✅ 外部 terminal 检测：fs.watch JSONL，发现非自身写入时推送 client 自动 refresh
- ✅ Tab 标题：AI session 加 ID 前缀；TabBar 桌面多 tab、移动单 tab
- ✅ Claude 启动加 `--dangerously-skip-permissions`
- ✅ 当前 tab 加刷新按钮（适用于文件查看与 AI session，跨设备同步用）
- ✅ PC 模式合并左侧两栏：Project 切换/管理收进 Files 标题的下拉选择器，左侧只占一列
- ✅ TabBar 溢出菜单：`⋮` 按钮替代两个文字按钮，下拉列出所有 tab 提供切换/关闭
- ✅ 移动端友好：抽屉式 Projects+Files、触摸热区放大、iOS 不缩放、`100dvh` 视口
- ✅ Assistant 消息 markdown 渲染（代码块带语法高亮）
- ✅ Tool 调用展示：默认折叠 + 一行摘要 + 展开后按字段渲染（string 值正确换行）
- ✅ Resume 后聊天面板回放历史消息
  - Server `GET /api/projects/:id/sessions/:uuid/transcript` 读 JSONL，过滤到 `user/assistant`
  - Client mount 时若有 resumeId 先 fetch 回放再连 WS
  - 抽出纯函数 `renderEvent(ev) → deltas[]` + `applyDeltas(prev, deltas) → next` 复用到 live / replay
  - tool_result 用 `tool_use_id` 精确匹配回填（不再靠"最近一个无 output 的 tool msg"）

## 已完成（续）

- ✅ WS 断开自动重连：指数退避（500ms → 10s），重连前 refetch transcript 同步状态，重连成功 toast 提示
- ✅ 字体大小设置：small / normal / large / xlarge，通过 `--font-scale` CSS 变量缩放阅读内容（消息、Viewer、tool 字段），不动 UI chrome 与输入框（避开 iOS focus zoom）
- ✅ 生产构建与部署
  - server 监听默认端口 5174 → 9991
  - server 注册 `@fastify/static` 托管 `../web/dist`，SPA fallback：非 `/api/*` 非 `/ws/*` 的 404 回退到 `index.html`
  - vite dev proxy 同步改成 9991（保留 dev 流程）
  - 单进程模型：API + WS + 静态 SPA 全部走 9991，反代直接指过去即可

## 已完成（续）

- ✅ launchd 守护：`~/Library/LaunchAgents/com.eric.remote-ide.plist`
  - 用户态 LaunchAgent（不是 LaunchDaemon），保留 `claude` CLI 的 `~/.claude` 凭据上下文
  - `RunAtLoad` + `KeepAlive` + `ThrottleInterval=5`（崩溃 5s 冷却）
  - 日志写 `~/Library/Logs/remote-ide.{log,err}`
  - 旧 `pnpm dev` 树已停（vite + tsx watch 全部退出）
- ✅ 反代决策记录：反代上游切到 `localhost:9991`，TLS 在反代终止，server 跑 HTTP；vite 部分（5173 + HMR wss）整条链路废弃

## 已完成（续）

- ✅ 刷新页面不再打断 AI 工作 + thinking 状态保留
  - server SessionEntry 加 `killTimer`，最后一个 client 断开后 30s grace 才 SIGTERM；任何 attach 取消 timer
  - server SessionEntry 加 `thinking`，user 输入时置 true，收到 `result` 事件置 false
  - `started` payload 带 `thinking` 字段；client 据此初始化 status
- ✅ 反代上游切到 9991（用户手动改完）

## 待办

（清空）
