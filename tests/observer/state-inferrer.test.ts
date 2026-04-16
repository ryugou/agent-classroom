import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateInferrer } from '../../src/observer/parser/state-inferrer.js';
import { asSessionId } from '../../src/shared/ids.js';
import type { ObservationEvent } from '../../src/shared/events.js';

const sessionId = asSessionId('s1');

describe('StateInferrer', () => {
  let events: ObservationEvent[];
  let now: number;

  const emit = (e: ObservationEvent) => { events.push(e); };
  const makeInferrer = () => new StateInferrer({ sessionId, emit, now: () => now });

  beforeEach(() => { events = []; now = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ToolUseDetected → StateChanged(active)', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', at: 100 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });

  it('TurnDurationDetected → StateChanged(idle)', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'TurnDurationDetected', at: 200 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'idle' }));
  });

  it('TextOnlyAssistant + 5s silence → idle', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'TextOnlyAssistant', at: 300 });
    vi.advanceTimersByTime(5000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'idle' }));
  });

  it('TextOnlyAssistant but next event before 5s → no idle', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'TextOnlyAssistant', at: 300 });
    vi.advanceTimersByTime(2000);
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_x', toolName: 'Bash', at: 2300 });
    vi.advanceTimersByTime(5000);
    const idles = events.filter((e) => e.type === 'StateChanged' && e.state === 'idle');
    expect(idles).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });

  it('non-exempt tool_result + 7s silence → permission', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', at: 400 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 450 });
    vi.advanceTimersByTime(7000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'permission' }));
  });

  it('exempt tool_result does not trigger permission', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_2', toolName: 'Read', at: 500 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_2', at: 550 });
    vi.advanceTimersByTime(7000);
    const perms = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(perms).toHaveLength(0);
  });

  it('permission timer survives unrelated ProgressDetected events', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', at: 0 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 50 });
    // Simulate sub-agent activity while the 7s permission timer is counting down
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_1', agentId: 'sub_a', event: 'tool_use', at: 100 });
    vi.advanceTimersByTime(7000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'permission' }));
  });

  it('stop event for unknown agent does not spawn a phantom student', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'unknown_sub', event: 'stop', at: 0 });
    const spawns = events.filter((e) => e.type === 'StudentSpawned');
    const despawns = events.filter((e) => e.type === 'StudentDespawned');
    expect(spawns).toHaveLength(0);
    expect(despawns).toHaveLength(0);
  });

  it('progress with new agentId → StudentSpawned; event=stop → StudentDespawned', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'sub_a', event: 'tool_use', at: 600 });
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'sub_a', event: 'stop', at: 700 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentSpawned' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentDespawned' }));
  });
});
