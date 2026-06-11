# session-export

## 目标

为 Claude 会话（`ChatPanel`）和 Devin 会话（`DevinPanel`）增加"导出/下载"能力，让用户能把对话内容带离系统留存、分享或归档。

## 范围

- **支持的会话类型**：Claude、Devin 两类会话都要覆盖。
- **支持的格式**：
  - **Markdown** — 文本形式，便于二次编辑、版本管理。
  - **PDF** — 排版稳定，便于打印、外发。
  - **PNG** — 长图，便于社交分享、贴到文档里。
- **导出范围**：默认导出整段会话；额外支持"选择消息区间"（起止两条消息之间的所有内容）。
- **触发入口**：在两个会话面板里提供"下载/导出"操作（具体放工具栏还是更多菜单，后续 UI 细化时定）。

## 关键约束

- **前端渲染**：PDF / PNG 走纯前端方案（`html2canvas` + `jsPDF` 或同类库），不引入服务端 headless 浏览器依赖。
- **PNG 长图**：整段会话拼成一张完整长图，不分页、不只截可视区域。
- **保真度**：导出结果应尽量贴近用户在界面上看到的样子（代码块、Markdown 渲染、图片、消息分组等）。

## 非目标

- 不做会话搜索 / 多会话批量导出。
- 不做云端归档 / 分享链接，纯本地下载。
- 不重新设计会话面板，只在现有组件上叠加导出能力。

## 涉及的主要文件（初判）

- `web/src/components/ChatPanel.tsx` — Claude 会话视图
- `web/src/components/DevinPanel.tsx` — Devin 会话视图
- 可能新增 `web/src/components/ExportDialog.tsx` 或 `web/src/lib/export/` 工具模块
