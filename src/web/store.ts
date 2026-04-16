import type { WSMessage, SchoolhouseSnapshot, ClassroomSnapshot } from '../shared/ws-messages.js';
import type { ClassroomId } from '../shared/ids.js';

export interface StoreState {
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomSnapshot[];
  layoutTemplates: { id: string }[];
  toasts: { level: 'info' | 'warn' | 'error'; message: string; at: number }[];
}

const EMPTY: StoreState = { gridShape: { cols: 0, rows: 0 }, classrooms: [], layoutTemplates: [], toasts: [] };

export interface Store {
  getState(): StoreState;
  apply(msg: WSMessage): void;
  subscribe(fn: () => void): () => void;
}

export function createStore(): Store {
  let state: StoreState = EMPTY;
  const subs = new Set<() => void>();

  const update = (next: StoreState) => { state = next; for (const fn of subs) fn(); };
  const patchClassroom = (id: ClassroomId, patch: (c: ClassroomSnapshot) => ClassroomSnapshot) =>
    update({ ...state, classrooms: state.classrooms.map((c) => (c.id === id ? patch(c) : c)) });

  const apply = (msg: WSMessage): void => {
    switch (msg.type) {
      case 'ClassroomList': {
        const s: SchoolhouseSnapshot = msg.snapshot;
        update({ gridShape: s.gridShape, classrooms: s.classrooms, layoutTemplates: s.layoutTemplates, toasts: state.toasts });
        break;
      }
      case 'ClassroomUpdate':
        patchClassroom(msg.classroomId, (c) => ({ ...c, ...msg.update }));
        break;
      case 'TeacherEntered':
        patchClassroom(msg.classroomId, (c) => ({
          ...c,
          occupant: { sessionId: msg.sessionId, teacherState: 'idle', students: [] },
        }));
        break;
      case 'TeacherLeft':
        patchClassroom(msg.classroomId, (c) => ({ ...c, occupant: null }));
        break;
      case 'StudentEntered':
        patchClassroom(msg.classroomId, (c) => {
          if (!c.occupant) return c;
          if (c.occupant.students.some((s) => s.id === msg.studentId)) return c;
          return { ...c, occupant: { ...c.occupant, students: [...c.occupant.students, { id: msg.studentId, state: 'active' }] } };
        });
        break;
      case 'StudentLeft':
        patchClassroom(msg.classroomId, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: c.occupant.students.filter((s) => s.id !== msg.studentId) } };
        });
        break;
      case 'StateChanged':
        patchClassroom(msg.classroomId, (c) => {
          if (!c.occupant) return c;
          if (msg.target === 'teacher') return { ...c, occupant: { ...c.occupant, teacherState: msg.state } };
          return {
            ...c,
            occupant: {
              ...c.occupant,
              students: c.occupant.students.map((s) => (s.id === msg.target ? { ...s, state: msg.state } : s)),
            },
          };
        });
        break;
      case 'Toast':
        update({ ...state, toasts: [...state.toasts, { level: msg.level, message: msg.message, at: Date.now() }].slice(-5) });
        break;
    }
  };

  return {
    getState: () => state,
    apply,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
