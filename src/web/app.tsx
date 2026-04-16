import { useEffect, useState } from 'react';
import { createStore, type StoreState } from './store.js';
import { connect } from './ws-client.js';
import { preload } from './canvas/renderer.js';
import { Schoolhouse } from './components/Schoolhouse.js';
import { Toasts } from './components/Toast.js';

// Module-level init: this module is the browser-only entry point,
// so WS connect + sprite preload run unconditionally at import.
const store = createStore();
connect(store);
const preloadDone = preload();

export function App() {
  const [state, setState] = useState<StoreState>(store.getState());
  const [preloaded, setPreloaded] = useState(false);

  useEffect(() => store.subscribe(() => setState(store.getState())), []);
  useEffect(() => {
    preloadDone.then(() => setPreloaded(true)).catch(() => setPreloaded(true));
  }, []);

  return (
    <>
      <Schoolhouse state={state} preloaded={preloaded} />
      <Toasts toasts={state.toasts} />
    </>
  );
}
