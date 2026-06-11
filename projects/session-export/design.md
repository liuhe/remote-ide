# session-export 设计

## 两类会话的消息结构（来自 ChatPanel.tsx / DevinPanel.tsx）

### Claude `Msg`

```
user      { text, images?, uuid? }
assistant { text }                    // markdown
system    { text }                    // 系统提示
tool      { name, input, toolUseId?, output? }
```

### Devin `Msg`

```
user      { text, images? }
assistant { text }                    // markdown
thought   { text }                    // 推理过程
system    { text }
tool      { toolCallId, title, kind, status, rawInput?, output? }
```

## 归一化中间模型 `ExportMessage`

两侧 Panel 把自己的 `Msg` 映射到这个统一结构，导出层只认这个：

```ts
type ExportMessage =
  | { kind: 'user'; text: string; images?: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'thought'; text: string }              // 仅 Devin 用到
  | { kind: 'system'; text: string }
  | { kind: 'tool';
      name: string;            // Claude: tool.name; Devin: tool.kind
      title?: string;          // Devin: tool.title；Claude: 留空
      input: any;              // Claude: input; Devin: rawInput
      output?: string;
    };
```

源会话类型作为元数据传给导出层：`source: 'claude' | 'devin'`，仅用于文件名、标题等元信息。

## 模块拆分

```
web/src/lib/export/
  types.ts            // ExportMessage / ExportSource / ExportFormat
  toMarkdown.ts       // ExportMessage[] -> string
  toImage.ts          // 渲染 DOM 节点 -> PNG dataURL（长图）
  toPdf.ts            // PNG 长图 -> 分页 PDF blob
  download.ts         // saveAs(blob/dataUrl, filename)
web/src/components/
  ExportDialog.tsx    // 入口对话框：格式 + 区间 + 触发
  ExportView.tsx      // 用于截图/PDF 的离屏渲染视图（共享）
```

`ChatPanel` 和 `DevinPanel` 各加一个"导出"按钮（位置放在 chat-status 行的右侧或工具栏，待 UI 时定）：

- 点击 → 把当前 `msgs` 映射成 `ExportMessage[]`，连同会话标题、source 传给 `ExportDialog`
- `ExportDialog` 提供「格式选择」「范围选择」「下载」三步

## Markdown 输出规则

- 用户消息：`### 🧑 用户` + 正文 + 行内图片（`![](data-url)` 或省略）
- 助手消息：`### 🤖 助手` + 原文 markdown（保留代码块）
- 思考（Devin）：折叠块 `<details><summary>思考</summary>...</details>` 或 `> [思考] 正文`
- 系统消息：`> [系统] 正文`
- 工具调用：
  ```
  #### 🛠 ToolName — 一句话摘要
  ```input.lang
  {input JSON}
  ```
  ```output
  {output 文本}
  ```
  ```
- 不放图片 dataURL 时尺寸可能爆炸 → 默认嵌入；超过 1MB 的图片改为占位符 `[image omitted]`，由前端 toggle。

## PNG / PDF 实现路线

1. 把当前 `ExportMessage[]` 用 `ExportView` 在屏幕外（`position: fixed; left: -99999px; top: 0;`）完整渲染——不带 scroll，让浏览器自己撑开 `scrollHeight`。
2. 等所有 `<img>` `complete=true`（包括 base64 data URL，理论上 sync），字体 `document.fonts.ready`。
3. `html-to-image` 把根节点转成 PNG dataURL（长图）。
4. PDF：把 PNG 切片，按 A4 / Letter 分页塞进 jsPDF。

候选库：
- `html-to-image`（默认）：~30KB，SVG foreignObject，文本保真度高
- `jspdf`：成熟，支持 image 分页

引入前的复核点：
- React 19 是否兼容 — `html-to-image` 是 vanilla DOM API，不依赖 React
- 代码块高亮 CSS 是否进入截图 — 用 react-syntax-highlighter inline style 没问题
- emoji / 中文字体 — 用系统字体即可

## 区间选择

- 对话框里有两个下拉，默认 `[第一条, 最后一条]`
- 下拉选项以"序号 · 角色 · 文本前 40 字"形式呈现
- 起 ≤ 止，区间外消息直接从数组截掉

## 入口 UI

```
[chat-status bar 右侧]
  Ready  · model · [⬇ 导出]
```

`ExportDialog`：

```
┌─ Export session ────────────┐
│ Format:  ( ) Markdown        │
│          ( ) PDF             │
│          ( ) PNG             │
│ Range:   From [select]       │
│          To   [select]       │
│                              │
│       [Cancel]   [Download]  │
└──────────────────────────────┘
```

## 风险与待验证项

- **超长会话内存**：一张 5000 px 宽 × 数万 px 高的 PNG 在 Safari 上可能受 canvas 尺寸限制（iOS 一般 4096×4096 上限）→ 若 PNG 高度超阈值，分块导出多张
- **代码块溢出截断**：导出视图里 `pre` 必须 `white-space: pre-wrap`
- **跨域图片**：用户消息里粘贴的图片是 data URL（无跨域问题）；助手输出里的外链图片可能有 CORS → 转 base64 重试或跳过
