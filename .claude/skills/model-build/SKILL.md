---
name: model-build
description: 把 DCDDP viewer + 本工程模型打包成可双击打开的静态站到 docs/modeling/static/
user_invocable: true
---

# /model-build

把 DCDDP v6.2 model-viewer 与本工程模型一起 build 成自包含静态站，输出到 `<target>/docs/modeling/static/`。产物可直接用 `python -m http.server -d docs/modeling/static`（或任何静态文件服务）打开浏览。

不依赖 dev server；md 链接通过 viewer 内的弹层渲染，无需外部 .md→html 转换。

## 步骤

> 下面 `<aie-root>` 来自 `.claude/settings.local.json` 的 `aie_root` 字段。运行命令时先读出再替换。

1. **解析模型目录与工程名**：模型目录默认 `./docs/modeling/`（可在 CLAUDE.md "## 系统建模方法论" 段中调整），转换为绝对路径。工程名取被管工程根目录的 basename（与 `/model-view` 一致）。

2. **注册到 viewer 的 public/**（与 `/model-view` 同语义，幂等；本 skill 应独立可跑，不假设 model-view 跑过）：
   - 在 `<aie-root>/methodology/app/public/` 下创建软链 `<工程名> -> <模型目录绝对路径>`。
     - 若软链已存在且指向相同路径，跳过；指向不同路径，警告用户后用新路径覆盖（避免 build 出错误内容）。
   - 在 `<aie-root>/methodology/app/public/models.json` 中确保有本工程的注册项（缺则追加）。

3. **清空目标目录**（关键：必须在 build **之前**做）：
   - `rm -rf <target>/docs/modeling/static`。
   - 原因：模型目录通过 public/ 软链被 vite 解引用复制；若 `<target>/docs/modeling/` 里残留旧 `static/`，新 dist 会把它递归吸进 `dist/<工程名>/static/`，造成产物自包含旧产物的嵌套。

4. **临时单工程化 models.json**：
   - 备份当前 `<aie-root>/methodology/app/public/models.json` 内容到内存变量 `originalModels`。
   - 把文件改写为 `["<工程名>"]`，让 build 出的静态站顶部选择器只显示本工程。

5. **build viewer**：
   - 在 `<aie-root>/methodology/app/` 跑 `npm install`（若缺 `node_modules`）+ `npm run build`。
   - 产物在 `<aie-root>/methodology/app/dist/`，包含 `index.html`、`assets/`、`models.json`、以及通过 public/ 软链被 vite 烤入的所有公共目录（**包括 dcddp 出厂样板与其他 receiver**——下一步会剥离）。

6. **还原 models.json**：把步骤 4 备份的 `originalModels` 写回 `<aie-root>/methodology/app/public/models.json`（不影响后续 `/model-view` 多工程列表）。

7. **剥离 dist 内非本工程的 public 目录**：
   - vite 默认把整个 `public/` 拷进 dist，所以 dist 里会带其他工程模型（dcddp 样板、其他 receiver 软链）。逐字泄漏 + 体积膨胀。
   - 列 `<aie-root>/methodology/app/public/` 的目录/软链项，凡名字非 `<工程名>` 的，从 `<aie-root>/methodology/app/dist/<name>/` 删掉。保留 `assets/`、`index.html`、`models.json`、`favicon.svg`、`icons.svg` 等顶层资源。
   - 操作完后 dist 顶层应只剩：`assets/`、`favicon.svg`、`icons.svg`、`index.html`、`models.json`、`<工程名>/`。

8. **同步到目标位置**：
   - `mkdir -p <target>/docs/modeling/static`（步骤 3 已清空）。
   - `cp -R <aie-root>/methodology/app/dist/. <target>/docs/modeling/static/`。vite build 时 public/ 下的软链已被解引用，dist 内 `<工程名>/` 是实文件，无需 `-L`。

9. **维护 .gitignore**：在 `<target>/.gitignore` 中确保有 `docs/modeling/static/` 一行（产物不入 git）。缺则追加。

10. **输出报告**：
   - 静态站入口：`<target>/docs/modeling/static/index.html`
   - 推荐启动方式（任意目录、任意子路径都可）：`cd <target> && python -m http.server -d docs/modeling/static 8080`，浏览器开 `http://localhost:8080/?model=<工程名>`
   - viewer 已用 `base: './'` build，资源全走相对路径，所以 dist 整个目录可挂到任意 HTTP 子路径下。`file://` 双击在 Safari 通常可用、Chrome / Firefox 因 fetch CORS 拒绝 file:// 同源会失败——遇阻就改起 HTTP server。

## 失败兜底

- 步骤 5 build 报错：保留 dist 旧产物不动；步骤 6 仍然要执行（恢复 models.json）；步骤 7-8 跳过；向用户报错并粘出 build 末尾输出。
- 步骤 4-6 中途中断：用户重跑本 skill 时再次覆盖 models.json，最终状态以 `originalModels` 为准。
- 步骤 3 必须先于 build：若漏跑，dist 会把 `<target>/docs/modeling/static/` 嵌套进 `dist/<工程名>/static/`；产物可用但臃肿、含 stale 旧版本。重跑本 skill 即可纠正。

## 关键约束

- 不修改 viewer 源码（`<aie-root>/methodology/app/src/`）。
- 不在被管工程内安装 node 依赖；build 在 ai-excellence 自身的 app 目录里完成。
- 产物完全自包含；移动整个 `docs/modeling/static/` 目录到其他机器仍可打开。
