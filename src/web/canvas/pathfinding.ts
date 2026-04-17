export interface Pos { row: number; col: number; }

export function findPath(
  grid: boolean[][],
  start: Pos,
  goal: Pos,
): Pos[] | null {
  const rows = grid.length;
  if (rows === 0) return null;
  const cols = grid[0]!.length;
  if (!inBounds(start, rows, cols) || !grid[start.row]![start.col]) return null;
  if (!inBounds(goal, rows, cols) || !grid[goal.row]![goal.col]) return null;
  if (start.row === goal.row && start.col === goal.col) return [start];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  const visited = new Set<string>();
  const parent = new Map<string, Pos>();
  const queue: Pos[] = [start];
  visited.add(key(start));
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dr, dc] of dirs) {
      const next: Pos = { row: cur.row + dr, col: cur.col + dc };
      if (!inBounds(next, rows, cols)) continue;
      if (!grid[next.row]![next.col]) continue;
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);
      parent.set(k, cur);
      if (next.row === goal.row && next.col === goal.col) return reconstructPath(parent, start, goal);
      queue.push(next);
    }
  }
  return null;
}

function inBounds(p: Pos, rows: number, cols: number): boolean {
  return p.row >= 0 && p.row < rows && p.col >= 0 && p.col < cols;
}
function key(p: Pos): string { return `${p.row},${p.col}`; }
function reconstructPath(parent: Map<string, Pos>, start: Pos, goal: Pos): Pos[] {
  const path: Pos[] = [];
  let cur: Pos | undefined = goal;
  while (cur && !(cur.row === start.row && cur.col === start.col)) {
    path.push(cur);
    cur = parent.get(key(cur));
  }
  path.push(start);
  path.reverse();
  return path;
}
