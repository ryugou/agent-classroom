import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export interface FileWatcherOptions {
  rootDir: string;
  onLine: (path: string, line: string) => void;
  onFileAdded?: (path: string) => void;
  onFileClosed?: (path: string) => void;
  scanIntervalMs?: number;
  tailIntervalMs?: number;
  staleThresholdMs?: number;
}

interface TrackedFile {
  path: string;
  offset: number;
  /** real mtime from statSync, used to detect changes */
  lastMtimeMs: number;
  /** Date.now() timestamp of last observed mtime change, for stale detection */
  lastActivityAt: number;
}

export class FileWatcher {
  private readonly opts: Required<FileWatcherOptions>;
  private readonly tracked = new Map<string, TrackedFile>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private tailTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: FileWatcherOptions) {
    this.opts = {
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
      staleThresholdMs: 120_000,
      onFileAdded: () => {},
      onFileClosed: () => {},
      ...opts,
    };
  }

  start(): void {
    this.scanOnce();
    this.scanTimer = setInterval(() => this.scanOnce(), this.opts.scanIntervalMs);
    this.tailTimer = setInterval(() => this.tailAll(), this.opts.tailIntervalMs);
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tailTimer) clearInterval(this.tailTimer);
    this.scanTimer = null;
    this.tailTimer = null;
  }

  private scanOnce(): void {
    const now = Date.now();
    let entries: string[];
    try { entries = readdirSync(this.opts.rootDir); } catch { return; }

    for (const projDir of entries) {
      const full = join(this.opts.rootDir, projDir);
      let dirStat;
      try { dirStat = statSync(full); } catch { continue; }
      if (!dirStat.isDirectory()) continue;

      let files: string[];
      try { files = readdirSync(full); } catch { continue; }

      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = join(full, f);
        let fileStat;
        try { fileStat = statSync(fp); } catch { continue; }

        if (!this.tracked.has(fp)) {
          this.tracked.set(fp, {
            path: fp,
            offset: 0,
            lastMtimeMs: fileStat.mtimeMs,
            lastActivityAt: now,
          });
          this.opts.onFileAdded(fp);
        } else {
          const t = this.tracked.get(fp)!;
          if (fileStat.mtimeMs !== t.lastMtimeMs) {
            t.lastMtimeMs = fileStat.mtimeMs;
            t.lastActivityAt = now;
          }
        }
      }
    }

    // Check for stale files
    for (const [path, t] of this.tracked) {
      if (now - t.lastActivityAt > this.opts.staleThresholdMs) {
        this.tracked.delete(path);
        this.opts.onFileClosed(path);
      }
    }
  }

  private tailAll(): void {
    for (const t of this.tracked.values()) this.tailOne(t);
  }

  private tailOne(t: TrackedFile): void {
    let fileStat;
    try { fileStat = statSync(t.path); } catch { return; }
    if (fileStat.size <= t.offset) return;

    const fd = openSync(t.path, 'r');
    try {
      const len = fileStat.size - t.offset;
      const buf = Buffer.allocUnsafe(len);
      readSync(fd, buf, 0, len, t.offset);
      t.offset = fileStat.size;
      t.lastMtimeMs = fileStat.mtimeMs;
      t.lastActivityAt = Date.now();
      const chunk = buf.toString('utf8');
      for (const line of chunk.split('\n')) {
        if (line.trim().length > 0) this.opts.onLine(t.path, line);
      }
    } finally {
      closeSync(fd);
    }
  }
}
