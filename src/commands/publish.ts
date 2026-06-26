import path from "node:path";
import fs from "node:fs/promises";

import {
  checkGhAuth,
  checkTargetRepoGitIdentity,
  getGitOutput,
  runGh,
  runGit,
} from "../utils/git";

const VAULT_DIR = process.env.VAULT_DIR;
const READY_DIR = process.env.READY_DIR || "40_publish_ready";
const TARGET_REPO_DIR = process.env.TARGET_REPO_DIR;
const TARGET_CONTENT_DIR = process.env.TARGET_CONTENT_DIR || "data/blog";

if (!VAULT_DIR) throw new Error("Missing env: VAULT_DIR");
if (!TARGET_REPO_DIR) throw new Error("Missing env: TARGET_REPO_DIR");

const vaultRoot = path.resolve(VAULT_DIR);
const readyRoot = path.join(vaultRoot, READY_DIR);
const targetRepoRoot = path.resolve(TARGET_REPO_DIR);
const manifestDir = path.join(vaultRoot, "manifest");
const reviewIndexPath = path.join(manifestDir, "review-index.json");

type ReviewStatus = "pending" | "ready" | "published";

type ReviewIndexItem = {
  title: string;
  displayTitle?: string;
  status: ReviewStatus;
  draftPath: string;
  reviewPath: string;
  readyPath?: string;
  sourcePath?: string;
  targetPath?: string;
  submittedAt: string;
  checkedAt?: string;
  publishedAt?: string;
  publishBranch?: string;
  commit?: string;
  prNumber?: number;
  prUrl?: string;
};

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readReviewIndex(): Promise<ReviewIndexItem[]> {
  if (!(await pathExists(reviewIndexPath))) {
    throw new Error(`review-index.json not found: ${reviewIndexPath}`);
  }

  return JSON.parse(await fs.readFile(reviewIndexPath, "utf-8"));
}

async function writeReviewIndex(items: ReviewIndexItem[]) {
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(reviewIndexPath, JSON.stringify(items, null, 2), "utf-8");
}

function formatDateTime() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

function parsePrNumber(prUrl: string) {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function resolveTargetRelativePath(item: ReviewIndexItem) {
  if (!item.readyPath) {
    throw new Error(`Missing readyPath: ${item.title}`);
  }

  const readyFileName = path.basename(item.readyPath);

  return item.targetPath || path.join(TARGET_CONTENT_DIR, readyFileName);
}

async function main() {
  await fs.mkdir(readyRoot, { recursive: true });

  await checkTargetRepoGitIdentity(targetRepoRoot);
  await checkGhAuth(targetRepoRoot);

  const reviewIndex = await readReviewIndex();
  const readyItems = reviewIndex.filter((item) => item.status === "ready");

  if (readyItems.length === 0) {
    console.log("No ready items to publish.");
    return;
  }

  const branchName = `publish/${formatDateTime()}`;
  const publishedAt = new Date().toISOString();

  console.log(`Publishing ${readyItems.length} item(s)`);
  console.log(`Branch: ${branchName}`);

  await runGit(["checkout", "main"], targetRepoRoot);
  await runGit(["pull", "--ff-only"], targetRepoRoot);
  await runGit(["checkout", "-b", branchName], targetRepoRoot);

  const publishedItems: ReviewIndexItem[] = [];

  for (const item of readyItems) {
    if (!item.readyPath) {
      console.warn(`Ready artifact path missing, skipped: ${item.title}`);
      continue;
    }

    const readyAbsPath = path.join(vaultRoot, item.readyPath);

    if (!(await pathExists(readyAbsPath))) {
      console.warn(`Ready artifact not found, skipped: ${item.readyPath}`);
      continue;
    }

    const targetRelPath = resolveTargetRelativePath(item);
    const targetAbsPath = path.join(targetRepoRoot, targetRelPath);

    await fs.mkdir(path.dirname(targetAbsPath), { recursive: true });
    await fs.copyFile(readyAbsPath, targetAbsPath);

    publishedItems.push({
      ...item,
      targetPath: targetRelPath,
      publishedAt,
      publishBranch: branchName,
    });

    console.log(`Copied: ${item.readyPath}`);
    console.log(`  -> ${targetRelPath}`);
  }

  if (publishedItems.length === 0) {
    console.log("No files copied. Publish stopped.");
    return;
  }

  await runGit(["add", TARGET_CONTENT_DIR], targetRepoRoot);

  const status = await getGitOutput(["status", "--porcelain"], targetRepoRoot);
  if (!status) {
    console.log("No git changes detected. Publish stopped.");
    return;
  }

  const commitMessage = `docs(knowledge): publish ${publishedItems.length} article(s)`;

  await runGit(["commit", "-m", commitMessage], targetRepoRoot);

  const commitHash = await getGitOutput(
    ["rev-parse", "--short", "HEAD"],
    targetRepoRoot
  );

  await runGit(["push", "-u", "origin", branchName], targetRepoRoot);

  const prTitle = `docs(knowledge): publish ${formatDateTime()}`;
  const prBody = [
    "## Publish Summary",
    "",
    "### Articles",
    "",
    ...publishedItems.map((item) => `- ${item.displayTitle || item.title}`),
    "",
    "---",
    "",
    "### Ready Artifacts",
    "",
    ...publishedItems.map((item) => `- ${item.readyPath}`),
    "",
    "---",
    "",
    "### Source",
    "",
    ...publishedItems.map((item) => `- ${item.sourcePath || item.reviewPath}`),
    "",
    "---",
    "",
    "Generated by KnowledgeOps.",
  ].join("\n");

  const prResult = await runGh(
    [
      "pr",
      "create",
      "--title",
      prTitle,
      "--body",
      prBody,
      "--base",
      "main",
      "--head",
      branchName,
    ],
    targetRepoRoot
  );

  const prUrl = prResult.trim();
  const prNumber = parsePrNumber(prUrl);

  const publishedMap = new Map(
    publishedItems.map((item) => [item.reviewPath, item])
  );

  const nextReviewIndex = reviewIndex.map((item) => {
    const publishedItem = publishedMap.get(item.reviewPath);

    if (!publishedItem) {
      return item;
    }

    return {
      ...item,
      status: "published" as const,
      readyPath: publishedItem.readyPath,
      targetPath: publishedItem.targetPath,
      publishedAt,
      publishBranch: branchName,
      commit: commitHash,
      prNumber,
      prUrl,
    };
  });

  await writeReviewIndex(nextReviewIndex);

  console.log("");
  console.log("Publish completed");
  console.log(`Published: ${publishedItems.length}`);
  console.log(`Branch: ${branchName}`);
  console.log(`Commit: ${commitHash}`);
  console.log(`PR: ${prUrl}`);
}

main().catch((error) => {
  console.error("Publish failed");
  console.error(error);
  process.exit(1);
});
