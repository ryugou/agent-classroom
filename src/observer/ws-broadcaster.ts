import type { ClassroomManager } from './classroom-manager.js';
import type { ObservationEvent, AgentState } from '../shared/events.js';
import type { WSMessage, SchoolhouseSnapshot, ClassroomSnapshot } from '../shared/ws-messages.js';
import type { ClassroomId } from '../shared/ids.js';
import { asStudentId } from '../shared/ids.js';

export interface BroadcasterOptions {
  manager: ClassroomManager;
  initialSnapshot: SchoolhouseSnapshot;
  layoutFilePath: string;  // actual resolved path for user-facing messages
}

export class Broadcaster {
  private snapshot: SchoolhouseSnapshot;
  private readonly manager: ClassroomManager;
  private readonly layoutFilePath: string;
  private subs: ((msg: WSMessage) => void)[] = [];

  constructor(opts: BroadcasterOptions) {
    this.manager = opts.manager;
    this.snapshot = opts.initialSnapshot;
    this.layoutFilePath = opts.layoutFilePath;
  }

  subscribe(fn: (msg: WSMessage) => void): () => void {
    this.subs.push(fn);
    fn({ type: 'ClassroomList', snapshot: this.snapshot });
    return () => { this.subs = this.subs.filter((s) => s !== fn); };
  }

  ingest(ev: ObservationEvent): void {
    switch (ev.type) {
      case 'SessionStarted': {
        const res = this.manager.assign(ev.sessionId, ev.cwd);
        if (!res.ok) {
          this.broadcast({ type: 'Toast', level: 'warn', message: `教室が全て埋まっています (session=${ev.sessionId})。--classrooms を増やして再起動するか、${this.layoutFilePath} を削除して再初期化してください。` });
          return;
        }

        if (res.role === 'teacher') {
          // Check for duplicate teacher announcement
          const existing = this.snapshot.classrooms.find((c) => c.id === res.classroomId);
          if (existing?.occupant?.sessionId === ev.sessionId) return;
          this.patchSnapshot(res.classroomId, (c) => ({
            ...c,
            occupant: { sessionId: ev.sessionId, cwd: ev.cwd, teacherState: 'idle', students: [] },
          }));
          this.broadcast({ type: 'TeacherEntered', classroomId: res.classroomId, sessionId: ev.sessionId, cwd: ev.cwd });
        } else {
          // Teammate session → show as student
          const studentId = asStudentId(ev.sessionId);
          // Dedup: don't add if already present
          const classroom = this.snapshot.classrooms.find((c) => c.id === res.classroomId);
          if (classroom?.occupant?.students.some((s) => s.id === studentId)) return;
          this.patchSnapshot(res.classroomId, (c) => {
            if (!c.occupant) return c;
            return { ...c, occupant: { ...c.occupant, students: [...c.occupant.students, { id: studentId, state: 'idle' as AgentState }] } };
          });
          this.broadcast({ type: 'StudentEntered', classroomId: res.classroomId, studentId });
        }
        break;
      }
      case 'SessionEnded': {
        const result = this.manager.release(ev.sessionId);
        if (!result) return; // stale event after session ended — ignore
        const { classroomId, promoted } = result;

        // Check if this session was a student (teammate)
        const studentId = asStudentId(ev.sessionId);
        const classroom = this.snapshot.classrooms.find((c) => c.id === classroomId);
        const isStudent = classroom?.occupant?.students.some((s) => s.id === studentId) ?? false;

        if (isStudent) {
          // Remove student
          this.patchSnapshot(classroomId, (c) => {
            if (!c.occupant) return c;
            return { ...c, occupant: { ...c.occupant, students: c.occupant.students.filter((s) => s.id !== studentId) } };
          });
          this.broadcast({ type: 'StudentLeft', classroomId, studentId });
        } else {
          // Teacher left
          if (promoted) {
            // Promote a student to teacher — update occupant sessionId
            const promotedStudentId = asStudentId(promoted);
            this.patchSnapshot(classroomId, (c) => {
              if (!c.occupant) return c;
              return {
                ...c,
                occupant: {
                  ...c.occupant,
                  sessionId: promoted,
                  students: c.occupant.students.filter((s) => s.id !== promotedStudentId),
                },
              };
            });
            // promoted teacher inherits the classroom's existing cwd (may be '' if original teacher had no cwd)
            this.broadcast({ type: 'TeacherEntered', classroomId, sessionId: promoted, cwd: classroom?.occupant?.cwd ?? '' });
            this.broadcast({ type: 'TeacherLeft', classroomId, sessionId: ev.sessionId });
          } else {
            // Last session, classroom empty
            this.patchSnapshot(classroomId, (c) => ({ ...c, occupant: null }));
            this.broadcast({ type: 'TeacherLeft', classroomId, sessionId: ev.sessionId });
          }
        }
        break;
      }
      case 'StudentSpawned': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return; // stale event after session ended — ignore
        const classroom = this.snapshot.classrooms.find((c) => c.id === cid);
        if (!classroom?.occupant) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: [...c.occupant.students, { id: ev.studentId, state: 'active' }] } };
        });
        this.broadcast({ type: 'StudentEntered', classroomId: cid, studentId: ev.studentId });
        break;
      }
      case 'StudentDespawned': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return; // stale event after session ended — ignore
        const classroom = this.snapshot.classrooms.find((c) => c.id === cid);
        if (!classroom?.occupant) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: c.occupant.students.filter((s) => s.id !== ev.studentId) } };
        });
        this.broadcast({ type: 'StudentLeft', classroomId: cid, studentId: ev.studentId });
        break;
      }
      case 'StateChanged': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return; // stale event after session ended — ignore
        const classroom = this.snapshot.classrooms.find((c) => c.id === cid);
        if (!classroom?.occupant) return; // no teacher/students to change state for
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
