# Instagram Feed — 引き継ぎメモ

Webサイト（Wix 等）に iframe で埋め込める Instagram 投稿の横スクロール表示と、表示する投稿を選ぶ管理UIを GitHub Pages だけで作るプロジェクト。
特定の団体・サイト向けではない汎用のもの（特定の組織名は入れない）。
回答・コメントは日本語で。

## 決定事項

- **リポスト前提ではない**。他人のアカウントの投稿をそのまま表示する。
- 表示は **Instagram 公式埋め込み**（`https://www.instagram.com/p/{code}/embed/`）。他人の画像をリポジトリに保存・再配信しない（権利面のため）。
- **アカウント表示（API不要）**：公式プロフィール埋め込み `https://www.instagram.com/{username}/embed/`（最新6件・自動更新）。posts.json の `profiles` に保存。管理画面「投稿を選ぶ」に各アカウントの埋め込みを並べる。埋め込み内の投稿コードはクロスオリジンで読めないため、選択は **ブックマークレット「📌 投稿を選ぶ」**（Instagram の投稿ページで押す → `admin/pick.html#<URL>` を小窓で開き、localStorage の接続設定で posts.json を読み→approved:true→保存。409/422 は1回だけ読み直して再試行。BroadcastChannel `igfeed` で管理画面に通知し、未保存変更がなければ再読み込み）。ユーザーの選択でこの方式に決定（2026-11-11）。`show_profiles: false` で embed.html の先頭にアカウント枠を出さない（未設定=表示）。高さ通知（MEASURE）は0で来るので `w*2/3+152` で固定。localhost からの iframe では描画されない（GitHub Pages 上では表示を確認済み 2026-11-11）
- ハッシュタグの API 不要な公式埋め込みは無い（`/explore/tags/{tag}/embed/` は404）。審査なしなら手動URL追加
- 候補の集め方は2系統：
  1. **URL貼り付けで手動追加**（フェーズ1。どのアカウントの公開投稿でも可、API不要）
  2. **API自動収集**（フェーズ2。GitHub Actions で毎日）
     - ユーザー指定 = Business Discovery。ビジネス/クリエイターアカウントのみ。個人アカウントは手動追加で補う
     - ハッシュタグ指定 = Hashtag Search。Meta の App Review（Instagram Public Content Access）が必要、7日間で30種類まで
     - 収集対象（アカウント・ハッシュタグ・ハッシュタグ有効化・取得件数）は管理画面で編集し `data/sources.json` に保存
- 管理UIの保存は GitHub Contents API（Fine-grained PAT、Contents: Read and write）。トークンはブラウザの localStorage のみ。
- サーバーなし。GitHub Pages（main / root）。無料プランなので公開リポジトリ前提。

- **選ぶ手段は Chrome 拡張（`extension/`、MV3、未公開・デベロッパーモードで読み込み）が主**（2026-11-11 決定）。content.js が Instagram の一覧の写真（`a[href*=/p/|/reel/]` かつ img を含む）に＋/✓ボタン、投稿表示中は右下 FAB、フィードは article 右上。background.js が GitHub Contents API で posts.json を read-modify-write（409/422 は3回まで再試行）。トークンは chrome.storage.local。ブックマークレット＋admin/pick.html は予備
- **埋め込みは写真だけ**：`/p/{code}/embed/` を正方形の枠で top:-(56px+size×0.125) に置いてヘッダーを隠し写真の中央を切り出す（埋め込みの写真枠は常に 4:5、MEASURE は投稿によらず同じ高さで来る）、透明ボタンでクリックを受けて詳細モーダル（`/embed/captioned/`、MEASURE で高さ）。画像はコピーしない（権利面）。ヘッダーを隠すのは Meta 規約上グレーなので、写真の左下に @投稿者名 を出している（`who=0` で消せる）。`show_profiles` は既定オフ

## 構成

- `embed.html` — `data/posts.json` の `approved: true` を配列順に表示。IntersectionObserver で遅延読み込み、矢印/スワイプ/`?auto=秒`。公式埋め込みの `MEASURE` postMessage で iframe 高さを調整。パラメータ: `w`, `caption`, `auto`, `max`, `bg`, `data`, `user`（カンマ区切りでアカウント指定）, `posts=0`
- `admin/pick.html` — ブックマークレットの受け口（上記）
- `admin/index.html` — 接続設定、URL追加、タブ（選択中/未確認の候補/すべて）、本文付き（/embed/captioned/、MEASURE で高さ合わせ）の大きなカード、「＋ 選ぶ／✓ 選択中」切替（該当カードだけ更新して iframe を再読込しない）、「大きく見る」モーダル（←→/Esc）、←→並べ替え（表示中同士）、見送り（`reviewed: true`）、除外（`dismissed` に入れて自動収集でも再追加しない）、自動収集の対象（アカウント/ハッシュタグを追加・削除、URLからユーザー名・タグを抽出、ハッシュタグ有効化、取得件数、前回の収集結果の表示、「今すぐ収集を実行」= workflow_dispatch。トークンに Actions: Read and write が必要）。sha 競合（409/422）時は再読み込みを促す
- `data/posts.json` — `{ updated_at, profiles: [username], show_profiles?, posts: [{code,url,author,source,added_at,posted_at?,caption?,approved,reviewed?,note}], dismissed: [code] }`。`source` は `manual` / `user:名前` / `tag:名前`
- `data/sources.json` — `{ users: [], hashtags: [], hashtag_enabled: false, max_per_source: 12 }`
- `data/collect_status.json` — collect.mjs が書く前回結果 `{ ran_at, added, results: [{kind,name,ok,fetched?,added?,error?,skipped?}] }`
- `scripts/collect.mjs` + `.github/workflows/collect.yml` — Secrets `IG_USER_ID` / `IG_ACCESS_TOKEN` が無ければスキップ。Variables: `GRAPH_VERSION`（既定 v23.0）。`ENABLE_HASHTAG`/`MAX_PER_SOURCE` は sources.json の値が無いときの後方互換。Secrets 設定後は collect_status.json の更新で毎日コミットが入る

## 状態

- ローカルで、Instagram と GitHub API をモックにした Playwright テストで確認済み：表示、矢印、URL解析（/p/・/reel/・/ユーザー名/p/・クエリ付き）、重複/不正URL、並べ替え、見送り、除外、保存（両ファイルPUT）
- **未確認**：
  - ~~MEASURE 形式~~ 投稿埋め込みは `{type:"MEASURE",details:{height}}` を送ることを実ブラウザで確認済み（2026-11-11）。カード幅での見た目は未確認
  - collect.mjs の実API呼び出し（Graph API のフィールド・バージョン）

- 管理画面の収集対象UI・「今すぐ収集を実行」・collect.mjs の結果書き出しは、GitHub/Graph API をモックにして確認済み（2026-11-11）

## 次にやること

1. ~~公開リポジトリを作ってプッシュ → Pages 有効化~~（済：GitHub 7n4jwe、Pages main / root）
2. 実際の投稿URLを数件入れて embed.html の見た目・高さを確認。合わなければ高さ固定のフォールバックやカード幅を調整
3. 埋め込み先サイトに iframe で配置し、高さを決める
4. フェーズ2：Meta アプリ作成 → トークン取得 → Secrets 設定 → 管理画面の「今すぐ収集を実行」で確認
