import type { SessionId, StudentId } from '../../shared/ids.js';
import { asStudentId } from '../../shared/ids.js';
import type { ObservationEvent, AgentState } from '../../shared/events.js';
import type { ParsedRecord } from './transcript-parser.js';

const EXEMPT_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'LS', 'TodoWrite']);
const IDLE_TIMEOUT_MS = 5000;
const PERMISSION_TIMEOUT_MS = 7000;

export interface StateInferrerOptions {
  sessionId: SessionId;
  emit: (event: ObservationEvent) => void;
  now: () => number;
}

export class StateInferrer {
  private readonly opts: StateInferrerOptions;
  // null initial state ensures the first setState call always emits (never skipped by dedup guard)
  private lastState: AgentState | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private permissionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly students = new Map<string, StudentId>();
  private readonly pendingTools = new Map<string, string>();  // toolUseId → toolName; never drained if session killed mid-tool (acceptable for Phase 1)

  constructor(opts: StateInferrerOptions) {
    this.opts = opts;
  }

  ingest(record: ParsedRecord): void {
    this.clearIdleTimer();  // any new ingest cancels pending idle ("something happened")
    // Cancel permission timer on any "definitive state change" signal:
    // ToolUseDetected → new tool starting; TurnDurationDetected → definitive idle;
    // TextOnlyAssistant → assistant producing text, permission should not fire.
    if (record.kind === 'ToolUseDetected' ||
        record.kind === 'TurnDurationDetected' ||
        record.kind === 'TextOnlyAssistant') {
      this.clearPermissionTimer();
    }
    switch (record.kind) {
      case 'ToolUseDetected':
        this.pendingTools.set(record.toolUseId, record.toolName);
        this.setState('active', record.at);
        break;
      case 'TurnDurationDetected':
        this.setState('idle', record.at);
        break;
      case 'TextOnlyAssistant':
        this.idleTimer = setTimeout(
          () => this.setState('idle', this.opts.now()),
          IDLE_TIMEOUT_MS,
        );
        break;
      case 'ToolResultDetected': {
        const toolName = this.pendingTools.get(record.toolUseId);
        this.pendingTools.delete(record.toolUseId);
        if (toolName !== undefined && !EXEMPT_TOOLS.has(toolName)) {
          this.permissionTimer = setTimeout(
            () => this.setState('permission', this.opts.now()),
            PERMISSION_TIMEOUT_MS,
          );
        }
        break;
      }
      case 'ProgressDetected':
        this.handleProgress(record);
        break;
    }
  }

  private handleProgress(r: Extract<ParsedRecord, { kind: 'ProgressDetected' }>): void {
    let sid = this.students.get(r.agentId);
    if (sid === undefined) {
      if (r.event === 'stop') return;  // ignore stop for never-seen agent (likely replay / out-of-order)
      sid = asStudentId(r.agentId);
      this.students.set(r.agentId, sid);
      this.opts.emit({
        type: 'StudentSpawned',
        sessionId: this.opts.sessionId,
        studentId: sid,
        parentToolUseId: r.parentToolUseId,
        spawnedAt: r.at,
      });
    }
    if (r.event === 'stop') {
      this.opts.emit({
        type: 'StudentDespawned',
        sessionId: this.opts.sessionId,
        studentId: sid,
        despawnedAt: r.at,
      });
      this.students.delete(r.agentId);
    }
  }

  private setState(state: AgentState, at: number): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.opts.emit({
      type: 'StateChanged',
      sessionId: this.opts.sessionId,
      target: 'teacher',
      state,
      changedAt: at,
    });
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  private clearPermissionTimer(): void {
    if (this.permissionTimer !== null) { clearTimeout(this.permissionTimer); this.permissionTimer = null; }
  }

  private clearTimers(): void { this.clearIdleTimer(); this.clearPermissionTimer(); }

  /** Must be called to cancel any pending timers before discarding the instance. */
  dispose(): void {
    this.clearTimers();
    this.pendingTools.clear();
    this.students.clear();
  }
}
