export type SessionId = string & { readonly __brand: 'SessionId' };
export type ClassroomId = string & { readonly __brand: 'ClassroomId' };
export type StudentId = string & { readonly __brand: 'StudentId' };

export const asSessionId = (s: string): SessionId => s as SessionId;
export const asClassroomId = (s: string): ClassroomId => s as ClassroomId;
export const asStudentId = (s: string): StudentId => s as StudentId;

export const newClassroomId = (index: number): ClassroomId =>
  asClassroomId(`classroom-${index.toString().padStart(3, '0')}`);
