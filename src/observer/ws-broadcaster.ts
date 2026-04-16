import type { ClassroomManager } from './classroom-manager.js';
import type { ObservationEvent } from '../shared/events.js';
import type { WSMessage, SchoolhouseSnapshot, ClassroomSnapshot } from '../shared/ws-messages.js';
import type { ClassroomId } from '../shared/ids.js';

export interface BroadcasterOptions {
  manager: ClassroomManager;
  initialSnapshot: SchoolhouseSnapshot;
}

export class Broadcaster {
  private snapshot: SchoolhouseSnapshot;
  private readonly manager: ClassroomManager;
  private subs: ((msg: WSMessage) => void)[] = [];

  constructor(opts: BroadcasterOptions) {
    this.manager = opts.manager;
    this.snapshot = opts.initialSnapshot;
  }

  subscribe(fn: (msg: WSMessage) => void): () => void {
    this.subs.push(fn);
    fn({ type: 'ClassroomList', snapshot: this.snapshot });
    return () => { this.subs = this.subs.filter((s) => s !== fn); };
  }

  ingest(ev: ObservationEvent): void {
    switch (ev.type) {
      case 'SessionStarted': {
        const res = this.manager.assign(ev.sessionId);
        if (!res.ok) {
          this.broadcast({ type: 'Toast', level: 'warn', message: `教室が全て埋まっています (session=${ev.sessionId})。config で classroomCount を増やして再起動してください。` });
          return;
        }
        this.patchSnapshot(res.classroomId, (c) => ({
          ...c,
          occupant: { sessionId: ev.sessionId, teacherState: 'idle', students: [] },
        }));
        this.broadcast({ type: 'TeacherEntered', classroomId: res.classroomId, sessionId: ev.sessionId, cwd: ev.cwd });
        break;
      }
      case 'SessionEnded': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.manager.release(ev.sessionId);
        this.patchSnapshot(cid, (c) => ({ ...c, occupant: null }));
        this.broadcast({ type: 'TeacherLeft', classroomId: cid, sessionId: ev.sessionId });
        break;
      }
      case 'StudentSpawned': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: [...c.occupant.students, { id: ev.studentId, state: 'active' }] } };
        });
        this.broadcast({ type: 'StudentEntered', classroomId: cid, studentId: ev.studentId });
        break;
      }
      case 'StudentDespawned': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: c.occupant.students.filter((s) => s.id !== ev.studentId) } };
        });
        this.broadcast({ type: 'StudentLeft', classroomId: cid, studentId: ev.studentId });
        break;
      }
      case 'StateChanged': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          if (ev.target === 'teacher') return { ...c, occupant: { ...c.occupant, teacherState: ev.state } };
          return {
            ...c,
            occupant: {
              ...c.occupant,
              students: c.occupant.students.map((s) => (s.id === ev.target ? { ...s, state: ev.state } : s)),
            },
          };
        });
        this.broadcast({ type: 'StateChanged', classroomId: cid, target: ev.target, state: ev.state });
        break;
      }
    }
  }

  private patchSnapshot(classroomId: ClassroomId, patch: (c: ClassroomSnapshot) => ClassroomSnapshot): void {
    this.snapshot = {
      ...this.snapshot,
      classrooms: this.snapshot.classrooms.map((c) => (c.id === classroomId ? patch(c) : c)),
    };
  }

  private broadcast(msg: WSMessage): void { for (const fn of [...this.subs]) fn(msg); }
}
