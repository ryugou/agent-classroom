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

**ポイント**:
- 教室は永続的に N 個存在する pool。session が来たら空き教室に "居候" する形で入る。
- 教師と生徒の違いは明示的 (design.md 時点ではどちらも「生徒」扱いだったのを修正)。

### 2.2 教室の性質

- **ID**: stable (再起動しても同じ ID)。教室を識別する primary key。
- **grid 位置**: 可変。ユーザーが D&D あるいは設定メニューで入れ替え可能。
- **layout template**: Phase 1 は全教室共通の 1 種。Phase 2 以降で教室ごとに異なる template を許すかを再検討 (将来改修候補)。
- **layout 永続化**: layout template・grid 位置・N の値を `~/.agent-classroom/` 配下に保存。再起動で復元。

### 2.3 セッションライフサイクル

- **起動検知**: observer が host `~/.claude/projects/` を watch、新しい `.jsonl` 出現で session start を認識。
- **アサイン**: 最小 ID の空き教室に自動アサイン (= α ルール)。silent auto。
- **入室演出**: ブラウザが開いていれば軽微な可視化 (キャラが歩いて着席、もしくは "N 号教室にアサイン" トースト)。ブラウザが開いていない場合は影響なし (次回閲覧時にはすでに入室済み)。
- **アクティビティ**: session 内で Task tool が起動すれば sub-agent が「生徒」として該当教室に追加表示。
- **終了**: session end で教師・生徒が退場、教室は空に戻る (教室自体は消えない)。退場アニメは最小限。

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

Phase 1 で実際に発火させるイベントは最小限 (SessionStarted/Ended + active/idle の StateChanged) だが、schema は最終形態前提で定義。

### 3.3 WebSocket message schema

observer ↔ browser の message type を固定:
- `ClassroomList` (起動時、全教室の layout + 配置)
- `ClassroomUpdate` (grid 位置や N の変更、layout 変更)
- `TeacherEntered` / `TeacherLeft`
- `StudentEntered` / `StudentLeft`
- `StateChanged`
- `Toast` (アサイン通知など)

source (host / VibePod / 他) が増えても message type は増やさない。

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
  - 状態推論 (pixel-agents の heuristic 相当: tool_use で active / turn_duration or idle タイマーで idle)
  - HTTP + WebSocket server
- 起動時に config N (default 4 など) で教室を生成、`~/.agent-classroom/` に layout 永続化・再起動で復元
- session start → α ルールで空き教室にアサイン、軽微な入室可視化
- session end → 教室を空に戻す
- main agent (教師) 1 + sub-agent (生徒) 0..M の表示
- 状態語彙は pixel-agents 相当 (active / idle / permission 等)
- ブラウザ UI (Canvas 2D + React) で N 教室を grid 配置、画面溢れたらスクロール
- 素材: Cool School tileset + Kenney Tiny Dungeon 7 体 (`docs/assets-reference.md` 採用確定プラン準拠)

### 4.2 含まないもの (Phase 2 以降)

- VibePod container 対応 (Phase 2)
- UI からの教室追加 (Phase 2 以降)
- 教室の grid 位置入れ替え UI (D&D or 設定メニュー) (Phase 2 以降)
- 事後ドラッグ移動で session と教室の紐付けを変える機能 (最終形態にも含めない)
- 履歴 / session log 画面 (未定)
- 教室ごとに異なる layout template (将来改修候補)
- 教室 layout の UI 編集 (最終形態にも含めない)

### 4.3 Phase 1 Definition of Done

以下が満たされれば Phase 1 完了:

1. macOS/Linux で observer を CLI から手動起動できる (常駐化 = launchd / systemd 対応は Phase 2 以降の論点)
2. ブラウザでローカル URL を開くと config N 個の教室が grid 表示される
3. ターミナルで Claude Code を起動すると、`~/.claude/projects/` の JSONL 出現を検知し、最小 ID の空き教室に教師が入室する演出が出る
4. Task tool で sub-agent が発火すると、その教室に生徒が表示される
5. session 終了で教師と生徒が退場、教室は空に戻る
6. observer 再起動後、layout が復元される (教室数・grid 位置が同じ)
7. Claude Code を 2 つ以上並行で起動した際、2 つ以上の教室に並行表示される

---

## 5. 派生論点 (Phase 2 以降で再検討)

以下は本ドキュメントで意図的に先送りした論点。実装を動かした経験を踏まえて判断する (`docs/design.md` §5 Phase 3 の方針を踏襲)。

- 教室の grid 位置入れ替え UX: D&D か設定メニューか
- observer 常駐プロセスの起動方法 (launchd / systemd / 手動 CLI)
- VibePod 側観測データ出力経路 (bind mount か Hooks 注入か)
- session 履歴の永続化範囲 (log をどこまで残すか、UI で見せるか)
- 教室ごとに異なる layout template を許すか (将来改修候補)
- 状態語彙の拡張 (pixel-agents 相当を超えて agent-classroom 独自の状態を追加するか)
- サイズ差問題 (タイル 48×48 vs キャラ 16×16) の最終解 (`docs/assets-reference.md` §残る課題 参照、Phase 1 実装時に並べて決める)

---

## 6. 参考ドキュメント

- `docs/design.md` — プロジェクト全体方針 (命名、Phase 計画、pixel-agents との関係)
- `docs/pixel-agents-reference.md` — 技術的参照 (JSONL schema、状態推論、描画パイプライン)
- `docs/assets-reference.md` — 素材選定 (Cool School tileset、Kenney Tiny Dungeon)
