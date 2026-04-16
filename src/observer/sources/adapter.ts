import type { ObservationEvent } from '../../shared/events.js';

export interface SourceAdapter {
  start(): void;
  stop(): void;
  on(listener: (event: ObservationEvent) => void): () => void;
}
