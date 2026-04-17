import type { AgentState } from '../../shared/events.js';
import type { Pos } from './pathfinding.js';
import { findPath } from './pathfinding.js';

export type CharacterState = 'idle' | 'walk' | 'type';
export interface PixelPos { x: number; y: number; }

const MOVE_SPEED = 40;
const WANDER_MIN_MS = 3000;
const WANDER_MAX_MS = 12000;
const WANDER_COUNT = 3;
const BOUNCE_SPEED = 4;
const BOUNCE_PX = 1.5;

export class Character {
  readonly id: string;
  readonly role: 'teacher' | 'student';
  readonly seatTile: Pos;
  readonly charSpriteIndex: number;

  state: CharacterState = 'idle';
  agentState: AgentState = 'idle';
  pos: PixelPos;
  targetPos: PixelPos | null = null;
  path: Pos[] = [];
  pathIndex: number = 0;
  wanderCount: number = 0;
  wanderTimer: number = 0;
  bouncePhase: number = 0;
  showBubble: boolean = false;

  constructor(opts: {
    id: string;
    role: 'teacher' | 'student';
    seatTile: Pos;
    charSpriteIndex: number;
    tilePx: number;
  }) {
    this.id = opts.id;
    this.role = opts.role;
    this.seatTile = opts.seatTile;
    this.charSpriteIndex = opts.charSpriteIndex;
    this.pos = tileToPixel(opts.seatTile, opts.tilePx);
    this.wanderTimer = randomWanderDelay();
  }

  update(dt: number, tilePx: number, walkableGrid: boolean[][]): void {
    switch (this.state) {
      case 'idle':
        this.updateIdle(dt, tilePx, walkableGrid);
        break;
      case 'walk':
        this.updateWalk(dt, tilePx);
        break;
      case 'type':
        this.bouncePhase += dt * BOUNCE_SPEED;
        break;
    }
  }

  get bounceOffsetY(): number {
    if (this.state !== 'type') return 0;
    return Math.sin(this.bouncePhase * Math.PI * 2) * BOUNCE_PX;
  }

  onAgentStateChanged(agentState: AgentState, tilePx: number, walkableGrid: boolean[][]): void {
    this.agentState = agentState;
    this.showBubble = agentState === 'permission';
    if (agentState === 'active') {
      this.startWalkToSeat(tilePx, walkableGrid);
    } else if (agentState === 'idle') {
      if (this.state === 'type') {
        this.state = 'idle';
        this.wanderTimer = randomWanderDelay();
        this.wanderCount = 0;
      }
    }
  }

  private updateIdle(dt: number, tilePx: number, grid: boolean[][]): void {
    this.wanderTimer -= dt * 1000;
    if (this.wanderTimer <= 0) {
      this.wanderCount++;
      if (this.wanderCount > WANDER_COUNT) {
        this.startWalkToSeat(tilePx, grid);
      } else {
        this.startWanderToRandom(tilePx, grid);
      }
    }
  }

  private updateWalk(dt: number, tilePx: number): void {
    if (!this.targetPos) {
      this.arriveAtDestination();
      return;
    }
    const dx = this.targetPos.x - this.pos.x;
    const dy = this.targetPos.y - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = MOVE_SPEED * dt;
    if (step >= dist) {
      this.pos = { ...this.targetPos };
      this.pathIndex++;
      if (this.pathIndex < this.path.length) {
        this.targetPos = tileToPixel(this.path[this.pathIndex]!, tilePx);
      } else {
        this.targetPos = null;
        this.arriveAtDestination();
      }
    } else {
      this.pos = {
        x: this.pos.x + (dx / dist) * step,
        y: this.pos.y + (dy / dist) * step,
      };
    }
  }

  private arriveAtDestination(): void {
    if (this.agentState === 'active') {
      this.state = 'type';
      this.bouncePhase = 0;
    } else {
      this.state = 'idle';
      this.wanderTimer = randomWanderDelay();
    }
  }

  private startWalkToSeat(tilePx: number, grid: boolean[][]): void {
    const from = pixelToTile(this.pos, tilePx);
    const path = findPath(grid, from, this.seatTile);
    if (path && path.length > 1) {
      this.state = 'walk';
      this.path = path;
      this.pathIndex = 1;
      this.targetPos = tileToPixel(path[1]!, tilePx);
    } else {
      this.pos = tileToPixel(this.seatTile, tilePx);
      this.arriveAtDestination();
    }
  }

  private startWanderToRandom(tilePx: number, grid: boolean[][]): void {
    const target = randomWalkableTile(grid);
    if (!target) { this.wanderTimer = randomWanderDelay(); return; }
    const from = pixelToTile(this.pos, tilePx);
    const path = findPath(grid, from, target);
    if (path && path.length > 1) {
      this.state = 'walk';
      this.path = path;
      this.pathIndex = 1;
      this.targetPos = tileToPixel(path[1]!, tilePx);
    } else {
      this.wanderTimer = randomWanderDelay();
    }
  }
}

export function tileToPixel(tile: Pos, tilePx: number): PixelPos {
  return { x: tile.col * tilePx, y: tile.row * tilePx };
}

export function pixelToTile(px: PixelPos, tilePx: number): Pos {
  return { row: Math.round(px.y / tilePx), col: Math.round(px.x / tilePx) };
}

function randomWanderDelay(): number {
  return WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS);
}

function randomWalkableTile(grid: boolean[][]): Pos | null {
  const candidates: Pos[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      if (grid[r]![c]) candidates.push({ row: r, col: c });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
