import type { ClassroomId } from './ids.js';

export interface LayoutTemplate {
  id: string;
  cols: number;              // タイル数 (横)
  rows: number;              // タイル数 (縦)
  tiles: number[];           // cols*rows の flat 配列、TileType の番号
  seats: { row: number; col: number }[];  // 座席位置
  teacherDesk: { row: number; col: number };
}

export interface ClassroomPersistence {
  id: ClassroomId;
  layoutTemplateId: string;
  gridPos: { row: number; col: number };
}

export interface SchoolhousePersistence {
  version: 1;
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomPersistence[];
  layoutTemplates: LayoutTemplate[];
}

export interface Config {
  port: number;
  classroomCount: number;        // 初期 N
  gridShape: { cols: number; rows: number };  // default: cols=3, rows=ceil(N/3)
  claudeProjectsDir: string;     // default: ~/.claude/projects
  stateDir: string;              // default: ~/.agent-classroom
}
