import { describe, it, expect } from 'vitest';
import { asSessionId, asClassroomId, newClassroomId } from '../../src/shared/ids.js';
import type { ObservationEvent } from '../../src/shared/events.js';
import type { WSMessage, SchoolhouseSnapshot } from '../../src/shared/ws-messages.js';
import type { SchoolhousePersistence } from '../../src/shared/persistence.js';

describe('shared types', () => {
  it('brands ids', () => {
    const s = asSessionId('uuid-1');
    const c = asClassroomId('classroom-001');
    expect(s).toBe('uuid-1');
    expect(c).toBe('classroom-001');
  });

  it('generates zero-padded classroom ids', () => {
    expect(newClassroomId(0)).toBe('classroom-000');
    expect(newClassroomId(9)).toBe('classroom-009');
    expect(newClassroomId(42)).toBe('classroom-042');
  });

  it('ObservationEvent discriminates by type', () => {
    const ev: ObservationEvent = {
      type: 'SessionStarted',
      sessionId: asSessionId('s1'),
      cwd: '/tmp',
      startedAt: Date.now(),
    };
    if (ev.type === 'SessionStarted') expect(ev.cwd).toBe('/tmp');
  });

  it('WSMessage and persistence types compile', () => {
    const ws: WSMessage = { type: 'Toast', level: 'info', message: 'hi' };
    const p: SchoolhousePersistence = {
      version: 1,
      gridShape: { cols: 3, rows: 2 },
      classrooms: [],
      layoutTemplates: [],
    };
    const snap: SchoolhouseSnapshot = {
      gridShape: p.gridShape,
      classrooms: [],
      layoutTemplates: [],
    };
    expect(ws.type).toBe('Toast');
    expect(snap.classrooms).toEqual([]);
  });
});
