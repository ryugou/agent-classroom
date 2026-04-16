import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** Default session-abandoned heuristic (30 minutes). Exported so config layer can reference it. */
export const DEFAULT_STALE_THRESHOLD_MS = 30 * 60_000;

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
  /** Date.now() timestamp of last new bytes read, for stale detection */
  lastActivityAt: number;
  /** incomplete line fragment waiting for its terminating newline */
  lineBuffer: string;
  /**
   * Whether onFileAdded has been emitted for this file.
   * false for files that existed at first scan (historical) — onFileAdded is
   * deferred until the file actually grows (i.e. the user resumes the session).
   * true for files discovered after the first scan (genuinely new sessions).
   */
  emitted: boolean;
  /** Per-file UTF-8 decoder that buffers incomplete multi-byte sequences across chunk boundaries. */
  decoder: StringDecoder;
}

/** Max bytes read from a single file per tail cycle. Prevents event-loop blocking on large backlogs. */
const MAX_READ_BYTES = 64 * 1024; // 64 KB per tail cycle

export class FileWatcher {
  private readonly opts: Required<FileWatcherOptions>;
  private readonly tracked = new Map<string, TrackedFile>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private tailTimer: ReturnType<typeof setInterval> | null = null;
  /** Set to true after the first scanOnce() completes. */
  private firstScanDone = false;

  constructor(opts: FileWatcherOptions) {
    this.opts = {
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
      // DEFAULT_STALE_THRESHOLD_MS: heuristic for "session abandoned".
      // Definitive session-end detection requires hooks mode (Phase 2).
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
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
    this.tracked.clear();
    this.firstScanDone = false;
  }

  private scanOnce(): void {
    const now = Date.now();
    let entries: string[];
    // EACCES or ENOENT here is silently ignored; production path ~/.claude/projects/ is always readable.
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
        if (!this.tracked.has(fp)) {
          if (!this.firstScanDone) {
            // Historical file: track with offset = current size so we only pick
            // up *new* bytes (i.e. the user resumes this session after boot).
            // Do NOT emit onFileAdded — avoid replaying stale transcripts.
            let fileStat;
            try { fileStat = statSync(fp); } catch { continue; }
            this.tracked.set(fp, {
              path: fp,
              offset: fileStat.size,
              lastActivityAt: now,
              lineBuffer: '',
              emitted: false,
              decoder: new StringDecoder('utf8'),
            });
          } else {
            // File appeared after boot — genuine new session; tail from the beginning.
            this.tracked.set(fp, {
              path: fp,
              offset: 0,
              lastActivityAt: now,
              lineBuffer: '',
              emitted: true,
              decoder: new StringDecoder('utf8'),
            });
            this.opts.onFileAdded(fp);
          }
        }
      }
    }

    // Check for stale files
    for (const [path, t] of this.tracked) {
      if (now - t.lastActivityAt > this.opts.staleThresholdMs) {
        if (t.emitted) {
          // Only notify if onFileAdded was previously emitted — avoids unbalanced
          // SessionEnded for historical files that were never started.
          this.tracked.delete(path);
          this.opts.onFileClosed(path);
        }
        // unemitted: leave in tracked, keep waiting for growth so a resumed
        // session can be re-admitted without being permanently blocked.
      }
    }

    // Check historical (unemitted) files for growth at the slower scan rate.
    // This avoids polling them at the faster tailInterval (2Hz) when they are likely idle.
    for (const t of this.tracked.values()) {
      if (!t.emitted) {
        try {
          const s = statSync(t.path);
          if (s.size > t.offset) {
            // File has grown — delegate to tailOne which will emit onFileAdded + read bytes.
            this.tailOne(t);
          }
        } catch {
          // File deleted before growing; unemitted → no onFileClosed
          this.tracked.delete(t.path);
        }
      }
    }

    this.firstScanDone = true;
  }

  private tailAll(): void {
    // Only tail files that have already been emitted (active sessions).
    // Historical files are checked for growth in scanOnce at the slower scan rate.
    for (const t of this.tracked.values()) {
      if (t.emitted) this.tailOne(t);
    }
  }

  private tailOne(t: TrackedFile): void {
    let fileStat;
    try {
      fileStat = statSync(t.path);
    } catch {
      // File was deleted — drop from tracked and notify if we had emitted it
      this.tracked.delete(t.path);
      if (t.emitted) this.opts.onFileClosed(t.path);
      return;
    }
    if (fileStat.size <= t.offset) return;
    // Note: truncation (size < offset) would leave offset stale. Acceptable here because
    // Claude Code JSONL files are append-only.

    const available = fileStat.size - t.offset;
    const readLen = Math.min(available, MAX_READ_BYTES);

    let fd: number;
    try {
      fd = openSync(t.path, 'r');
    } catch {
      // File was deleted between statSync and openSync (race condition) — drop + notify
      this.tracked.delete(t.path);
      if (t.emitted) this.opts.onFileClosed(t.path);
      return;
    }
    try {
      const buf = Buffer.allocUnsafe(readLen);
      const bytesRead = readSync(fd, buf, 0, readLen, t.offset);
      if (bytesRead === 0) return;  // nothing to process
      t.offset += bytesRead;
      t.lastActivityAt = Date.now();

      // For historical files (emitted=false): first new bytes trigger onFileAdded,
      // making this an active session from this point forward.
      if (!t.emitted) {
        this.opts.onFileAdded(t.path);
        t.emitted = true;
      }

      const chunk = t.lineBuffer + t.decoder.write(buf.subarray(0, bytesRead));
      const lines = chunk.split('\n');
      t.lineBuffer = lines.pop() ?? '';  // last element is the incomplete trailing fragment (or '' if buffer ended with \n)
      for (const line of lines) {
        if (line.trim().length > 0) this.opts.onLine(t.path, line);
      }
    } finally {
      closeSync(fd);
    }
  }
}
