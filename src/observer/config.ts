import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../shared/persistence.js';

export interface ResolveInput {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

const DEFAULT_PORT = 6868;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_CLASSROOMS = 4;
const DEFAULT_GRID_COLS = 3;

export function resolveConfig({ argv, env }: ResolveInput): Config {
  const port = parseIntOr(readFlag(argv, '--port') ?? env.AGENT_CLASSROOM_PORT, DEFAULT_PORT, 'port');
  const host = (readFlag(argv, '--host') ?? env.AGENT_CLASSROOM_HOST ?? '').trim() || DEFAULT_HOST;
  const classroomCount = parseIntOr(readFlag(argv, '--classrooms') ?? env.AGENT_CLASSROOM_CLASSROOMS, DEFAULT_CLASSROOMS, 'classrooms');
  const gridCols = parseIntOr(readFlag(argv, '--grid-cols') ?? env.AGENT_CLASSROOM_GRID_COLS, DEFAULT_GRID_COLS, 'grid-cols');

  return {
    port,
    host,
    classroomCount,
    gridShape: { cols: gridCols, rows: Math.ceil(classroomCount / gridCols) },
    claudeProjectsDir: valueOrDefault(env.AGENT_CLASSROOM_CLAUDE_DIR, join(homedir(), '.claude', 'projects')),
    stateDir: valueOrDefault(env.AGENT_CLASSROOM_STATE_DIR, join(homedir(), '.agent-classroom')),
  };
}

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function parseIntOr(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid ${label}: ${value}`);
  return n;
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback;
}
