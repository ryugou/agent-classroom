import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWatcher } from '../../src/observer/parser/file-watcher.js';

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'ac-fw-')); vi.useFakeTimers(); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); vi.useRealTimers(); });

describe('FileWatcher', () => {
  it('detects new .jsonl files and yields lines', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'abc.jsonl');
    writeFileSync(file, '');

    const received: { path: string; line: string }[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (path, line) => received.push({ path, line }),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
    });
    fw.start();

    // File existed at first scan (historical). New bytes trigger tailing.
    appendFileSync(file, '{"type":"assistant","timestamp":1}\n');
    await vi.advanceTimersByTimeAsync(1500);
    expect(received.some((r) => r.line.includes('assistant'))).toBe(true);

    fw.stop();
  });

  it('ignores non-jsonl files', async () => {
    mkdirSync(join(base, 'proj'));
    writeFileSync(join(base, 'proj', 'notes.txt'), 'hello\n');
    const received: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => received.push(l),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(received).toHaveLength(0);
    fw.stop();
  });

  it('emits only new lines on subsequent appends', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'seq.jsonl');
    writeFileSync(file, '');
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
    });
    fw.start();

    appendFileSync(file, '{"a":1}\n');
    await vi.advanceTimersByTimeAsync(1500);
    expect(lines).toEqual(['{"a":1}']);

    appendFileSync(file, '{"b":2}\n{"c":3}\n');
    await vi.advanceTimersByTimeAsync(1500);
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);

    fw.stop();
  });

  it('buffers partial lines until newline arrives', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'partial.jsonl');
    writeFileSync(file, '');
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
    });
    fw.start();

    appendFileSync(file, '{"part":"A"');   // no trailing newline
    await vi.advanceTimersByTimeAsync(1500);
    expect(lines).toEqual([]);             // nothing emitted yet

    appendFileSync(file, '}\n');           // complete the line
    await vi.advanceTimersByTimeAsync(1500);
    expect(lines).toEqual(['{"part":"A"}']);

    fw.stop();
  });

  it('emits onFileAdded and onFileClosed callbacks for new files created after start', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);

    const added: string[] = [];
    const closed: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: () => {},
      onFileAdded: (p) => added.push(p),
      onFileClosed: (p) => closed.push(p),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
      staleThresholdMs: 2000,
    });
    fw.start();

    // Create file AFTER start — counts as a new session, onFileAdded fires immediately at scan.
    const file = join(projectDir, 's1.jsonl');
    writeFileSync(file, '');
    await vi.advanceTimersByTimeAsync(1500);
    expect(added).toContain(file);

    // After staleThresholdMs with no activity, onFileClosed fires.
    await vi.advanceTimersByTimeAsync(3000);
    expect(closed).toContain(file);

    fw.stop();
  });

  // --- Regression tests for cold-start fix ---

  it('does not emit onFileAdded for pre-existing files at first scan', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'historical.jsonl');
    writeFileSync(file, '{"type":"assistant","timestamp":0}\n'.repeat(5));

    const added: string[] = [];
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      onFileAdded: (p) => added.push(p),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(added).toEqual([]);   // historical file — not emitted
    expect(lines).toEqual([]);   // not tailed from offset 0
    fw.stop();
  });

  it('emits onFileAdded when a historical file grows after boot', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'resumed.jsonl');
    writeFileSync(file, '{"type":"assistant","timestamp":0}\n');

    const added: string[] = [];
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      onFileAdded: (p) => added.push(p),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(added).toEqual([]);   // still no emit — file hasn't grown

    appendFileSync(file, '{"type":"user","timestamp":1}\n');
    await vi.advanceTimersByTimeAsync(300);
    expect(added).toContain(file);                              // now emitted
    expect(lines.some((l) => l.includes('"user"'))).toBe(true); // only new bytes
    fw.stop();
  });

  it('emits onFileAdded immediately for files created after start', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);

    const added: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: () => {},
      onFileAdded: (p) => added.push(p),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(200); // first scan complete

    const file = join(projectDir, 'new-session.jsonl');
    writeFileSync(file, '');
    await vi.advanceTimersByTimeAsync(200);
    expect(added).toContain(file); // post-boot file → immediate emit at scan
    fw.stop();
  });

  // --- UTF-8 / chunk-boundary regression tests ---

  it('handles lines split across 64KB chunk boundaries', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'big.jsonl');
    writeFileSync(file, '');
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(200);

    // Write a line longer than 64KB so multiple tail cycles are needed
    const bigPayload = 'x'.repeat(70_000);
    appendFileSync(file, `{"type":"marker","data":"${bigPayload}"}\n`);

    // Allow several tail cycles to drain
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('marker');
    expect(lines[0]!.length).toBeGreaterThan(70_000);

    fw.stop();
  });

  it('preserves multi-byte UTF-8 characters across chunk boundaries', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'utf8.jsonl');
    writeFileSync(file, '');
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(200);

    // Japanese text padded to exceed 64KB chunk boundary
    const jp = 'あ'.repeat(30_000);  // 30k × 3 bytes = 90KB
    appendFileSync(file, `{"type":"japanese","text":"${jp}"}\n`);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.text).toBe(jp);

    fw.stop();
  });

  it('resumes tailing a historical file that grows after stale threshold expires', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'resumed.jsonl');
    writeFileSync(file, '{"type":"assistant","timestamp":0}\n');
    const added: string[] = [];
    const lines: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => lines.push(l),
      onFileAdded: (p) => added.push(p),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
      staleThresholdMs: 300,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(added).toEqual([]);

    // Wait past stale threshold without activity
    await vi.advanceTimersByTimeAsync(500);
    expect(added).toEqual([]);

    // Now the file grows (user resumed the session)
    appendFileSync(file, '{"type":"user","timestamp":1}\n');
    await vi.advanceTimersByTimeAsync(300);
    expect(added).toContain(file);
    expect(lines.some((l) => l.includes('"user"'))).toBe(true);

    fw.stop();
  });

  it('drops tracked entry + fires onFileClosed when tracked file is deleted', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'transient.jsonl');
    writeFileSync(file, '');
    const added: string[] = [];
    const closed: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: () => {},
      onFileAdded: (p) => added.push(p),
      onFileClosed: (p) => closed.push(p),
      scanIntervalMs: 200,
      tailIntervalMs: 50,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(300);
    // File was created BEFORE fw.start() — historical, so no added yet
    appendFileSync(file, '{"type":"user","timestamp":0}\n');
    await vi.advanceTimersByTimeAsync(300);
    expect(added).toContain(file);

    // Delete the file — tailOne should drop it + fire onFileClosed (since emitted)
    rmSync(file);
    await vi.advanceTimersByTimeAsync(300);
    expect(closed).toContain(file);

    fw.stop();
  });

  it('does not emit SessionEnded for unemitted historical files at stale timeout', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'historical.jsonl');
    writeFileSync(file, '{"type":"assistant","timestamp":0}\n');
    const added: string[] = [];
    const closed: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: () => {},
      onFileAdded: (p) => added.push(p),
      onFileClosed: (p) => closed.push(p),
      scanIntervalMs: 100,
      tailIntervalMs: 50,
      staleThresholdMs: 500,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(added).toEqual([]);

    // Wait past stale threshold without any activity
    await vi.advanceTimersByTimeAsync(1000);
    expect(added).toEqual([]);
    expect(closed).toEqual([]);  // should NOT fire for never-emitted file

    fw.stop();
  });
});
