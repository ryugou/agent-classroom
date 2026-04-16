import type { Store } from './store.js';
import type { WSMessage } from '../shared/ws-messages.js';

export function connect(store: Store, url?: string): () => void {
  const resolvedUrl = url ?? (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
  let disposed = false;
  let currentWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const attempt = () => {
    if (disposed) return;
    const ws = new WebSocket(resolvedUrl);
    currentWs = ws;
    ws.addEventListener('message', (ev) => {
      try { store.apply(JSON.parse(ev.data) as WSMessage); }
      catch (err) { console.warn('ws parse failed', err); }
    });
    ws.addEventListener('close', () => {
      if (!disposed) reconnectTimer = setTimeout(attempt, 2000);
    });
    ws.addEventListener('error', () => ws.close());
  };
  attempt();
  return () => {
    disposed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    currentWs?.close();
  };
}
