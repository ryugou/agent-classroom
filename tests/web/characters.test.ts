import { describe, it, expect } from 'vitest';
import { Character, tileToPixel, pixelToTile } from '../../src/web/canvas/characters.js';

const TILE_PX = 16;
const grid = [
  [true, true, true],
  [true, true, true],
  [true, true, true],
];

describe('Character', () => {
  it('starts at seat position in idle state', () => {
    const c = new Character({
      id: 'teacher', role: 'teacher', seatTile: { row: 2, col: 1 },
      charSpriteIndex: 0, tilePx: TILE_PX,
    });
    expect(c.state).toBe('idle');
    expect(c.pos).toEqual({ x: 1 * TILE_PX, y: 2 * TILE_PX });
  });

  it('transitions to walk→type when agentState becomes active', () => {
    const c = new Character({
      id: 'teacher', role: 'teacher', seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0, tilePx: TILE_PX,
    });
    c.pos = { x: 2 * TILE_PX, y: 2 * TILE_PX };
    c.onAgentStateChanged('active', TILE_PX, grid);
    expect(c.state).toBe('walk');
    for (let i = 0; i < 200; i++) c.update(0.05, TILE_PX, grid);
    expect(c.state).toBe('type');
  });

  it('shows bounce offset only in type state', () => {
    const c = new Character({
      id: 'teacher', role: 'teacher', seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0, tilePx: TILE_PX,
    });
    expect(c.bounceOffsetY).toBe(0);
    c.state = 'type';
    c.bouncePhase = 0.25;
    expect(Math.abs(c.bounceOffsetY)).toBeGreaterThan(0);
  });

  it('shows bubble when permission state', () => {
    const c = new Character({
      id: 'teacher', role: 'teacher', seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0, tilePx: TILE_PX,
    });
    c.onAgentStateChanged('permission', TILE_PX, grid);
    expect(c.showBubble).toBe(true);
    c.onAgentStateChanged('active', TILE_PX, grid);
    expect(c.showBubble).toBe(false);
  });

  it('returns to idle with wander after type ends', () => {
    const c = new Character({
      id: 'teacher', role: 'teacher', seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0, tilePx: TILE_PX,
    });
    c.state = 'type';
    c.agentState = 'active';
    c.onAgentStateChanged('idle', TILE_PX, grid);
    expect(c.state).toBe('idle');
    expect(c.wanderCount).toBe(0);
  });
});

describe('tileToPixel / pixelToTile', () => {
  it('converts correctly', () => {
    expect(tileToPixel({ row: 3, col: 5 }, 16)).toEqual({ x: 80, y: 48 });
    expect(pixelToTile({ x: 80, y: 48 }, 16)).toEqual({ row: 3, col: 5 });
  });
});
