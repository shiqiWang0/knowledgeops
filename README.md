# KnowledgeOps

KnowledgeOps 是一套把语雀 Markdown 导出内容整理成博客 PR 的自动化流程。

它的核心流程是：

1. 同步语雀导出的 Markdown 到知识库 vault。
2. 对比本次和上次同步结果，生成变更清单。
3. 对人工勾选的条目调用 OpenAI，生成技术编辑初稿。
4. 人工审阅和修改初稿。
5. 转换成待发布 MDX。
6. 写入目标 GitHub 仓库并创建 PR。

## 环境要求

- Node.js
- pnpm
- Git
- GitHub CLI：`gh`
- 已登录 GitHub CLI：`gh auth login`
- OpenAI API Key

安装依赖：

```bash
pnpm install
```

## 环境变量

项目脚本默认通过 `.env` 加载配置。

必填：

```bash
VAULT_DIR=/path/to/knowledge-vault
YUQUE_SOURCE_DIR=/path/to/yuque-markdown-export
OPENAI_API_KEY=your-openai-api-key
TARGET_REPO_DIR=/path/to/github/blog-repo
```

常用可选项：

```bash
OPENAI_BASE_URL=
OPENAI_MODEL=gpt-4o-mini

SOURCE_MIRROR_DIR=00_source
INBOX_DIR=10_editorial_inbox
DRAFT_DIR=20_editorial_draft
REVIEW_DIR=30_editorial_review
READY_DIR=40_publish_ready
TARGET_CONTENT_DIR=data/blog
```

发布前还需要在 `TARGET_REPO_DIR` 中配置 git identity：

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

## 目录约定

`VAULT_DIR` 下默认会使用这些目录：

- `00_source`：语雀源文件镜像
- `10_editorial_inbox`：变更清单，人工在这里勾选要处理的条目
- `20_editorial_draft`：AI 生成的编辑初稿
- `30_editorial_review`：人工审阅后的待发布 Markdown
- `40_publish_ready`：转换后的 MDX
- `manifest`：索引和发布状态记录

## 使用流程

### 1. 同步语雀内容

```bash
pnpm run kb:sync
```

该命令会把 `YUQUE_SOURCE_DIR` 复制到 vault 的 source mirror，并生成 `manifest/source-index.json`。

### 2. 生成变更清单

```bash
pnpm run kb:diff
```

该命令会对比本次和上次同步的索引，在 `10_editorial_inbox` 下生成当天的变更清单。

打开生成的 inbox 文件，把需要处理的条目从：

```markdown
- [ ] action: draft | title: 示例标题 | path: 00_source/example.md
```

改成：

```markdown
- [x] action: draft | title: 示例标题 | path: 00_source/example.md
```

### 3. 生成 AI 编辑初稿

```bash
pnpm run kb:editorial
```

该命令会读取 inbox 中勾选的条目，使用 `src/prompts/editorial.md` 作为编辑提示词，调用 OpenAI 生成初稿，并写入 `20_editorial_draft`。

### 4. 人工审阅初稿

检查并修改 `20_editorial_draft` 中的初稿。确认可进入 review 后，将 frontmatter 设置为：

```yaml
status: review
editorial_status: human_edited
```

不要把未经审阅的 AI 初稿直接发布。

### 5. 提交到 review

```bash
pnpm run kb:submit
```

该命令会从 draft 中提取真正要发布的正文，写入 `30_editorial_review`，并更新 `manifest/review-index.json`。

### 6. 构建待发布 MDX

```bash
pnpm run kb:checked
```

该命令会把 review Markdown 转成可发布 MDX，写入 `40_publish_ready`。

### 7. 创建 GitHub PR

```bash
pnpm run kb:publish
```

该命令会在 `TARGET_REPO_DIR` 中：

1. 切到 `main` 并拉取最新代码。
2. 创建 `publish/YYYYMMDD-HHMM` 分支。
3. 将 ready MDX 复制到 `TARGET_CONTENT_DIR`。
4. commit 并 push。
5. 使用 `gh pr create` 创建 PR。
6. 回写 `manifest/review-index.json` 中的发布状态。

## Codex Skill

仓库内包含一个项目级 Skill：

```text
.codex/skills/knowledgeops-publish/SKILL.md
```

当你对 Codex 说“检查语雀变更并创建 PR”或“跑 KnowledgeOps 发布流程”时，它应该按该 Skill 中的步骤执行，并在 AI 初稿发布前保留人工确认点。

## 脚本说明

- `pnpm run kb:sync`：同步语雀源文件并生成 source index
- `pnpm run kb:diff`：生成本次变更 inbox
- `pnpm run kb:editorial`：调用 OpenAI 生成编辑初稿
- `pnpm run kb:submit`：把人工审阅后的 draft 提交到 review
- `pnpm run kb:checked`：构建 publish ready MDX
- `pnpm run kb:publish`：发布 ready 内容到目标仓库并创建 PR

## 安全边界

- 删除项不会自动发布或归档，需要人工处理。
- 未经人工审阅的 AI 初稿不应进入发布流程。
- `kb:publish` 会操作目标 GitHub 仓库、push 分支并创建 PR，运行前确认 `TARGET_REPO_DIR` 指向正确仓库。
