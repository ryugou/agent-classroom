import express from 'express';
import { createServer as createHttp, type Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Broadcaster } from './ws-broadcaster.js';
import type { SourceAdapter } from './sources/adapter.js';
import type { WSMessage } from '../shared/ws-messages.js';
import { logger } from './logger.js';

export interface CreateServerOptions {
  staticDir: string;
  broadcaster: Broadcaster;
  source: SourceAdapter;
  port: number;
}

export function createServer(opts: CreateServerOptions) {
  const app = express();
  app.use(express.static(opts.staticDir));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const http: HttpServer = createHttp(app);
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (socket) => {
    const unsub = opts.broadcaster.subscribe((msg: WSMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    });
    socket.on('close', unsub);
    socket.on('error', (err) => logger.warn('ws socket error', { err: String(err) }));
  });

  return {
    async start(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(opts.port, () => { http.off('error', reject); resolve(); });
      });
      opts.source.start();
      logger.info('observer started', { port: (http.address() as AddressInfo).port });
    },
    async stop(): Promise<void> {
      opts.source.stop();
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    address(): AddressInfo | string | null { return http.address(); },
  };
}
