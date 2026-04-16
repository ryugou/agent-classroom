import { useEffect, useState } from 'react';
import { createStore, type StoreState } from './store.js';
import { connect } from './ws-client.js';
import { preload } from './canvas/renderer.js';
import { Schoolhouse } from './components/Schoolhouse.js';
import { Toasts } from './components/Toast.js';

const store = createStore();
connect(store);
preload();

export function App() {
  const [state, setState] = useState<StoreState>(store.getState());
  useEffect(() => store.subscribe(() => setState(store.getState())), []);
  return (
    <>
      <Schoolhouse state={state} />
      <Toasts toasts={state.toasts} />
    </>
  );
}
