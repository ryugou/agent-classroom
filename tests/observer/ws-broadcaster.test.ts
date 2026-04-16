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
});
