import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/observer/server.js';
import WebSocket from 'ws';
import { AddressInfo } from 'node:net';
import { HostSource } from '../../src/observer/sources/host-source.js';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { Broadcaster } from '../../src/observer/ws-broadcaster.js';
import { newClassroomId } from '../../src/shared/ids.js';
import type { LayoutTemplate } from '../../src/shared/persistence.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tpl: LayoutTemplate = {
  id: 'default', cols: 10, rows: 7, tiles: Array(70).fill(1), seats: [], teacherDesk: { row: 0, col: 0 },
};

describe('server integration', () => {
  it('serves static and exposes /ws that delivers ClassroomList on connect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-srv-'));
    try {
      const ids = [newClassroomId(0), newClassroomId(1)];
      const manager = new ClassroomManager(ids);
      const broadcaster = new Broadcaster({
        manager,
        initialSnapshot: {
          gridShape: { cols: 2, rows: 1 },
          classrooms: ids.map((id, i) => ({
            id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
          })),
          layoutTemplates: [tpl],
        },
      });
      const source = new HostSource({ rootDir: root });
      source.on((e) => broadcaster.ingest(e));

      const srv = createServer({ staticDir: root, broadcaster, source, port: 0 });
      await srv.start();

      const port = (srv.address() as AddressInfo).port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const first = await new Promise<string>((resolve, reject) => {
        ws.on('message', (d) => resolve(d.toString()));
        ws.on('error', reject);
      });
      try {
        expect(JSON.parse(first)).toMatchObject({ type: 'ClassroomList' });
      } finally {
        ws.close();
        await srv.stop();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);
});
