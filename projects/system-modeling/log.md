# log

2026-05-30 — 项目启动。读完方法论 v6.2（业务/应用/部署 3 视图）+ chargable-proxy 样板，扫了一遍 server/web 源码（auth / projects / fs / session / devin / export / store）。范围拍板：当前 main 已实现的全部能力。起点：业务视图。

2026-05-30 — 阶段 1 overview pass 落盘：business.yaml / business-model.yaml / applications.yaml / deployment.yaml。等用户审完再进 details。

2026-05-30 — overview 用户审 1 轮，3 处改动：(a) Host File System / Headless Chrome 从业务 external_parties 移到只在 application_topology 体现；(b) 业务模型实体名带空格（Claude Session / Auth Session / Session Transcript / File Node / Export Artifact / Devin Session）；(c) Developer / Operator 维持分开。准备进阶段 2 details。

2026-05-30 — 阶段 2 details 一次性落盘：business-model/ 11 件（含 archetype + state_machine + rules + relationships），applications/ 5 件（server 含完整 DDD domain_model：SessionBridge role / SessionEntryAggregate / UserAggregate / 5 个 Store + ChromeLauncher / PageRenderer / TranscriptScanner / 4 个 domain_events；web 含 pages 与 use case → page 映射；3 个外部 app 精简件）。deployment details 暂留空（overview 信息足）。下一步跑 model-build viewer 验证。

2026-05-30 — `/model-build` 跑完。vite build 1.79s，481 modules，产物 ~576KB（css 21KB + js 555KB）。dist 剥离了其它工程目录，`docs/modeling/static/` 只含 assets/favicon/icons/index/models.json/remote-ide。models.json 同时把 "remote-ide" 注册到 viewer public/（方便后续 /model-view）。.gitignore 已含 `docs/modeling/static/`，产物不入 git。启动：`python -m http.server -d docs/modeling/static 8080`，浏览器开 `http://localhost:8080/?model=remote-ide`。

2026-05-30 — 用户审 business_use_cases：合并到 2 个（远程使用 AI 能力 / 查看文件信息），删除 Operator 这一 business_worker 与 "Provision User" 系统用例（adduser 是技术运维不算业务价值；server.yaml 的 AddUser 仍保留作为 server 应用用例）。重 build 静态站。

2026-05-30 — 把"按特性切业务用例"和"Developer 错放 business_workers"两类失误反哺方法论。改动落在 ai-excellence：
  - modeling-conventions.md §2 新增"业务用例的颗粒度"小节（goal vs feature、拆分必要条件、合并/剥离场景、1~5 阈值、命名要点）
  - modeling-conventions.md §8 新增"business_workers vs external_parties 的判断"（单人工具特例：business_workers: []）
  - system-modeling-prompt.md §2 重写 Business View First（litmus test + 命名指导 + 拆/合/剥规则 + 阈值；系统用例补"无规则/无 api/无交互"）
  - system-modeling-prompt.md §12 加 3 条 checklist（业务用例 1~5、名字表达 WHY、business_workers 仅运营角色）
