---
name: knowledgeops-publish
description: 运行 KnowledgeOps 从语雀到 GitHub PR 的发布工作流。用户要求检查语雀变更、同步知识库、生成 AI 编辑初稿、整理待发布文章、发布 ready 内容、或把 KnowledgeOps 内容提交到 GitHub PR 时使用。
---

# KnowledgeOps 发布流程

## 目标

使用本仓库已有 CLI 脚本完成整套 KnowledgeOps 流程。脚本负责实际执行；本 Skill 负责规定执行顺序、前置检查、人工确认点和发布安全边界。

## 前置检查

在仓库根目录执行。开始前检查：

- `package.json` 中存在 `kb:*` 脚本。
- `.env` 或当前命令环境提供 `VAULT_DIR`。
- `YUQUE_SOURCE_DIR` 指向本地语雀 Markdown 导出目录。
- `OPENAI_API_KEY` 已配置，供 AI 编辑初稿使用。
- `TARGET_REPO_DIR` 指向最终接收 MDX 内容的 GitHub 仓库。
- `TARGET_REPO_DIR` 中已配置 git identity，且 `gh auth status` 可用。

默认脚本顺序：

```bash
pnpm run kb:sync
pnpm run kb:diff
pnpm run kb:editorial
pnpm run kb:submit
pnpm run kb:checked
pnpm run kb:publish
```

## 标准流程

### 1. 同步语雀源文件

运行：

```bash
pnpm run kb:sync
```

作用：

- 将 `YUQUE_SOURCE_DIR` 同步到 vault 的 source mirror。
- 重建 `manifest/source-index.json`。

失败时停止，向用户报告缺失的环境变量、路径或权限问题。

### 2. 生成变更清单

运行：

```bash
pnpm run kb:diff
```

作用：

- 对比当前 source index 和上一次 index。
- 在 `${VAULT_DIR}/10_editorial_inbox` 生成当天 inbox 文件，除非 `INBOX_DIR` 覆盖了目录名。

生成后打开最新 inbox，向用户汇总：

- 新增条目数量和标题。
- 更新条目数量和标题。
- 删除条目数量和标题。

不要默认处理全部条目。除非用户明确说“全部处理”，否则询问用户要处理哪些新增或更新条目，并只把这些行改成 `- [x]`。

删除条目只汇报，不自动归档或发布。

### 3. 调用 AI 生成编辑初稿

运行：

```bash
pnpm run kb:editorial
```

作用：

- 读取 inbox 中 `- [x]` 的条目。
- 使用 `src/prompts/editorial.md` 作为 system prompt。
- 调用配置的 OpenAI 模型生成编辑初稿。
- 写入 `${VAULT_DIR}/20_editorial_draft`，除非 `DRAFT_DIR` 覆盖了目录名。

完成后汇报生成的 draft 路径、跳过项和失败项。

### 4. 等待人工编辑确认

AI 初稿不能直接发布。到这一步默认停止，提醒用户检查并编辑 draft。

只有在用户明确表示已经审阅，或要求你协助审阅并完成修改后，才继续后续步骤。

可提交到 review 的 draft frontmatter 必须包含：

```yaml
status: review
editorial_status: human_edited
```

不要在未检查内容的情况下批量写入 `human_edited`。

### 5. 提交到 review

当 draft 已人工编辑后运行：

```bash
pnpm run kb:submit
```

作用：

- 从 draft 中提取真正要发布的正文。
- 写入 `${VAULT_DIR}/30_editorial_review`，除非 `REVIEW_DIR` 覆盖了目录名。
- 更新 `manifest/review-index.json`。

完成后汇报 submitted、skipped 和 review index 路径。

### 6. 构建 publish ready MDX

运行：

```bash
pnpm run kb:checked
```

作用：

- 将 review Markdown 转成可发布 MDX。
- 写入 `${VAULT_DIR}/40_publish_ready`，除非 `READY_DIR` 覆盖了目录名。
- 将 review index 中对应条目标记为 ready。

完成后汇报生成的 ready MDX 路径。

### 7. 发布到 GitHub PR

仅当内容已经 ready，且用户明确要求创建 PR 时运行：

```bash
pnpm run kb:publish
```

作用：

- 进入 `TARGET_REPO_DIR`。
- checkout `main` 并 `pull --ff-only`。
- 创建 `publish/YYYYMMDD-HHMM` 分支。
- 将 ready 文件复制到 `TARGET_CONTENT_DIR`。
- commit、push，并通过 `gh pr create` 创建 PR。
- 回写 `manifest/review-index.json` 中的 published 状态、branch、commit 和 PR URL。

完成后向用户汇报：

- Published / Unchanged / Skipped 数量。
- 分支名。
- commit hash。
- PR URL。

## 安全规则

- 不要跳过 inbox 选择步骤，除非用户明确要求处理全部适用变更。
- 不要对删除项自动发布、删除或归档，只汇报给用户。
- 不要在 AI 初稿未经审阅时运行 `kb:submit`、`kb:checked` 或 `kb:publish`。
- 不要运行 `git reset --hard`、`git checkout --`、强制 push 或其他破坏性命令，除非用户明确要求。
- 如果 `kb:publish` 因目标仓库 dirty、GitHub CLI 未登录、git identity 缺失或远端不同步失败，停止并报告具体阻塞点。
- 对外部网络、GitHub push、PR 创建等需要权限的命令，按当前执行环境的审批机制请求授权。

## 常见用户表达

以下请求应触发本 Skill：

- “检查有没有语雀变更，然后生成 PR”
- “跑一下 KnowledgeOps 发布流程”
- “把语雀更新同步到博客仓库”
- “生成 AI 编辑初稿”
- “把 ready 的文章发到 GitHub PR”
- “检查知识库变更并发布”
