# agent-classroom 設計ドキュメント

このドキュメントは agent-classroom の発案から初期方針決定までの議論を集約したもの。以降の実装はこの設計を起点に進める。

> **命名の経緯**: `vibepod-observer` → `claude-classroom` → `agent-classroom` と変遷。最終的な判断軸: (1) OSS として広く使われるためにスコープを狭めない、(2) Claude の商標リスクを避ける、(3) 将来の agent-agnostic 展開と整合。vibepod 連携は重要な統合対象だが、命名で縛らず機能として実装する。vibepod 固有機能のアイデアは feature delta が薄く、独立プロダクトとして分けるより統合プラグインとして取り込む方針。

---

## 1. 背景と動機

### 1.1 観測できない問題

VibePod で `vibepod run --prompt` を実行すると、コンテナ内で Claude Code が動き始めるものの、中の様子が外から見えにくい。「教師が自習を言い渡して教室を出た」状態で、進捗・状態・完了の判断が難しい。

tmux + Claude Code の直接運用でも同じ。複数セッションを並走させると、どれが動いていてどれが終わっているのか一目では分からない。

### 1.2 既存解決策の限界

Pixel Agents (`pablodelucca/pixel-agents`) は VS Code 拡張として、Claude Code の JSONL トランスクリプトを監視し、エージェントの状態をピクセルアートのキャラクターで可視化する。

ただし **VS Code 依存** のため、tmux + Claude Code ワークフローや VibePod と組み合わせられない。VS Code を起動しない運用で恩恵を受けられない。

---

## 2. コンセプト

### 2.1 3 層メタファー

| 層 | 実体 | 粒度 | 永続性 |
|---|---|---|---|
| 校舎 (schoolhouse) | observer 常駐プロセス + ブラウザ | 1 | 永続 |
| 教室 (classroom) | Claude Code 1 セッション (tmux pane / VibePod container) | N | スロット扱い (永続) |
| 生徒 (student) | そのセッション内で動いているエージェント (main + Task tool で発火した sub-agent) | 教室ごとに 1..M | 一時的 |

### 2.2 核となる非対称性

- **observer と教室は永続** — 建物と部屋はずっとそこにある
- **チーム (コンテナ / セッション) は一時的** — 結成され、空いている教室に入り、作業し、去る

この非対称性が設計の核。観測基盤は常に立ち上がっていて、観測対象だけが出入りする。

### 2.3 典型シナリオ

ブラウザで校舎を見ている状態で、手元で Claude Code を 4 つ並走させると、校舎内に 4 教室が見える。各教室の中には、そのセッションの main agent と Task tool で起動された sub-agent たちが「生徒」として存在する。

---

## 3. 戦略決定事項

### 3.1 Pixel Agents に対する位置付け

**独立実装 (Inspired by) とする。** Fork でもコピーでもない。

#### 根拠

1. VS Code 依存を剥がす作業で実質大半を書き直すことになる → 派生タグだけ残すのは中途半端
2. 「Pixel Agents 拡張版」というポジションは親の影が消えない。本家の活動量に認知が引きずられる
3. 本家は heuristic 主体、agent-classroom は hooks + JSONL を厳密に組み合わせる方向 (misfire 削減)。設計哲学が違うなら兄弟プロダクトとして並ぶ方が自然
4. 校舎/教室/生徒の 3 層メタファーは独自抽象 (本家は 2 層)
5. 複数 session 同時観測も本家未対応。独立性を主張できる機能差が存在する

#### 敬意表明

README の "Acknowledgements" セクションに以下を記載する:

> Inspired by [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT). The JSONL-transcript-watching approach to Claude Code agent observation originates from that project. `agent-classroom` is an independent reimplementation with a different scope (standalone browser, multi-session, school/classroom metaphor) and does not reuse any of its source code or art assets.

#### 実務フロー

- `pablodelucca/pixel-agents` を GitHub 上で fork (`ryugou/pixel-agents`) → **読解用ブックマーク**
- 手元で fork を clone して設計を読む
- コードは一切コピーしない (本当に `cp` しない)
- ソース素材 (PNG, キャラクター, マップ) も本家のものは使わず独自に用意する

### 3.2 VibePod との関係

**依存しない独立プロダクト。** VibePod 連携は adapter として後付けする。

- Phase 1 は素の Claude Code (host の `~/.claude/projects/`) のみ対象
- Phase 2 で VibePod container 対応を追加
- 名前も `vibepod-observer` ではなく `agent-classroom` とし、Claude Code 全般に使える広いポジションを取る

### 3.3 素材

視覚アイデンティティを確立するため、キャラクター・マップ・机・黒板などのドット素材は独自調達する (新規発注 or OSS ピクセルアート素材サイト経由)。学校モチーフとメタファーの一致を優先する。

---

## 4. Pixel Agents 技術調査まとめ

フォーク判断のため Marketplace ページから抽出した情報。

| 項目 | 内容 |
|---|---|
| 対象エージェント | 現時点では Claude Code のみ。agent-agnostic を志向 |
| 観測方法 | **Claude Code の JSONL トランスクリプトファイルを watch**。hooks や IPC ではない純 observational アプローチ |
| UI | VS Code Webview 上で React 19 + Canvas 2D |
| 配置 | ボトムパネル (ターミナルと並列) |
| 描画 | Canvas 2D、BFS pathfinding、キャラクター state machine |
| 状態推論 | heuristic (idle タイマー、turn-duration イベント) — 精度は完全ではなく misfire あり |
| 要件 | VS Code 1.105.0+、Claude Code CLI |
| スタック | TypeScript、esbuild、Vite、React 19 |
| 資産 | オープンソース (PNG + manifest.json)、外部ディレクトリからカスタム読み込み可 |
| ライセンス | MIT |

### 4.1 層別の VS Code 依存度

| 層 | 実装 | VS Code 依存 | agent-classroom での扱い |
|---|---|---|---|
| 観測 | JSONL transcript watching | なし | 考え方は流用、実装は独自 |
| 状態判定 | heuristic (idle + turn-duration) | なし | 考え方は流用、hooks と組み合わせて misfire 削減 |
| UI 描画 | React + Canvas 2D | **あり (webview host)** | 考え方は流用、host を Node HTTP server + WebSocket に差し替え |
| pathfinding / 資産 | BFS + PNG manifest | なし | 独自素材で独自実装 |

つまり **VS Code 依存があるのは webview host だけ**。そこを差し替えれば残りは独立して成立する — という構造が、独立実装の実現可能性を裏付ける。

---

## 5. Phase 計画

### Phase 1 — 素の Claude Code をブラウザで観測

目標: VS Code なしで、tmux や素のターミナルで動いている Claude Code 1 セッションをブラウザから観測できる。

- JSONL watcher 実装 (`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` を tail)
- 状態推論ロジック (idle / running / task-invoking など)
- observer core を HTTP server + WebSocket で起動
- ブラウザ UI (Canvas ベースの教室 1 室、中に生徒キャラクター)
- 観測データの契約 (JSONL schema 解釈、event protocol) を固定

この Phase で「Claude Code を素でブラウザから見られる」ところまで完成させ、契約を固める。

### Phase 2 — VibePod 連携

目標: VibePod container 内で動く Claude Code を同じ observer から観測する。

- VibePod コンテナの `/home/vibepod/.claude/projects/` をホスト側 `~/.config/vibepod/runtime/<container>/transcripts/` に bind-mount
- observer は host 側のこのパスも watch 対象に加える
- 教室単位で host session と container session が並立表示される

### Phase 3 — 教室パターンの設計

目標: Phase 1/2 の実装と運用経験を踏まえて、校舎・教室・チームの抽象を本当に入れるべきか、入れるならどう入れるかを設計する。

**机上設計は禁止。** 実装を動かした経験を踏まえて判断する。

### Phase 4 — 本格実装

目標: Phase 3 で固めた設計に基づき、複数コンテナの動的割り当て、教室の可視化、チームの入退室といった本格的な機能を実装する。

---

## 6. 保留事項

以降のフェーズで順次判断する。

- observer 常駐プロセスの起動方法 (手動 / launchd / VibePod からの自動起動)
- 終了したコンテナ (退室したチーム) の扱い (即削除 / 一定時間残す / 履歴として永続化)
- Phase 2 で VibePod 側に必要な観測データ出力経路 (bind mount か Hooks 注入か) の最終決定

---

## 7. 関連リポジトリ

- 本体: https://github.com/ryugou/agent-classroom
- 読解用 fork: https://github.com/ryugou/pixel-agents (コードコピーは禁止、参照専用)
- 本家: https://github.com/pablodelucca/pixel-agents
- Phase 2 連携先: https://github.com/ryugou/vibepod
