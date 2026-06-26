import path from "node:path";
import fs from "node:fs/promises";

const VAULT_DIR = process.env.VAULT_DIR;

if (!VAULT_DIR) {
  throw new Error("Missing env: VAULT_DIR");
}

const vaultRoot = path.resolve(VAULT_DIR);
const manifestDir = path.join(vaultRoot, "manifest");
const inboxDir = path.join(
  vaultRoot,
  process.env.INBOX_DIR || "10_editorial_inbox"
);

const currentIndexPath = path.join(manifestDir, "source-index.json");
const prevIndexPath = path.join(manifestDir, "source-index.prev.json");

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

type DiffItem = {
  title: string;
  mirrorPath: string;
  relativePath: string;
  hash: string;
};

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function formatToday() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMap(items: SourceIndexItem[]) {
  return new Map(items.map((item) => [item.relativePath, item]));
}

function buildDiffMarkdown(params: {
  date: string;
  added: DiffItem[];
  updated: DiffItem[];
  deleted: DiffItem[];
}) {
  const { date, added, updated, deleted } = params;

  const renderList = (items: DiffItem[], action: "draft" | "merge" | "archive") => {
    if (items.length === 0) {
      return "- 无";
    }

    return items
      .map((item) => {
        return `- [ ] action: ${action} | title: ${item.title} | path: ${item.mirrorPath}`;
      })
      .join("\n");
  };

  return `# ${date} Yuque Diff

## 新增

${renderList(added, "draft")}

## 更新

${renderList(updated, "merge")}

## 删除

${renderList(deleted, "archive")}

`;
}

async function main() {
  await fs.mkdir(inboxDir, { recursive: true });

  if (!(await pathExists(currentIndexPath))) {
    throw new Error(`source-index.json not found. Run pnpm kb:sync first.`);
  }

  const currentItems = await readJson<SourceIndexItem[]>(currentIndexPath);

  // 第一次运行 diff：没有 prev，就初始化 prev
  if (!(await pathExists(prevIndexPath))) {
    await fs.copyFile(currentIndexPath, prevIndexPath);

    const date = formatToday();
    const inboxPath = path.join(inboxDir, `${date}.md`);

    const content = `# ${date} Yuque Diff

第一次初始化 diff，已创建：

- manifest/source-index.prev.json

本次不产生新增/更新/删除。

`;

    await fs.writeFile(inboxPath, content, "utf-8");

    console.log("Diff initialized");
    console.log(`Prev index created: ${prevIndexPath}`);
    console.log(`Inbox created: ${inboxPath}`);
    return;
  }

  const prevItems = await readJson<SourceIndexItem[]>(prevIndexPath);

  const currentMap = toMap(currentItems);
  const prevMap = toMap(prevItems);

  const added: DiffItem[] = [];
  const updated: DiffItem[] = [];
  const deleted: DiffItem[] = [];

  for (const current of currentItems) {
    const prev = prevMap.get(current.relativePath);

    if (!prev) {
      added.push({
        title: current.title,
        mirrorPath: current.mirrorPath,
        relativePath: current.relativePath,
        hash: current.hash,
      });
      continue;
    }

    if (prev.hash !== current.hash) {
      updated.push({
        title: current.title,
        mirrorPath: current.mirrorPath,
        relativePath: current.relativePath,
        hash: current.hash,
      });
    }
  }

  for (const prev of prevItems) {
    const current = currentMap.get(prev.relativePath);

    if (!current) {
      deleted.push({
        title: prev.title,
        mirrorPath: prev.mirrorPath,
        relativePath: prev.relativePath,
        hash: prev.hash,
      });
    }
  }

  const date = formatToday();
  const inboxPath = path.join(inboxDir, `${date}.md`);

  const content = buildDiffMarkdown({
    date,
    added,
    updated,
    deleted,
  });

  await fs.writeFile(inboxPath, content, "utf-8");

  // 当前 diff 完成后，把当前 index 保存成 prev，供下一次比较
  await fs.copyFile(currentIndexPath, prevIndexPath);

  console.log("Diff completed");
  console.log(`Added: ${added.length}`);
  console.log(`Updated: ${updated.length}`);
  console.log(`Deleted: ${deleted.length}`);
  console.log(`Inbox: ${inboxPath}`);
}

main().catch((error) => {
  console.error("Diff failed");
  console.error(error);
  process.exit(1);
});