---
name: model-view
description: 启动 DCDDP viewer 加载本工程模型目录
user_invocable: true
---

# /model-view

启动 DCDDP v6.2 model-viewer，加载本工程的模型目录（默认 `./docs/modeling/`，可在 CLAUDE.md "## 系统建模方法论" 段中调整）。

## 步骤

> 下面 `<aie-root>` 来自 `.claude/settings.local.json` 的 `aie_root` 字段。运行命令时先读出再替换。

1. 解析模型目录：默认 `./docs/modeling/`，转换为绝对路径。
2. 在 `<aie-root>/methodology/app/public/` 下创建软链 `<工程名> -> <模型目录绝对路径>`（已存在则跳过）。
3. 在 `<aie-root>/methodology/app/public/models.json` 中确保有本工程的注册项（缺则追加）。
4. 检查端口 5173：`lsof -i :5173`。
   - 已占用：直接返回 viewer URL
   - 未占用：`cd <aie-root>/methodology/app/ && npm run dev`（后台启动）
5. 输出 viewer URL（`http://localhost:5173/`），提示用户在 viewer 中切换到本工程模型。
