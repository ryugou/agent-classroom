import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchoolhouse, saveSchoolhouse, initializeSchoolhouse } from '../../src/observer/persistence.js';
import { newClassroomId } from '../../src/shared/ids.js';
import type { LayoutTemplate } from '../../src/shared/persistence.js';

let tmpDir: string;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ac-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const defaultTemplate: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: Array(70).fill(1),
  seats: [{ row: 2, col: 2 }, { row: 2, col: 4 }],
  teacherDesk: { row: 5, col: 4 },
};

describe('persistence', () => {
  it('returns null when file absent', () => {
    expect(loadSchoolhouse(tmpDir)).toBeNull();
  });

  it('initializes N classrooms with default template', () => {
    const p = initializeSchoolhouse({ classroomCount: 4, gridCols: 3, defaultTemplate });
    expect(p.classrooms).toHaveLength(4);
    expect(p.classrooms[0]!.id).toBe(newClassroomId(0));
    expect(p.classrooms[0]!.gridPos).toEqual({ row: 0, col: 0 });
    expect(p.classrooms[3]!.gridPos).toEqual({ row: 1, col: 0 });
    expect(p.layoutTemplates).toHaveLength(1);
    expect(p.gridShape).toEqual({ cols: 3, rows: 2 });
  });

  it('saves and loads round-trip', () => {
    const original = initializeSchoolhouse({ classroomCount: 2, gridCols: 3, defaultTemplate });
    saveSchoolhouse(tmpDir, original);
    expect(existsSync(join(tmpDir, 'layout.json'))).toBe(true);
    const loaded = loadSchoolhouse(tmpDir);
    expect(loaded).toEqual(original);
  });

  it('writes schema version 1', () => {
    const p = initializeSchoolhouse({ classroomCount: 1, gridCols: 1, defaultTemplate });
    saveSchoolhouse(tmpDir, p);
    const raw = JSON.parse(readFileSync(join(tmpDir, 'layout.json'), 'utf8'));
    expect(raw.version).toBe(1);
  });

  it('rejects unknown schema version on load', () => {
    const file = join(tmpDir, 'layout.json');
    writeFileSync(file, JSON.stringify({ version: 999 }));
    expect(() => loadSchoolhouse(tmpDir)).toThrow(/version/);
  });
});
