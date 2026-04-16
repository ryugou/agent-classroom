import { useEffect, useRef, useState } from 'react';
import { createStore, type StoreState } from './store.js';
import { connect } from './ws-client.js';
import { preload } from './canvas/renderer.js';
import { Schoolhouse } from './components/Schoolhouse.js';
import { Toasts } from './components/Toast.js';

export function App() {
  const storeRef = useRef(createStore());
  const store = storeRef.current;
  const [state, setState] = useState<StoreState>(store.getState());
  const [preloaded, setPreloaded] = useState(false);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setState(store.getState()));
    return unsubscribe;
  }, [store]);

  useEffect(() => {
    const disconnect = connect(store);
    preload().then(() => setPreloaded(true)).catch(() => setPreloaded(true));
    return disconnect;
  }, [store]);

  return (
    <>
      <Schoolhouse state={state} preloaded={preloaded} />
      <Toasts toasts={state.toasts} />
    </>
  );
}
