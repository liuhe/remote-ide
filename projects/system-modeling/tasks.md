# tasks

## 阶段 1：overview pass

- ✅ `docs/modeling/business.yaml` — 业务执行者 / 业务用例 / 系统用例
- ✅ `docs/modeling/business-model.yaml` — 实体清单 + 一句简介 + overview relationships
- ✅ `docs/modeling/applications.yaml` — 应用清单 + application_topology
- ✅ `docs/modeling/deployment.yaml` — 节点 / 端口 / launchd 约束
- ✅ 用户审 overview pass — 1 轮反馈已落：
  - Developer / Operator 分开（已是）
  - Host File System / Headless Chrome 从业务 external_parties 移除，只走 application_topology
  - 业务模型实体名带空格（Claude Session / Auth Session / Session Transcript / File Node / Export Artifact / Devin Session）

## 阶段 2：details pass

- ✅ business-model details（11 件，含 archetype + 关系）
  - user / auth-session / project / workspace / tab / claude-session / devin-session / session-transcript / file-node / settings / export-artifact
- ✅ applications details（5 件）
  - server（含 DDD domain_model：SessionBridge role / SessionEntryAggregate / UserAggregate / 各 store / ChromeLauncher / TranscriptScanner 等）
  - web（含 pages 与 use case → page 映射）
  - claude-cli / devin-cli / headless-chrome（外部，精简）
- 🔘 deployment details（当前 overview 已够；用户指明再补）

## 阶段 3：图

- 🔘 ER svg
- 🔘 application topology svg
- 🔘 deployment topology svg

## 阶段 4：跑通 viewer

- ✅ `/model-build` 出 docs/modeling/static/（已构建，单工程入口 ./index.html?model=remote-ide）
- 🔘 用户在浏览器里看一眼，反馈命名空间冲突 / 跨文件跳转 / archetype 着色情况
- 🔘 viewer 报错时回头修模型
