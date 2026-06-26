export class Spinner {
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private readonly enabled = Boolean(process.stdout.isTTY);
  private frameIndex = 0;
  private timer: NodeJS.Timeout | null = null;
  private text = "";
  private startedAt = Date.now();

  start(text: string) {
    this.text = text;
    this.startedAt = Date.now();

    if (!this.enabled) {
      console.log(text);
      return;
    }

    process.stdout.write("\u001B[?25l");
    this.render();
    this.timer = setInterval(() => this.render(), 80);
  }

  stop(message?: string) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!this.enabled) {
      if (message) console.log(message);
      return;
    }

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write("\u001B[?25h");
    if (message) {
      process.stdout.write(`${message}\n`);
    }
  }

  private render() {
    const frame = this.frames[this.frameIndex % this.frames.length];
    this.frameIndex++;
    const elapsed = formatDuration(Date.now() - this.startedAt);
    const line = this.truncate(`${frame} ${this.text} ${elapsed}`);

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(line);
  }

  private truncate(line: string) {
    const columns = process.stdout.columns || 100;

    if (line.length <= columns - 1) {
      return line;
    }

    return `${line.slice(0, Math.max(0, columns - 2))}…`;
  }
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatDateTime(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}
