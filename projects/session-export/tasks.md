# session-export 任务

## T1 调研现状 ✅

- 两个 Panel 的 `Msg` 类型已读完 → 见 `design.md` 的"两类会话的消息结构"段
- 渲染栈：`react-markdown` + `remark-gfm` + `react-syntax-highlighter`（Prism）
- 工程是 pnpm workspaces，`web` 目录独立 package
- 设计文档 `design.md` 已落地

## T2 引入依赖 ✅

- 加入 `html-to-image` (^1.11.13) + `jspdf` (^4.2.1)
- vite build 通过；bundle 增加 ~250KB gz（含 jspdf 间接拖入的 html2canvas）

## T3 Markdown 导出 ✅

- `lib/export/toMarkdown.ts` 落地，用户/助手/思考/系统/工具五种角色都有规则
- 工具调用 `input` 用 JSON code-fence，避免与内容里的 ``` 撞车
- 用户消息图片默认嵌入 base64

## T4 PDF / PNG 导出 ✅

- `components/ExportView.tsx` 离屏渲染（fixed + left:-100000，复用 .msg 系列 class 保证视觉一致）
- `lib/export/toImage.ts` 用 html-to-image 出 PNG dataURL；等 fonts + img.complete + 一帧 rAF
- `lib/export/toPdf.ts` 把长 PNG 按 A4 切片塞进 jsPDF
- 工具调用强制 open，代码块 white-space: pre-wrap

## T5 区间选择 UI ✅

- 对话框内两个 select（From / To）默认整段
- 自动按数值排序 min/max → slice

## T6 入口 UI 与对话框 ✅

- `chat-status` 加 ⤓ 按钮（两个 Panel 共用 class `.chat-status-export`）
- `ExportDialog` 提供格式 + 区间 + 错误展示 + busy 态

## T7 联调与边界 ✅

- Claude × Markdown 通过
- Claude × PDF / PNG 在浏览器端遇浏览器 canvas 高度上限（用户实测会话 29394px × pixelRatio 2 = 58788px，超 Chrome 32767 上限），输出空白
- **决策（2026-05-30）**：放弃纯前端 canvas 路线，PDF/PNG 改走 server 端 puppeteer-core + 系统 Chrome 渲染。Markdown 仍在前端。

## T8 服务端导出（PDF/PNG）✅

- 引入 `puppeteer-core@25.1.0`
- `server/src/export.ts` 单例 browser + CSS mtime 缓存
- `server/src/export-routes.ts` `POST /api/projects/:id/export`，bodyLimit 64MB
- Chrome 路径：`CHROME_EXECUTABLE` → macOS 默认 → Linux 常见
- 前端 ExportDialog 改 fetch POST → blob 下载

## T9 清理 ✅

- 删 `web/src/lib/export/{toImage,toPdf}.ts`
- 卸 `html-to-image`、`jspdf`（bundle 1490 KB → 1084 KB）
- 删 v3/v4、console.log、Preview 勾选、debug 行、inheritRootCssVars
- ExportView dashed border 已撤

## T10 实测 ✅

- Markdown / PDF / PNG 三路径用户实测通过
- 路上踩坑：装 sharp 触发 pnpm v11 build-script 护栏 → 配 `allowBuilds`
- 渲染 30K+px 页面 → Chrome target closed → 改 scrolling-viewport + fresh browser + headless flags
- 末段缺失 → `scrollTo` 钳位，必须读 `window.scrollY`
- 文字模糊 → `deviceScaleFactor: 2`

## T11 知识沉淀 ✅

- CLAUDE.md 加入：web 改完必 rebuild、server 用 launchctl 重启、新增 native build script 依赖必加 `allowBuilds`
- 项目 log 里沉淀了：scrolling-viewport 拼图、`scrollTo` 钳位、dsf 坐标系、puppeteer 内部 reject 不挂进程等通用经验
