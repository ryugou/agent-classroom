# agent-classroom Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec `docs/superpowers/specs/2026-04-16-agent-classroom-core-design.md` §4.3 の Definition of Done (8 項目) を満たす agent-classroom Phase 1 の observer + browser UI を実装する。

**Architecture:** 単一 npm パッケージ構成。`src/shared/` に不変契約 (event protocol / WS messages / persistence schema) の型を置き、observer (`src/observer/`) と web UI (`src/web/`) がこれを共用する。observer は Node.js で `~/.claude/projects/` を 500ms ポーリングして JSONL を tail、状態推論を heuristic mode で行い、HTTP + WebSocket サーバーから snapshot + delta を broadcast。web は React + Canvas 2D で N 教室を grid に描画、WebSocket 接続で受信した snapshot/delta を反映。CLI は `agent-classroom start` で observer を起動。

**Tech Stack:**
- Node.js 22 / TypeScript 5
- Vitest (unit + integration test)
- Express (HTTP) + ws (WebSocket) — シンプル重視
- React 19 + Vite (web UI build)
- Canvas 2D (描画)
- pnpm (パッケージ管理、lockfile 決定性のため)

---

## File Structure

```
agent-classroom/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json           (base)
├── tsconfig.observer.json  (observer 専用、CommonJS / Node)
├── tsconfig.web.json       (web 専用、ESM / React)
├── vite.config.ts          (web build)
├── vitest.config.ts
├── bin/
│   └── agent-classroom.js  (CLI shim → dist/observer/cli.js)
├── src/
│   ├── shared/
│   │   ├── events.ts       (ObservationEvent union: SessionStarted/Ended, StudentSpawned/Despawned, StateChanged)
│   │   ├── ws-messages.ts  (WSMessage union: ClassroomList, ClassroomUpdate, TeacherEntered/Left, StudentEntered/Left, StateChanged, Toast)
│   │   ├── persistence.ts  (ClassroomPersistence, LayoutTemplate, Config の型)
│   │   └── ids.ts          (SessionId, ClassroomId の opaque 型と生成)
│   ├── observer/
│   │   ├── cli.ts                      (entrypoint: argv parse → start)
│   │   ├── server.ts                   (HTTP + WS 起動、port bind)
│   │   ├── config.ts                   (~/.agent-classroom/config.json or default)
│   │   ├── persistence.ts              (layout.json の I/O、schema migration)
│   │   ├── classroom-manager.ts        (N 教室の state + assign/release + 溢れ検知)
│   │   ├── sources/
│   │   │   ├── adapter.ts              (SourceAdapter interface)
│   │   │   └── host-source.ts          (host 実装: file-watcher + parser + inferrer を束ねる)
│   │   ├── parser/
│   │   │   ├── file-watcher.ts         (project dir scan + .jsonl tail)
│   │   │   ├── transcript-parser.ts    (JSONL record → normalized parser output)
│   │   │   └── state-inferrer.ts       (parser 出力 → StateChanged / StudentSpawned events)
│   │   ├── ws-broadcaster.ts           (接続管理、snapshot on connect、delta broadcast)
│   │   └── logger.ts                   (stderr への構造化ログ)
│   └── web/
│       ├── main.tsx
│       ├── app.tsx
│       ├── ws-client.ts                (WS 接続 + 自動再接続)
│       ├── store.ts                    (zustand 不使用、シンプルな Observable Store)
│       ├── components/
│       │   ├── Schoolhouse.tsx         (N 教室の grid 配置 + スクロール)
│       │   ├── Classroom.tsx           (1 教室の Canvas コンテナ)
│       │   ├── Toast.tsx
│       │   └── styles.css
│       ├── canvas/
│       │   ├── renderer.ts             (tile + sprite 描画)
│       │   ├── characters.ts           (教師/生徒の描画状態 = state + pos)
│       │   ├── pathfinding.ts          (BFS 4 方向)
│       │   ├── sprite-cache.ts         (Image decode + cache)
│       │   └── tile-map.ts             (Cool School タイルの配置定義)
│       └── assets/                     (copy-assets.ts でビルド時に public/ へ配置)
├── public/assets/                      (build 時に copy される)
├── tests/
│   ├── shared/
│   ├── observer/
│   └── web/
└── scripts/
    └── copy-assets.ts                  (assets-reference/ から抽出)
```

**設計方針**:
- `src/shared/` は observer と web が共に import する。不変契約 6 項目はここに凝縮
- parser / state-inferrer は **純関数** として設計 (test しやすい)
- file-watcher と source adapter は副作用境界 (I/O)
- web 側は store + render の 2 層。WS 受信 → store 更新 → render 反応
- 描画の一部 (pathfinding, state machine) は pixel-agents を参考に独自実装。コードコピーは禁止 (`docs/design.md` §3.1)

---

## Task 1: プロジェクト初期化

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml` (不要、単一パッケージ)
- Create: `tsconfig.json`, `tsconfig.observer.json`, `tsconfig.web.json`
- Create: `vite.config.ts`, `vitest.config.ts`
- Create: `.gitignore` (既存を拡張)、`.node-version`
- Create: `bin/agent-classroom.js` (shim)

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "agent-classroom",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "agent-classroom": "./bin/agent-classroom.js"
  },
  "scripts": {
    "dev:web": "vite",
    "build:web": "vite build",
    "build:observer": "tsc -p tsconfig.observer.json",
    "build": "pnpm run build:web && pnpm run build:observer",
    "start": "node bin/agent-classroom.js start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.observer.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.21.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/ws": "^8.5.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=22.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json (base) を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": false,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "public"]
}
```

- [ ] **Step 3: tsconfig.observer.json を作成**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "outDir": "./dist/observer",
    "rootDir": "./src",
    "types": ["node"],
    "lib": ["ES2022"]
  },
  "include": ["src/shared/**/*", "src/observer/**/*"]
}
```

- [ ] **Step 4: tsconfig.web.json を作成**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "outDir": "./dist/web",
    "noEmit": true
  },
  "include": ["src/shared/**/*", "src/web/**/*"]
}
```

- [ ] **Step 5: vite.config.ts を作成**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 6: vitest.config.ts を作成**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
```

- [ ] **Step 7: bin/agent-classroom.js を作成**

```js
#!/usr/bin/env node
import('../dist/observer/observer/cli.js').catch((err) => {
  console.error('[agent-classroom] CLI load failed:', err);
  process.exit(1);
});
```

`chmod +x bin/agent-classroom.js`

- [ ] **Step 8: .gitignore を拡張 / src 空ディレクトリを作成**

既存の `.gitignore` に以下を追記:

```
node_modules/
dist/
public/assets/
.vite/
coverage/
*.tsbuildinfo
```

`mkdir -p src/shared src/observer/sources src/observer/parser src/web/components src/web/canvas tests/shared tests/observer tests/web scripts`

- [ ] **Step 9: pnpm install + 初回 typecheck**

```bash
pnpm install
pnpm run typecheck
```

Expected: `Command is running...` → 正常終了 (src 空でも fail しない)

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig*.json vite.config.ts vitest.config.ts bin/ .gitignore src/ scripts/ tests/
git commit -m "chore: scaffold Node + TypeScript project (observer + web)"
```

---

## Task 2: 不変契約の型定義 (src/shared/)

**Files:**
- Create: `src/shared/ids.ts`, `src/shared/events.ts`, `src/shared/ws-messages.ts`, `src/shared/persistence.ts`
- Create: `tests/shared/types.test.ts`

spec §3.1-3.6 で定義した不変契約を型として固定する。

- [ ] **Step 1: src/shared/ids.ts を作成**

```ts
export type SessionId = string & { readonly __brand: 'SessionId' };
export type ClassroomId = string & { readonly __brand: 'ClassroomId' };
export type StudentId = string & { readonly __brand: 'StudentId' };

export const asSessionId = (s: string): SessionId => s as SessionId;
export const asClassroomId = (s: string): ClassroomId => s as ClassroomId;
export const asStudentId = (s: string): StudentId => s as StudentId;

export const newClassroomId = (index: number): ClassroomId =>
  asClassroomId(`classroom-${index.toString().padStart(3, '0')}`);
```

- [ ] **Step 2: src/shared/events.ts を作成** (Observation event protocol)

```ts
import type { SessionId, StudentId } from './ids.js';

export type AgentState = 'active' | 'idle' | 'permission';

export type ObservationEvent =
  | { type: 'SessionStarted'; sessionId: SessionId; cwd: string; startedAt: number }
  | { type: 'SessionEnded'; sessionId: SessionId; endedAt: number }
  | { type: 'StudentSpawned'; sessionId: SessionId; studentId: StudentId; parentToolUseId: string; spawnedAt: number }
  | { type: 'StudentDespawned'; sessionId: SessionId; studentId: StudentId; despawnedAt: number }
  | { type: 'StateChanged'; sessionId: SessionId; target: 'teacher' | StudentId; state: AgentState; changedAt: number };
```

- [ ] **Step 3: src/shared/ws-messages.ts を作成** (WebSocket message schema)

```ts
import type { SessionId, ClassroomId, StudentId } from './ids.js';
import type { AgentState } from './events.js';

export interface ClassroomSnapshot {
  id: ClassroomId;
  gridPos: { row: number; col: number };
  layoutTemplateId: string;
  occupant: {
    sessionId: SessionId;
    teacherState: AgentState;
    students: { id: StudentId; state: AgentState }[];
  } | null;
}

export interface SchoolhouseSnapshot {
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomSnapshot[];
  layoutTemplates: { id: string; /* Task 3 で具体化 */ }[];
}

export type WSMessage =
  | { type: 'ClassroomList'; snapshot: SchoolhouseSnapshot }
  | { type: 'ClassroomUpdate'; classroomId: ClassroomId; update: Partial<Pick<ClassroomSnapshot, 'gridPos' | 'layoutTemplateId'>> }
  | { type: 'TeacherEntered'; classroomId: ClassroomId; sessionId: SessionId; cwd: string }
  | { type: 'TeacherLeft'; classroomId: ClassroomId; sessionId: SessionId }
  | { type: 'StudentEntered'; classroomId: ClassroomId; studentId: StudentId }
  | { type: 'StudentLeft'; classroomId: ClassroomId; studentId: StudentId }
  | { type: 'StateChanged'; classroomId: ClassroomId; target: 'teacher' | StudentId; state: AgentState }
  | { type: 'Toast'; level: 'info' | 'warn' | 'error'; message: string };
```

- [ ] **Step 4: src/shared/persistence.ts を作成** (layout persistence schema)

```ts
import type { ClassroomId } from './ids.js';

export interface LayoutTemplate {
  id: string;
  cols: number;              // タイル数 (横)
  rows: number;              // タイル数 (縦)
  tiles: number[];           // cols*rows の flat 配列、TileType の番号
  seats: { row: number; col: number }[];  // 座席位置
  teacherDesk: { row: number; col: number };
}

export interface ClassroomPersistence {
  id: ClassroomId;
  layoutTemplateId: string;
  gridPos: { row: number; col: number };
}

export interface SchoolhousePersistence {
  version: 1;
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomPersistence[];
  layoutTemplates: LayoutTemplate[];
}

export interface Config {
  port: number;
  classroomCount: number;        // 初期 N
  gridShape: { cols: number; rows: number };  // default: cols=3, rows=ceil(N/3)
  claudeProjectsDir: string;     // default: ~/.claude/projects
  stateDir: string;              // default: ~/.agent-classroom
}
```

- [ ] **Step 5: tests/shared/types.test.ts を作成し failing test を書く**

```ts
import { describe, it, expect } from 'vitest';
import { asSessionId, asClassroomId, newClassroomId } from '../../src/shared/ids.js';
import type { ObservationEvent } from '../../src/shared/events.js';
import type { WSMessage, SchoolhouseSnapshot } from '../../src/shared/ws-messages.js';
import type { SchoolhousePersistence } from '../../src/shared/persistence.js';

describe('shared types', () => {
  it('brands ids', () => {
    const s = asSessionId('uuid-1');
    const c = asClassroomId('classroom-001');
    expect(s).toBe('uuid-1');
    expect(c).toBe('classroom-001');
  });

  it('generates zero-padded classroom ids', () => {
    expect(newClassroomId(0)).toBe('classroom-000');
    expect(newClassroomId(9)).toBe('classroom-009');
    expect(newClassroomId(42)).toBe('classroom-042');
  });

  it('ObservationEvent discriminates by type', () => {
    const ev: ObservationEvent = {
      type: 'SessionStarted',
      sessionId: asSessionId('s1'),
      cwd: '/tmp',
      startedAt: Date.now(),
    };
    if (ev.type === 'SessionStarted') expect(ev.cwd).toBe('/tmp');
  });

  it('WSMessage and persistence types compile', () => {
    const ws: WSMessage = { type: 'Toast', level: 'info', message: 'hi' };
    const p: SchoolhousePersistence = {
      version: 1,
      gridShape: { cols: 3, rows: 2 },
      classrooms: [],
      layoutTemplates: [],
    };
    const snap: SchoolhouseSnapshot = {
      gridShape: p.gridShape,
      classrooms: [],
      layoutTemplates: [],
    };
    expect(ws.type).toBe('Toast');
    expect(snap.classrooms).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test**

```bash
pnpm run test -- tests/shared/types.test.ts
```

Expected: 4 passing

- [ ] **Step 7: Typecheck**

```bash
pnpm run typecheck
```

Expected: clean

- [ ] **Step 8: Commit**

```bash
git add src/shared/ tests/shared/
git commit -m "feat(shared): define invariant contracts (events, ws messages, persistence, ids)"
```

---

## Task 3: ClassroomManager (N 教室の状態 + アサイン)

spec §3.4 (識別子分離), §3.6 (Classroom abstraction), §2.3 (α ルール + 溢れ時の挙動) を実装する純ロジック。I/O を含まない。

**Files:**
- Create: `src/observer/classroom-manager.ts`
- Create: `tests/observer/classroom-manager.test.ts`

- [ ] **Step 1: failing test を書く**

```ts
// tests/observer/classroom-manager.test.ts
import { describe, it, expect } from 'vitest';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { asSessionId, newClassroomId } from '../../src/shared/ids.js';

const ids = [newClassroomId(0), newClassroomId(1), newClassroomId(2)];

describe('ClassroomManager', () => {
  it('assigns to minimum empty classroom', () => {
    const mgr = new ClassroomManager(ids);
    const result = mgr.assign(asSessionId('s1'));
    expect(result).toEqual({ ok: true, classroomId: ids[0] });
  });

  it('skips occupied classrooms', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    mgr.assign(asSessionId('s2'));
    const result = mgr.assign(asSessionId('s3'));
    expect(result).toEqual({ ok: true, classroomId: ids[2] });
  });

  it('reports overflow when all full', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    mgr.assign(asSessionId('s2'));
    mgr.assign(asSessionId('s3'));
    const result = mgr.assign(asSessionId('s4'));
    expect(result).toEqual({ ok: false, reason: 'overflow' });
  });

  it('reuses the same classroom id when same session assigned twice', () => {
    const mgr = new ClassroomManager(ids);
    const r1 = mgr.assign(asSessionId('s1'));
    const r2 = mgr.assign(asSessionId('s1'));
    expect(r1).toEqual(r2);
  });

  it('releases classroom on end', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    mgr.assign(asSessionId('s2'));
    mgr.release(asSessionId('s1'));
    expect(mgr.assign(asSessionId('s3'))).toEqual({ ok: true, classroomId: ids[0] });
  });

  it('release of unknown session is a no-op', () => {
    const mgr = new ClassroomManager(ids);
    expect(() => mgr.release(asSessionId('unknown'))).not.toThrow();
  });

  it('exposes current assignment map', () => {
    const mgr = new ClassroomManager(ids);
    mgr.assign(asSessionId('s1'));
    expect(mgr.occupantOf(ids[0])).toBe('s1');
    expect(mgr.occupantOf(ids[1])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm run test -- tests/observer/classroom-manager.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement ClassroomManager**

```ts
// src/observer/classroom-manager.ts
import type { SessionId, ClassroomId } from '../shared/ids.js';

export type AssignResult =
  | { ok: true; classroomId: ClassroomId }
  | { ok: false; reason: 'overflow' };

export class ClassroomManager {
  private readonly classroomIds: readonly ClassroomId[];
  private readonly sessionByClassroom = new Map<ClassroomId, SessionId>();
  private readonly classroomBySession = new Map<SessionId, ClassroomId>();

  constructor(classroomIds: readonly ClassroomId[]) {
    if (classroomIds.length === 0) throw new Error('classroom list must not be empty');
    this.classroomIds = classroomIds;
  }

  assign(sessionId: SessionId): AssignResult {
    const existing = this.classroomBySession.get(sessionId);
    if (existing !== undefined) return { ok: true, classroomId: existing };

    for (const cid of this.classroomIds) {
      if (!this.sessionByClassroom.has(cid)) {
        this.sessionByClassroom.set(cid, sessionId);
        this.classroomBySession.set(sessionId, cid);
        return { ok: true, classroomId: cid };
      }
    }
    return { ok: false, reason: 'overflow' };
  }

  release(sessionId: SessionId): ClassroomId | null {
    const cid = this.classroomBySession.get(sessionId);
    if (cid === undefined) return null;
    this.classroomBySession.delete(sessionId);
    this.sessionByClassroom.delete(cid);
    return cid;
  }

  occupantOf(classroomId: ClassroomId): SessionId | null {
    return this.sessionByClassroom.get(classroomId) ?? null;
  }

  classroomOf(sessionId: SessionId): ClassroomId | null {
    return this.classroomBySession.get(sessionId) ?? null;
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm run test -- tests/observer/classroom-manager.test.ts
```

Expected: 7 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/classroom-manager.ts tests/observer/classroom-manager.test.ts
git commit -m "feat(observer): implement ClassroomManager with alpha assignment + overflow"
```

---

## Task 4: Persistence Layer (~/.agent-classroom/ の I/O)

spec §3.5 の `SchoolhousePersistence` の読み書き + migration skeleton。

**Files:**
- Create: `src/observer/persistence.ts`
- Create: `tests/observer/persistence.test.ts`

- [ ] **Step 1: failing test を書く**

```ts
// tests/observer/persistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchoolhouse, saveSchoolhouse, initializeSchoolhouse } from '../../src/observer/persistence.js';
import { newClassroomId } from '../../src/shared/ids.js';
import type { LayoutTemplate } from '../../src/shared/persistence.js';

let tmpDir: string;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ac-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const defaultTemplate: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: Array(70).fill(1),
  seats: [{ row: 2, col: 2 }, { row: 2, col: 4 }],
  teacherDesk: { row: 5, col: 4 },
};

describe('persistence', () => {
  it('returns null when file absent', () => {
    expect(loadSchoolhouse(tmpDir)).toBeNull();
  });

  it('initializes N classrooms with default template', () => {
    const p = initializeSchoolhouse({ classroomCount: 4, gridCols: 3, defaultTemplate });
    expect(p.classrooms).toHaveLength(4);
    expect(p.classrooms[0]!.id).toBe(newClassroomId(0));
    expect(p.classrooms[0]!.gridPos).toEqual({ row: 0, col: 0 });
    expect(p.classrooms[3]!.gridPos).toEqual({ row: 1, col: 0 });
    expect(p.layoutTemplates).toHaveLength(1);
    expect(p.gridShape).toEqual({ cols: 3, rows: 2 });
  });

  it('saves and loads round-trip', () => {
    const original = initializeSchoolhouse({ classroomCount: 2, gridCols: 3, defaultTemplate });
    saveSchoolhouse(tmpDir, original);
    expect(existsSync(join(tmpDir, 'layout.json'))).toBe(true);
    const loaded = loadSchoolhouse(tmpDir);
    expect(loaded).toEqual(original);
  });

  it('writes schema version 1', () => {
    const p = initializeSchoolhouse({ classroomCount: 1, gridCols: 1, defaultTemplate });
    saveSchoolhouse(tmpDir, p);
    const raw = JSON.parse(readFileSync(join(tmpDir, 'layout.json'), 'utf8'));
    expect(raw.version).toBe(1);
  });

  it('rejects unknown schema version on load', () => {
    const file = join(tmpDir, 'layout.json');
    const { writeFileSync } = require('node:fs');
    writeFileSync(file, JSON.stringify({ version: 999 }));
    expect(() => loadSchoolhouse(tmpDir)).toThrow(/version/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm run test -- tests/observer/persistence.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement persistence**

```ts
// src/observer/persistence.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { newClassroomId } from '../shared/ids.js';
import type { SchoolhousePersistence, LayoutTemplate, ClassroomPersistence } from '../shared/persistence.js';

const FILE_NAME = 'layout.json';

export function loadSchoolhouse(stateDir: string): SchoolhousePersistence | null {
  const p = join(stateDir, FILE_NAME);
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, 'utf8')) as { version: number };
  if (raw.version !== 1) {
    throw new Error(`unsupported schema version: ${raw.version} (expected 1)`);
  }
  return raw as SchoolhousePersistence;
}

export function saveSchoolhouse(stateDir: string, data: SchoolhousePersistence): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, FILE_NAME), JSON.stringify(data, null, 2), 'utf8');
}

export interface InitParams {
  classroomCount: number;
  gridCols: number;
  defaultTemplate: LayoutTemplate;
}

export function initializeSchoolhouse({ classroomCount, gridCols, defaultTemplate }: InitParams): SchoolhousePersistence {
  if (classroomCount <= 0) throw new Error('classroomCount must be > 0');
  if (gridCols <= 0) throw new Error('gridCols must be > 0');
  const classrooms: ClassroomPersistence[] = [];
  for (let i = 0; i < classroomCount; i++) {
    classrooms.push({
      id: newClassroomId(i),
      layoutTemplateId: defaultTemplate.id,
      gridPos: { row: Math.floor(i / gridCols), col: i % gridCols },
    });
  }
  const rows = Math.ceil(classroomCount / gridCols);
  return {
    version: 1,
    gridShape: { cols: gridCols, rows },
    classrooms,
    layoutTemplates: [defaultTemplate],
  };
}
```

- [ ] **Step 4: Run test**

Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/persistence.ts tests/observer/persistence.test.ts
git commit -m "feat(observer): add ~/.agent-classroom/layout.json persistence with schema v1"
```

---

## Task 5: Config (CLI / env / defaults)

**Files:**
- Create: `src/observer/config.ts`
- Create: `tests/observer/config.test.ts`

- [ ] **Step 1: failing test を書く**

```ts
// tests/observer/config.test.ts
import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/observer/config.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('resolveConfig', () => {
  it('returns defaults when no overrides', () => {
    const cfg = resolveConfig({ argv: [], env: {} });
    expect(cfg.port).toBe(6868);
    expect(cfg.classroomCount).toBe(4);
    expect(cfg.gridShape).toEqual({ cols: 3, rows: 2 });
    expect(cfg.claudeProjectsDir).toBe(join(homedir(), '.claude', 'projects'));
    expect(cfg.stateDir).toBe(join(homedir(), '.agent-classroom'));
  });

  it('overrides port via --port', () => {
    const cfg = resolveConfig({ argv: ['--port', '7777'], env: {} });
    expect(cfg.port).toBe(7777);
  });

  it('overrides classroom count via --classrooms', () => {
    const cfg = resolveConfig({ argv: ['--classrooms', '6'], env: {} });
    expect(cfg.classroomCount).toBe(6);
    expect(cfg.gridShape).toEqual({ cols: 3, rows: 2 });
  });

  it('AGENT_CLASSROOM_PORT env wins when --port absent', () => {
    const cfg = resolveConfig({ argv: [], env: { AGENT_CLASSROOM_PORT: '9000' } });
    expect(cfg.port).toBe(9000);
  });

  it('rejects non-numeric port', () => {
    expect(() => resolveConfig({ argv: ['--port', 'xyz'], env: {} })).toThrow(/port/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement resolveConfig**

```ts
// src/observer/config.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../shared/persistence.js';

export interface ResolveInput {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

const DEFAULT_PORT = 6868;
const DEFAULT_CLASSROOMS = 4;
const DEFAULT_GRID_COLS = 3;

export function resolveConfig({ argv, env }: ResolveInput): Config {
  const port = parseIntOr(readFlag(argv, '--port') ?? env.AGENT_CLASSROOM_PORT, DEFAULT_PORT, 'port');
  const classroomCount = parseIntOr(readFlag(argv, '--classrooms') ?? env.AGENT_CLASSROOM_CLASSROOMS, DEFAULT_CLASSROOMS, 'classrooms');
  const gridCols = parseIntOr(readFlag(argv, '--grid-cols') ?? env.AGENT_CLASSROOM_GRID_COLS, DEFAULT_GRID_COLS, 'grid-cols');

  return {
    port,
    classroomCount,
    gridShape: { cols: gridCols, rows: Math.ceil(classroomCount / gridCols) },
    claudeProjectsDir: env.AGENT_CLASSROOM_CLAUDE_DIR ?? join(homedir(), '.claude', 'projects'),
    stateDir: env.AGENT_CLASSROOM_STATE_DIR ?? join(homedir(), '.agent-classroom'),
  };
}

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function parseIntOr(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid ${label}: ${value}`);
  return n;
}
```

- [ ] **Step 4: Run test**

Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/config.ts tests/observer/config.test.ts
git commit -m "feat(observer): CLI/env/default config resolver"
```

---

## Task 6: TranscriptParser (JSONL record → 中間 ParsedRecord)

spec §3.2 で定義した Observation event を生成するための前段。pixel-agents `transcriptParser.ts` 154-559 の **設計を参考**、実装は独自。

**Files:**
- Create: `src/observer/parser/transcript-parser.ts`
- Create: `tests/observer/transcript-parser.test.ts`

**参考**: `docs/pixel-agents-reference.md` §2.3 (JSONL レコード型一覧)

抽出する情報:
- `assistant` record 内 `tool_use` block → `ToolUseDetected`
- `user` record 内 `tool_result` block → `ToolResultDetected`
- `progress` record (subtype: `agent_progress`) → `ProgressDetected` (parentToolUseID 付き)
- `system` record (subtype: `turn_duration`) → `TurnDurationDetected`

この層は「JSONL 1 行を読んで何を検知したか」を吐くだけ。状態推論は次タスク。

- [ ] **Step 1: failing test を書く**

```ts
// tests/observer/transcript-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseLine } from '../../src/observer/parser/transcript-parser.js';

describe('parseLine', () => {
  it('detects tool_use in assistant record', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 1000,
      message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
    });
    expect(parseLine(line)).toEqual([
      { kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Read', at: 1000 },
    ]);
  });

  it('detects multiple tool_use in a single assistant record', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 1200,
      message: { content: [
        { type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} },
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'tu_3', name: 'Edit', input: {} },
      ]},
    });
    const result = parseLine(line);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'ToolUseDetected', toolUseId: 'tu_2' });
    expect(result[1]).toMatchObject({ kind: 'ToolUseDetected', toolUseId: 'tu_3' });
  });

  it('detects text-only assistant as TextOnly', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: 2000,
      message: { content: [{ type: 'text', text: 'done' }] },
    });
    expect(parseLine(line)).toEqual([{ kind: 'TextOnlyAssistant', at: 2000 }]);
  });

  it('detects tool_result in user record', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: 3000,
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] },
    });
    expect(parseLine(line)).toEqual([
      { kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 3000 },
    ]);
  });

  it('detects progress with parentToolUseID', () => {
    const line = JSON.stringify({
      type: 'progress',
      subtype: 'agent_progress',
      timestamp: 4000,
      parentToolUseID: 'tu_parent',
      agentId: 'sub_a',
      event: 'tool_use',
      tool: 'Read',
    });
    expect(parseLine(line)).toEqual([
      { kind: 'ProgressDetected', parentToolUseId: 'tu_parent', agentId: 'sub_a', event: 'tool_use', at: 4000 },
    ]);
  });

  it('detects turn_duration', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
      timestamp: 5000,
      duration_ms: 1200,
    });
    expect(parseLine(line)).toEqual([{ kind: 'TurnDurationDetected', at: 5000 }]);
  });

  it('returns empty for unknown / malformed lines', () => {
    expect(parseLine('{"type":"unknown"}')).toEqual([]);
    expect(parseLine('not json')).toEqual([]);
    expect(parseLine('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement parseLine**

```ts
// src/observer/parser/transcript-parser.ts
export type ParsedRecord =
  | { kind: 'ToolUseDetected'; toolUseId: string; toolName: string; at: number }
  | { kind: 'ToolResultDetected'; toolUseId: string; at: number }
  | { kind: 'TextOnlyAssistant'; at: number }
  | { kind: 'ProgressDetected'; parentToolUseId: string; agentId: string; event: string; at: number }
  | { kind: 'TurnDurationDetected'; at: number };

export function parseLine(line: string): ParsedRecord[] {
  if (!line.trim()) return [];
  let rec: unknown;
  try { rec = JSON.parse(line); } catch { return []; }
  if (typeof rec !== 'object' || rec === null) return [];
  const r = rec as Record<string, unknown>;
  const at = typeof r.timestamp === 'number' ? r.timestamp : Date.now();

  if (r.type === 'assistant') return parseAssistant(r, at);
  if (r.type === 'user') return parseUser(r, at);
  if (r.type === 'progress' && r.subtype === 'agent_progress') return parseProgress(r, at);
  if (r.type === 'system' && r.subtype === 'turn_duration') return [{ kind: 'TurnDurationDetected', at }];
  return [];
}

function parseAssistant(r: Record<string, unknown>, at: number): ParsedRecord[] {
  const msg = r.message as { content?: unknown[] } | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  const out: ParsedRecord[] = [];
  let anyToolUse = false;
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      out.push({ kind: 'ToolUseDetected', toolUseId: b.id, toolName: b.name, at });
      anyToolUse = true;
    }
  }
  if (!anyToolUse) out.push({ kind: 'TextOnlyAssistant', at });
  return out;
}

function parseUser(r: Record<string, unknown>, at: number): ParsedRecord[] {
  const msg = r.message as { content?: unknown[] } | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  const out: ParsedRecord[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      out.push({ kind: 'ToolResultDetected', toolUseId: b.tool_use_id, at });
    }
  }
  return out;
}

function parseProgress(r: Record<string, unknown>, at: number): ParsedRecord[] {
  if (typeof r.parentToolUseID !== 'string') return [];
  if (typeof r.agentId !== 'string') return [];
  if (typeof r.event !== 'string') return [];
  return [{
    kind: 'ProgressDetected',
    parentToolUseId: r.parentToolUseID,
    agentId: r.agentId,
    event: r.event,
    at,
  }];
}
```

- [ ] **Step 4: Run test**

Expected: 7 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/parser/transcript-parser.ts tests/observer/transcript-parser.test.ts
git commit -m "feat(observer): parseLine for JSONL transcript (tool_use, tool_result, progress, turn_duration)"
```

---

## Task 7: StateInferrer (ParsedRecord → ObservationEvent with heuristic)

spec §4.1 の状態推論ロジックを実装。

ルール:
- `ToolUseDetected` → 即座に `StateChanged(active)` 発火
- `ToolResultDetected` (非 exempt tool) → 7 秒タイマー起動。期間中に次の tool_use なし → `StateChanged(permission)` 発火
- `TextOnlyAssistant` → 5 秒タイマー起動。期間中に新イベントなし → `StateChanged(idle)` 発火
- `TurnDurationDetected` → 即 `StateChanged(idle)` 発火 (definitive)
- `ProgressDetected`(event='tool_use') で新しい agentId が初出 → `StudentSpawned`
- `ProgressDetected`(event='stop') → `StudentDespawned`

**exempt tool**: Read, Glob, Grep, WebFetch, LS (pixel-agents 準拠、permission 判定を除外する読取系)

**Files:**
- Create: `src/observer/parser/state-inferrer.ts`
- Create: `tests/observer/state-inferrer.test.ts`

- [ ] **Step 1: failing test を書く**

```ts
// tests/observer/state-inferrer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateInferrer } from '../../src/observer/parser/state-inferrer.js';
import { asSessionId } from '../../src/shared/ids.js';
import type { ObservationEvent } from '../../src/shared/events.js';

const sessionId = asSessionId('s1');

describe('StateInferrer', () => {
  let events: ObservationEvent[];
  let now: number;

  const emit = (e: ObservationEvent) => { events.push(e); };
  const makeInferrer = () => new StateInferrer({ sessionId, emit, now: () => now });

  beforeEach(() => { events = []; now = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ToolUseDetected → StateChanged(active)', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', at: 100 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });

  it('TurnDurationDetected → StateChanged(idle)', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'TurnDurationDetected', at: 200 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'idle' }));
  });

  it('TextOnlyAssistant + 5s silence → idle', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'TextOnlyAssistant', at: 300 });
    vi.advanceTimersByTime(5000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'idle' }));
  });

  it('TextOnlyAssistant but next event before 5s → no idle', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'TextOnlyAssistant', at: 300 });
    vi.advanceTimersByTime(2000);
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_x', toolName: 'Bash', at: 2300 });
    vi.advanceTimersByTime(5000);
    const idles = events.filter((e) => e.type === 'StateChanged' && e.state === 'idle');
    expect(idles).toHaveLength(0);
  });

  it('non-exempt tool_result + 7s silence → permission', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_1', toolName: 'Bash', at: 400 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_1', at: 450 });
    vi.advanceTimersByTime(7000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'permission' }));
  });

  it('exempt tool_result does not trigger permission', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ToolUseDetected', toolUseId: 'tu_2', toolName: 'Read', at: 500 });
    inf.ingest({ kind: 'ToolResultDetected', toolUseId: 'tu_2', at: 550 });
    vi.advanceTimersByTime(7000);
    const perms = events.filter((e) => e.type === 'StateChanged' && e.state === 'permission');
    expect(perms).toHaveLength(0);
  });

  it('progress with new agentId → StudentSpawned; event=stop → StudentDespawned', () => {
    const inf = makeInferrer();
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'sub_a', event: 'tool_use', at: 600 });
    inf.ingest({ kind: 'ProgressDetected', parentToolUseId: 'tu_p', agentId: 'sub_a', event: 'stop', at: 700 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentSpawned' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'StudentDespawned' }));
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement StateInferrer (exempt 判定含む全機能)**

```ts
// src/observer/parser/state-inferrer.ts
import type { SessionId, StudentId } from '../../shared/ids.js';
import { asStudentId } from '../../shared/ids.js';
import type { ObservationEvent, AgentState } from '../../shared/events.js';
import type { ParsedRecord } from './transcript-parser.js';

const EXEMPT_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'LS', 'TodoWrite']);
const IDLE_TIMEOUT_MS = 5000;
const PERMISSION_TIMEOUT_MS = 7000;

export interface StateInferrerOptions {
  sessionId: SessionId;
  emit: (event: ObservationEvent) => void;
  now: () => number;
}

export class StateInferrer {
  private readonly opts: StateInferrerOptions;
  private lastState: AgentState = 'idle';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private permissionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly students = new Map<string, StudentId>();
  private readonly pendingTools = new Map<string, string>();  // toolUseId → toolName

  constructor(opts: StateInferrerOptions) { this.opts = opts; }

  ingest(record: ParsedRecord): void {
    this.clearTimers();
    switch (record.kind) {
      case 'ToolUseDetected':
        this.pendingTools.set(record.toolUseId, record.toolName);
        this.setState('active', record.at);
        break;
      case 'TurnDurationDetected':
        this.setState('idle', record.at);
        break;
      case 'TextOnlyAssistant':
        this.idleTimer = setTimeout(
          () => this.setState('idle', this.opts.now()),
          IDLE_TIMEOUT_MS,
        );
        break;
      case 'ToolResultDetected': {
        const toolName = this.pendingTools.get(record.toolUseId);
        this.pendingTools.delete(record.toolUseId);
        if (toolName !== undefined && !EXEMPT_TOOLS.has(toolName)) {
          this.permissionTimer = setTimeout(
            () => this.setState('permission', this.opts.now()),
            PERMISSION_TIMEOUT_MS,
          );
        }
        break;
      }
      case 'ProgressDetected':
        this.handleProgress(record);
        break;
    }
  }

  private handleProgress(r: Extract<ParsedRecord, { kind: 'ProgressDetected' }>): void {
    let sid = this.students.get(r.agentId);
    if (sid === undefined) {
      sid = asStudentId(r.agentId);
      this.students.set(r.agentId, sid);
      this.opts.emit({
        type: 'StudentSpawned',
        sessionId: this.opts.sessionId,
        studentId: sid,
        parentToolUseId: r.parentToolUseId,
        spawnedAt: r.at,
      });
    }
    if (r.event === 'stop') {
      this.opts.emit({
        type: 'StudentDespawned',
        sessionId: this.opts.sessionId,
        studentId: sid,
        despawnedAt: r.at,
      });
      this.students.delete(r.agentId);
    }
  }

  private setState(state: AgentState, at: number): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.opts.emit({
      type: 'StateChanged',
      sessionId: this.opts.sessionId,
      target: 'teacher',
      state,
      changedAt: at,
    });
  }

  private clearTimers(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.permissionTimer) { clearTimeout(this.permissionTimer); this.permissionTimer = null; }
  }

  dispose(): void { this.clearTimers(); }
}
```

**設計メモ**: permission は `ToolUseDetected` で tool 名を `pendingTools` に保持し、`ToolResultDetected` で lookup。exempt tool (Read/Glob/Grep/WebFetch/LS/TodoWrite) なら permission タイマー不起動。pixel-agents `timerManager.ts` の考え方を踏襲。

- [ ] **Step 4: Run test**

```bash
pnpm run test -- tests/observer/state-inferrer.test.ts
```

Expected: 7 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/parser/state-inferrer.ts tests/observer/state-inferrer.test.ts
git commit -m "feat(observer): heuristic state inferrer (active/idle/permission + student spawn/despawn)"
```

---

## Task 8: FileWatcher (~/.claude/projects/ スキャン + tail)

**Files:**
- Create: `src/observer/parser/file-watcher.ts`
- Create: `tests/observer/file-watcher.test.ts`

pixel-agents `fileWatcher.ts` の設計を参考:
- 1s ごとに project dir を scan、直近 2 分以内に変更された `.jsonl` を検出
- 各ファイルは byte offset を保持し 500ms ごとに増分読み出し → 行単位に分割して callback

**Files:**
- Create: `src/observer/parser/file-watcher.ts`
- Create: `tests/observer/file-watcher.test.ts`

- [ ] **Step 1: failing test を書く (tmpdir + fake project dir)**

```ts
// tests/observer/file-watcher.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWatcher } from '../../src/observer/parser/file-watcher.js';

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'ac-fw-')); vi.useFakeTimers(); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); vi.useRealTimers(); });

describe('FileWatcher', () => {
  it('detects new .jsonl files and yields lines', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 'abc.jsonl');
    writeFileSync(file, '');

    const received: { path: string; line: string }[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (path, line) => received.push({ path, line }),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
    });
    fw.start();

    appendFileSync(file, '{"type":"assistant","timestamp":1}\n');
    await vi.advanceTimersByTimeAsync(1500);
    expect(received.some((r) => r.line.includes('assistant'))).toBe(true);

    fw.stop();
  });

  it('ignores non-jsonl files', async () => {
    mkdirSync(join(base, 'proj'));
    writeFileSync(join(base, 'proj', 'notes.txt'), 'hello\n');
    const received: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: (_p, l) => received.push(l),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(received).toHaveLength(0);
    fw.stop();
  });

  it('emits onFileAdded and onFileClosed callbacks', async () => {
    const projectDir = join(base, 'proj');
    mkdirSync(projectDir);
    const file = join(projectDir, 's1.jsonl');
    writeFileSync(file, '');

    const added: string[] = [];
    const closed: string[] = [];
    const fw = new FileWatcher({
      rootDir: base,
      onLine: () => {},
      onFileAdded: (p) => added.push(p),
      onFileClosed: (p) => closed.push(p),
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
      staleThresholdMs: 2000,
    });
    fw.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(added).toContain(file);

    // 変更後、staleThresholdMs を超えたら closed
    await vi.advanceTimersByTimeAsync(3000);
    expect(closed).toContain(file);

    fw.stop();
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement FileWatcher**

```ts
// src/observer/parser/file-watcher.ts
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export interface FileWatcherOptions {
  rootDir: string;
  onLine: (path: string, line: string) => void;
  onFileAdded?: (path: string) => void;
  onFileClosed?: (path: string) => void;
  scanIntervalMs?: number;
  tailIntervalMs?: number;
  staleThresholdMs?: number;  // 最終更新から閾値超で closed 扱い
}

interface TrackedFile {
  path: string;
  offset: number;
  lastMtimeMs: number;
}

export class FileWatcher {
  private readonly opts: Required<FileWatcherOptions>;
  private readonly tracked = new Map<string, TrackedFile>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private tailTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: FileWatcherOptions) {
    this.opts = {
      scanIntervalMs: 1000,
      tailIntervalMs: 500,
      staleThresholdMs: 120_000,
      onFileAdded: () => {},
      onFileClosed: () => {},
      ...opts,
    };
  }

  start(): void {
    this.scanOnce();
    this.scanTimer = setInterval(() => this.scanOnce(), this.opts.scanIntervalMs);
    this.tailTimer = setInterval(() => this.tailAll(), this.opts.tailIntervalMs);
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.tailTimer) clearInterval(this.tailTimer);
    this.scanTimer = null;
    this.tailTimer = null;
  }

  private scanOnce(): void {
    const now = Date.now();
    let entries: string[];
    try { entries = readdirSync(this.opts.rootDir); } catch { return; }
    for (const projDir of entries) {
      const full = join(this.opts.rootDir, projDir);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      let files: string[];
      try { files = readdirSync(full); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = join(full, f);
        let fs_;
        try { fs_ = statSync(fp); } catch { continue; }
        if (!this.tracked.has(fp)) {
          this.tracked.set(fp, { path: fp, offset: 0, lastMtimeMs: fs_.mtimeMs });
          this.opts.onFileAdded(fp);
        } else {
          this.tracked.get(fp)!.lastMtimeMs = fs_.mtimeMs;
        }
      }
    }
    for (const [path, t] of this.tracked) {
      if (now - t.lastMtimeMs > this.opts.staleThresholdMs) {
        this.tracked.delete(path);
        this.opts.onFileClosed(path);
      }
    }
  }

  private tailAll(): void {
    for (const t of this.tracked.values()) this.tailOne(t);
  }

  private tailOne(t: TrackedFile): void {
    let st;
    try { st = statSync(t.path); } catch { return; }
    if (st.size <= t.offset) return;
    const fd = openSync(t.path, 'r');
    try {
      const len = st.size - t.offset;
      const buf = Buffer.allocUnsafe(len);
      readSync(fd, buf, 0, len, t.offset);
      t.offset = st.size;
      t.lastMtimeMs = st.mtimeMs;
      const chunk = buf.toString('utf8');
      for (const line of chunk.split('\n')) {
        if (line.trim().length > 0) this.opts.onLine(t.path, line);
      }
    } finally {
      closeSync(fd);
    }
  }
}
```

- [ ] **Step 4: Run test**

Expected: 3 passing

(fake timer で `setInterval` 発火が実ファイル読みに繋がるため、一部環境で不安定な場合あり。安定しなければ `vi.runOnlyPendingTimersAsync()` を使用する形に調整。)

- [ ] **Step 5: Commit**

```bash
git add src/observer/parser/file-watcher.ts tests/observer/file-watcher.test.ts
git commit -m "feat(observer): FileWatcher with dir scan + tail (polling, stale detection)"
```

---

## Task 9: SourceAdapter + HostSource 統合

不変契約 §3.1 の SourceAdapter interface を定義、host 実装は上記 Task 6-8 を組み合わせる。

**Files:**
- Create: `src/observer/sources/adapter.ts`
- Create: `src/observer/sources/host-source.ts`
- Create: `tests/observer/host-source.test.ts`

- [ ] **Step 1: SourceAdapter interface**

```ts
// src/observer/sources/adapter.ts
import type { ObservationEvent } from '../../shared/events.js';

export interface SourceAdapter {
  start(): void;
  stop(): void;
  on(listener: (event: ObservationEvent) => void): () => void;
}
```

- [ ] **Step 2: failing test で HostSource を駆動**

```ts
// tests/observer/host-source.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostSource } from '../../src/observer/sources/host-source.js';
import type { ObservationEvent } from '../../src/shared/events.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ac-src-')); vi.useFakeTimers(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

describe('HostSource', () => {
  it('emits SessionStarted when new jsonl appears, SessionEnded when stale', async () => {
    const src = new HostSource({ rootDir: root, scanIntervalMs: 100, tailIntervalMs: 50, staleThresholdMs: 500 });
    const events: ObservationEvent[] = [];
    src.on((e) => events.push(e));
    src.start();

    const projDir = join(root, '-tmp-proj');
    mkdirSync(projDir);
    const file = join(projDir, 'abc-uuid.jsonl');
    writeFileSync(file, '');

    await vi.advanceTimersByTimeAsync(200);
    expect(events.some((e) => e.type === 'SessionStarted' && e.sessionId === 'abc-uuid')).toBe(true);

    appendFileSync(file, JSON.stringify({
      type: 'assistant',
      timestamp: 100,
      message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash' }] },
    }) + '\n');

    await vi.advanceTimersByTimeAsync(200);
    expect(events.some((e) => e.type === 'StateChanged' && e.state === 'active')).toBe(true);

    await vi.advanceTimersByTimeAsync(700);  // stale
    expect(events.some((e) => e.type === 'SessionEnded')).toBe(true);

    src.stop();
  });
});
```

- [ ] **Step 3: Implement HostSource**

```ts
// src/observer/sources/host-source.ts
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
      scanIntervalMs: opts.scanIntervalMs,
      tailIntervalMs: opts.tailIntervalMs,
      staleThresholdMs: opts.staleThresholdMs,
      onFileAdded: (p) => this.handleAdded(p),
      onFileClosed: (p) => this.handleClosed(p),
      onLine: (p, l) => this.handleLine(p, l),
    });
  }

  start(): void { this.fw.start(); }
  stop(): void { this.fw.stop(); for (const inf of this.inferrers.values()) inf.dispose(); this.inferrers.clear(); }

  on(listener: (event: ObservationEvent) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private emit(e: ObservationEvent): void { for (const l of this.listeners) l(e); }

  private handleAdded(path: string): void {
    const sessionId = asSessionId(basename(path, '.jsonl'));
    this.emit({ type: 'SessionStarted', sessionId, cwd: '', startedAt: Date.now() });
    const inf = new StateInferrer({
      sessionId,
      emit: (e) => this.emit(e),
      now: () => Date.now(),
    });
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
```

- [ ] **Step 4: Run test**

Expected: 1 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/sources/ tests/observer/host-source.test.ts
git commit -m "feat(observer): HostSource adapter wires file watcher + parser + inferrer"
```

---

## Task 10: WSBroadcaster (snapshot on connect + delta broadcast)

spec §3.3 同期モデル + 多重接続を実装する純ロジック (WebSocket 層は Task 11)。

**Files:**
- Create: `src/observer/ws-broadcaster.ts`
- Create: `tests/observer/ws-broadcaster.test.ts`

Broadcaster は以下を管理:
- 現在の `SchoolhouseSnapshot` (classroom state)
- ObservationEvent を受けて snapshot を更新し、delta WSMessage を算出して全クライアントに送信
- 新規クライアント接続時に `ClassroomList` を 1 回送信

- [ ] **Step 1: failing test**

```ts
// tests/observer/ws-broadcaster.test.ts
import { describe, it, expect } from 'vitest';
import { Broadcaster } from '../../src/observer/ws-broadcaster.js';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { newClassroomId, asSessionId, asStudentId } from '../../src/shared/ids.js';
import type { WSMessage } from '../../src/shared/ws-messages.js';
import type { LayoutTemplate } from '../../src/shared/persistence.js';

const tpl: LayoutTemplate = {
  id: 'default', cols: 10, rows: 7, tiles: Array(70).fill(1), seats: [], teacherDesk: { row: 0, col: 0 },
};
const ids = [newClassroomId(0), newClassroomId(1)];

describe('Broadcaster', () => {
  it('sends ClassroomList on new subscription', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    expect(received[0]).toMatchObject({ type: 'ClassroomList' });
  });

  it('translates SessionStarted → TeacherEntered delta for the assigned classroom', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '/tmp', startedAt: 0 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'TeacherEntered', classroomId: ids[0] }));
  });

  it('emits Toast on overflow', () => {
    const mgr = new ClassroomManager([newClassroomId(0)]);  // N=1
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 1, rows: 1 },
        classrooms: [{ id: newClassroomId(0), gridPos: { row: 0, col: 0 }, layoutTemplateId: 'default', occupant: null }],
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 0 });
    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s2'), cwd: '', startedAt: 0 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'Toast', level: 'warn' }));
  });

  it('emits StateChanged delta', () => {
    const mgr = new ClassroomManager(ids);
    const b = new Broadcaster({
      manager: mgr,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const received: WSMessage[] = [];
    b.subscribe((m) => received.push(m));
    received.length = 0;

    b.ingest({ type: 'SessionStarted', sessionId: asSessionId('s1'), cwd: '', startedAt: 0 });
    b.ingest({ type: 'StateChanged', sessionId: asSessionId('s1'), target: 'teacher', state: 'active', changedAt: 10 });
    expect(received).toContainEqual(expect.objectContaining({ type: 'StateChanged', state: 'active' }));
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement Broadcaster**

```ts
// src/observer/ws-broadcaster.ts
import type { ClassroomManager } from './classroom-manager.js';
import type { ObservationEvent } from '../shared/events.js';
import type { WSMessage, SchoolhouseSnapshot, ClassroomSnapshot } from '../shared/ws-messages.js';
import type { ClassroomId } from '../shared/ids.js';

export interface BroadcasterOptions {
  manager: ClassroomManager;
  initialSnapshot: SchoolhouseSnapshot;
}

export class Broadcaster {
  private snapshot: SchoolhouseSnapshot;
  private readonly manager: ClassroomManager;
  private subs: ((msg: WSMessage) => void)[] = [];

  constructor(opts: BroadcasterOptions) {
    this.manager = opts.manager;
    this.snapshot = opts.initialSnapshot;
  }

  subscribe(fn: (msg: WSMessage) => void): () => void {
    this.subs.push(fn);
    fn({ type: 'ClassroomList', snapshot: this.snapshot });
    return () => { this.subs = this.subs.filter((s) => s !== fn); };
  }

  ingest(ev: ObservationEvent): void {
    switch (ev.type) {
      case 'SessionStarted': {
        const res = this.manager.assign(ev.sessionId);
        if (!res.ok) {
          this.broadcast({ type: 'Toast', level: 'warn', message: `教室が全て埋まっています (session=${ev.sessionId})。config で classroomCount を増やして再起動してください。` });
          return;
        }
        this.patchSnapshot(res.classroomId, (c) => ({
          ...c,
          occupant: { sessionId: ev.sessionId, teacherState: 'idle', students: [] },
        }));
        this.broadcast({ type: 'TeacherEntered', classroomId: res.classroomId, sessionId: ev.sessionId, cwd: ev.cwd });
        break;
      }
      case 'SessionEnded': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.manager.release(ev.sessionId);
        this.patchSnapshot(cid, (c) => ({ ...c, occupant: null }));
        this.broadcast({ type: 'TeacherLeft', classroomId: cid, sessionId: ev.sessionId });
        break;
      }
      case 'StudentSpawned': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: [...c.occupant.students, { id: ev.studentId, state: 'active' }] } };
        });
        this.broadcast({ type: 'StudentEntered', classroomId: cid, studentId: ev.studentId });
        break;
      }
      case 'StudentDespawned': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: c.occupant.students.filter((s) => s.id !== ev.studentId) } };
        });
        this.broadcast({ type: 'StudentLeft', classroomId: cid, studentId: ev.studentId });
        break;
      }
      case 'StateChanged': {
        const cid = this.manager.classroomOf(ev.sessionId);
        if (!cid) return;
        this.patchSnapshot(cid, (c) => {
          if (!c.occupant) return c;
          if (ev.target === 'teacher') return { ...c, occupant: { ...c.occupant, teacherState: ev.state } };
          return {
            ...c,
            occupant: {
              ...c.occupant,
              students: c.occupant.students.map((s) => (s.id === ev.target ? { ...s, state: ev.state } : s)),
            },
          };
        });
        this.broadcast({ type: 'StateChanged', classroomId: cid, target: ev.target, state: ev.state });
        break;
      }
    }
  }

  private patchSnapshot(classroomId: ClassroomId, patch: (c: ClassroomSnapshot) => ClassroomSnapshot): void {
    this.snapshot = {
      ...this.snapshot,
      classrooms: this.snapshot.classrooms.map((c) => (c.id === classroomId ? patch(c) : c)),
    };
  }

  private broadcast(msg: WSMessage): void { for (const fn of this.subs) fn(msg); }
}
```

- [ ] **Step 4: Run test**

Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/observer/ws-broadcaster.ts tests/observer/ws-broadcaster.test.ts
git commit -m "feat(observer): Broadcaster maintains snapshot + emits WS delta messages"
```

---

## Task 11: HTTP + WS Server + Logger + CLI entrypoint

**Files:**
- Create: `src/observer/logger.ts`
- Create: `src/observer/server.ts`
- Create: `src/observer/cli.ts`
- Create: `tests/observer/server.test.ts`

- [ ] **Step 1: logger**

```ts
// src/observer/logger.ts
type Level = 'info' | 'warn' | 'error';
export const logger = {
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
};
function log(level: Level, msg: string, meta?: unknown): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ? { meta } : {}) });
  process.stderr.write(line + '\n');
}
```

- [ ] **Step 2: server.test.ts (integration)**

```ts
// tests/observer/server.test.ts
import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/observer/server.js';
import WebSocket from 'ws';
import { AddressInfo } from 'node:net';
import { HostSource } from '../../src/observer/sources/host-source.js';
import { ClassroomManager } from '../../src/observer/classroom-manager.js';
import { Broadcaster } from '../../src/observer/ws-broadcaster.js';
import { newClassroomId } from '../../src/shared/ids.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('server integration', () => {
  it('serves static and exposes /ws that delivers ClassroomList on connect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-srv-'));
    const ids = [newClassroomId(0), newClassroomId(1)];
    const manager = new ClassroomManager(ids);
    const broadcaster = new Broadcaster({
      manager,
      initialSnapshot: {
        gridShape: { cols: 2, rows: 1 },
        classrooms: ids.map((id, i) => ({
          id, gridPos: { row: 0, col: i }, layoutTemplateId: 'default', occupant: null,
        })),
        layoutTemplates: [{ id: 'default' }],
      },
    });
    const source = new HostSource({ rootDir: root });
    source.on((e) => broadcaster.ingest(e));

    const srv = createServer({ staticDir: root, broadcaster, source, port: 0 });
    await srv.start();

    const port = (srv.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const first = await new Promise<string>((resolve, reject) => {
      ws.on('message', (d) => resolve(d.toString()));
      ws.on('error', reject);
    });
    expect(JSON.parse(first)).toMatchObject({ type: 'ClassroomList' });

    ws.close();
    await srv.stop();
    rmSync(root, { recursive: true, force: true });
  }, 10_000);
});
```

- [ ] **Step 3: server.ts**

```ts
// src/observer/server.ts
import express from 'express';
import { createServer as createHttp, type Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Broadcaster } from './ws-broadcaster.js';
import type { SourceAdapter } from './sources/adapter.js';
import type { WSMessage } from '../shared/ws-messages.js';
import { logger } from './logger.js';

export interface CreateServerOptions {
  staticDir: string;
  broadcaster: Broadcaster;
  source: SourceAdapter;
  port: number;
}

export function createServer(opts: CreateServerOptions) {
  const app = express();
  app.use(express.static(opts.staticDir));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const http: HttpServer = createHttp(app);
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (socket) => {
    const unsub = opts.broadcaster.subscribe((msg: WSMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    });
    socket.on('close', unsub);
    socket.on('error', (err) => logger.warn('ws socket error', { err: String(err) }));
  });

  return {
    async start(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(opts.port, () => { http.off('error', reject); resolve(); });
      });
      opts.source.start();
      logger.info('observer started', { port: (http.address() as AddressInfo).port });
    },
    async stop(): Promise<void> {
      opts.source.stop();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    address(): AddressInfo | string | null { return http.address(); },
  };
}
```

- [ ] **Step 4: cli.ts**

```ts
// src/observer/cli.ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveConfig } from './config.js';
import { loadSchoolhouse, saveSchoolhouse, initializeSchoolhouse } from './persistence.js';
import { ClassroomManager } from './classroom-manager.js';
import { Broadcaster } from './ws-broadcaster.js';
import { HostSource } from './sources/host-source.js';
import { createServer } from './server.js';
import { logger } from './logger.js';
import type { LayoutTemplate } from '../shared/persistence.js';
import type { SchoolhouseSnapshot } from '../shared/ws-messages.js';

const DEFAULT_TEMPLATE: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: Array(70).fill(1),
  seats: [
    { row: 2, col: 2 }, { row: 2, col: 4 }, { row: 2, col: 6 },
    { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 3, col: 6 },
  ],
  teacherDesk: { row: 5, col: 4 },
};

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'start') {
    process.stderr.write('Usage: agent-classroom start [--port N] [--classrooms N]\n');
    return 2;
  }

  const config = resolveConfig({ argv: rest, env });
  let persisted = loadSchoolhouse(config.stateDir);
  if (!persisted) {
    persisted = initializeSchoolhouse({
      classroomCount: config.classroomCount,
      gridCols: config.gridShape.cols,
      defaultTemplate: DEFAULT_TEMPLATE,
    });
    saveSchoolhouse(config.stateDir, persisted);
  }

  const classroomIds = persisted.classrooms.map((c) => c.id);
  const manager = new ClassroomManager(classroomIds);
  const initialSnapshot: SchoolhouseSnapshot = {
    gridShape: persisted.gridShape,
    classrooms: persisted.classrooms.map((c) => ({
      id: c.id,
      gridPos: c.gridPos,
      layoutTemplateId: c.layoutTemplateId,
      occupant: null,
    })),
    layoutTemplates: persisted.layoutTemplates.map((t) => ({ id: t.id })),
  };
  const broadcaster = new Broadcaster({ manager, initialSnapshot });
  const source = new HostSource({ rootDir: config.claudeProjectsDir });
  source.on((e) => broadcaster.ingest(e));

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../web'),          // dist/web next to dist/observer
    resolve(here, '../../../dist/web'),  // fallback
  ];
  const staticDir = candidates.find((p) => existsSync(join(p, 'index.html'))) ?? candidates[0]!;

  const server = createServer({ staticDir, broadcaster, source, port: config.port });
  try {
    await server.start();
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `port ${config.port} is already in use. Another observer may be running (1 machine = 1 schoolhouse).`
      : String(err);
    logger.error('failed to start', { msg });
    process.stderr.write(msg + '\n');
    return 1;
  }

  const shutdown = async () => {
    logger.info('shutting down');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
}

main(process.argv.slice(2), process.env).then(
  (code) => { if (code !== 0) process.exit(code); },
  (err) => { logger.error('crashed', { err: String(err) }); process.exit(1); },
);
```

- [ ] **Step 5: Run integration test**

```bash
pnpm run test -- tests/observer/server.test.ts
```

Expected: 1 passing

- [ ] **Step 6: Commit**

```bash
git add src/observer/logger.ts src/observer/server.ts src/observer/cli.ts tests/observer/server.test.ts
git commit -m "feat(observer): HTTP + WebSocket server + CLI entrypoint"
```

---

## Task 12: Assets ingestion script

`assets-reference/cool-school/CoolSchool_tileset_48px/CoolSchool_tileset.png` と `assets-reference/kenney-tiny-dungeon/Tiles/tile_00{85,86,88,98,99}.png` + `tile_0100.png` + `tile_0112.png` を `src/web/public/assets/` にコピー。

**Files:**
- Create: `scripts/copy-assets.ts`
- Create: `src/web/public/assets/.gitkeep`

- [ ] **Step 1: scripts/copy-assets.ts**

```ts
// scripts/copy-assets.ts
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const SRC = resolve(repo, 'assets-reference');
const OUT = resolve(repo, 'src/web/public/assets');

if (!existsSync(SRC)) {
  console.error(`[copy-assets] assets-reference/ not found at ${SRC}. Skipping (OK in CI).`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(OUT, 'characters'), { recursive: true });

const tile = resolve(SRC, 'cool-school/CoolSchool_tileset_48px/CoolSchool_tileset.png');
const tileDst = resolve(OUT, 'cool-school-tileset.png');
if (existsSync(tile)) cpSync(tile, tileDst);
else console.warn(`[copy-assets] not found: ${tile}`);

const charIds = ['0085', '0086', '0088', '0098', '0099', '0100', '0112'];
for (const id of charIds) {
  const s = resolve(SRC, `kenney-tiny-dungeon/Tiles/tile_${id}.png`);
  const d = resolve(OUT, 'characters', `char-${id}.png`);
  if (existsSync(s)) cpSync(s, d);
  else console.warn(`[copy-assets] not found: ${s}`);
}

console.log('[copy-assets] done');
```

- [ ] **Step 2: package.json scripts に `copy-assets` と prebuild hook を追加**

```json
"scripts": {
  ...
  "copy-assets": "tsx scripts/copy-assets.ts",
  "prebuild:web": "pnpm run copy-assets",
  ...
}
```

devDependencies に `tsx` を追加:
```bash
pnpm add -D tsx
```

- [ ] **Step 3: Run**

```bash
pnpm run copy-assets
ls src/web/public/assets/
```

Expected: `cool-school-tileset.png` と `characters/char-*.png` (7 個) が存在 (assets-reference/ がある場合)

- [ ] **Step 4: .gitkeep を作成**

`touch src/web/public/assets/.gitkeep`

- [ ] **Step 5: Commit**

```bash
git add scripts/copy-assets.ts src/web/public/assets/.gitkeep package.json pnpm-lock.yaml
git commit -m "chore(assets): add copy-assets script pulling Cool School + 7 Tiny Dungeon chars"
```

---

## Task 13: Web Store + WS Client

**Files:**
- Create: `src/web/store.ts`
- Create: `src/web/ws-client.ts`
- Create: `tests/web/store.test.ts`

- [ ] **Step 1: failing test**

```ts
// tests/web/store.test.ts
import { describe, it, expect } from 'vitest';
import { createStore } from '../../src/web/store.js';
import type { WSMessage } from '../../src/shared/ws-messages.js';
import { newClassroomId, asSessionId, asStudentId } from '../../src/shared/ids.js';

const id0 = newClassroomId(0);
const id1 = newClassroomId(1);

const list: WSMessage = {
  type: 'ClassroomList',
  snapshot: {
    gridShape: { cols: 2, rows: 1 },
    classrooms: [
      { id: id0, gridPos: { row: 0, col: 0 }, layoutTemplateId: 'default', occupant: null },
      { id: id1, gridPos: { row: 0, col: 1 }, layoutTemplateId: 'default', occupant: null },
    ],
    layoutTemplates: [{ id: 'default' }],
  },
};

describe('store', () => {
  it('applies ClassroomList as full replacement', () => {
    const s = createStore();
    s.apply(list);
    expect(s.getState().classrooms).toHaveLength(2);
  });

  it('applies TeacherEntered delta', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'TeacherEntered', classroomId: id0, sessionId: asSessionId('s1'), cwd: '/tmp' });
    expect(s.getState().classrooms[0]!.occupant?.sessionId).toBe('s1');
  });

  it('applies StateChanged for teacher', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'TeacherEntered', classroomId: id0, sessionId: asSessionId('s1'), cwd: '' });
    s.apply({ type: 'StateChanged', classroomId: id0, target: 'teacher', state: 'active' });
    expect(s.getState().classrooms[0]!.occupant?.teacherState).toBe('active');
  });

  it('applies StudentEntered/Left', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'TeacherEntered', classroomId: id0, sessionId: asSessionId('s1'), cwd: '' });
    const studentId = asStudentId('stu_a');
    s.apply({ type: 'StudentEntered', classroomId: id0, studentId });
    expect(s.getState().classrooms[0]!.occupant?.students).toEqual([{ id: studentId, state: 'active' }]);
    s.apply({ type: 'StudentLeft', classroomId: id0, studentId });
    expect(s.getState().classrooms[0]!.occupant?.students).toEqual([]);
  });

  it('notifies subscribers', () => {
    const s = createStore();
    let count = 0;
    s.subscribe(() => count++);
    s.apply(list);
    expect(count).toBe(1);
  });

  it('keeps last toast message', () => {
    const s = createStore();
    s.apply(list);
    s.apply({ type: 'Toast', level: 'warn', message: 'full' });
    expect(s.getState().toasts.at(-1)?.message).toBe('full');
  });
});
```

- [ ] **Step 2: Implement store.ts**

```ts
// src/web/store.ts
import type { WSMessage, SchoolhouseSnapshot, ClassroomSnapshot } from '../shared/ws-messages.js';
import type { ClassroomId } from '../shared/ids.js';

export interface StoreState {
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomSnapshot[];
  layoutTemplates: { id: string }[];
  toasts: { level: 'info' | 'warn' | 'error'; message: string; at: number }[];
}

const EMPTY: StoreState = { gridShape: { cols: 0, rows: 0 }, classrooms: [], layoutTemplates: [], toasts: [] };

export interface Store {
  getState(): StoreState;
  apply(msg: WSMessage): void;
  subscribe(fn: () => void): () => void;
}

export function createStore(): Store {
  let state: StoreState = EMPTY;
  const subs = new Set<() => void>();

  const update = (next: StoreState) => { state = next; for (const fn of subs) fn(); };
  const patchClassroom = (id: ClassroomId, patch: (c: ClassroomSnapshot) => ClassroomSnapshot) =>
    update({ ...state, classrooms: state.classrooms.map((c) => (c.id === id ? patch(c) : c)) });

  const apply = (msg: WSMessage): void => {
    switch (msg.type) {
      case 'ClassroomList': {
        const s: SchoolhouseSnapshot = msg.snapshot;
        update({ gridShape: s.gridShape, classrooms: s.classrooms, layoutTemplates: s.layoutTemplates, toasts: state.toasts });
        break;
      }
      case 'ClassroomUpdate':
        patchClassroom(msg.classroomId, (c) => ({ ...c, ...msg.update }));
        break;
      case 'TeacherEntered':
        patchClassroom(msg.classroomId, (c) => ({
          ...c,
          occupant: { sessionId: msg.sessionId, teacherState: 'idle', students: [] },
        }));
        break;
      case 'TeacherLeft':
        patchClassroom(msg.classroomId, (c) => ({ ...c, occupant: null }));
        break;
      case 'StudentEntered':
        patchClassroom(msg.classroomId, (c) => {
          if (!c.occupant) return c;
          if (c.occupant.students.some((s) => s.id === msg.studentId)) return c;
          return { ...c, occupant: { ...c.occupant, students: [...c.occupant.students, { id: msg.studentId, state: 'active' }] } };
        });
        break;
      case 'StudentLeft':
        patchClassroom(msg.classroomId, (c) => {
          if (!c.occupant) return c;
          return { ...c, occupant: { ...c.occupant, students: c.occupant.students.filter((s) => s.id !== msg.studentId) } };
        });
        break;
      case 'StateChanged':
        patchClassroom(msg.classroomId, (c) => {
          if (!c.occupant) return c;
          if (msg.target === 'teacher') return { ...c, occupant: { ...c.occupant, teacherState: msg.state } };
          return {
            ...c,
            occupant: {
              ...c.occupant,
              students: c.occupant.students.map((s) => (s.id === msg.target ? { ...s, state: msg.state } : s)),
            },
          };
        });
        break;
      case 'Toast':
        update({ ...state, toasts: [...state.toasts, { level: msg.level, message: msg.message, at: Date.now() }].slice(-5) });
        break;
    }
  };

  return {
    getState: () => state,
    apply,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
```

- [ ] **Step 3: Implement ws-client.ts**

```ts
// src/web/ws-client.ts
import type { Store } from './store.js';
import type { WSMessage } from '../shared/ws-messages.js';

export function connect(store: Store, url: string = `ws://${location.host}/ws`): void {
  const attempt = () => {
    const ws = new WebSocket(url);
    ws.addEventListener('message', (ev) => {
      try { store.apply(JSON.parse(ev.data) as WSMessage); }
      catch (err) { console.warn('ws parse failed', err); }
    });
    ws.addEventListener('close', () => setTimeout(attempt, 2000));
    ws.addEventListener('error', () => ws.close());
  };
  attempt();
}
```

- [ ] **Step 4: Run test**

Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add src/web/store.ts src/web/ws-client.ts tests/web/store.test.ts
git commit -m "feat(web): state store + WS client with auto-reconnect"
```

---

## Task 14: Canvas Rendering — SpriteCache + TileMap

**Files:**
- Create: `src/web/canvas/sprite-cache.ts`
- Create: `src/web/canvas/tile-map.ts`
- Create: `src/web/canvas/renderer.ts`

描画は学習曲線を避けるため最小機能:
- タイル: 16×16 換算で描画 (48×48 原画を 1/3 縮小、`docs/assets-reference.md` §残る課題 解決策 A 採用)
- キャラ: 16×16 の静止画 (walk/idle アニメなし、spec §4.1 素材の方針どおり)
- 状態表示: teacher/student の state (active/idle/permission) に応じてキャラの上に small badge を描く (色のみ: 緑=active, グレー=idle, 赤=permission)

**設計方針**: キャンバス 1 枚 = 1 教室。大枠の grid 配置は React が CSS grid で担当。

- [ ] **Step 1: sprite-cache.ts**

```ts
// src/web/canvas/sprite-cache.ts
export class SpriteCache {
  private readonly cache = new Map<string, HTMLImageElement>();
  private readonly promises = new Map<string, Promise<HTMLImageElement>>();

  load(src: string): Promise<HTMLImageElement> {
    const hit = this.cache.get(src);
    if (hit) return Promise.resolve(hit);
    const pending = this.promises.get(src);
    if (pending) return pending;
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.cache.set(src, img); resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
    this.promises.set(src, p);
    return p;
  }

  get(src: string): HTMLImageElement | null { return this.cache.get(src) ?? null; }
}

export const sharedCache = new SpriteCache();
```

- [ ] **Step 2: tile-map.ts**

```ts
// src/web/canvas/tile-map.ts
import type { LayoutTemplate } from '../../shared/persistence.js';

export const TILE_PX = 16;  // 描画サイズ (48/3)
export const SOURCE_TILE_PX = 48;  // Cool School tileset の原サイズ

export interface TileRect { sx: number; sy: number; }

// Cool School tileset は 48px 単位。簡略のため Phase 1 は 3 種のみ:
// 0 = 床, 1 = 壁, 2 = 黒板
// 実装時に tileset PNG のどの col/row が何かを並べて決める。仮配置:
const TILE_ATLAS: Record<number, TileRect> = {
  0: { sx: 0, sy: 0 },        // 床
  1: { sx: 48, sy: 0 },       // 壁
  2: { sx: 96, sy: 0 },       // 黒板
};

export function atlasOf(tileId: number): TileRect | null {
  return TILE_ATLAS[tileId] ?? null;
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  tileId: number,
  dx: number,
  dy: number,
): void {
  const a = atlasOf(tileId);
  if (!a) return;
  ctx.drawImage(sheet, a.sx, a.sy, SOURCE_TILE_PX, SOURCE_TILE_PX, dx, dy, TILE_PX, TILE_PX);
}

export function buildLayoutPixels(template: LayoutTemplate) {
  return { widthPx: template.cols * TILE_PX, heightPx: template.rows * TILE_PX };
}
```

**注記**: `TILE_ATLAS` の座標は実装時に PNG を開いて確定。Phase 1 の DoD は「教室が grid 表示される」までなので、タイル種は 3 種で十分。

- [ ] **Step 3: renderer.ts**

```ts
// src/web/canvas/renderer.ts
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import type { AgentState } from '../../shared/events.js';
import { drawTile, TILE_PX } from './tile-map.js';
import { sharedCache } from './sprite-cache.js';

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

export async function preload(): Promise<void> {
  await Promise.all([
    sharedCache.load(TILESET_SRC),
    ...CHAR_SRCS.map((s) => sharedCache.load(s)),
  ]);
}

export function renderClassroom(
  ctx: CanvasRenderingContext2D,
  template: LayoutTemplate,
  snapshot: ClassroomSnapshot,
): void {
  const sheet = sharedCache.get(TILESET_SRC);
  if (!sheet) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let r = 0; r < template.rows; r++) {
    for (let c = 0; c < template.cols; c++) {
      const id = template.tiles[r * template.cols + c] ?? 0;
      drawTile(ctx, sheet, id, c * TILE_PX, r * TILE_PX);
    }
  }

  if (!snapshot.occupant) return;
  const occ = snapshot.occupant;

  const teacher = sharedCache.get(CHAR_SRCS[0]!);
  if (teacher) {
    const tx = template.teacherDesk.col * TILE_PX;
    const ty = template.teacherDesk.row * TILE_PX;
    ctx.drawImage(teacher, tx, ty);
    drawStateBadge(ctx, tx, ty, occ.teacherState);
  }

  occ.students.forEach((student, i) => {
    const seat = template.seats[i % template.seats.length];
    if (!seat) return;
    const charIdx = (hash(student.id) % (CHAR_SRCS.length - 1)) + 1;  // teacher と別の 1..6
    const img = sharedCache.get(CHAR_SRCS[charIdx]!);
    if (!img) return;
    const sx = seat.col * TILE_PX;
    const sy = seat.row * TILE_PX;
    ctx.drawImage(img, sx, sy);
    drawStateBadge(ctx, sx, sy, student.state);
  });
}

function drawStateBadge(ctx: CanvasRenderingContext2D, x: number, y: number, state: AgentState): void {
  ctx.fillStyle = STATE_COLOR[state];
  ctx.beginPath();
  ctx.arc(x + TILE_PX - 2, y + 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
```

- [ ] **Step 4: Commit (rendering は vitest で直接テストしにくいので後で手動確認する。Step 4 は commit のみ)**

```bash
git add src/web/canvas/
git commit -m "feat(web): canvas renderer (tile + teacher/student + state badge)"
```

---

## Task 15: React Components (Schoolhouse + Classroom + Toast)

**Files:**
- Create: `src/web/main.tsx`, `src/web/app.tsx`
- Create: `src/web/components/Schoolhouse.tsx`
- Create: `src/web/components/Classroom.tsx`
- Create: `src/web/components/Toast.tsx`
- Create: `src/web/components/styles.css`
- Create: `src/web/index.html`

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>agent-classroom</title>
    <link rel="stylesheet" href="/src/web/components/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: styles.css**

```css
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: #1a1a1a; color: #eee; }
.schoolhouse { padding: 16px; display: grid; gap: 12px; overflow: auto; height: 100vh; box-sizing: border-box; }
.classroom { background: #0e1117; border-radius: 6px; padding: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.5); }
.classroom header { font-size: 12px; color: #9ca3af; margin-bottom: 4px; display: flex; justify-content: space-between; }
.classroom canvas { display: block; image-rendering: pixelated; background: #202028; border-radius: 4px; }
.toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
.toast { background: #111; padding: 10px 14px; border-radius: 4px; border-left: 4px solid #4caf50; max-width: 320px; font-size: 13px; }
.toast.warn { border-left-color: #f59e0b; }
.toast.error { border-left-color: #ef4444; }
```

- [ ] **Step 3: main.tsx + app.tsx**

```tsx
// src/web/main.tsx
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
createRoot(document.getElementById('root')!).render(<App />);
```

```tsx
// src/web/app.tsx
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
```

- [ ] **Step 4: Schoolhouse.tsx**

```tsx
// src/web/components/Schoolhouse.tsx
import type { StoreState } from '../store.js';
import { Classroom } from './Classroom.js';

interface Props { state: StoreState; }
export function Schoolhouse({ state }: Props) {
  const { cols, rows } = state.gridShape;
  return (
    <div
      className="schoolhouse"
      style={{ gridTemplateColumns: `repeat(${cols}, max-content)`, gridTemplateRows: `repeat(${rows}, max-content)` }}
    >
      {state.classrooms.map((c) => (
        <Classroom
          key={c.id}
          classroom={c}
          templates={state.layoutTemplates}
          style={{ gridColumn: c.gridPos.col + 1, gridRow: c.gridPos.row + 1 }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Classroom.tsx**

```tsx
// src/web/components/Classroom.tsx
import { useEffect, useRef } from 'react';
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import { TILE_PX } from '../canvas/tile-map.js';
import { renderClassroom } from '../canvas/renderer.js';

interface Props {
  classroom: ClassroomSnapshot;
  templates: { id: string }[];
  style?: React.CSSProperties;
}

// Phase 1: 全教室共通テンプレ。本来は window 経由の props 等で渡すが、簡略化のため FALLBACK_TEMPLATE をモジュール static で持つ
const FALLBACK_TEMPLATE: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: Array(70).fill(0),  // 床のみ
  seats: [
    { row: 2, col: 2 }, { row: 2, col: 4 }, { row: 2, col: 6 },
    { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 3, col: 6 },
  ],
  teacherDesk: { row: 5, col: 4 },
};

export function Classroom({ classroom, style }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    renderClassroom(ctx, FALLBACK_TEMPLATE, classroom);
  }, [classroom]);

  return (
    <section className="classroom" style={style}>
      <header>
        <span>{classroom.id}</span>
        <span>{classroom.occupant?.sessionId ?? 'empty'}</span>
      </header>
      <canvas
        ref={ref}
        width={FALLBACK_TEMPLATE.cols * TILE_PX}
        height={FALLBACK_TEMPLATE.rows * TILE_PX}
        style={{ width: FALLBACK_TEMPLATE.cols * TILE_PX * 2, height: FALLBACK_TEMPLATE.rows * TILE_PX * 2 }}
      />
    </section>
  );
}
```

**注記 (後続の改善点)**: Phase 1 では `FALLBACK_TEMPLATE` をハードコード。observer から本物の `LayoutTemplate` (`tiles` 配列含む) を snapshot に載せる改善は Task 17 で。

- [ ] **Step 6: Toast.tsx**

```tsx
// src/web/components/Toast.tsx
interface Props { toasts: { level: 'info' | 'warn' | 'error'; message: string; at: number }[]; }
export function Toasts({ toasts }: Props) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.at} className={`toast ${t.level}`}>{t.message}</div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck + vite build**

```bash
pnpm run typecheck
pnpm run build:web
```

Expected: clean build, `dist/web/index.html` 生成

- [ ] **Step 8: Commit**

```bash
git add src/web/
git commit -m "feat(web): React components (Schoolhouse grid, Classroom canvas, Toasts)"
```

---

## Task 16: Layout Template を snapshot に載せる (Classroom の FALLBACK_TEMPLATE 撤去)

Task 15 までの `LayoutTemplate` payload は `{ id: string }` 止まりで `tiles`/`seats`/`teacherDesk` が web 側に渡っていない。Task 16 でこれを修正し、Classroom の FALLBACK_TEMPLATE を撤去する。

**Files:**
- Modify: `src/shared/ws-messages.ts` (SchoolhouseSnapshot.layoutTemplates を完全 LayoutTemplate 型に)
- Modify: `src/observer/cli.ts` (initialSnapshot 作成時に完全 template を渡す)
- Modify: `src/observer/ws-broadcaster.ts` (型変更追従)
- Modify: `src/web/components/Classroom.tsx` (props で template を受け取り)
- Modify: `src/web/components/Schoolhouse.tsx` (templates から参照)
- Modify: tests (型変更箇所)

- [ ] **Step 1: ws-messages.ts を更新**

```ts
// src/shared/ws-messages.ts
import type { LayoutTemplate } from './persistence.js';
// ...
export interface SchoolhouseSnapshot {
  gridShape: { cols: number; rows: number };
  classrooms: ClassroomSnapshot[];
  layoutTemplates: LayoutTemplate[];   // ← 差し替え
}
```

- [ ] **Step 2: 影響箇所をコンパイラに教えてもらう**

```bash
pnpm run typecheck
```

fail しているファイルを順次修正:

- `src/observer/cli.ts`: `initialSnapshot.layoutTemplates` を `persisted.layoutTemplates` にそのまま渡す
- `src/observer/ws-broadcaster.ts` の tests: `[{ id: 'default' }]` ではなく完全テンプレを渡すよう修正
- `src/web/store.ts` の test 内 `layoutTemplates` 指定も完全テンプレ化
- `src/web/components/Schoolhouse.tsx`: `templates={state.layoutTemplates}` を Classroom に渡す

- [ ] **Step 3: Classroom.tsx から FALLBACK_TEMPLATE を撤去**

```tsx
// src/web/components/Classroom.tsx
import { useEffect, useRef } from 'react';
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import { TILE_PX } from '../canvas/tile-map.js';
import { renderClassroom } from '../canvas/renderer.js';

interface Props {
  classroom: ClassroomSnapshot;
  templates: LayoutTemplate[];
  style?: React.CSSProperties;
}

export function Classroom({ classroom, templates, style }: Props) {
  const template = templates.find((t) => t.id === classroom.layoutTemplateId);
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!template) return;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    renderClassroom(ctx, template, classroom);
  }, [classroom, template]);

  if (!template) return <section className="classroom" style={style}>no template</section>;

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

- [ ] **Step 4: run tests + typecheck**

```bash
pnpm run typecheck
pnpm run test
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/ tests/
git commit -m "refactor: ship full LayoutTemplate in snapshot, drop Classroom fallback"
```

---

## Task 17: End-to-End 手動検証 (DoD 8 項目)

自動テストでカバーしきれない DoD 8 項目を手動で通す。観測対象として素の Claude Code セッションを使う (VibePod 不要)。

**Files:**
- Create: `docs/superpowers/plans/phase1-dod-checklist.md`

- [ ] **Step 1: build**

```bash
pnpm run build
```

Expected: `dist/observer/` と `dist/web/` が生成、CLI が動く

- [ ] **Step 2: DoD-1: 起動**

```bash
pnpm run start -- --classrooms 4 --port 6868
```

Expected: observer が port 6868 で起動、ブラウザで `http://localhost:6868/` 開ける

- [ ] **Step 3: DoD-2: 教室 grid 表示**

ブラウザで画面を見て、4 教室が 3×2 grid に並んでいることを確認 (最後の 2 スロットは空)。

- [ ] **Step 4: DoD-3 + DoD-4: Claude Code 起動 → 教師 → sub-agent**

別ターミナルで `claude` を起動、簡単なタスクを与える (例: `echo hello`)。ブラウザで 1 号教室 (`classroom-000`) に教師が現れることを確認。Task tool を使うタスク (例: "Task tool で 'hello' を echo してください") を与え、生徒が出現することを確認。

- [ ] **Step 5: DoD-5: session 終了**

Claude Code を exit。observer のログで `SessionEnded` が出て、ブラウザで教室が空に戻ることを確認。

- [ ] **Step 6: DoD-6: 永続化**

observer を停止 → `cat ~/.agent-classroom/layout.json` で schema v1 JSON があることを確認 → observer 再起動 → ブラウザで教室配置が同じであることを確認。

- [ ] **Step 7: DoD-7: 並行 2 セッション**

2 つのターミナルで並行して Claude Code を起動。ブラウザで 2 教室 (`classroom-000` と `classroom-001`) に教師が現れることを確認。

- [ ] **Step 8: DoD-8: 溢れ**

`--classrooms 1` で再起動。2 つの Claude Code を起動。1 つ目は教室に入り、2 つ目は Toast "教室が全て埋まっています..." が出る。observer log にも warn が出る。

- [ ] **Step 9: phase1-dod-checklist.md に結果を記録**

```md
# Phase 1 DoD 検証結果 (YYYY-MM-DD)

- [x] DoD-1: CLI 起動 & ブラウザアクセス
- [x] DoD-2: N=4 の grid 表示
- [x] DoD-3: CC 起動で教師入室演出
- [x] DoD-4: Task tool で sub-agent が生徒として出現
- [x] DoD-5: session 終了で教室が空
- [x] DoD-6: 再起動後に layout 復元
- [x] DoD-7: 並行 2 セッションで 2 教室表示
- [x] DoD-8: N=1 状態で 2 個目起動時に Toast 通知
```

失敗した項目があれば、該当 Task にバックフィードして修正 → 再検証。

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/plans/phase1-dod-checklist.md
git commit -m "docs: record Phase 1 DoD verification results"
```

---

## Summary / 完了条件

- Task 1–16 が完了し、17 で DoD 8 項目すべて通過すること
- `pnpm run test` が green
- `pnpm run typecheck` が clean
- 手動検証が phase1-dod-checklist.md で ✅ 揃い

完了後は `superpowers:finishing-a-development-branch` スキルで merge / PR / cleanup を選択する。
