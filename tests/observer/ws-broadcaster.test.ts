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

const makeSnapshot = (classroomIds = ids) => ({
  gridShape: { cols: classroomIds.length, rows: 1 },
  classrooms: classroomIds.map((id, i) => ({
    id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
  })),
  layoutTemplates: [tpl],
});

describe('Broadcaster', () => {
  it('sends ClassroomList on new subscription', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    expect(received[0]).toMatchObject({ type: 'ClassroomList' });
  });

  it('translates SessionStarted → TeacherEntered delta for the assigned classroom', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/tmp', startedAt: 0 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherEntered', classroomId: ids[0] }));
  });

  it('emits Toast on overflow', () => {
    const singleId = [newClassroomId(0)];
    const mgr = new ClassroomManager(singleId);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(singleId),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/proj-a', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s2'), cwd: '/proj-b', startedAt: 0 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'Toast', level: 'warn' }));
  });

  it('emits StateChanged delta', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/proj', startedAt: 0 });
    b.ingest({ type: 'StateChanged', sessionId: asSessionId('s1'), target: 'teacher', state: 'active', changedAt: 10 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });

  it('emits TeacherLeft and clears occupant on SessionEnded', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/proj', startedAt: 0 });
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
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/proj', startedAt: 0 });
    b.ingest({ type: 'StudentSpawned', sessionId: asSessionId('s1'), studentId: asStudentId('stu'), parentToolUseId: 'tu_1', spawnedAt: 10 });
    received.length = 0;

    // Duplicate SessionStarted should be a no-op
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/proj', startedAt: 20 });
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
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    // Stale event for session that was never started
    b.ingest({ type: 'StudentSpawned', sessionId: asSessionId('ghost'), studentId: asStudentId('stu'), parentToolUseId: 'tu', spawnedAt: 0 });
    b.ingest({ type: 'StateChanged', sessionId: asSessionId('ghost'), target: 'teacher', state: 'active', changedAt: 0 });
    expect(received).toHaveLength(0);
  });

  // --- Project-based grouping tests ---

  it('teammate session from same project enters as student', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teacher'), cwd: '/proj', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teammate'), cwd: '/proj', startedAt: 1 });

    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherEntered', classroomId: ids[0] }));
    expect(received).toContainEqual(expect.objectContaining({ type: 'StudentEntered', classroomId: ids[0], studentId: 'teammate' }));

    // Snapshot should have 1 student
    const later: WSMessage[] = [];
    b.subscribe((m) => later.push(m));
    const list = later[0];
    if (list?.type !== 'ClassroomList') throw new Error('expected ClassroomList');
    expect(list.snapshot.classrooms[0]!.occupant?.students).toHaveLength(1);
  });

  it('teammate session ending removes student', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teacher'), cwd: '/proj', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teammate'), cwd: '/proj', startedAt: 1 });
    received.length = 0;

    b.ingest({ type: 'SessionEnded', sessionId: asSessionId('teammate'), endedAt: 10 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'StudentLeft', classroomId: ids[0], studentId: 'teammate' }));
  });

  it('does not duplicate teammate student on repeated SessionStarted', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('leader'), cwd: 'proj-a', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teammate'), cwd: 'proj-a', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teammate'), cwd: 'proj-a', startedAt: 0 }); // duplicate

    const studentEnteredCount = received.filter((m) => m.type === 'StudentEntered').length;
    expect(studentEnteredCount).toBe(1); // not 2
  });

  it('routes teammate StateChanged to student, not teacher', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: { gridShape: { cols: 2, rows: 1 }, classrooms: ids.map((id, i) => ({ id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null })), layoutTemplates: [tpl] },
      layoutFilePath: '/tmp/test.json',
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    // Leader enters as teacher
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('leader'), cwd: 'proj', startedAt: 0 });
    // Teammate enters as student
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('mate'), cwd: 'proj', startedAt: 0 });
    received.length = 0;

    // Teammate's state changes to active — should NOT affect teacherState
    b.ingest({ type: 'StateChanged', sessionId: asSessionId('mate'), target: 'teacher', state: 'active', changedAt: 10 });

    // The StateChanged should target the student, not 'teacher'
    const sc = received.find((m) => m.type === 'StateChanged');
    expect(sc).toBeDefined();
    if (sc?.type === 'StateChanged') {
      expect(sc.target).not.toBe('teacher');
    }

    // Verify snapshot: teacherState should still be 'idle', student should be 'active'
    const later: WSMessage[] = [];
    b.subscribe((m) => later.push(m));
    const snap = later[0];
    if (snap?.type === 'ClassroomList') {
      expect(snap.snapshot.classrooms[0]!.occupant?.teacherState).toBe('idle');
      const mateStudent = snap.snapshot.classrooms[0]!.occupant?.students.find(s => s.id === asStudentId('mate'));
      expect(mateStudent?.state).toBe('active');
    }
  });

  it('teacher leaving with students promotes a student to teacher', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      layoutFilePath: '/tmp/test-layout.json',
      initialSnapshot: makeSnapshot(),
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teacher'), cwd: '/proj', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('teammate'), cwd: '/proj', startedAt: 1 });
    received.length = 0;

    b.ingest({ type: 'SessionEnded', sessionId: asSessionId('teacher'), endedAt: 10 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherLeft', classroomId: ids[0], sessionId: asSessionId('teacher') }));
    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherEntered', classroomId: ids[0], sessionId: asSessionId('teammate') }));

    // Snapshot: promoted session is now the occupant, no students remain
    const later: WSMessage[] = [];
    b.subscribe((m) => later.push(m));
    const list = later[0];
    if (list?.type !== 'ClassroomList') throw new Error('expected ClassroomList');
    const occ = list.snapshot.classrooms[0]!.occupant;
    expect(occ).not.toBeNull();
    expect(occ!.sessionId).toBe('teammate');
    expect(occ!.students).toHaveLength(0);
  });
});
