import { describe, it, expect } from 'vitest';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { asSessionId, newClassroomId } from '../../src/shared/ids.js';

const ids = [newClassroomId(0), newClassroomId(1), newClassroomId(2)];

describe('ClassroomManager', () => {
  it('assigns to minimum empty classroom', () => {
    const mgr = new ClassroomManager(ids);
    const result = mgr.assign(asSessionId('s1'));
    expect(result).toEqual({ ok: true, classroomId: ids[0] });
  });

  it('skips occupied classrooms', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    mgr.assign(asSessionId('s2'));
    const result = mgr.assign(asSessionId('s3'));
    expect(result).toEqual({ ok: true, classroomId: ids[2] });
  });

  it('reports overflow when all full', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    mgr.assign(asSessionId('s2'));
    mgr.assign(asSessionId('s3'));
    const result = mgr.assign(asSessionId('s4'));
    expect(result).toEqual({ ok: false, reason: 'overflow' });
  });

  it('reuses the same classroom id when same session assigned twice', () => {
    const mgr = new ClassroomManager(ids);
    const r1 = mgr.assign(asSessionId('s1'));
    const r2 = mgr.assign(asSessionId('s1'));
    expect(r1).toEqual(r2);
  });

  it('releases classroom on end', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    mgr.assign(asSessionId('s2'));
    mgr.release(asSessionId('s1'));
    expect(mgr.assign(asSessionId('s3'))).toEqual({ ok: true, classroomId: ids[0] });
  });

  it('release of unknown session is a no-op', () => {
    const mgr = new ClassroomManager(ids);
    expect(() => mgr.release(asSessionId('unknown'))).not.toThrow();
  });

  it('exposes current assignment map', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    expect(mgr.occupantOf(ids[0])).toBe('s1');
    expect(mgr.occupantOf(ids[1])).toBeNull();
  });
});
