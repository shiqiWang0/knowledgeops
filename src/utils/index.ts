import { spawn } from "node:child_process";
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


export function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; inherit?: boolean }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed\n${stderr}`));
      }
    });
  });
}