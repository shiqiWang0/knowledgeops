import path from "node:path";
import fs from "node:fs/promises";
import fg from "fast-glob";
import matter from "gray-matter";
import OpenAI from "openai";
import { Spinner, formatDateTime, formatDuration } from "../utils/terminal";

const VAULT_DIR = process.env.VAULT_DIR;
const INBOX_DIR = process.env.INBOX_DIR || "10_editorial_inbox";
const DRAFT_DIR = process.env.DRAFT_DIR || "20_editorial_draft";
const TARGET_CONTENT_DIR = process.env.TARGET_CONTENT_DIR || "data/blog";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!VAULT_DIR) throw new Error("Missing env: VAULT_DIR");
if (!OPENAI_API_KEY) throw new Error("Missing env: OPENAI_API_KEY");

const vaultRoot = path.resolve(VAULT_DIR);
const inboxRoot = path.join(vaultRoot, INBOX_DIR);
const draftRoot = path.join(vaultRoot, DRAFT_DIR);
const promptPath = path.resolve("./src/prompts/editorial.md");

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL,
});

type EditorialItem = {
  title: string;
  sourceMirrorPath: string;
};

type EditorialDraftResult = {
  display_title: string;
  summary: string;
  tags: string[];
  category?: string;
  cover?: string;
  content: string;
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

async function getLatestInboxFile() {
  const files = await fg("*.md", {
    cwd: inboxRoot,
    absolute: true,
    onlyFiles: true,
  });

  if (files.length === 0) {
    throw new Error(`No inbox file found in ${inboxRoot}`);
  }

  files.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  return files[0];
}

function parseCheckedItems(content: string): EditorialItem[] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("- [x]"))
    .map((line) => {
      const titleMatch = line.match(/title:\s*(.*?)\s*\|\s*path:/);
      const pathMatch = line.match(/path:\s*(.+)$/);

      if (!titleMatch || !pathMatch) return null;

      return {
        title: titleMatch[1].trim(),
        sourceMirrorPath: pathMatch[1].trim(),
      };
    })
    .filter(Boolean) as EditorialItem[];
}

function stripThinkBlocks(content: string) {
  return content
    .replace(/```(?:think|thinking|reasoning)\b[\s\S]*?```/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJsonObject(content: string) {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI output is not valid JSON object");
  }

  return cleaned.slice(start, end + 1);
}

function parseEditorialResult(content: string): EditorialDraftResult {
  const jsonText = extractJsonObject(content);
  const parsed = JSON.parse(jsonText);

  if (!parsed.content || typeof parsed.content !== "string") {
    throw new Error("AI JSON missing content");
  }

  return {
    display_title: String(parsed.display_title || ""),
    summary: String(parsed.summary || ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    category: parsed.category ? String(parsed.category) : "",
    cover: parsed.cover ? String(parsed.cover) : "",
    content: parsed.content.trim(),
  };
}

async function generateEditorialDraft(params: {
  prompt: string;
  title: string;
  sourceContent: string;
}): Promise<EditorialDraftResult> {
  const { prompt, title, sourceContent } = params;

  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: `请加工下面这篇文档，并严格返回 JSON：\n\n标题：${title}\n\n原始内容：\n\n${sourceContent}`,
      },
    ],
  });

  const content = res.choices[0]?.message?.content?.trim() || "";
  return parseEditorialResult(stripThinkBlocks(content));
}

function buildDraftFile(params: {
  title: string;
  slug: string;
  sourceMirrorPath: string;
  aiResult: EditorialDraftResult;
}) {
  const { title, slug, sourceMirrorPath, aiResult } = params;

  return matter.stringify(
    `${aiResult.content}
---

## 原始资料链接

- [[${sourceMirrorPath.replace(/\.md$/i, "")}]]
`,
    {
      title,
      display_title: aiResult.display_title || title,
      summary: aiResult.summary || "",
      tags: aiResult.tags || [],
      category: aiResult.category || "",
      cover: aiResult.cover || "",
      source: "yuque",
      source_path: sourceMirrorPath,
      status: "draft",
      editorial_status: "ai_generated",
      publish: false,
      check_status: "pending",
      target_path: `${TARGET_CONTENT_DIR}/${slug}.mdx`,
    }
  );
}

async function processItem(params: {
  item: EditorialItem;
  prompt: string;
  current: number;
  total: number;
}) {
  const { item, prompt, current, total } = params;
  const sourceAbsPath = path.join(vaultRoot, item.sourceMirrorPath);
  const label = `[${current}/${total}]`;

  if (!(await pathExists(sourceAbsPath))) {
    console.warn(`${label} Source not found, skipped: ${item.sourceMirrorPath}`);
    return false;
  }

  const raw = await fs.readFile(sourceAbsPath, "utf-8");
  const parsed = matter(raw);

  const title = parsed.data.title || item.title || path.basename(sourceAbsPath, ".md");
  const slug = slugify(title);
  const draftAbsPath = path.join(draftRoot, `${slug}.md`);

  if (await pathExists(draftAbsPath)) {
    console.warn(
      `${label} Draft already exists, skipped: ${path.relative(vaultRoot, draftAbsPath)}`
    );
    return false;
  }

  const sourceContent = parsed.content.trim();
  const itemStartedAt = Date.now();
  const spinner = new Spinner();

  spinner.start(`${label} Generating editorial draft: ${title}`);

  let aiResult: EditorialDraftResult | null = null;

  try {
    aiResult = await generateEditorialDraft({
      prompt,
      title,
      sourceContent,
    });
  } finally {
    spinner.stop();
  }

  if (!aiResult?.content) {
    console.warn(`${label} AI returned empty content, skipped: ${title}`);
    return false;
  }

  const draftFile = buildDraftFile({
    title,
    slug,
    sourceMirrorPath: item.sourceMirrorPath,
    aiResult,
  });

  await fs.mkdir(draftRoot, { recursive: true });
  await fs.writeFile(draftAbsPath, draftFile, "utf-8");

  const itemDuration = formatDuration(Date.now() - itemStartedAt);
  console.log(`${label} Done ${path.relative(vaultRoot, draftAbsPath)} (${itemDuration})`);
  return true;
}

async function main() {
  const startedAt = Date.now();
  const latestInbox = await getLatestInboxFile();
  const inboxContent = await fs.readFile(latestInbox, "utf-8");

  const items = parseCheckedItems(inboxContent);

  if (items.length === 0) {
    console.log("No checked items found.");
    console.log(`Inbox: ${latestInbox}`);
    return;
  }

  const prompt = await fs.readFile(promptPath, "utf-8");

  let created = 0;
  let processed = 0;

  console.log("Editorial started");
  console.log(`Inbox: ${latestInbox}`);
  console.log(`Checked items: ${items.length}`);
  console.log("");

  for (const [index, item] of items.entries()) {
    const ok = await processItem({
      item,
      prompt,
      current: index + 1,
      total: items.length,
    });
    processed++;
    if (ok) created++;
  }

  const completedAt = new Date();

  console.log("");
  console.log("Editorial completed");
  console.log(`Inbox: ${latestInbox}`);
  console.log(`Checked items: ${items.length}`);
  console.log(`Processed items: ${processed}`);
  console.log(`Created drafts: ${created}`);
  console.log(`Completed at: ${formatDateTime(completedAt)}`);
  console.log(`Duration: ${formatDuration(completedAt.getTime() - startedAt)}`);
}

main().catch((error) => {
  console.error("Editorial failed");
  console.error(error);
  process.exit(1);
});
