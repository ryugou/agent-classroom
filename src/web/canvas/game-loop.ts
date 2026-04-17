// src/web/canvas/game-loop.ts
export interface FrameCallback {
  (dt: number): void;
}

const MAX_DT = 0.1;

export class GameLoop {
  private rafId: number | null = null;
  private lastTime: number = 0;
  private readonly onFrame: FrameCallback;

  constructor(onFrame: FrameCallback) {
    this.onFrame = onFrame;
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(rawDt, MAX_DT);
      this.onFrame(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
