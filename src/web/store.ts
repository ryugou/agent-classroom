import type { WSMessage, SchoolhouseSnapshot, ClassroomSnapshot } from '../shared/ws-messages.js';
import type { ClassroomId } from '../shared/ids.js';
import type { LayoutTemplate } from '../shared/persistence.js';

export interface StoreState {
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomSnapshot[];
  layoutTemplates: LayoutTemplate[];
  toasts: { level: 'info' | 'warn' | 'error'; message: string; at: number }[];
}

const EMPTY: StoreState = Object.freeze({ gridShape: { cols: 0, rows: 0 }, classrooms: [], layoutTemplates: [], toasts: [] }) as StoreState;

export interface Store {
  getState(): StoreState;
  apply(msg: WSMessage): void;
  subscribe(fn: () => void): () => void;
}

export function createStore(): Store {
  let state: StoreState = EMPTY;
  const subs = new Set<() => void>();

  const update = (next: StoreState) => { state = next; for (const fn of subs) fn(); };
  const patchClassroom = (id: ClassroomId, patch: (c: ClassroomSnapshot) => ClassroomSnapshot) => {
    const nextClassrooms = state.classrooms.map((c) => (c.id === id ? patch(c) : c));
    if (nextClassrooms.every((c, i) => c === state.classrooms[i])) return;
    update({ ...state, classrooms: nextClassrooms });
  };

  const apply = (msg: WSMessage): void => {
    switch (msg.type) {
      case 'ClassroomList': {
        const s: SchoolhouseSnapshot = msg.snapshot;
        update({ gridShape: s.gridShape, classrooms: s.classrooms, layoutTemplates: s.layoutTemplates,
          // preserve toasts across reconnect so the user still sees recent warnings
          toasts: state.toasts });
        break;
      }
      case 'ClassroomUpdate':
        patchClassroom(msg.classroomId, (c) => ({ ...c, ...msg.update }));
        break;
      case 'TeacherEntered':
        patchClassroom(msg.classroomId, (c) => ({
          ...c,
          occupant: { sessionId: msg.sessionId, cwd: msg.cwd, teacherState: 'idle', students: [] },
        }));
        break;
      case 'TeacherLeft':
        patchClassroom(msg.classroomId, (c) => {
          if (c.occupant?.sessionId !== msg.sessionId) return c;  // ignore stale leave
          return { ...c, occupant: null };
        });
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
        update({ ...state, toasts: [...state.toasts, { level: msg.level, message: msg.message, at: Date.now() }]
          .slice(-5) });  // keep only the 5 most recent
        break;
    }
  };

  return {
    getState: () => state,
    apply,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
