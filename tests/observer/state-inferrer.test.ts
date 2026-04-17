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
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 100 });
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
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_x', toolName: 'Bash', isBackground: false, at: 2300 });
    vi.advanceTimersByTime(5000);
    const idles = events.filter((e) => e.type === 'StateChanged' && e.state === 'idle');
    expect(idles).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });

  it('non-exempt tool_result + 7s silence → permission', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 400 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 450 });
    vi.advanceTimersByTime(7000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'permission' }));
  });

  it('exempt tool_result does not trigger permission', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_2', toolName: 'Read', isBackground: false, at: 500 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_2', at: 550 });
    vi.advanceTimersByTime(7000);
    const perms = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(perms).toHaveLength(0);
  });

  it('permission timer survives unrelated ProgressDetected events', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 0 });
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

  it('cancels pending permission timer when TurnDurationDetected arrives', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 0 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 50 });
    // TurnDurationDetected fires before the 7s timer
    inf.ingest({ kind: 'TurnDurationDetected', at: 100 });
    vi.advanceTimersByTime(10_000);
    const permissions = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(permissions).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'idle' }));
  });

  it('cancels pending permission timer when TextOnlyAssistant arrives', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 0 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 50 });
    inf.ingest({ kind: 'TextOnlyAssistant', at: 100 });
    vi.advanceTimersByTime(10_000);
    const permissions = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(permissions).toHaveLength(0);
  });

  it('progress with new agentId → StudentSpawned; event=stop → StudentDespawned', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'sub_a', event: 'tool_use', at: 600 });
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'sub_a', event: 'stop', at: 700 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentSpawned' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentDespawned' }));
  });

  it('Agent tool_use → StudentSpawned with toolUseId as studentId', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_agent_1', toolName: 'Agent', isBackground: false, at: 800 });
    const spawns = events.filter((e) => e.type === 'StudentSpawned');
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({
      type: 'StudentSpawned',
      sessionId,
      studentId: 'tu_agent_1',
      parentToolUseId: 'tu_agent_1',
      spawnedAt: 800,
    });
  });

  it('Agent tool_result → StudentDespawned', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_agent_2', toolName: 'Agent', isBackground: false, at: 900 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_agent_2', at: 1000 });
    const despawns = events.filter((e) => e.type === 'StudentDespawned');
    expect(despawns).toHaveLength(1);
    expect(despawns[0]).toMatchObject({
      type: 'StudentDespawned',
      sessionId,
      studentId: 'tu_agent_2',
      despawnedAt: 1000,
    });
  });

  it('non-Agent tool_use does not emit StudentSpawned', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_bash', toolName: 'Bash', isBackground: false, at: 1100 });
    const spawns = events.filter((e) => e.type === 'StudentSpawned');
    expect(spawns).toHaveLength(0);
  });

  it('cancels pending permission timer when a new ToolResultDetected arrives', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 0 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 50 });
    // Second non-exempt tool before the 7s timer fires
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_2', toolName: 'Edit', isBackground: false, at: 1000 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_2', at: 1050 });
    vi.advanceTimersByTime(6500);
    // The first timer (tu_1) would have fired at 7000ms had it not been cancelled
    // Only one permission should ever fire — from tu_2's timer
    const permissions = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(permissions).toHaveLength(0);
    vi.advanceTimersByTime(1000);  // total elapsed from tu_2 = 7500
    const permissionsAfter = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(permissionsAfter).toHaveLength(1);
  });

  it('cancels pending permission timer when an exempt ToolResultDetected arrives', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', isBackground: false, at: 0 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 50 });
    // Exempt tool's result should cancel the pending non-exempt permission timer
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_2', toolName: 'Read', isBackground: false, at: 1000 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_2', at: 1050 });
    vi.advanceTimersByTime(10_000);
    const permissions = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(permissions).toHaveLength(0);
  });

  it('does not despawn background Agent on immediate tool_result, despawns on BackgroundAgentCompleted', () => {
    const inf = makeInferrer();
    // Background Agent dispatch
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_bg', toolName: 'Agent', isBackground: true, at: 0 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentSpawned' }));

    // Immediate ack tool_result — should NOT despawn
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_bg', at: 3 });
    const despawnsAfterAck = events.filter((e) => e.type === 'StudentDespawned');
    expect(despawnsAfterAck).toHaveLength(0);

    // Real completion via queue-operation
    inf.ingest({ kind: 'BackgroundAgentCompleted', toolUseId: 'tu_bg', at: 10000 });
    const despawnsAfterComplete = events.filter((e) => e.type === 'StudentDespawned');
    expect(despawnsAfterComplete).toHaveLength(1);
    expect(despawnsAfterComplete[0]).toMatchObject({
      type: 'StudentDespawned',
      sessionId,
      studentId: 'tu_bg',
      despawnedAt: 10000,
    });
  });

  it('despawns foreground Agent normally on tool_result', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_fg', toolName: 'Agent', isBackground: false, at: 0 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentSpawned' }));

    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_fg', at: 5000 });
    const despawns = events.filter((e) => e.type === 'StudentDespawned');
    expect(despawns).toHaveLength(1);
    expect(despawns[0]).toMatchObject({
      type: 'StudentDespawned',
      sessionId,
      studentId: 'tu_fg',
      despawnedAt: 5000,
    });
  });

  it('BackgroundAgentCompleted for unknown toolUseId does nothing', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'BackgroundAgentCompleted', toolUseId: 'tu_unknown', at: 5000 });
    const despawns = events.filter((e) => e.type === 'StudentDespawned');
    expect(despawns).toHaveLength(0);
  });
});
