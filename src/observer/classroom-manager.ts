import type { SessionId, ClassroomId } from '../shared/ids.js';

export type AssignResult =
  | { ok: true; classroomId: ClassroomId; role: 'teacher' | 'student' }
  | { ok: false; reason: 'overflow' };

export class ClassroomManager {
  private readonly classroomIds: readonly ClassroomId[];
  private readonly classroomByProject = new Map<string, ClassroomId>();
  private readonly projectByClassroom = new Map<ClassroomId, string>();
  private readonly sessionsByClassroom = new Map<ClassroomId, Set<SessionId>>();
  private readonly classroomBySession = new Map<SessionId, ClassroomId>();
  private readonly teacherByClassroom = new Map<ClassroomId, SessionId>();

  constructor(classroomIds: readonly ClassroomId[]) {
    if (classroomIds.length === 0) throw new Error('classroom list must not be empty');
    this.classroomIds = classroomIds;
  }

  assign(sessionId: SessionId, projectDir: string): AssignResult {
    // If session already assigned, return existing
    const existing = this.classroomBySession.get(sessionId);
    if (existing !== undefined) {
      const isTeacher = this.teacherByClassroom.get(existing) === sessionId;
      return { ok: true, classroomId: existing, role: isTeacher ? 'teacher' : 'student' };
    }

    // Check if project already has a classroom
    const projectClassroom = this.classroomByProject.get(projectDir);
    if (projectClassroom !== undefined) {
      // Add as student to existing classroom
      this.sessionsByClassroom.get(projectClassroom)!.add(sessionId);
      this.classroomBySession.set(sessionId, projectClassroom);
      return { ok: true, classroomId: projectClassroom, role: 'student' };
    }

    // New project — find empty classroom (alpha rule)
    for (const cid of this.classroomIds) {
      if (!this.projectByClassroom.has(cid)) {
        this.classroomByProject.set(projectDir, cid);
        this.projectByClassroom.set(cid, projectDir);
        this.sessionsByClassroom.set(cid, new Set([sessionId]));
        this.classroomBySession.set(sessionId, cid);
        this.teacherByClassroom.set(cid, sessionId);
        return { ok: true, classroomId: cid, role: 'teacher' };
      }
    }
    return { ok: false, reason: 'overflow' };
  }

  release(sessionId: SessionId): { classroomId: ClassroomId; promoted: SessionId | null } | null {
    const cid = this.classroomBySession.get(sessionId);
    if (cid === undefined) return null;
    this.classroomBySession.delete(sessionId);
    const sessions = this.sessionsByClassroom.get(cid)!;
    sessions.delete(sessionId);

    const wasTeacher = this.teacherByClassroom.get(cid) === sessionId;
    let promoted: SessionId | null = null;

    if (sessions.size === 0) {
      // Classroom empty — release project mapping
      const proj = this.projectByClassroom.get(cid);
      if (proj) this.classroomByProject.delete(proj);
      this.projectByClassroom.delete(cid);
      this.sessionsByClassroom.delete(cid);
      this.teacherByClassroom.delete(cid);
    } else if (wasTeacher) {
      // Promote first remaining session to teacher
      promoted = sessions.values().next().value!;
      this.teacherByClassroom.set(cid, promoted);
    }

    return { classroomId: cid, promoted };
  }

  classroomOf(sessionId: SessionId): ClassroomId | null {
    return this.classroomBySession.get(sessionId) ?? null;
  }

  occupantOf(classroomId: ClassroomId): SessionId | null {
    return this.teacherByClassroom.get(classroomId) ?? null;
  }
}
