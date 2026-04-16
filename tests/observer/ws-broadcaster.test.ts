import { describe, it, expect } from 'vitest';
import { Broadcaster } from '../../src/observer/ws-broadcaster.js';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { newClassroomId, asSessionId, asStudentId } from '../../src/shared/ids.js';
import type { WSMessage } from '../../src/shared/ws-messages.js';
import type { LayoutTemplate } from '../../src/shared/persistence.js';

const tpl: LayoutTemplate = {
  id: 'default', cols: 10, rows: 7, tiles: Array(70).fill(1), seats: [], teacherDesk: { row: 0, col: 0 },
};
const ids = [newClassroomId(0), newClassroomId(1)];

describe('Broadcaster', () => {
  it('sends ClassroomList on new subscription', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    expect(received[0]).toMatchObject({ type: 'ClassroomList' });
  });

  it('translates SessionStarted → TeacherEntered delta for the assigned classroom', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/tmp', startedAt: 0 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherEntered', classroomId: ids[0] }));
  });

  it('emits Toast on overflow', () => {
    const mgr = new ClassroomManager([newClassroomId(0)]);  // N=1
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 1, rows: 1 },
        classrooms: [{ id: newClassroomId(0), gridPos: { row: 0, col: 0 }, layoutTemplateId: 'default', occupant: null }],
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s2'), cwd: '', startedAt: 0 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'Toast', level: 'warn' }));
  });

  it('emits StateChanged delta', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 0 });
    b.ingest({ type: 'StateChanged', sessionId: asSessionId('s1'), target: 'teacher', state: 'active', changedAt: 10 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });

  it('emits TeacherLeft and clears occupant on SessionEnded', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 0 });
    b.ingest({ type: 'SessionEnded', sessionId: asSessionId('s1'), endedAt: 10 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherLeft', classroomId: ids[0] }));

    // Re-subscribe to see snapshot: occupant should be null again
    const later: WSMessage[] = [];
    b.subscribe((m) => later.push(m));
    const list = later[0];
    if (list?.type !== 'ClassroomList') throw new Error('expected ClassroomList');
    expect(list.snapshot.classrooms[0]!.occupant).toBeNull();
  });

  it('does not double-announce for duplicate SessionStarted and preserves student state', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 0 });
    b.ingest({ type: 'StudentSpawned', sessionId: asSessionId('s1'), studentId: asStudentId('stu'), parentToolUseId: 'tu_1', spawnedAt: 10 });
    received.length = 0;

    // Duplicate SessionStarted should be a no-op
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 20 });
    expect(received.filter((m) => m.type === 'TeacherEntered')).toHaveLength(0);

    // Verify student preserved
    const later: WSMessage[] = [];
    b.subscribe((m) => later.push(m));
    const list = later[0];
    if (list?.type !== 'ClassroomList') throw new Error('expected ClassroomList');
    expect(list.snapshot.classrooms[0]!.occupant?.students).toHaveLength(1);
  });

  it('ignores StudentSpawned / StateChanged for session without occupant (stale)', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    // Stale event for session that was never started
    b.ingest({ type: 'StudentSpawned', sessionId: asSessionId('ghost'), studentId: asStudentId('stu'), parentToolUseId: 'tu', spawnedAt: 0 });
    b.ingest({ type: 'StateChanged', sessionId: asSessionId('ghost'), target: 'teacher', state: 'active', changedAt: 0 });
    expect(received).toHaveLength(0);
  });
});
