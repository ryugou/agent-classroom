import { basename } from 'node:path';
import type { SourceAdapter } from './adapter.js';
import type { ObservationEvent } from '../../shared/events.js';
import { asSessionId } from '../../shared/ids.js';
import { FileWatcher } from '../parser/file-watcher.js';
import { parseLine } from '../parser/transcript-parser.js';
import { StateInferrer } from '../parser/state-inferrer.js';

export interface HostSourceOptions {
  rootDir: string;
  scanIntervalMs?: number;
  tailIntervalMs?: number;
  staleThresholdMs?: number;
}

export class HostSource implements SourceAdapter {
  private readonly fw: FileWatcher;
  private readonly inferrers = new Map<string, StateInferrer>();
  private listeners: ((e: ObservationEvent) => void)[] = [];

  constructor(opts: HostSourceOptions) {
    this.fw = new FileWatcher({
      rootDir: opts.rootDir,
      ...(opts.scanIntervalMs !== undefined ? { scanIntervalMs: opts.scanIntervalMs } : {}),
      ...(opts.tailIntervalMs !== undefined ? { tailIntervalMs: opts.tailIntervalMs } : {}),
      ...(opts.staleThresholdMs !== undefined ? { staleThresholdMs: opts.staleThresholdMs } : {}),
      onFileAdded: (p) => this.handleAdded(p),
      onFileClosed: (p) => this.handleClosed(p),
      onLine: (p, l) => this.handleLine(p, l),
    });
  }

  start(): void { this.fw.start(); }
  stop(): void {
    this.fw.stop();
    for (const inf of this.inferrers.values()) inf.dispose();
    this.inferrers.clear();
  }

  on(listener: (event: ObservationEvent) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private emit(e: ObservationEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  private handleAdded(path: string): void {
    const sessionId = asSessionId(basename(path, '.jsonl'));
    // TODO Phase 2: populate cwd from project directory name (currently '' placeholder).
    this.emit({ type: 'SessionStarted', sessionId, cwd: '', startedAt: Date.now() });
    const inf = new StateInferrer({
      sessionId,
      emit: (e) => this.emit(e),
      now: () => Date.now(),
    });
    this.inferrers.get(path)?.dispose();
    this.inferrers.set(path, inf);
  }

  private handleClosed(path: string): void {
    const sessionId = asSessionId(basename(path, '.jsonl'));
    const inf = this.inferrers.get(path);
    if (inf) { inf.dispose(); this.inferrers.delete(path); }
    this.emit({ type: 'SessionEnded', sessionId, endedAt: Date.now() });
  }

  private handleLine(path: string, line: string): void {
    const inf = this.inferrers.get(path);
    if (!inf) return;
    for (const rec of parseLine(line)) inf.ingest(rec);
  }
}
