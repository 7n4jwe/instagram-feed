# Instagram Feed — 引き継ぎメモ

Webサイト（Wix 等）に iframe で埋め込める Instagram 投稿の横スクロール表示と、表示する投稿を選ぶ管理UIを GitHub Pages だけで作るプロジェクト。
特定の団体・サイト向けではない汎用のもの（特定の組織名は入れない）。
回答・コメントは日本語で。

## 決定事項

- **Instagram API（Business Discovery 等）は使わない方針**：プロアカウント化・Facebookページ連携・Metaアプリ作成を他人に頼む場面が出るため避けたい（2026-11-12 ユーザー決定）。投稿の選択は Chrome 拡張（＋URL貼り付け）で行う。自動収集のコード（collect.mjs 等）は残っているが使わない前提
- **Wix 公式の Instagram フィードアプリは使わない**：あれは Wix が審査済みアプリを持ち、連携（ログイン）した自分のアカウントの投稿だけを出す仕組み。他人の投稿はリポストしないと出せない。他人の投稿をリポストせず選んで出すため、この仕組みを続ける（2026-11-12 ユーザー決定）
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
- **埋め込みは写真だけ**：`/p/{code}/embed/` を幅540pxで読み込み、transform で縮小・移動して写真の部分だけを高さ size に合わせて表示（幅は縦横比どおり）。埋め込みは「ヘッダー56px＋写真枠＋下部」でヘッダー＋下部＝208px が幅によらず一定なので、MEASURE の高さ−208＝写真枠の高さ（縦長は最大4:5、横長はそのまま）。リール（URLが /reel/）は4:5枠に9:16映像が黒帯つきで入るので中央の 9/16 幅だけ切り出す。拡張は動画を選んだとき postType=reel で保存。一覧の写真は既定で操作可能（iframe の pointer-events を有効化：動画の再生・複数枚の切替がその場ででき、写真部分のクリックは Instagram が新しいタブで開く）、詳細モーダル（`/embed/captioned/`）は右上の「詳細」ボタンから。`interact=0` で従来の全面クリック→詳細。2026-11-12 ユーザーの Chrome で再生・切替・詳細・ホイール横スクロールを確認。画像はコピーしない（権利面）。ヘッダーを隠すのは Meta 規約上グレーなので、写真の左下に @投稿者名 を出している（`who=0` で消せる）。`show_profiles` は既定オフ
- 拡張の一覧ボタンは、投稿へのリンクで大きさ100px以上のもの（動画タイルは img が無いことがあるので画像の有無では判断しない）＋フィードの200px以上の動画/画像（親をたどって投稿リンクが1つだけの範囲を投稿とみなす）に付ける。ただしホームのフィード（time を含む article）は、写真・動画の上だと動画の再生用画像に隠れ、右上は「フォローする」と重なるため、操作アイコン列（保存アイコンの svg[aria-label=保存する] を含む section）の right:36px に置く（2026-11-12 ログイン中の実画面で確認）。広告（time 無し・投稿リンク無し）には付かない
- 拡張の **アカウントバー**（1.2.0）：posts.json の `profiles` を画面上部に並べ、クリックで pickMode をオンにしてそのプロフィールへ移動。件数は approved の author 集計。プロフィール上で登録／解除（background の setProfile）。「Instagram のページを管理画面に取り込む」は不可（フレーム禁止・サーバー取得は規約違反の自動収集）なので、Instagram 上で選ぶ体験を拡張で整える方針
- 拡張の **選択モード**（1.1.0）：一覧ページで左下のスイッチ。オン中は window の捕捉段階で pointerdown/mousedown/mouseup/click を止め、一覧の写真（a.igf-host に .igf-tile があるもの）のクリックを選択／解除にする。状態は chrome.storage.local の pickMode。実 Instagram で実クリックが遷移しないことを確認済み
- **ブックマークレット「📌 選択ボタン」**（2026-11-12 試作、拡張を配らずに済ませる案）：管理画面が `extension/content.js`＋`content.css` を読み込み、`chrome` の代用（shim）で包んで javascript: URL にする（約38KB、拡張と常に同じコード）。Instagram の CSP（connect-src）で GitHub に直接保存できないため、`window.open` で `admin/bridge.html`（保存用の窓）を開き postMessage で依頼。bridge は origin が `https://www.instagram.com` のメッセージだけ受け付け、管理画面と同じ localStorage の接続設定で保存（処理は background.js と同じ）。pickMode/barOpen は Instagram 側の sessionStorage。ページを読み込み直すと消えるので押し直しが必要。Instagram の応答ヘッダーは COOP unsafe-none・style 'unsafe-inline' 可（未ログインで確認）。ローカルの模擬ページでは動作確認済み、実 Instagram では未確認

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
