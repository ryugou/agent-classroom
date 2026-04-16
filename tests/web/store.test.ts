import { describe, it, expect } from 'vitest';
import { createStore } from '../../src/web/store.js';
import type { WSMessage } from '../../src/shared/ws-messages.js';
import { newClassroomId, asSessionId, asStudentId } from '../../src/shared/ids.js';

const id0 = newClassroomId(0);
const id1 = newClassroomId(1);

const list: WSMessage = {
  type: 'ClassroomList',
  snapshot: {
    gridShape: { cols: 2, rows: 1 },
    classrooms: [
      { id: id0, gridPos: { row: 0, col: 0 }, layoutTemplateId: 'default', occupant: null },
      { id: id1, gridPos: { row: 0, col: 1 }, layoutTemplateId: 'default', occupant: null },
    ],
    layoutTemplates: [{ id: 'default' }],
  },
};

describe('store', () => {
  it('applies ClassroomList as full replacement', () => {
    const s = createStore();
    s.apply(list);
    expect(s.getState().classrooms).toHaveLength(2);
  });

  it('applies TeacherEntered delta', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'TeacherEntered', classroomId: id0, sessionId: asSessionId('s1'), cwd: '/tmp' });
    expect(s.getState().classrooms[0]!.occupant?.sessionId).toBe('s1');
  });

  it('applies StateChanged for teacher', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'TeacherEntered', classroomId: id0, sessionId: asSessionId('s1'), cwd: '' });
    s.apply({ type: 'StateChanged', classroomId: id0, target: 'teacher', state: 'active' });
    expect(s.getState().classrooms[0]!.occupant?.teacherState).toBe('active');
  });

  it('applies StudentEntered/Left', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'TeacherEntered', classroomId: id0, sessionId: asSessionId('s1'), cwd: '' });
    const studentId = asStudentId('stu_a');
    s.apply({ type: 'StudentEntered', classroomId: id0, studentId });
    expect(s.getState().classrooms[0]!.occupant?.students).toEqual([{ id: studentId, state: 'active' }]);
    s.apply({ type: 'StudentLeft', classroomId: id0, studentId });
    expect(s.getState().classrooms[0]!.occupant?.students).toEqual([]);
  });

  it('notifies subscribers', () => {
    const s = createStore();
    let count = 0;
    s.subscribe(() => count++);
    s.apply(list);
    expect(count).toBe(1);
  });

  it('keeps last toast message', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'Toast', level: 'warn', message: 'full' });
    expect(s.getState().toasts.at(-1)?.message).toBe('full');
  });
});
