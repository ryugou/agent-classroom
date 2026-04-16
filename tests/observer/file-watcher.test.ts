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

  it('emits onFileAdded and onFileClosed callbacks', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 's1.jsonl');
    writeFileSync(file, '');

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
    await vi.advanceTimersByTimeAsync(1500);
    expect(added).toContain(file);

    // 変更後、staleThresholdMs を超えたら closed
    await vi.advanceTimersByTimeAsync(3000);
    expect(closed).toContain(file);

    fw.stop();
  });
});
