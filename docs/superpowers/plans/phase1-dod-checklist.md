# Phase 1 DoD 検証結果 (2026-04-16)

## サマリー

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| 1 | CLI 起動 & ブラウザアクセス (`/healthz`) | automated ✓ | smoke test で実証済み |
| 2 | N=4 教室 grid 表示 (ClassroomList WS) | automated ✓ | smoke test で実証済み |
| 3 | CC 起動で教師入室演出 (TeacherEntered) | automated ✓ | fake JSONL で smoke test 実証済み |
| 4 | Task tool で sub-agent が生徒として出現 | automated ✓ | smoke test: progress/agent_progress 追記 → StateInferrer.handleProgress → StudentEntered WS 受信確認 |
| 5 | session 終了で教室が空 (TeacherLeft) | automated ✓ | smoke test: AGENT_CLASSROOM_STALE_MS=3000ms で起動し stale 待機 → TeacherLeft WS 受信確認 |
| 6 | 再起動後に layout 復元 (layout.json 書き込み) | automated ✓ | smoke test で layout.json 存在確認済み |
| 7 | 並行 2 セッションで 2 教室表示 | automated ✓ | smoke test で 2 × TeacherEntered 確認済み |
| 8 | N=1 で 2 個目起動時 Toast 通知 | automated ✓ | smoke test で Toast warn 受信確認済み |

## Automated verification

次のコマンドで automated 項目を一括検証:

```bash
pnpm tsx scripts/dod-smoke.ts
```

### 実行結果 (2026-04-16)

```
═══════════════════════════════════════════════════
 agent-classroom Phase 1 DoD Automated Smoke Tests
═══════════════════════════════════════════════════

[DoD-1] CLI 起動 & /healthz エンドポイント応答確認...
[DoD-1] ✓ PASS  CLI 起動 & /healthz → {ok:true}
[DoD-2] WS 接続 → ClassroomList (N=4 教室) 確認...
[DoD-2] ✓ PASS  ClassroomList 受信 (4 教室)
[DoD-3] 偽 JSONL 出現 → TeacherEntered 検知...
[DoD-3] ✓ PASS  TeacherEntered 受信 (sessionId=session-abc-001)
[DoD-4] progress/agent_progress 行追記 → StudentEntered WS 受信...
[DoD-4] ✓ PASS  agent_progress 追記で StudentEntered を WebSocket 受信
[DoD-5] JSONL stale → TeacherLeft (AGENT_CLASSROOM_STALE_MS=3000ms)...
[DoD-5] ✓ PASS  TeacherLeft broadcast を AGENT_CLASSROOM_STALE_MS=3000ms 後に WS 受信
[DoD-6] layout.json 書き込み確認 (再起動後の状態復元)...
[DoD-6] ✓ PASS  永続化ファイル存在: /tmp/ac-dod-xxx/state/layout.json
[DoD-7] 並行 2 JSONL → 2 教室への TeacherEntered 確認...
[DoD-7] ✓ PASS  並行 2 セッション → TeacherEntered × 2
[DoD-8] N=1 設定で 2 個目セッション → Toast warn 確認...
[DoD-8] ✓ PASS  N=1 overflow → Toast warn 受信

═══════════════════════════════════════════════════
 Result: 8 passed, 0 failed
═══════════════════════════════════════════════════
```

### ユニットテスト (67 tests)

```bash
pnpm test
```

```
 ✓ tests/shared/types.test.ts (4 tests)
 ✓ tests/observer/ws-broadcaster.test.ts (7 tests)
 ✓ tests/observer/classroom-manager.test.ts (10 tests)
 ✓ tests/observer/transcript-parser.test.ts (8 tests)
 ✓ tests/observer/config.test.ts (7 tests)
 ✓ tests/web/store.test.ts (8 tests)
 ✓ tests/observer/persistence.test.ts (7 tests)
 ✓ tests/observer/state-inferrer.test.ts (9 tests)
 ✓ tests/observer/host-source.test.ts (1 test)
 ✓ tests/observer/file-watcher.test.ts (5 tests)
 ✓ tests/observer/server.test.ts (1 test)

 Test Files  11 passed (11)
      Tests  67 passed (67)
```

## 自動化の範囲と根拠

### DoD-5 (JSONL stale → TeacherLeft) について

`staleThresholdMs` は `--stale-ms` CLI フラグまたは `AGENT_CLASSROOM_STALE_MS` 環境変数で設定可能。デフォルト値は `DEFAULT_STALE_THRESHOLD_MS`（30分 = 1,800,000ms）。

smoke test では `AGENT_CLASSROOM_STALE_MS=3000` でオブザーバーを起動し、ファイル最終書き込みから 3000ms+ 経過後に `TeacherLeft` WS メッセージを受信することを統合テストとして確認している。

ユニットテストでも引き続き補完：

- `tests/observer/file-watcher.test.ts` — `vi.useFakeTimers()` で時間を進め、stale 検出ロジックを直接検証
- `tests/observer/host-source.test.ts` — `staleThresholdMs: 500` を指定した HostSource で SessionEnded 発火を確認
- `tests/observer/ws-broadcaster.test.ts` — `TeacherLeft` WS メッセージへの変換を確認

**注意 (cold-start 挙動):** observer 起動時に既存の `.jsonl` ファイルが存在しても、それらは「過去のセッション」として扱われ再生されない。`onFileAdded` はファイルが実際に成長した時点で初めて発火する。これにより、boot 時に大量の ghost セッションが UI に表示される問題 (Critical 1) と、アクティブなアイドルセッションが誤って stale 判定される問題 (Critical 2) を解消している。

### DoD-4 (StudentEntered) について

`StudentEntered` は `transcript-parser.ts` が `{type: 'progress', subtype: 'agent_progress', parentToolUseID, agentId, event}` レコードを `ProgressDetected` としてパースし、`StateInferrer.handleProgress` が `StudentSpawned` イベントを emit、`WsBroadcaster` が `StudentEntered` WS メッセージに変換することで発火する。

smoke test では `progress/agent_progress` レコードをファイルに追記し、WS クライアントで `StudentEntered` メッセージを受信することを統合テストとして確認している。`tests/observer/state-inferrer.test.ts` でも発火ロジックをユニットテストで網羅。

## Manual verification (手動確認が必要な項目)

### 対象: DoD-3 UI + DoD-4 実 Claude Code + DoD-5 UI

これら 3 項目はブラウザの描画演出と実 Claude Code セッションを必要とするため、自動化では代替できない。

#### 手順

```bash
# 1. ビルド (dist/ を最新化)
pnpm run build

# 2. observer を起動
node bin/agent-classroom.js start --port 6868

# 3. ブラウザで開く
open http://localhost:6868/
```

別ターミナルで:

```bash
# 4. Claude Code を任意のプロジェクトで起動
cd ~/your-project
claude
```

#### 目視確認チェックリスト

- [ ] **(DoD-3)** Claude Code 起動直後、ブラウザの 1 号教室に教師入室アニメーションが表示される
- [ ] **(DoD-3)** 教師のアバターが教師デスクに配置される
- [ ] **(DoD-4)** Task tool を使うプロンプトを入力する（例: `Use the Task tool to count files in /tmp`）
- [ ] **(DoD-4)** sub-agent が起動され、ブラウザで生徒として教室内の席に表示される
- [ ] **(DoD-5)** Claude Code を `exit` で終了する
- [ ] **(DoD-5)** ブラウザで教師と生徒が退場し、教室が空状態に戻る
- [ ] **(DoD-5)** 一定時間後（2分以内）に教室の占有状態がクリアされる

#### レイアウト復元確認 (DoD-6 手動補足)

```bash
# observer を Ctrl+C で停止し、再起動
node bin/agent-classroom.js start --port 6868
```

- [ ] ブラウザリロード後、教室の配置 (gridPos) が維持されている
- [ ] `~/.agent-classroom/layout.json` が存在し、教室情報が記録されている
