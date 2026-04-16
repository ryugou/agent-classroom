import type { Store } from './store.js';
import type { WSMessage } from '../shared/ws-messages.js';

export function connect(store: Store, url: string = `ws://${location.host}/ws`): void {
  const attempt = () => {
    const ws = new WebSocket(url);
    ws.addEventListener('message', (ev) => {
      try { store.apply(JSON.parse(ev.data) as WSMessage); }
      catch (err) { console.warn('ws parse failed', err); }
    });
    ws.addEventListener('close', () => setTimeout(attempt, 2000));
    ws.addEventListener('error', () => ws.close());
  };
  attempt();
}
