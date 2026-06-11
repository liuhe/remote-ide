---
name: aie-review
description: 对当前工程的 AI 协作配置（CLAUDE.md / Skills / Hooks）做静态体检并给出改进建议；可选 --auto-fix 在 worktree 里自动尝试修复
user_invocable: true
---

# /aie-review [--auto-fix]

对**当前工程**的 AI 协作配置做静态体检：CLAUDE.md 体量、逐条规则评审、重复与冲突、Skills/Hooks 现状。可选 `--auto-fix` 在 worktree + 新分支里自动尝试落地建议。

**核心定位**：lint 级体检（不跑测试），跑得快、可频繁跑。行为测试见 `/aie-test`。

## 参数

- `--auto-fix`：可选。把 high 级建议落地到 worktree + 新分支，**最多 3 轮**复评。不自动 merge / push / 删 worktree。

## 执行步骤

### 1. 体量

读 `./CLAUDE.md`：

- 行数、估算 token（粗略 1 token ≈ 3.5 中文字符 或 4 英文字符）
- 阈值：>200 行标"偏大"，>300 行标"明显过载"

### 2. 逐条规则评审（三问框架）

把 CLAUDE.md 按章节/要点切成"规则单元"，对每条问：

1. **频率**：每次对话都用得到吗？
   - 答否 → 建议挪到 `.claude/skills/`（按需加载）
2. **性质**：这是规则还是数据？
   - 是数据（映射表、配置表、术语表） → 建议拆到独立 `docs/*.md`，CLAUDE.md 只留一行指针
3. **刚性**：靠 AI 理解够吗？还是必须强制？
   - 出现"必须 / 绝不 / 禁止 / 一定要" + 性质可机械检查 → 建议升级为 Hook

输出表格：`规则摘要 | 频率 | 性质 | 刚性 | 建议动作`。

### 3. 重复 / 冲突检测

- 同主题规则散布多处 → 标"可合并"
- 互相冲突的规则 → 标"需要消歧"
- CLAUDE.md 内容与现有 `.claude/skills/` 重复 → 标"已有 skill，CLAUDE.md 可删"

### 4. Skills 与 Hooks 现状

- 列 `./.claude/skills/` 下的 skill 与各自 description
- 列 `./.claude/settings.json` 里的 hooks 事件
- 启发式标"长期没被引用的 skill"：CLAUDE.md / 其他 skill / 文档里都没提到名字 → 候选删除

### 5. 输出报告

```
# /aie-review 报告：<当前工程名>

## 体量
- CLAUDE.md：<N> 行 / 约 <M> tokens — <舒适 / 偏大 / 明显过载>

## 逐条规则评审
<表格>

## 重复与冲突
<列表>

## Skills / Hooks 现状
<列表 + 候选删除>

## 改进建议（按 severity 排序）
1. [high] <scope> — <issue>
   - 建议：<suggestion>
   - 理由：<rationale，关联三问中的哪一问>
...
```

不开 `--auto-fix` 就停在这里。

## --auto-fix 流程

仅当有 `[high]` 级建议时进入；`med` / `low` 不自动改（容易引入低价值变更）。

### 6.1 前置闸

- 当前工作树必须 clean（无未提交改动），脏 → 拒绝
- `git rev-parse --show-toplevel` 必须成功（不是 git 仓库 → 拒绝）

### 6.2 建 worktree + 分支

```bash
REPO_BASE=$(basename "$(git rev-parse --show-toplevel)")
TS=$(date +%Y%m%d-%H%M%S)
BRANCH="aie-review-fix/$TS"
WORKTREE="../$REPO_BASE-aie-review-$TS"
git worktree add "$WORKTREE" -b "$BRANCH"
```

### 6.3 修复循环（上限 3 轮）

```
for round in 1..3:
  1. 在 $WORKTREE 跑步骤 1-4 重新体检
  2. 若已无 high 级建议 → 退出，状态 = success
  3. 把"当前 high 级建议列表"作为 fix prompt 喂修复子 agent（在 $WORKTREE 里 claude -p）
     白名单（子 agent 只能改这些路径）：
       - CLAUDE.md
       - .claude/skills/
       - .claude/settings.json
       - methodology/   ← 仅当当前仓库是 ai-excellence 时
     禁止改业务代码 / 测试用例文件 / fixture 工程
  4. 子 agent 没改任何文件 → 退出，状态 = stuck
  5. git -C $WORKTREE add -A
     git -C $WORKTREE commit -m "aie-review-fix round $round: <一句话摘要>"
  6. round += 1
  到 3 轮仍有 high → 状态 = max-rounds
```

### 6.4 输出最终报告

```
## 自动修复结果
- worktree：<绝对路径>
- 分支：<分支名>
- 轮次：<N>/3
- 剩余 high 级建议数：<X>
- 状态：success | stuck | max-rounds | interrupted
- 每轮 commit：
  - <sha> round 1: <摘要>
  ...

下一步（你决定，本 skill 不自动执行）：
- 满意：cd <repo> && git merge <分支>
- 部分采纳：cd <worktree> 看 diff，git cherry-pick
- 全部丢弃：git worktree remove <worktree> && git -C <repo> branch -D <分支>
```

## 关键约束

- **位置即类型**：只动当前 cwd 工程，不跨工程改文件
- **默认只读**：不开 `--auto-fix` 就只出报告，不动文件
- **只自动改 high**：med / low 级建议留给用户判断
- **--auto-fix 边界**：
  - 仅在 worktree + 新分支里改动
  - 循环上限 3 轮，每轮独立 commit
  - 子 agent 白名单严格（同 aie-test）
  - 不自动 merge / push / 删 worktree
  - 工作树脏直接拒绝
- **与 /aie-test 的分工**：本 skill 只看配置写得好不好（静态），实际行为效果由 `/aie-test` 跑用例验证。先 review 后 test 是合理顺序。
