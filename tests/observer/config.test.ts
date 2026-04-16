import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/observer/config.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('resolveConfig', () => {
  it('returns defaults when no overrides', () => {
    const cfg = resolveConfig({ argv: [], env: {} });
    expect(cfg.port).toBe(6868);
    expect(cfg.classroomCount).toBe(4);
    expect(cfg.gridShape).toEqual({ cols: 3, rows: 2 });
    expect(cfg.claudeProjectsDir).toBe(join(homedir(), '.claude', 'projects'));
    expect(cfg.stateDir).toBe(join(homedir(), '.agent-classroom'));
  });

  it('overrides port via --port', () => {
    const cfg = resolveConfig({ argv: ['--port', '7777'], env: {} });
    expect(cfg.port).toBe(7777);
  });

  it('overrides classroom count via --classrooms', () => {
    const cfg = resolveConfig({ argv: ['--classrooms', '6'], env: {} });
    expect(cfg.classroomCount).toBe(6);
    expect(cfg.gridShape).toEqual({ cols: 3, rows: 2 });
  });

  it('AGENT_CLASSROOM_PORT env wins when --port absent', () => {
    const cfg = resolveConfig({ argv: [], env: { AGENT_CLASSROOM_PORT: '9000' } });
    expect(cfg.port).toBe(9000);
  });

  it('rejects non-numeric port', () => {
    expect(() => resolveConfig({ argv: ['--port', 'xyz'], env: {} })).toThrow(/port/);
  });
});
