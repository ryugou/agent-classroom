import type { SessionId, StudentId } from './ids.js';

export type AgentState = 'active' | 'idle' | 'permission';

export type ObservationEvent =
  | { type: 'SessionStarted'; sessionId: SessionId; cwd: string; startedAt: number }
  | { type: 'SessionEnded'; sessionId: SessionId; endedAt: number }
  | { type: 'StudentSpawned'; sessionId: SessionId; studentId: StudentId; parentToolUseId: string; spawnedAt: number }
  | { type: 'StudentDespawned'; sessionId: SessionId; studentId: StudentId; despawnedAt: number }
  | { type: 'StateChanged'; sessionId: SessionId; target: 'teacher' | StudentId; state: AgentState; changedAt: number };
