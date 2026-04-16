import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
// NOTE: The usage string in main() must be kept in sync with the flags defined
// in resolveConfig (src/observer/config.ts). End-to-end CLI testing happens via
// scripts/dod-smoke.ts — unit tests cannot easily import this module because it
// auto-executes at import time.
import { existsSync } from 'node:fs';
import { resolveConfig } from './config.js';
import { loadSchoolhouse, saveSchoolhouse, initializeSchoolhouse } from './persistence.js';
import { ClassroomManager } from './classroom-manager.js';
import { Broadcaster } from './ws-broadcaster.js';
import { HostSource } from './sources/host-source.js';
import { createServer } from './server.js';
import { logger } from './logger.js';
import type { LayoutTemplate } from '../shared/persistence.js';
import type { SchoolhouseSnapshot } from '../shared/ws-messages.js';

const DEFAULT_TEMPLATE: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: Array(70).fill(1),
  seats: [
    { row: 2, col: 2 }, { row: 2, col: 4 }, { row: 2, col: 6 },
    { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 3, col: 6 },
  ],
  teacherDesk: { row: 5, col: 4 },
};

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'start') {
    process.stderr.write('Usage: agent-classroom start [--port N] [--classrooms N] [--host ADDRESS] [--stale-ms N] [--grid-cols N]\n');
    return 2;
  }

  const config = resolveConfig({ argv: rest, env });
  let persisted = loadSchoolhouse(config.stateDir);
  if (persisted) {
    if (persisted.classrooms.length !== config.classroomCount) {
      logger.warn('persisted layout overrides --classrooms', {
        requested: config.classroomCount,
        persisted: persisted.classrooms.length,
        hint: `delete ${join(config.stateDir, 'layout.json')} to reset`,
      });
    }
    if (persisted.gridShape.cols !== config.gridShape.cols) {
      logger.warn('persisted layout overrides --grid-cols', {
        requested: config.gridShape.cols,
        persisted: persisted.gridShape.cols,
        hint: `delete ${join(config.stateDir, 'layout.json')} to reset`,
      });
    }
  }
  if (!persisted) {
    persisted = initializeSchoolhouse({
      classroomCount: config.classroomCount,
      gridCols: config.gridShape.cols,
      defaultTemplate: DEFAULT_TEMPLATE,
    });
    saveSchoolhouse(config.stateDir, persisted);
  }

  const classroomIds = persisted.classrooms.map((c) => c.id);
  const manager = new ClassroomManager(classroomIds);
  const initialSnapshot: SchoolhouseSnapshot = {
    gridShape: persisted.gridShape,
    classrooms: persisted.classrooms.map((c) => ({
      id: c.id,
      gridPos: c.gridPos,
      layoutTemplateId: c.layoutTemplateId,
      occupant: null,
    })),
    layoutTemplates: persisted.layoutTemplates,
  };
  const broadcaster = new Broadcaster({ manager, initialSnapshot, layoutFilePath: join(config.stateDir, 'layout.json') });
  const source = new HostSource({ rootDir: config.claudeProjectsDir, staleThresholdMs: config.staleThresholdMs });
  source.on((e) => broadcaster.ingest(e));

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../web'),          // dist/web next to dist/observer
    resolve(here, '../../../dist/web'),  // fallback
  ];
  const staticDir = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!staticDir) {
    const msg = `observer web assets not found: expected index.html in one of ${candidates.join(', ')}. Run \`pnpm run build\` and try again.`;
    logger.error('failed to locate observer web assets', { candidates, hint: 'run `pnpm run build`' });
    process.stderr.write(msg + '\n');
    return 1;
  }

  const server = createServer({ staticDir, broadcaster, source, port: config.port, host: config.host });
  try {
    await server.start();
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `port ${config.port} is already in use. Another observer may be running (1 machine = 1 schoolhouse).`
      : String(err);
    logger.error('failed to start', { msg });
    process.stderr.write(msg + '\n');
    return 1;
  }

  const shutdown = async () => {
    logger.info('shutting down');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
}

main(process.argv.slice(2), process.env).then(
  (code) => { if (code !== 0) process.exit(code); },
  (err) => { logger.error('crashed', { err: String(err) }); process.exit(1); },
);
