import { describe, it, expect } from 'vitest';
import { findPath } from '../../src/web/canvas/pathfinding.js';

const grid = [
  [true,  true,  true,  true, true],
  [true,  false, false, false, true],
  [true,  true,  true,  true, true],
];

describe('findPath', () => {
  it('finds shortest path around obstacle', () => {
    const path = findPath(grid, { row: 0, col: 0 }, { row: 2, col: 3 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ row: 0, col: 0 });
    expect(path![path!.length - 1]).toEqual({ row: 2, col: 3 });
    expect(path!.length).toBeGreaterThanOrEqual(6);
  });
  it('returns null when no path exists', () => {
    const blocked = [[true, false], [false, true]];
    expect(findPath(blocked, { row: 0, col: 0 }, { row: 1, col: 1 })).toBeNull();
  });
  it('returns single-element path when start === goal', () => {
    expect(findPath(grid, { row: 0, col: 0 }, { row: 0, col: 0 })).toEqual([{ row: 0, col: 0 }]);
  });
  it('returns null when start is not walkable', () => {
    expect(findPath(grid, { row: 1, col: 1 }, { row: 0, col: 0 })).toBeNull();
  });
  it('returns null when goal is not walkable', () => {
    expect(findPath(grid, { row: 0, col: 0 }, { row: 1, col: 1 })).toBeNull();
  });
});
