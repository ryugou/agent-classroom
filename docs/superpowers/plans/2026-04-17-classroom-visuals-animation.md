# Classroom Visuals + Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教室の見た目を Cool School tileset で「教室らしく」し、pixel-agents 相当のキャラクター動作 (wander / 着席 / typing bounce / speech bubble) を追加する。

**Architecture:** 既存の「React useEffect で snapshot 変更時に再描画」モデルを `requestAnimationFrame` ベースの game loop に置き換える。キャラクター FSM (IDLE/WALK/TYPE) + BFS pathfinding で wander / 着席を実現。Kenney Tiny Dungeon は静止画 1 フレームなので、walk アニメの代わりに位置の線形補間 (glide) + typing 時の上下 bounce で動きを出す。

**Tech Stack:** 既存: Canvas 2D + React + Vite。新規追加のライブラリ: なし (全て自前実装)。

**参考:** `docs/pixel-agents-reference.md` §4.1-4.4 (gameLoop, characters FSM, BFS pathfinding, renderer)

---

## File Structure

```
src/web/canvas/
├── tile-map.ts           ← Modify: TILE_ATLAS 拡張 + walkability metadata
├── renderer.ts           ← Modify: Z-sort 描画 + speech bubble + bounce
├── sprite-cache.ts       ← No change
├── game-loop.ts          ← Create: rAF ベースの game loop
├── characters.ts         ← Create: キャラクター FSM (IDLE/WALK/TYPE) + position lerp
└── pathfinding.ts        ← Create: BFS 4 方向 pathfinding

src/web/components/
├── Classroom.tsx          ← Modify: useEffect 再描画 → game loop 統合
└── (others unchanged)

src/observer/cli.ts        ← Modify: DEFAULT_TEMPLATE を教室レイアウトに修正

tests/web/
├── pathfinding.test.ts    ← Create
└── characters.test.ts     ← Create
```

**設計方針:**
- `game-loop.ts`: `start(canvas, onFrame)` → rAF 管理。canvas resize / visibility change 対応
- `characters.ts`: 各キャラクターの位置・状態・wander タイマーを管理。snapshot diff を受けて FSM 遷移。**純ロジック** (Canvas API に触らない)
- `pathfinding.ts`: `findPath(grid, from, to)` → `{row, col}[]`。**純関数**
- `renderer.ts`: 上記から受け取った character positions を描画。Z-sort + speech bubble + bounce
- `tile-map.ts`: tile type ごとの `walkable` フラグを追加
- `Classroom.tsx`: 毎フレーム `renderFrame(ctx, template, snapshot, characterStates, dt)` を呼ぶ

---

## Task 1: Tileset Atlas Mapping + Walkability

**Cool School tileset** (`src/web/public/assets/cool-school-tileset.png`) は 384×576px、48px/tile で 8col × 12row。

現在の `TILE_ATLAS` は 3 エントリ (全部間違った座標)。実際の tileset を見て正しいタイル座標を特定し、walkability metadata を追加する。

**Files:**
- Modify: `src/web/canvas/tile-map.ts`

- [ ] **Step 1: tileset 座標の特定**

tileset PNG を目視で確認。48px グリッドでの主要タイル座標:

| ID | 名前 | sx | sy | walkable | 備考 |
|----|------|----|----|----------|------|
| 0 | 床 (ヘリンボーン) | 0 | 144 | true | row 3, col 0 |
| 1 | 壁上段 (青) | 0 | 0 | false | row 0, col 0 |
| 2 | 壁中段 (青) | 0 | 48 | false | row 1, col 0 |
| 3 | 壁下段 (腰板) | 0 | 96 | false | row 2, col 0 |
| 4 | 黒板左 | 144 | 48 | false | row 1, col 3 |
| 5 | 黒板右 | 192 | 48 | false | row 1, col 4 (not found if blackboard is 1 tile, adjust) |
| 6 | 床 (ダイヤ柄) | 96 | 144 | true | row 3, col 2 |
| 7 | 本棚 | 240 | 48 | false | row 1, col 5 |
| 8 | 窓 | 144 | 0 | false | row 0, col 3 |
| 9 | 床 (木目) | 48 | 144 | true | row 3, col 1 |
| 10 | 机 (青天板+引出) | 0 | 192 | false | row 4, col 0 |

**注意**: 上記座標は目視推定。実装者は PNG を開いて正確に確認すること。特に黒板が 1 タイルか 2 タイル幅かは要確認。

- [ ] **Step 2: tile-map.ts を書き換え**

```ts
// src/web/canvas/tile-map.ts
export const TILE_PX = 16;
export const SOURCE_TILE_PX = 48;

export interface TileType {
  sx: number;
  sy: number;
  walkable: boolean;
}

// 座標は実装者が PNG 目視で確定。以下は初期推定値。
const TILE_TYPES: Record<number, TileType> = {
  0:  { sx: 0,   sy: 144, walkable: true },   // 床 (ヘリンボーン)
  1:  { sx: 0,   sy: 0,   walkable: false },  // 壁上段
  2:  { sx: 0,   sy: 48,  walkable: false },  // 壁中段
  3:  { sx: 0,   sy: 96,  walkable: false },  // 壁下段 (腰板)
  4:  { sx: 144, sy: 48,  walkable: false },  // 黒板
  5:  { sx: 96,  sy: 144, walkable: true },   // 床 (ダイヤ柄)
  6:  { sx: 48,  sy: 144, walkable: true },   // 床 (木目)
  7:  { sx: 240, sy: 48,  walkable: false },  // 本棚
  8:  { sx: 144, sy: 0,   walkable: false },  // 窓
  9:  { sx: 0,   sy: 192, walkable: false },  // 机 (座席家具)
  10: { sx: 48,  sy: 0,   walkable: false },  // 壁コーナー
};

export function tileTypeOf(id: number): TileType | null {
  return TILE_TYPES[id] ?? null;
}

export function isWalkable(id: number): boolean {
  return TILE_TYPES[id]?.walkable ?? false;
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  tileId: number,
  dx: number,
  dy: number,
): void {
  const t = tileTypeOf(tileId);
  if (!t) return;
  ctx.drawImage(sheet, t.sx, t.sy, SOURCE_TILE_PX, SOURCE_TILE_PX, dx, dy, TILE_PX, TILE_PX);
}

export function buildWalkableGrid(tiles: number[], cols: number, rows: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(isWalkable(tiles[r * cols + c] ?? -1));
    }
    grid.push(row);
  }
  return grid;
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm run typecheck
```

renderer.ts の `atlasOf` 呼び出しが消えるため compile error になる。次 Task で renderer を修正するので、ここでは tile-map.ts の型チェックだけ確認 (observer 側は影響なし):

```bash
pnpm tsc -p tsconfig.web.json --noEmit 2>&1 | head -20
```

renderer.ts のエラーは無視して次の Task で修正する。もしくは renderer.ts の `atlasOf` → `tileTypeOf` に一時的に差し替えて typecheck を通す。

- [ ] **Step 4: Commit**

```bash
git add src/web/canvas/tile-map.ts
git commit -m "$(cat <<'EOF'
feat(web): expand tile atlas with walkability metadata (Cool School tileset)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Classroom Layout Template + Renderer Tileset Fix

DEFAULT_TEMPLATE を教室らしいレイアウトに修正。renderer.ts を新しい tile-map API に合わせる。

**Files:**
- Modify: `src/observer/cli.ts` (DEFAULT_TEMPLATE)
- Modify: `src/web/canvas/renderer.ts` (atlasOf → tileTypeOf 置換 + 描画修正)

- [ ] **Step 1: DEFAULT_TEMPLATE を教室レイアウトに**

10×7 グリッド。上段は壁 + 黒板 + 窓、中段は床 + 生徒机、下段は教卓エリア。

```ts
// src/observer/cli.ts DEFAULT_TEMPLATE
const DEFAULT_TEMPLATE: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: [
    // Row 0: 壁上段 + 窓 + 壁上段
    1, 1, 1, 8, 1, 1, 8, 1, 1, 1,
    // Row 1: 壁中段 + 黒板 + 本棚
    2, 2, 2, 4, 4, 4, 2, 2, 7, 2,
    // Row 2: 壁下段
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    // Row 3: 床 + 生徒机
    0, 0, 9, 0, 9, 0, 9, 0, 0, 0,
    // Row 4: 床 + 生徒机
    0, 0, 9, 0, 9, 0, 9, 0, 0, 0,
    // Row 5: 床 (教卓エリア)
    0, 0, 0, 0, 9, 0, 0, 0, 0, 0,
    // Row 6: 床 (入口側)
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  seats: [
    { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 3, col: 6 },
    { row: 4, col: 2 }, { row: 4, col: 4 }, { row: 4, col: 6 },
  ],
  teacherDesk: { row: 5, col: 4 },
};
```

- [ ] **Step 2: renderer.ts を tileTypeOf API に修正**

`atlasOf` 呼び出しを `tileTypeOf` に置換。`drawTile` は既に修正済み (Task 1 で API が変わった) なので、renderer.ts 側で呼び出し元を合わせる。

```ts
// renderer.ts: drawTile は tile-map.ts が export しているものをそのまま使う
// → 変更不要 (drawTile の内部実装が atlasOf → tileTypeOf に変わっただけ)
```

実際に renderer.ts を Read して確認し、`atlasOf` を直接呼んでいる箇所があれば `tileTypeOf` に差し替え。

- [ ] **Step 3: typecheck + build + 目視確認**

```bash
pnpm run typecheck
pnpm run build
node bin/agent-classroom.js start --port 6868
```

ブラウザで http://localhost:6868/ を開き、教室の見た目が改善されていることを確認。壁・床・黒板が区別できるレイアウトになっているはず。

**タイル座標がズレていた場合**: 実装者は PNG を見て TILE_TYPES の `sx, sy` を調整する。見た目が正しくなるまで微調整を繰り返す。

- [ ] **Step 4: Commit**

```bash
git add src/observer/cli.ts src/web/canvas/renderer.ts
git commit -m "$(cat <<'EOF'
feat(web): classroom layout with walls, blackboard, desks, floor

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: BFS Pathfinding

pixel-agents `tileMap.ts:37-105` の設計を参考に 4 方向 BFS。**純関数**、テスト可能。

**Files:**
- Create: `src/web/canvas/pathfinding.ts`
- Create: `tests/web/pathfinding.test.ts`

- [ ] **Step 1: failing test**

```ts
// tests/web/pathfinding.test.ts
import { describe, it, expect } from 'vitest';
import { findPath } from '../../src/web/canvas/pathfinding.js';

// W=wall(false), F=floor(true)
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
    // path should go around the wall (row 1, cols 1-3)
    expect(path!.length).toBeGreaterThanOrEqual(6);
  });

  it('returns null when no path exists', () => {
    const blocked = [
      [true, false],
      [false, true],
    ];
    expect(findPath(blocked, { row: 0, col: 0 }, { row: 1, col: 1 })).toBeNull();
  });

  it('returns single-element path when start === goal', () => {
    const path = findPath(grid, { row: 0, col: 0 }, { row: 0, col: 0 });
    expect(path).toEqual([{ row: 0, col: 0 }]);
  });

  it('returns null when start is not walkable', () => {
    expect(findPath(grid, { row: 1, col: 1 }, { row: 0, col: 0 })).toBeNull();
  });

  it('returns null when goal is not walkable', () => {
    expect(findPath(grid, { row: 0, col: 0 }, { row: 1, col: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement pathfinding**

```ts
// src/web/canvas/pathfinding.ts
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
      if (next.row === goal.row && next.col === goal.col) {
        return reconstructPath(parent, start, goal);
      }
      queue.push(next);
    }
  }
  return null;
}

function inBounds(p: Pos, rows: number, cols: number): boolean {
  return p.row >= 0 && p.row < rows && p.col >= 0 && p.col < cols;
}

function key(p: Pos): string {
  return `${p.row},${p.col}`;
}

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
```

- [ ] **Step 4: Run test (5 passing)**

- [ ] **Step 5: Commit**

```bash
git add src/web/canvas/pathfinding.ts tests/web/pathfinding.test.ts
git commit -m "$(cat <<'EOF'
feat(web): BFS 4-direction pathfinding on walkable tile grid

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Game Loop

`requestAnimationFrame` ベースのフレームループ。pixel-agents `gameLoop.ts:9-36` 参考。

**Files:**
- Create: `src/web/canvas/game-loop.ts`

- [ ] **Step 1: Implement game-loop**

```ts
// src/web/canvas/game-loop.ts

export interface FrameCallback {
  (dt: number): void;  // dt in seconds, capped at MAX_DT
}

const MAX_DT = 0.1;  // 100ms cap — prevents huge jumps on tab-switch

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
```

- [ ] **Step 2: Commit (no test — rAF is browser-only)**

```bash
git add src/web/canvas/game-loop.ts
git commit -m "$(cat <<'EOF'
feat(web): requestAnimationFrame game loop with dt cap

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Character State Machine

pixel-agents `characters.ts:92-317` の FSM 設計を参考。**純ロジック** (Canvas API に触らない)、テスト可能。

**Files:**
- Create: `src/web/canvas/characters.ts`
- Create: `tests/web/characters.test.ts`

- [ ] **Step 1: types + interfaces**

```ts
// src/web/canvas/characters.ts
import type { AgentState } from '../../shared/events.js';
import type { Pos } from './pathfinding.js';
import { findPath } from './pathfinding.js';

export type CharacterState = 'idle' | 'walk' | 'type';

export interface PixelPos { x: number; y: number; }

const MOVE_SPEED = 40;       // pixels per second
const WANDER_MIN_MS = 3000;  // 3s
const WANDER_MAX_MS = 12000; // 12s
const WANDER_COUNT = 3;      // wanders before returning to seat
const BOUNCE_SPEED = 4;      // cycles per second
const BOUNCE_PX = 1.5;       // pixels amplitude

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
  }

  /** Called every frame. Advances movement, wander timers, bounce. */
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

  /** Get the Y offset for the typing bounce effect. */
  get bounceOffsetY(): number {
    if (this.state !== 'type') return 0;
    return Math.sin(this.bouncePhase * Math.PI * 2) * BOUNCE_PX;
  }

  /** Transition FSM based on agent state change. */
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
    // permission: keep current movement, just show bubble
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
      // Can't path or already at seat
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

// --- Helpers ---

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
```

- [ ] **Step 2: failing test**

```ts
// tests/web/characters.test.ts
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
      id: 'teacher',
      role: 'teacher',
      seatTile: { row: 2, col: 1 },
      charSpriteIndex: 0,
      tilePx: TILE_PX,
    });
    expect(c.state).toBe('idle');
    expect(c.pos).toEqual({ x: 1 * TILE_PX, y: 2 * TILE_PX });
  });

  it('transitions to walk→type when agentState becomes active', () => {
    const c = new Character({
      id: 'teacher',
      role: 'teacher',
      seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0,
      tilePx: TILE_PX,
    });
    // Move away from seat first
    c.pos = { x: 2 * TILE_PX, y: 2 * TILE_PX };
    c.onAgentStateChanged('active', TILE_PX, grid);
    expect(c.state).toBe('walk');
    // Simulate enough frames to arrive
    for (let i = 0; i < 200; i++) c.update(0.05, TILE_PX, grid);
    expect(c.state).toBe('type');
  });

  it('shows bounce offset only in type state', () => {
    const c = new Character({
      id: 'teacher',
      role: 'teacher',
      seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0,
      tilePx: TILE_PX,
    });
    expect(c.bounceOffsetY).toBe(0);
    c.state = 'type';
    c.bouncePhase = 0.25; // sin(0.5π) = 1
    expect(Math.abs(c.bounceOffsetY)).toBeGreaterThan(0);
  });

  it('shows bubble when permission state', () => {
    const c = new Character({
      id: 'teacher',
      role: 'teacher',
      seatTile: { row: 0, col: 0 },
      charSpriteIndex: 0,
      tilePx: TILE_PX,
    });
    c.onAgentStateChanged('permission', TILE_PX, grid);
    expect(c.showBubble).toBe(true);
    c.onAgentStateChanged('active', TILE_PX, grid);
    expect(c.showBubble).toBe(false);
  });
});

describe('tileToPixel / pixelToTile', () => {
  it('converts correctly', () => {
    expect(tileToPixel({ row: 3, col: 5 }, 16)).toEqual({ x: 80, y: 48 });
    expect(pixelToTile({ x: 80, y: 48 }, 16)).toEqual({ row: 3, col: 5 });
  });
});
```

- [ ] **Step 3: Run test, expect 5 passing**

- [ ] **Step 4: Commit**

```bash
git add src/web/canvas/characters.ts tests/web/characters.test.ts
git commit -m "$(cat <<'EOF'
feat(web): character FSM (idle/walk/type) with wander AI + BFS movement

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Renderer Upgrade (Z-sort + Bounce + Speech Bubble)

renderer.ts を game loop 対応に改修。キャラクターの位置を character states から受け取り、Z-sort + bounce + speech bubble を描画。

**Files:**
- Modify: `src/web/canvas/renderer.ts`

- [ ] **Step 1: renderFrame API に変更**

既存の `renderClassroom(ctx, template, snapshot)` を `renderFrame(ctx, template, characters, tilePx)` に置き換え。snapshot 情報は characters 配列経由で受け取る。

```ts
// src/web/canvas/renderer.ts
import type { LayoutTemplate } from '../../shared/persistence.js';
import type { AgentState } from '../../shared/events.js';
import { drawTile, TILE_PX } from './tile-map.js';
import { sharedCache } from './sprite-cache.js';
import type { Character, PixelPos } from './characters.js';

const TILESET_SRC = '/assets/cool-school-tileset.png';
const CHAR_SRCS = [
  '/assets/characters/char-0085.png',
  '/assets/characters/char-0086.png',
  '/assets/characters/char-0088.png',
  '/assets/characters/char-0098.png',
  '/assets/characters/char-0099.png',
  '/assets/characters/char-0100.png',
  '/assets/characters/char-0112.png',
];

const STATE_COLOR: Record<AgentState, string> = {
  active: '#4caf50',
  idle: '#9e9e9e',
  permission: '#f44336',
};

export { CHAR_SRCS };

export async function preload(): Promise<void> {
  const results = await Promise.allSettled([
    sharedCache.load(TILESET_SRC),
    ...CHAR_SRCS.map((s) => sharedCache.load(s)),
  ]);
  const sources = [TILESET_SRC, ...CHAR_SRCS];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === 'rejected') {
      console.warn('[renderer] failed to load sprite', { src: sources[i], err: r.reason });
    }
  }
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  template: LayoutTemplate,
  characters: Character[],
): void {
  const sheet = sharedCache.get(TILESET_SRC);
  if (!sheet) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // 1. Draw tiles
  for (let r = 0; r < template.rows; r++) {
    for (let c = 0; c < template.cols; c++) {
      const id = template.tiles[r * template.cols + c] ?? 0;
      drawTile(ctx, sheet, id, c * TILE_PX, r * TILE_PX);
    }
  }

  // 2. Z-sort characters by Y position (lower Y = further back = drawn first)
  const sorted = [...characters].sort((a, b) => a.pos.y - b.pos.y);

  // 3. Draw each character
  for (const ch of sorted) {
    const img = sharedCache.get(CHAR_SRCS[ch.charSpriteIndex]!);
    if (!img) continue;

    const drawX = Math.round(ch.pos.x);
    const drawY = Math.round(ch.pos.y + ch.bounceOffsetY);
    ctx.drawImage(img, drawX, drawY);

    // State badge (small circle top-right)
    drawStateBadge(ctx, drawX, drawY, ch.agentState);

    // Speech bubble for permission
    if (ch.showBubble) {
      drawSpeechBubble(ctx, drawX, drawY);
    }
  }
}

function drawStateBadge(ctx: CanvasRenderingContext2D, x: number, y: number, state: AgentState): void {
  ctx.fillStyle = STATE_COLOR[state];
  ctx.beginPath();
  ctx.arc(x + TILE_PX - 2, y + 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Simple "!" bubble above the character
  const bx = x + TILE_PX / 2;
  const by = y - 6;

  // Bubble background
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(bx - 5, by - 8, 10, 10, 2);
  ctx.fill();
  ctx.strokeStyle = '#f44336';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // "!" text
  ctx.fillStyle = '#f44336';
  ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', bx, by - 3);
}

// Keep old API for backward compat during migration (Task 7 removes this)
export function renderClassroom(
  ctx: CanvasRenderingContext2D,
  template: LayoutTemplate,
  snapshot: import('../../shared/ws-messages.js').ClassroomSnapshot,
): void {
  // Fallback: render without animation
  renderFrame(ctx, template, []);
  // Then draw characters at fixed positions (old behavior)
  if (!snapshot.occupant) return;
  const occ = snapshot.occupant;
  const teacher = sharedCache.get(CHAR_SRCS[0]!);
  if (teacher) {
    const tx = template.teacherDesk.col * TILE_PX;
    const ty = template.teacherDesk.row * TILE_PX;
    ctx.drawImage(teacher, tx, ty);
    drawStateBadge(ctx, tx, ty, occ.teacherState);
  }
  if (template.seats.length === 0) return;
  occ.students.forEach((student, i) => {
    const seat = template.seats[i % template.seats.length];
    if (!seat) return;
    const charIdx = (hash(student.id) % (CHAR_SRCS.length - 1)) + 1;
    const img = sharedCache.get(CHAR_SRCS[charIdx]!);
    if (!img) return;
    ctx.drawImage(img, seat.col * TILE_PX, seat.row * TILE_PX);
    drawStateBadge(ctx, seat.col * TILE_PX, seat.row * TILE_PX, student.state);
  });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
```

- [ ] **Step 2: typecheck + build**

```bash
pnpm run typecheck
pnpm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/web/canvas/renderer.ts
git commit -m "$(cat <<'EOF'
feat(web): renderFrame with Z-sort + bounce + speech bubble for permission

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Classroom.tsx Game Loop Integration

Classroom.tsx を game loop + Character FSM に統合。snapshot 変更 → Character.onAgentStateChanged、毎フレーム Character.update + renderFrame。

**Files:**
- Modify: `src/web/components/Classroom.tsx`

- [ ] **Step 1: Classroom.tsx を game loop ベースに書き直し**

```tsx
// src/web/components/Classroom.tsx
import { useEffect, useRef, type CSSProperties } from 'react';
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import { TILE_PX, buildWalkableGrid } from '../canvas/tile-map.js';
import { renderFrame, CHAR_SRCS } from '../canvas/renderer.js';
import { GameLoop } from '../canvas/game-loop.js';
import { Character } from '../canvas/characters.js';

interface Props {
  classroom: ClassroomSnapshot;
  templates: LayoutTemplate[];
  preloaded: boolean;
  style?: CSSProperties;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Classroom({ classroom, templates, preloaded, style }: Props) {
  const template = templates.find((t) => t.id === classroom.layoutTemplateId);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const charsRef = useRef<Map<string, Character>>(new Map());

  // Sync characters with snapshot occupant
  useEffect(() => {
    if (!template) return;
    const chars = charsRef.current;
    const grid = buildWalkableGrid(template.tiles, template.cols, template.rows);
    const occ = classroom.occupant;

    if (!occ) {
      chars.clear();
      return;
    }

    // Teacher
    const teacherKey = 'teacher';
    let teacher = chars.get(teacherKey);
    if (!teacher) {
      teacher = new Character({
        id: teacherKey,
        role: 'teacher',
        seatTile: template.teacherDesk,
        charSpriteIndex: 0,
        tilePx: TILE_PX,
      });
      chars.set(teacherKey, teacher);
    }
    teacher.onAgentStateChanged(occ.teacherState, TILE_PX, grid);

    // Students
    const activeStudentIds = new Set(occ.students.map((s) => s.id as string));
    // Remove departed students
    for (const [k] of chars) {
      if (k !== teacherKey && !activeStudentIds.has(k)) chars.delete(k);
    }
    // Add/update students
    for (const student of occ.students) {
      const sid = student.id as string;
      let ch = chars.get(sid);
      if (!ch) {
        const seatIdx = occ.students.indexOf(student) % Math.max(template.seats.length, 1);
        const seat = template.seats[seatIdx] ?? template.teacherDesk;
        ch = new Character({
          id: sid,
          role: 'student',
          seatTile: seat,
          charSpriteIndex: (hash(sid) % (CHAR_SRCS.length - 1)) + 1,
          tilePx: TILE_PX,
        });
        chars.set(sid, ch);
      }
      ch.onAgentStateChanged(student.state, TILE_PX, grid);
    }
  }, [classroom, template]);

  // Game loop lifecycle
  useEffect(() => {
    if (!template || !preloaded) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const grid = buildWalkableGrid(template.tiles, template.cols, template.rows);

    const loop = new GameLoop((dt) => {
      const chars = Array.from(charsRef.current.values());
      for (const ch of chars) ch.update(dt, TILE_PX, grid);
      renderFrame(ctx, template, chars);
    });
    loopRef.current = loop;
    loop.start();
    return () => loop.stop();
  }, [template, preloaded]);

  if (!template) {
    return <section className="classroom" style={style}>no template</section>;
  }

  return (
    <section className="classroom" style={style}>
      <header>
        <span>{classroom.id}</span>
        <span>{classroom.occupant?.sessionId ?? 'empty'}</span>
      </header>
      <canvas
        ref={ref}
        width={template.cols * TILE_PX}
        height={template.rows * TILE_PX}
        style={{ width: template.cols * TILE_PX * 2, height: template.rows * TILE_PX * 2 }}
      />
    </section>
  );
}
```

- [ ] **Step 2: 旧 renderClassroom 呼び出しを削除**

renderer.ts から `renderClassroom` (compat fallback) を削除。他に import している箇所がないか grep で確認:

```bash
grep -rn "renderClassroom" src/
```

全箇所を確認して削除。

- [ ] **Step 3: typecheck + build + 目視確認**

```bash
pnpm run typecheck
pnpm run build
node bin/agent-classroom.js start --port 6868
```

ブラウザで確認:
- キャラクターが教室内をウロウロ (wander) しているか
- active 状態で座席に向かって歩き、着席後に bounce しているか
- permission 状態で "!" speech bubble が表示されるか
- 複数教室でそれぞれ独立に動いているか

- [ ] **Step 4: Commit**

```bash
git add src/web/components/Classroom.tsx src/web/canvas/renderer.ts
git commit -m "$(cat <<'EOF'
feat(web): integrate game loop + character FSM into Classroom component

Characters now wander when idle, walk to seat when active, bounce when
typing, and show speech bubbles when awaiting permission. Replaces the
static snapshot-driven rendering with continuous rAF animation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual Verification + Tileset Tuning

タイル座標の微調整、レイアウトの最終確認。automated ではなく目視ベース。

- [ ] **Step 1: observer + ブラウザで全教室を確認**

```bash
pnpm run build && node bin/agent-classroom.js start --port 6868
```

確認項目:
- [ ] 教室の壁・床・黒板が正しく描画されている
- [ ] 教師キャラが wander → 座席へ移動 → bounce 動作を行う
- [ ] 生徒キャラが正しい座席位置に出現する
- [ ] permission state で "!" 吹き出しが出る
- [ ] 空き教室 (occupant=null) はキャラクターなし、タイルのみ
- [ ] 4 教室が独立して動作している

- [ ] **Step 2: タイル座標の微調整**

見た目がおかしいタイルがあれば `src/web/canvas/tile-map.ts` の `TILE_TYPES` の `sx, sy` を修正。PNG を目視で確認しながら調整:

```bash
# 開発サーバーなら HMR で即反映
pnpm run dev:web
```

(observer は別ターミナルで起動し、ブラウザの WS 接続先を dev server のプロキシ設定で合わせるか、build → start で確認)

- [ ] **Step 3: 最終 Commit**

```bash
git add src/
git commit -m "$(cat <<'EOF'
fix(web): tune tileset coordinates and classroom layout after visual inspection

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | 内容 | テスト | 備考 |
|------|------|--------|------|
| 1 | Tileset Atlas + walkability | typecheck | 座標は実装者が PNG 目視で確定 |
| 2 | Classroom Layout + renderer fix | 目視 | DEFAULT_TEMPLATE 差し替え |
| 3 | BFS Pathfinding | 5 unit tests | 純関数、pixel-agents BFS 相当 |
| 4 | Game Loop | なし (rAF) | requestAnimationFrame + dt cap |
| 5 | Character FSM | 5 unit tests | 純ロジック、wander + walk + type |
| 6 | Renderer Upgrade | typecheck | Z-sort + bounce + speech bubble |
| 7 | Classroom Integration | 目視 | game loop + FSM → Classroom.tsx |
| 8 | Manual Verification | 目視 | tileset 微調整 + 最終確認 |

完了後は `superpowers:finishing-a-development-branch` でブランチ完了フロー。
