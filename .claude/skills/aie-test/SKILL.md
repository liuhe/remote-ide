---
name: aie-test
description: 跑当前工程 .claude/aie-tests/ 下的行为测试用例并报告通过率；可选 --auto-fix 在 worktree 里自动尝试修复
user_invocable: true
---

# /aie-test [case] [--auto-fix]

跑**当前工程** `.claude/aie-tests/` 下的行为测试用例，给出通过率与失败原因。可选 `--auto-fix` 在 git worktree + 新分支里自动循环修复。

**核心定位**：用例文件在哪个工程，就测谁、改谁。在 `ai-excellence` 跑 → 测方法论（fixture 是被管工程）。在某个被管工程跑 → 测该工程自己的 AI 协作配置。

## 参数

- `[case]`：可选。具体用例文件名（不带扩展名）。未提供则跑全部。
- `--auto-fix`：可选。失败时自动开 worktree + 新分支循环修复，**最多 3 轮**。不自动 merge / push / 删 worktree。

## 用例文件结构（约定）

`./.claude/aie-tests/<case>.md` frontmatter 字段：

| 字段 | 必填 | 含义 |
|---|---|---|
| `name` | ✅ | 人读用例名 |
| `prompt` | ✅ | 喂给被测 AI 的 prompt 原文 |
| `criteria` | ✅ | 判官评估标准（YAML 列表） |
| `fixture_project` | ⏹ | 测试要在哪个 `projects/<x>` 上下文里跑（方法论回归测试需要） |
| `forbidden_reads` | ⏹ | AI 不准读的路径（防作弊） |
| `judge_hints` | ⏹ | 给判官的额外提示 |

## 执行步骤

### 1. 收集用例

- 找 `./.claude/aie-tests/` 下所有 `*.md`
- 不存在或为空 → 报错退出，提示用 `/aie-test-add` 添加
- 有 `[case]` 参数 → 只跑那一个；找不到列出可用项

### 2. 前置检查

对每个用例：

- **`fixture_project` 可达**：若有此字段，检查 `./projects/<fixture_project>` 存在（软链解析后真实路径有效）。不可达 → 跳过该用例并在报告里标 `skipped: fixture unreachable`。
- **`claude` CLI 可用**：`which claude` 失败 → 整轮退出。

### 3. 跑测试

对每个用例：

1. 解析 frontmatter，提取字段
2. 在**当前工程目录**下执行：
   ```bash
   claude -p "<prompt>" --output-format json
   ```
   - 超时建议 600s（建模类用例较慢，按 prompt 复杂度可放宽到 1200s）
   - 捕获 stdout / stderr / exit code
3. （可选）若 `forbidden_reads` 非空，扫描响应里有没有 `Read` / `Grep` / `Glob` 触及禁止路径的迹象，作为判官输入的一部分

### 4. 判官

每个用例响应跑完后，启另一个 `claude -p` 调用做判官：

- **执行目录**：**始终在 ai-excellence 仓库根**（不在被测工程里），避免被该工程配置污染判断
- 判官 prompt 模板见下文
- 要求结构化输出 `{passed: bool, reasoning: str, severity: low|med|high}`

**判官 prompt 模板**：

```
你是 AI 协作配置测试的判官。给定一次 AI 对话的输入和响应，按"判断标准"评估是否通过。

【AI 的输入】
<prompt>

【AI 的响应】
<response>

【判断标准】
<criteria，逐条列出>

【额外提示（如有）】
<judge_hints>

请输出 JSON：
{
  "passed": true | false,
  "reasoning": "逐条对照标准的简短说明",
  "severity": "low | med | high  (failure 时填，pass 时填 low)"
}

只输出 JSON，不要其他文字。
```

### 5. 输出报告

```
# /aie-test 报告

工程：<当前工程名>
用例数：<N>
通过：<X>     失败：<Y>     跳过：<Z>

## 逐用例结果
- ✅ <case-name>：<reasoning 摘要>
- ❌ <case-name>（severity）：<reasoning 摘要>
- ⏭️ <case-name>：<skip 原因>

## 失败用例详情
<每个失败用例附 prompt 摘要 + 完整 reasoning + 可能的修复方向>
```

不开 `--auto-fix` 就停在这里。

## --auto-fix 流程

仅在有失败用例时进入。

### 6.1 前置闸

- **当前工作树必须 clean**（无未提交改动）。脏 → 拒绝开工，提示用户先 commit/stash。
- 若是 ai-excellence 仓库本身，确保 `projects/` 下 fixture 软链能被 worktree 继承（git worktree 默认会带过去）。跑一遍前置检查 §2 验证。

### 6.2 建 worktree + 分支

```bash
REPO_BASE=$(basename "$(git rev-parse --show-toplevel)")
SLUG="<失败用例的 name slug，多用例取第一个 + 数量>"
TS=$(date +%Y%m%d-%H%M%S)
BRANCH="aie-test-fix/$SLUG-$TS"
WORKTREE="../$REPO_BASE-aie-test-$SLUG-$TS"
git worktree add "$WORKTREE" -b "$BRANCH"
```

后续所有改动与重测都在 `$WORKTREE` 里跑。

### 6.3 修复循环（上限 3 轮）

```
for round in 1..3:
  1. 在 $WORKTREE 里跑失败用例（命令同 §3）
  2. 全过 → 退出循环，状态 = success
  3. 把 (失败用例 prompt / 响应 / criteria / 判官 reasoning) 汇总成 fix prompt
  4. 在 $WORKTREE 里另启 claude -p 作为修复子 agent
     白名单（子 agent 只能改这些路径）：
       - CLAUDE.md
       - .claude/skills/
       - .claude/settings.json
       - methodology/   ← 仅当当前仓库是 ai-excellence 时
     禁止改业务代码 / 用例文件本身 / 任何 fixture 工程的文件
  5. 子 agent 没改任何文件 → 退出循环，状态 = stuck
  6. 在 $WORKTREE 里：
       git add -A
       git commit -m "aie-test-fix round $round: <一句话摘要>"
  7. round += 1
  到 3 轮仍未全过 → 状态 = max-rounds
```

判官调用始终在 ai-excellence 目录（不在 worktree）。

### 6.4 输出最终报告

```
## 自动修复结果
- worktree：<绝对路径>
- 分支：<分支名>
- 轮次：<N>/3
- 最终通过率：<X>/<Y>
- 状态：success | stuck | max-rounds | interrupted
- 每轮 commit：
  - <sha> round 1: <摘要>
  - <sha> round 2: <摘要>
  ...

下一步（由你决定，本 skill 不自动执行）：
- 满意：cd <repo> && git merge <分支>
- 部分采纳：cd <worktree> 看 diff，git cherry-pick 想要的 commit
- 全部丢弃：git worktree remove <worktree> && git -C <repo> branch -D <分支>
```

## 关键约束

- **位置即类型**：用例文件在哪个工程下，就由那个工程负责修。`/aie-test` 只动 cwd，不跨工程改文件。
- **默认只读**：不开 `--auto-fix` 就只跑测试出报告，不动任何文件。
- **判官独立性**：判官在 ai-excellence 目录跑，只看 `(prompt, response, criteria, judge_hints)`，不读 CLAUDE.md / 不参考其他用例。
- **超时**：单个测试 prompt 超时（默认 600s，可放宽）就标 timeout 跳过，不卡死。
- **fixture 可达性**：用例声明 `fixture_project` 但工程不可达 → 跳过该用例（不让一个挂掉的软链卡住全部）。
- **--auto-fix 边界**：
  - 仅在 worktree + 新分支里改动，原工作树和 main 永不动
  - 循环上限 3 轮，每轮一个独立 commit
  - 子 agent 白名单严格：协作配置 + 方法论（仅 ai-excellence），禁动业务代码 / 用例文件 / fixture 工程
  - 不自动 merge / push / 删 worktree / 删分支
  - 工作树脏直接拒绝（避免污染用户在途工作）
- **防作弊**：`forbidden_reads` 是软约束（靠 prompt 提示 + 响应扫描启发式），不是硬隔离。判官见到读了禁区的迹象应判 fail。
