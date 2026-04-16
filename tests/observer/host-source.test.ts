import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostSource } from '../../src/observer/sources/host-source.js';
import type { ObservationEvent } from '../../src/shared/events.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ac-src-')); vi.useFakeTimers(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

describe('HostSource', () => {
  it('emits SessionStarted when new jsonl appears, SessionEnded when stale', async () => {
    const src = new HostSource({ rootDir: root, scanIntervalMs: 100, tailIntervalMs: 50, staleThresholdMs: 500 });
    const events: ObservationEvent[] = [];
    src.on((e) => events.push(e));
    src.start();

    const projDir = join(root, '-tmp-proj');
    mkdirSync(projDir);
    const file = join(projDir, 'abc-uuid.jsonl');
    writeFileSync(file, '');

    await vi.advanceTimersByTimeAsync(200);
    expect(events.some((e) => e.type === 'SessionStarted' && e.sessionId === 'abc-uuid')).toBe(true);

    appendFileSync(file, JSON.stringify({
      type: 'assistant',
      timestamp: 100,
      message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash' }] },
    }) + '\n');

    await vi.advanceTimersByTimeAsync(200);
    expect(events.some((e) => e.type === 'StateChanged' && e.state === 'active')).toBe(true);

    await vi.advanceTimersByTimeAsync(700);  // stale
    expect(events.some((e) => e.type === 'SessionEnded')).toBe(true);

    src.stop();
  });
});
