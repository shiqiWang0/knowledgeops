import fs from "node:fs/promises";

export function ensureH1(body: string, title: string) {
  const trimmed = body.trim();

  // 只判断正文第一行是不是 H1，不要用 /m 全文匹配
  if (/^#\s+.+$/.test(trimmed.split("\n")[0])) {
    return trimmed;
  }

  return `# ${title}

${trimmed}`;
}


export async function pathExists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export function slugify(input: string) {
    return input
        .trim()
        .replace(/\.md$/i, "")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "-")
        .toLowerCase();
}

export function getH1Title(body: string): string | null {
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}