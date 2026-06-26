import path from "node:path";
import fs from "node:fs/promises";
import fg from "fast-glob";
import matter from "gray-matter";

const VAULT_DIR = process.env.VAULT_DIR;
const REVIEW_DIR = process.env.REVIEW_DIR || "30_editorial_review";
const READY_DIR = process.env.READY_DIR || "40_publish_ready";

if (!VAULT_DIR) {
  throw new Error("Missing env: VAULT_DIR");
}

const vaultRoot = path.resolve(VAULT_DIR);
const reviewRoot = path.join(vaultRoot, REVIEW_DIR);
const readyRoot = path.join(vaultRoot, READY_DIR);
const manifestDir = path.join(vaultRoot, "manifest");
const reviewIndexPath = path.join(manifestDir, "review-index.json");

type ReviewIndexItem = {
  title: string;
  displayTitle?: string;
  draftPath: string;
  reviewPath: string;
  readyPath?: string;
  sourcePath?: string;
  targetPath?: string;
  submittedAt: string;
  checkedAt?: string;
  status: "pending" | "ready" | "published";
};

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function slugify(input: string) {
  return input
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function formatDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getH1Title(body: string) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map(String).filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function escapeMdxUnsafeAngles(markdown: string) {
  const lines = markdown.split("\n");
  let inFence = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();

      // 代码块内不处理
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      let next = line;

      // <100行、< 100、<T 这种都容易被 MDX 当 JSX
      // 但保留合法 JSX/HTML 自闭合和闭合标签，例如 <br />、</div>、<Component />
      next = next.replace(/(^|[\s(（])<(?=\d|[A-Za-z][^>\n]*$)/g, "$1&lt;");

      // >300行 这种在普通正文中转义；但不影响 markdown blockquote 的行首 >
      if (!next.trimStart().startsWith(">")) {
        next = next.replace(/(^|[\s(（])>(?=\d)/g, "$1&gt;");
      }

      return next;
    })
    .join("\n");
}

function transformReviewMarkdownToMdx(body: string) {
  let content = body.trim();

  // [[xxx|alias]] -> alias
  content = content.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2");

  // [[xxx]] -> xxx
  content = content.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // ![[image.png]] -> ![](image.png)
  content = content.replace(/!\[\[([^\]]+)\]\]/g, "![]($1)");

  // Obsidian callout 降级
  content = content.replace(/^>\s*\[!(\w+)\]\s*$/gm, (_, type) => {
    return `> **${String(type).toUpperCase()}**`;
  });

  // HTML br 转 JSX 合法写法
  content = content.replace(/<br\s*>/gi, "<br />");

  // 转义容易被 MDX 当成 JSX 的裸 < / >
  content = escapeMdxUnsafeAngles(content);

  return content;
}

function buildBlogMdx(params: {
  reviewData: Record<string, any>;
  reviewBody: string;
}) {
  const { reviewData, reviewBody } = params;

  const displayTitle =
    reviewData.display_title || getH1Title(reviewBody) || reviewData.title;

  const blogData = {
    title: displayTitle,
    date: formatDate(),
    tags: normalizeTags(reviewData.tags),
    draft: false,
    summary: reviewData.summary || "",
  };

  const body = transformReviewMarkdownToMdx(reviewBody);

  return matter.stringify(`${body}\n`, blogData);
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
  await fs.mkdir(readyRoot, { recursive: true });
  await fs.mkdir(manifestDir, { recursive: true });

  const reviewFiles = await fg("**/*.md", {
    cwd: reviewRoot,
    absolute: true,
    onlyFiles: true,
  });

  const reviewIndex = await readReviewIndex();
  const reviewIndexMap = new Map(reviewIndex.map((item) => [item.reviewPath, item]));

  let scanned = 0;
  let built = 0;
  let skipped = 0;

  for (const reviewAbsPath of reviewFiles) {
    scanned++;

    const raw = await fs.readFile(reviewAbsPath, "utf-8");
    const parsed = matter(raw);

    const isPendingReview =
      parsed.data.status === "review" && parsed.data.review_status === "pending";

    const isManualReady =
      parsed.data.status === "ready" && parsed.data.review_status === "ready";

    if (!isPendingReview && !isManualReady) {
      skipped++;
      continue;
    }

    const reviewRelPath = path.relative(vaultRoot, reviewAbsPath);
    const checkedAt = parsed.data.checked_at || new Date().toISOString();

    const displayTitle =
      parsed.data.display_title || getH1Title(parsed.content) || parsed.data.title;

    const readyFileName = `${slugify(displayTitle)}.mdx`;
    const readyAbsPath = path.join(readyRoot, readyFileName);
    const readyRelPath = path.relative(vaultRoot, readyAbsPath);

    const blogMdx = buildBlogMdx({
      reviewData: {
        ...parsed.data,
        display_title: displayTitle,
      },
      reviewBody: parsed.content,
    });

    await fs.writeFile(readyAbsPath, blogMdx, "utf-8");

    const nextReviewData = {
      ...parsed.data,
      status: "ready",
      review_status: "ready",
      checked_at: checkedAt,
      ready_path: readyRelPath,
    };

    const nextReviewContent = matter.stringify(
      parsed.content.trim() + "\n",
      nextReviewData
    );

    await fs.writeFile(reviewAbsPath, nextReviewContent, "utf-8");

    const oldIndexItem = reviewIndexMap.get(reviewRelPath);

    reviewIndexMap.set(reviewRelPath, {
      title: parsed.data.title || path.basename(reviewAbsPath, ".md"),
      displayTitle,
      draftPath: oldIndexItem?.draftPath || "",
      reviewPath: reviewRelPath,
      readyPath: readyRelPath,
      sourcePath: oldIndexItem?.sourcePath || parsed.data.source_path,
      targetPath:
        oldIndexItem?.targetPath ||
        parsed.data.target_path ||
        path.join(process.env.TARGET_CONTENT_DIR || "data/blog", readyFileName),
      submittedAt: oldIndexItem?.submittedAt || parsed.data.submitted_at || "",
      checkedAt,
      status: "ready",
    });

    built++;

    console.log(`Built: ${reviewRelPath} -> ${readyRelPath}`);
  }

  await writeReviewIndex(Array.from(reviewIndexMap.values()));

  console.log("");
  console.log("Checked completed");
  console.log(`Scanned: ${scanned}`);
  console.log(`Built ready mdx: ${built}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Review index: ${reviewIndexPath}`);
}

main().catch((error) => {
  console.error("Checked failed");
  console.error(error);
  process.exit(1);
});