# system-modeling — DCDDP 系统建模

## 目标

按 DCDDP v6.2 方法论，给 remote-ide 现有实现（main 分支已合入的全部能力）建一份完整的系统模型，作为后续讨论与变更的 source of truth。

- 范围：MVP + multi-user + session-export + claude-rewind + devin-session（即当前 main 的真实状态）
- 起点：业务视图（用户场景清晰）→ 业务模型 → 应用视图 → 部署
- 落点：`docs/modeling/`（CLAUDE.md 约定的默认路径）

## 范围边界（什么不进模型）

- 已废弃 / 暂停的 projects/（claude-queue、multi-user 计划稿等）的"未实现"部分
- 浏览器端 UI 元件层（react 组件树）——只到"页面（page）"粒度
- 未来设想（编辑文件、多用户隔离细节超出 auth 之外的部分）

## 交付物

### 第一阶段（overview pass）

- `docs/modeling/business.yaml`
- `docs/modeling/business-model.yaml`
- `docs/modeling/applications.yaml`
- `docs/modeling/deployment.yaml`

完成后停下让用户审，确认骨架对齐再展开 details。

### 第二阶段（details pass）

- `docs/modeling/business-model/<Entity>.yaml` × 实体数
- `docs/modeling/applications/<app>.yaml` × 应用数
- `docs/modeling/deployment/` 必要时

### 第三阶段

补 SVG（ER 图、应用拓扑、部署拓扑）。当前 AI skill 还不能直接生成，先留 TODO，可手画或后续 AI 工具补齐。

## 方法论参考（路径前缀见 .claude/settings.local.json 的 aie_root）

- `<aie-root>/methodology/vision.md`
- `<aie-root>/methodology/modeling-conventions.md`
- `<aie-root>/methodology/meta-model.schema.yaml`
- `<aie-root>/methodology/examples/chargable-proxy/model/`（参照样板）

## 当前状态

🚀 第一阶段进行中
