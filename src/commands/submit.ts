import path from "node:path";
import fs from "node:fs/promises";
import fg from "fast-glob";
import matter from "gray-matter";
import { ensureH1, getH1Title, pathExists, slugify } from "../utils";

const VAULT_DIR = process.env.VAULT_DIR;
const DRAFT_DIR = process.env.DRAFT_DIR || "20_editorial_draft";
const REVIEW_DIR = process.env.REVIEW_DIR || "30_editorial_review";

if (!VAULT_DIR) {
  throw new Error("Missing env: VAULT_DIR");
}

const vaultRoot = path.resolve(VAULT_DIR);
const draftRoot = path.join(vaultRoot, DRAFT_DIR);
const reviewRoot = path.join(vaultRoot, REVIEW_DIR);
const manifestDir = path.join(vaultRoot, "manifest");
const reviewIndexPath = path.join(manifestDir, "review-index.json");

type ReviewIndexItem = {
  title: string;
  displayTitle: string;
  draftPath: string;
  reviewPath: string;
  sourcePath?: string;
  targetPath?: string;
  submittedAt: string;
  status: "pending";
};

/**
 * 从 draft 正文中提取真正要发布的内容。
 *
 * 规则：
 * 1. 优先提取 "## AI 初稿正文" 后面的内容。
 * 2. 遇到待补充、修改建议、来源引用等编辑辅助区块就停止。
 * 3. 如果没有 "## AI 初稿正文"，就使用整个正文。
 */
function buildPublishBody(body: string) {
  const startHeading = /^##\s+AI\s*初稿正文\s*$/m;

  const stopHeadings = [
    /^##\s+待补充\s*$/m,
    /^##\s+修改建议\s*$/m,
    /^##\s+来源引用\s*$/m,
    /^##\s+原始资料链接\s*$/m,
    /^##\s+原始资料\s*$/m,
    /^##\s+AI\s*建议修改\s*$/m,
    /^##\s+TODO\s*$/m,
    /^##\s+我的修改记录\s*$/m,
    /^##\s+Prompt\s*$/m,
  ];

  let content = body.trim();
  let shouldPromoteHeadingLevel = false;

  const startMatch = content.match(startHeading);

  if (startMatch && typeof startMatch.index === "number") {
    content = content.slice(startMatch.index + startMatch[0].length).trim();
    shouldPromoteHeadingLevel = true;
  }

  let stopIndex = content.length;

  for (const heading of stopHeadings) {
    const match = content.match(heading);

    if (match && typeof match.index === "number") {
      stopIndex = Math.min(stopIndex, match.index);
    }
  }

  content = content.slice(0, stopIndex).trim();

  if (!shouldPromoteHeadingLevel) {
    return content;
  }

  return promoteMarkdownHeadingLevel(content);
}

function promoteMarkdownHeadingLevel(body: string) {
  return body
    .split("\n")
    .map((line) => {
      const match = line.match(/^(#{2,6})\s+(.+)$/);

      if (!match) {
        return line;
      }

      const level = match[1].length;
      const text = match[2];

      return `${"#".repeat(level - 1)} ${text}`;
    })
    .join("\n")
    .trim();
}

function buildReviewContent(params: {
  data: Record<string, any>;
  title: string;
  displayTitle: string;
  body: string;
}) {
  const { data, title, displayTitle, body } = params;
  const reviewData = {
    title,
    display_title: displayTitle,
    slug: data.slug || slugify(displayTitle),
    summary: data.summary || "",
    tags: data.tags || [],
    publish: data.publish ?? true,
    source: data.source || "yuque",
    source_path: data.source_path,
    target_path: data.target_path,
    status: "review",
    review_status: "pending",
    submitted_at: new Date().toISOString(),
  };

  const finalBody = ensureH1(body, displayTitle);

  return matter.stringify(`${finalBody}
`, reviewData);
}

async function readReviewIndex(): Promise<ReviewIndexItem[]> {
  if (!(await pathExists(reviewIndexPath))) {
    return [];
  }

  const raw = await fs.readFile(reviewIndexPath, "utf-8");
  return JSON.parse(raw) as ReviewIndexItem[];
}

async function writeReviewIndex(items: ReviewIndexItem[]) {
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(reviewIndexPath, JSON.stringify(items, null, 2), "utf-8");
}

async function main() {
  await fs.mkdir(reviewRoot, { recursive: true });
  await fs.mkdir(manifestDir, { recursive: true });

  const draftFiles = await fg("**/*.md", {
    cwd: draftRoot,
    absolute: true,
    onlyFiles: true,
  });

  const reviewIndex = await readReviewIndex();
  const reviewIndexMap = new Map(reviewIndex.map((item) => [item.draftPath, item]));

  let scanned = 0;
  let submitted = 0;
  let skipped = 0;

  for (const draftAbsPath of draftFiles) {
    scanned++;

    const raw = await fs.readFile(draftAbsPath, "utf-8");
    const parsed = matter(raw);

    const status = parsed.data.status;
    const editorialStatus = parsed.data.editorial_status;

    if (status !== "review" || editorialStatus !== "human_edited") {
      skipped++;
      continue;
    }

    const title = parsed.data.title || path.basename(draftAbsPath, ".md");
    const draftRelPath = path.relative(vaultRoot, draftAbsPath);

    const publishBody = buildPublishBody(parsed.content);
   

    if (!publishBody) {
      console.warn(`Empty publish body, skipped: ${draftRelPath}`);
      skipped++;
      continue;
    }

    const displayTitle = getH1Title(parsed.content) || title;
    const reviewFileName = `${slugify(title)}.md`;
    const reviewAbsPath = path.join(reviewRoot, reviewFileName);
    const reviewRelPath = path.relative(vaultRoot, reviewAbsPath);

    const reviewContent = buildReviewContent({
      data: parsed.data,
      title,
      displayTitle,
      body: publishBody,
    });

    await fs.writeFile(reviewAbsPath, reviewContent, "utf-8");

    reviewIndexMap.set(draftRelPath, {
      title,
      displayTitle,
      draftPath: draftRelPath,
      reviewPath: reviewRelPath,
      sourcePath: parsed.data.source_path,
      targetPath: parsed.data.target_path,
      submittedAt: new Date().toISOString(),
      status: "pending",
    });

    submitted++;

    console.log(`Submitted: ${draftRelPath} -> ${reviewRelPath}`);
  }

  await writeReviewIndex(Array.from(reviewIndexMap.values()));

  console.log("");
  console.log("Submit completed");
  console.log(`Scanned: ${scanned}`);
  console.log(`Submitted: ${submitted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Review index: ${reviewIndexPath}`);
}

main().catch((error) => {
  console.error("Submit failed");
  console.error(error);
  process.exit(1);
});