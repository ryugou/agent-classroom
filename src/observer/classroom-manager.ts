import type { SessionId, ClassroomId } from '../shared/ids.js';

export type AssignResult =
  | { ok: true; classroomId: ClassroomId }
  | { ok: false; reason: 'overflow' };

export class ClassroomManager {
  private readonly classroomIds: readonly ClassroomId[];
  private readonly sessionByClassroom = new Map<ClassroomId, SessionId>();
  private readonly classroomBySession = new Map<SessionId, ClassroomId>();

  constructor(classroomIds: readonly ClassroomId[]) {
    if (classroomIds.length === 0) throw new Error('classroom list must not be empty');
    this.classroomIds = classroomIds;
  }

  assign(sessionId: SessionId): AssignResult {
    const existing = this.classroomBySession.get(sessionId);
    if (existing !== undefined) return { ok: true, classroomId: existing };

    for (const cid of this.classroomIds) {
      if (!this.sessionByClassroom.has(cid)) {
        this.sessionByClassroom.set(cid, sessionId);
        this.classroomBySession.set(sessionId, cid);
        return { ok: true, classroomId: cid };
      }
    }
    return { ok: false, reason: 'overflow' };
  }

  release(sessionId: SessionId): ClassroomId | null {
    const cid = this.classroomBySession.get(sessionId);
    if (cid === undefined) return null;
    this.classroomBySession.delete(sessionId);
    this.sessionByClassroom.delete(cid);
    return cid;
  }

  occupantOf(classroomId: ClassroomId): SessionId | null {
    return this.sessionByClassroom.get(classroomId) ?? null;
  }

  classroomOf(sessionId: SessionId): ClassroomId | null {
    return this.classroomBySession.get(sessionId) ?? null;
  }
}
