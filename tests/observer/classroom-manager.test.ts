import { describe, it, expect } from 'vitest';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { asSessionId, newClassroomId } from '../../src/shared/ids.js';

const ids = [newClassroomId(0), newClassroomId(1), newClassroomId(2)];

describe('ClassroomManager', () => {
  it('assigns to minimum empty classroom', () => {
    const mgr = new ClassroomManager(ids);
    const result = mgr.assign(asSessionId('s1'), 'project-a');
    expect(result).toEqual({ ok: true, classroomId: ids[0], role: 'teacher' });
  });

  it('skips occupied classrooms (different projects)', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), 'project-a');
    mgr.assign(asSessionId('s2'), 'project-b');
    const result = mgr.assign(asSessionId('s3'), 'project-c');
    expect(result).toEqual({ ok: true, classroomId: ids[2], role: 'teacher' });
  });

  it('reports overflow when all full', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), 'project-a');
    mgr.assign(asSessionId('s2'), 'project-b');
    mgr.assign(asSessionId('s3'), 'project-c');
    const result = mgr.assign(asSessionId('s4'), 'project-d');
    expect(result).toEqual({ ok: false, reason: 'overflow' });
  });

  it('reuses the same classroom id when same session assigned twice', () => {
    const mgr = new ClassroomManager(ids);
    const r1 = mgr.assign(asSessionId('s1'), 'project-a');
    const r2 = mgr.assign(asSessionId('s1'), 'project-a');
    expect(r1).toEqual(r2);
  });

  it('releases classroom on end', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), 'project-a');
    mgr.assign(asSessionId('s2'), 'project-b');
    mgr.release(asSessionId('s1'));
    const result = mgr.assign(asSessionId('s3'), 'project-c');
    expect(result).toEqual({ ok: true, classroomId: ids[0], role: 'teacher' });
  });

  it('release of unknown session is a no-op', () => {
    const mgr = new ClassroomManager(ids);
    expect(() => mgr.release(asSessionId('unknown'))).not.toThrow();
  });

  it('exposes current teacher via occupantOf', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), 'project-a');
    expect(mgr.occupantOf(ids[0])).toBe('s1');
    expect(mgr.occupantOf(ids[1])).toBeNull();
  });

  it('classroomOf returns assigned id and null for unknown', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), 'project-a');
    expect(mgr.classroomOf(asSessionId('s1'))).toBe(ids[0]);
    expect(mgr.classroomOf(asSessionId('s_unknown'))).toBeNull();
  });

  it('constructor throws on empty classroom list', () => {
    expect(() => new ClassroomManager([])).toThrow(/empty/);
  });

  it('release returns classroom id and promoted for known session, null for unknown', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), 'project-a');
    expect(mgr.release(asSessionId('s1'))).toEqual({ classroomId: ids[0], promoted: null });
    expect(mgr.release(asSessionId('unknown'))).toBeNull();
  });

  // --- Project-based grouping tests ---

  it('same project → same classroom, second session is student', () => {
    const mgr = new ClassroomManager(ids);
    const r1 = mgr.assign(asSessionId('s1'), '/my/project');
    const r2 = mgr.assign(asSessionId('s2'), '/my/project');
    expect(r1).toEqual({ ok: true, classroomId: ids[0], role: 'teacher' });
    expect(r2).toEqual({ ok: true, classroomId: ids[0], role: 'student' });
  });

  it('different projects → different classrooms', () => {
    const mgr = new ClassroomManager(ids);
    const r1 = mgr.assign(asSessionId('s1'), '/project-a');
    const r2 = mgr.assign(asSessionId('s2'), '/project-b');
    expect(r1).toEqual({ ok: true, classroomId: ids[0], role: 'teacher' });
    expect(r2).toEqual({ ok: true, classroomId: ids[1], role: 'teacher' });
  });

  it('teacher promotion on teacher release with remaining students', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('teacher'), '/proj');
    mgr.assign(asSessionId('student1'), '/proj');
    mgr.assign(asSessionId('student2'), '/proj');

    const result = mgr.release(asSessionId('teacher'));
    expect(result).not.toBeNull();
    expect(result!.classroomId).toBe(ids[0]);
    expect(result!.promoted).toBe('student1');

    // The promoted session should now be the teacher
    expect(mgr.occupantOf(ids[0])).toBe('student1');
  });

  it('releasing a student does not promote anyone', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('teacher'), '/proj');
    mgr.assign(asSessionId('student1'), '/proj');

    const result = mgr.release(asSessionId('student1'));
    expect(result).toEqual({ classroomId: ids[0], promoted: null });
    expect(mgr.occupantOf(ids[0])).toBe('teacher');
  });

  it('releasing all sessions frees the classroom for a new project', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'), '/proj-a');
    mgr.assign(asSessionId('s2'), '/proj-a');
    mgr.release(asSessionId('s1'));
    mgr.release(asSessionId('s2'));

    // Classroom should now be free for a different project
    const result = mgr.assign(asSessionId('s3'), '/proj-b');
    expect(result).toEqual({ ok: true, classroomId: ids[0], role: 'teacher' });
  });

  it('re-assigning an existing student returns student role', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('teacher'), '/proj');
    mgr.assign(asSessionId('student'), '/proj');
    const r2 = mgr.assign(asSessionId('student'), '/proj');
    expect(r2).toEqual({ ok: true, classroomId: ids[0], role: 'student' });
  });
});
