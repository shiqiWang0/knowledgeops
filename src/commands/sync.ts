import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import fg from "fast-glob";
import matter from "gray-matter";

const VAULT_DIR = process.env.VAULT_DIR;
const YUQUE_SOURCE_DIR = process.env.YUQUE_SOURCE_DIR;
const SOURCE_MIRROR_DIR = process.env.SOURCE_MIRROR_DIR || "00_source";

if (!VAULT_DIR) {
  throw new Error("Missing env: VAULT_DIR");
}

if (!YUQUE_SOURCE_DIR) {
  throw new Error("Missing env: YUQUE_SOURCE_DIR");
}

const sourceRoot = path.resolve(YUQUE_SOURCE_DIR);
const mirrorRoot = path.join(path.resolve(VAULT_DIR), SOURCE_MIRROR_DIR);
const manifestDir = path.join(path.resolve(VAULT_DIR), "manifest");
const indexPath = path.join(manifestDir, "source-index.json");

type SourceIndexItem = {
  title: string;
  source: "yuque";
  sourcePath: string;
  mirrorPath: string;
  relativePath: string;
  hash: string;
  size: number;
  syncedAt: string;
  mtimeMs: number;
};

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hashContent(content: Buffer | string) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function cleanAndCopySourceToMirror() {
  await fs.rm(mirrorRoot, { recursive: true, force: true });
  await fs.mkdir(mirrorRoot, { recursive: true });

  await fs.cp(sourceRoot, mirrorRoot, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: async (src) => {
      const name = path.basename(src);

      // 跳过常见无关文件
      if (name === ".git") return false;
      if (name === "node_modules") return false;
      if (name === ".DS_Store") return false;

      return true;
    },
  });
}

async function buildSourceIndex(): Promise<SourceIndexItem[]> {
  await fs.mkdir(manifestDir, { recursive: true });

  const files = await fg("**/*.md", {
    cwd: mirrorRoot,
    absolute: true,
    onlyFiles: true,
    dot: false,
  });

  const syncedAt = new Date().toISOString();
  const items: SourceIndexItem[] = [];

  for (const file of files) {
    const rawBuffer = await fs.readFile(file);
    const rawText = rawBuffer.toString("utf-8");
    const parsed = matter(rawText);
    const stat = await fs.stat(file);

    const relativePath = path.relative(mirrorRoot, file);
    const mirrorPath = path.relative(path.resolve(VAULT_DIR!), file);

    items.push({
      title: parsed.data.title || path.basename(file, ".md"),
      source: "yuque",
      sourcePath: path.join(sourceRoot, relativePath),
      mirrorPath,
      relativePath,
      hash: hashContent(rawBuffer),
      size: stat.size,
      syncedAt,
      mtimeMs: stat.mtimeMs,
    });
  }

  items.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));

  await fs.writeFile(indexPath, JSON.stringify(items, null, 2), "utf-8");

  return items;
}

async function main() {
  if (!(await pathExists(sourceRoot))) {
    throw new Error(`YUQUE_SOURCE_DIR not found: ${sourceRoot}`);
  }

  if (!(await pathExists(path.resolve(VAULT_DIR!)))) {
    throw new Error(`VAULT_DIR not found: ${VAULT_DIR}`);
  }

  console.log("KnowledgeOps sync started");
  console.log(`Source: ${sourceRoot}`);
  console.log(`Mirror: ${mirrorRoot}`);

  await cleanAndCopySourceToMirror();

  const items = await buildSourceIndex();

  console.log("");
  console.log("Sync completed");
  console.log(`Markdown files: ${items.length}`);
  console.log(`Index: ${indexPath}`);
}

main().catch((error) => {
  console.error("");
  console.error("Sync failed");
  console.error(error);
  process.exit(1);
});