import type { SessionId, ClassroomId, StudentId } from './ids.js';
import type { AgentState } from './events.js';
import type { LayoutTemplate } from './persistence.js';

export interface ClassroomSnapshot {
  id: ClassroomId;
  gridPos: { row: number; col: number };
  layoutTemplateId: string;
  occupant: {
    sessionId: SessionId;
    teacherState: AgentState;
    students: { id: StudentId; state: AgentState }[];
  } | null;
}

export interface SchoolhouseSnapshot {
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomSnapshot[];
  layoutTemplates: LayoutTemplate[];
}

export type WSMessage =
  | { type: 'ClassroomList'; snapshot: SchoolhouseSnapshot }
  | { type: 'ClassroomUpdate'; classroomId: ClassroomId; update: Partial<Pick<ClassroomSnapshot, 'gridPos' | 'layoutTemplateId'>> }
  | { type: 'TeacherEntered'; classroomId: ClassroomId; sessionId: SessionId; cwd: string }
  | { type: 'TeacherLeft'; classroomId: ClassroomId; sessionId: SessionId }
  | { type: 'StudentEntered'; classroomId: ClassroomId; studentId: StudentId }
  | { type: 'StudentLeft'; classroomId: ClassroomId; studentId: StudentId }
  | { type: 'StateChanged'; classroomId: ClassroomId; target: 'teacher' | StudentId; state: AgentState }
  | { type: 'Toast'; level: 'info' | 'warn' | 'error'; message: string };
