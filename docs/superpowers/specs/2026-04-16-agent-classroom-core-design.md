# agent-classroom コア設計 (最終形態像 + Phase 1 スライス)

本ドキュメントは `docs/design.md` (プロジェクト全体方針) をさらに踏み込んで、
**最終形態の骨格** と **Phase 1 で守るべき不変契約** を固定するための設計スペック。

実装 Plan (どの順でどうコーディングするか) は本ドキュメントの対象外。
後段で `superpowers:writing-plans` により作成する。

---

## 1. 前提と差分

`docs/design.md` との差分は以下:

- メタファーを **3 層 → 4 層** に修正 (教師 = main / 生徒 = sub-agent を区別)
- 教室モデルを **スロット扱い (永続)** → **固定 N 教室 pool (永続的に N 個存在)** に明確化
- 保留事項のうち「退室後の扱い」を **教室は空に戻る (教室自体は消えない)** で決着
- アサイン UX を **silent auto + 軽微な可視化** で決着

`docs/design.md` §2.1 (3 層メタファー) および §6 (保留事項) の記述は、本ドキュメントの決定事項に準じて将来的に更新する (本コミットでは差分記述のみ)。

---

## 2. 最終形態

### 2.1 メタファー (4 層)

| 層 | 実体 | 粒度 | 永続性 |
|---|---|---|---|
| 校舎 (schoolhouse) | observer プロセス + ブラウザ | 1 | 永続 |
| 教室 (classroom) | 固定 N 個のスロット (config 指定、UI で追加可) | N | 永続 |
| 教師 (teacher) | Claude Code セッションの main agent | 教室ごとに 0 または 1 | session と同じ寿命 |
| 生徒 (student) | Task tool で起動された sub-agent | 教室ごとに 0..M | sub-agent と同じ寿命 |

**教師と生徒を区別する根拠**:

main と sub-agent は次の 3 点で性質が異なるため、メタファーと実装モデルの両方で区別を持ち込む:

- **カーディナリティ**: 教師 = 1 per 教室 / 生徒 = 0..M
- **ライフタイム**: 教師 = session と同寿命 / 生徒 = sub-agent ごとに一時的 (session より短い)
- **役割**: 教師 = 教室の anchor (session 存在の可視表現) / 生徒 = 出入りする存在

この区別を最初から持ち込むことで、永続化・描画・状態モデルで両者の混同を起こさないようにする。`docs/design.md` §2.1 時点ではどちらも「生徒」扱いだったのを本ドキュメントで修正。

**ポイント**:
- 教室は永続的に N 個存在する pool。session が来たら空き教室に "居候" する形で入る。

### 2.2 教室の性質

- **ID**: stable (再起動しても同じ ID)。教室を識別する primary key。
- **grid 位置**: 可変。ユーザーが D&D あるいは設定メニューで入れ替え可能。
- **layout template**: Phase 1 は全教室共通の 1 種。Phase 2 以降で教室ごとに異なる template を許すかを再検討 (将来改修候補)。
- **layout 永続化**: layout template・grid 位置・N の値を `~/.agent-classroom/` 配下に保存。再起動で復元。

### 2.3 セッションライフサイクル

- **起動検知**: observer が host `~/.claude/projects/` を watch、新しい `.jsonl` 出現で session start を認識。
- **アサイン**: 最小 ID の空き教室に自動アサイン (= α ルール)。silent auto。
- **入室演出**: ブラウザが開いていれば軽微な可視化 (キャラが歩いて着席、もしくは "N 号教室にアサイン" トースト)。ブラウザが開いていない場合は影響なし (observer は session 状態を常時保持しているため、次回ブラウザ接続時に現時点の snapshot を受け取れる。切断中の過去イベントは replay しない)。
- **アクティビティ**: session 内で Task tool が起動すれば sub-agent が「生徒」として該当教室に追加表示。
- **終了**: session end で教師・生徒が退場、教室は空に戻る (教室自体は消えない)。退場アニメは最小限。
- **溢れ時の挙動**: 全 N 教室が埋まっている状態で新規 session が来た場合、その session は教室にアサインされず、observer ログと `Toast` メッセージ (例: "教室が全て埋まっています。config で N を増やして再起動してください") で通知する。session 自体は JSONL が観測され続けるが画面には表示されない。config で N を増やして observer を再起動すれば、再起動後の該当 session (既存 or 新規) は通常通り空き教室に入る。

### 2.4 観測対象 (ソース)

- host Claude Code (`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`)
- VibePod container (Phase 2 で bind-mount 経由)
- 将来的な他ソースも同じ source adapter インターフェースで統合

### 2.5 ユーザー操作の範囲 (最終形態)

- config で N (教室数) を指定
- UI から空教室を追加
- 教室の grid 位置を入れ替え (D&D or 設定メニュー)
- 教室の layout 編集 は **最終形態には含めない** (将来改修候補)

---

## 3. 不変契約 (Phase 1 から守る)

以下 6 項目は **Phase 1 で間違えると Phase 2 以降が総書き直しになる** ため、Phase 1 の実装時点から最終形態を見据えた設計にする。

### 3.1 Source adapter interface

host / VibePod container / 将来の他ソースが、同じ形で次を提供できるインターフェース:
- session の start/end イベント
- session 識別子 (session-uuid)
- transcript 位置 (観測できる JSONL パスまたは同等)

Phase 1 で実装するのは host アダプタのみ。インターフェースだけは最終形態を想定して定義する。

### 3.2 Observation event protocol

parser + infer 層が出力するイベント種別の schema を固定:
- `SessionStarted` (教師の入室)
- `SessionEnded` (教師と生徒の退場)
- `StudentSpawned` (sub-agent の出現)
- `StudentDespawned` (sub-agent の完了)
- `StateChanged` (active / idle / permission / etc)

Phase 1 で発火させるイベント:
- `SessionStarted` / `SessionEnded`
- `StudentSpawned` / `StudentDespawned`
- `StateChanged` (state 値は pixel-agents heuristic mode 相当: **active / idle / permission** の 3 種)

Hooks mode 由来の definitive な state (e.g. definitive permission) は Phase 1 範囲外。heuristic のみで実装し、misfire を伴うことを許容する。schema 側では state 値を文字列 enum として拡張可能にしておき、最終形態 (hooks 併用) で値が増えても破壊的変更にならないようにする。

### 3.3 WebSocket message schema

observer ↔ browser の message type を固定:
- `ClassroomList` (起動時、全教室の layout + 配置)
- `ClassroomUpdate` (grid 位置や N の変更、layout 変更)
- `TeacherEntered` / `TeacherLeft`
- `StudentEntered` / `StudentLeft`
- `StateChanged`
- `Toast` (アサイン通知など)

source (host / VibePod / 他) が増えても message type は増やさない。

**同期モデル**: 新規 WS 接続時に observer が現時点の snapshot (全教室と在室中の教師・生徒) を 1 回送信。以降は delta イベント (TeacherEntered 等) を broadcast。切断中の event は replay せず、再接続時の snapshot で状態を合わせる。この方針により observer 側は過去 event history を保持する必要がない。

**多重接続**: observer は複数 WebSocket 接続を並行して受け付け、snapshot/delta を全接続に broadcast する。Phase 1 では browser → observer 方向の状態変更イベントは存在しない (教室 rearrange 等の書き込み系操作は Phase 2 以降) ため、read-only 多重接続として自然に成立する。複数タブ・複数デバイスからアクセスしても常に同じ見た目が同期される。書き込み系操作が追加された時点で衝突解決モデルを再設計する (§5 参照)。

### 3.4 識別子の分離

- **session identity** = session-uuid (Claude Code が生成)
- **classroom identity** = classroom ID (観測側が付与、stable)
- session と classroom の対応は「現在どの session がどの classroom に居るか」という一時的な関連。永続化するのは classroom 側のみ。

### 3.5 Classroom persistence schema

各教室は以下の stable な構造を持つ:
```
{
  id: string                // stable identity
  layoutTemplate: ref       // Phase 1 は共通 1 種
  gridPos: { row, col }     // mutable
}
```
全体として:
```
{
  version: number,
  classrooms: Classroom[],
  layoutTemplates: LayoutTemplate[],  // Phase 1 は 1 要素
  gridShape: { cols, rows },          // 溢れたらスクロール
}
```
`~/.agent-classroom/` 配下の JSON として保存。schema version を持って将来の migration に備える。

### 3.6 Classroom abstraction

observer / browser の双方で `classrooms[]` の配列として扱う。1 教室 hardcode は禁止。Phase 1 が N=1 で動くとしても、コード上は N 教室前提。

---

## 4. Phase 1 スライス

最終形態のうち、以下を Phase 1 で実現する:

### 4.1 含むもの

- observer プロセス (Node + TypeScript、UI host は Node HTTP + WebSocket。`docs/design.md` §4.1 の「UI 描画層の差し替え方針」を踏襲)
  - host 用 source adapter のみ実装 (`~/.claude/projects/` の polling 500ms)
  - JSONL parser (pixel-agents `transcriptParser.ts` の設計を参考、実装は独自)
  - 状態推論 (pixel-agents の heuristic mode 相当: active = tool_use 検出 / idle = turn_duration もしくは 5s タイマー / permission = 非 exempt tool 後 7s タイマー)
  - HTTP + WebSocket server
- 起動時に config N (default 4 など) で教室を生成、`~/.agent-classroom/` に layout 永続化・再起動で復元
- session start → α ルールで空き教室にアサイン、軽微な入室可視化
- session end → 教室を空に戻す
- main agent (教師) 1 + sub-agent (生徒) 0..M の表示
- 状態語彙は pixel-agents heuristic mode 相当 (active / idle / permission の 3 種)、hooks 由来 state の追加は Phase 2 以降
- ブラウザ UI (Canvas 2D + React) で N 教室を grid 配置、画面溢れたらスクロール
- 素材: Cool School tileset + Kenney Tiny Dungeon 7 体 (`docs/assets-reference.md` 採用確定プラン準拠)
- CLI コマンドで observer を起動 (コマンド名は実装時に確定、例: `agent-classroom start`)。config で port 指定可。2 回目起動は port-bind 失敗で exit + エラーメッセージ (既存 instance 検出や自動 takeover は実装しない、1 マシン = 1 校舎 前提)

### 4.2 含まないもの (Phase 2 以降)

- VibePod container 対応 (Phase 2)
- UI からの教室追加 (Phase 2 以降)
- 教室の grid 位置入れ替え UI (D&D or 設定メニュー) (Phase 2 以降)
- 事後ドラッグ移動で session と教室の紐付けを変える機能 (最終形態にも含めない)
- 履歴 / session log 画面 (未定)
- 教室ごとに異なる layout template (将来改修候補)
- 教室 layout の UI 編集 (最終形態にも含めない)
- Hooks mode (definitive permission 等) の実装 (pixel-agents `server/` 相当、Phase 2 以降)

### 4.3 Phase 1 Definition of Done

以下が満たされれば Phase 1 完了:

1. macOS/Linux で observer を CLI コマンドから手動起動でき、ブラウザからアクセス可能になる (常駐化 = launchd / systemd 対応は Phase 2 以降)
2. ブラウザでローカル URL を開くと config N 個の教室が grid 表示される
3. ターミナルで Claude Code を起動すると、`~/.claude/projects/` の JSONL 出現を検知し、最小 ID の空き教室に教師が入室する演出が出る
4. Task tool で sub-agent が発火すると、その教室に生徒が表示される
5. session 終了で教師と生徒が退場、教室は空に戻る
6. observer 再起動後、layout が復元される (教室数・grid 位置が同じ)
7. Claude Code を 2 つ以上並行で起動した際、2 つ以上の教室に並行表示される
8. N 教室が全て埋まっている状態で (N+1) 番目の Claude Code を起動した場合、画面表示は変わらず、observer log と Toast で「教室が埋まっている」旨が通知される

---

## 5. 派生論点 (Phase 2 以降で再検討)

以下は本ドキュメントで意図的に先送りした論点。実装を動かした経験を踏まえて判断する (`docs/design.md` §5 Phase 3 の方針を踏襲)。

- 教室の grid 位置入れ替え UX: D&D か設定メニューか
- observer 常駐プロセスの起動方法 (launchd / systemd / 手動 CLI)
- VibePod 側観測データ出力経路 (bind mount か Hooks 注入か)
- session 履歴の永続化範囲 (log をどこまで残すか、UI で見せるか)
- 教室ごとに異なる layout template を許すか (将来改修候補)
- Hooks mode による definitive な状態検出の導入 (permission, session lifecycle 等)。pixel-agents `hookEventHandler.ts` 相当の実装が必要
- 状態語彙の拡張 (pixel-agents heuristic 相当を超えて agent-classroom 独自の状態を追加するか)
- サイズ差問題 (タイル 48×48 vs キャラ 16×16) の最終解 (`docs/assets-reference.md` §残る課題 参照、Phase 1 実装時に並べて決める)
- 複数ブラウザ接続時の書き込み競合解決 (教室 rearrange 等の書き込み系操作が Phase 2 以降で入ったタイミングで再設計)
- 複数校舎 (意図的に別ポートで複数 observer を走らせる用途) の是非。現時点では 1 マシン = 1 校舎を前提とし、必要性が出た段階で再検討

---

## 6. 参考ドキュメント

- `docs/design.md` — プロジェクト全体方針 (命名、Phase 計画、pixel-agents との関係)
- `docs/pixel-agents-reference.md` — 技術的参照 (JSONL schema、状態推論、描画パイプライン)
- `docs/assets-reference.md` — 素材選定 (Cool School tileset、Kenney Tiny Dungeon)
