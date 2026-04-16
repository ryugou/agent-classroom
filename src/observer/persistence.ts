import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { newClassroomId } from '../shared/ids.js';
import type { SchoolhousePersistence, LayoutTemplate, ClassroomPersistence } from '../shared/persistence.js';

const FILE_NAME = 'layout.json';

export function loadSchoolhouse(stateDir: string): SchoolhousePersistence | null {
  const p = join(stateDir, FILE_NAME);
  // Single-user local state: TOCTOU window between existsSync and readFileSync is acceptable.
  if (!existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (cause) {
    throw new Error(`Failed to parse ${p}: ${String(cause)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${p}: expected a JSON object, got ${JSON.stringify(raw)}`);
  }
  const obj = raw as { version: unknown };
  if (obj.version !== 1) {
    throw new Error(`unsupported schema version: ${String(obj.version)} (expected 1)`);
  }
  // TODO Phase 2: validate full shape with a schema library; for now we trust saveSchoolhouse output.
  return obj as unknown as SchoolhousePersistence;
}

export function saveSchoolhouse(stateDir: string, data: SchoolhousePersistence): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, FILE_NAME), JSON.stringify(data, null, 2), 'utf8');
}

export interface InitParams {
  classroomCount: number;
  gridCols: number;
  defaultTemplate: LayoutTemplate;
}

export function initializeSchoolhouse({ classroomCount, gridCols, defaultTemplate }: InitParams): SchoolhousePersistence {
  if (classroomCount <= 0) throw new Error('classroomCount must be > 0');
  if (gridCols <= 0) throw new Error('gridCols must be > 0');
  const classrooms: ClassroomPersistence[] = [];
  for (let i = 0; i < classroomCount; i++) {
    classrooms.push({
      id: newClassroomId(i),
      layoutTemplateId: defaultTemplate.id,
      gridPos: { row: Math.floor(i / gridCols), col: i % gridCols },
    });
  }
  const rows = Math.ceil(classroomCount / gridCols);
  return {
    version: 1,
    gridShape: { cols: gridCols, rows },
    classrooms,
    layoutTemplates: [defaultTemplate],
  };
}
