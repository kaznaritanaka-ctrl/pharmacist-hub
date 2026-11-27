# pharmacist-hub

薬剤師の資産形成・起業・FIREを目指すための総合支援サイト「FIRE薬剤師ラボ」（pharma.ai-investment-research.net）のソースです。

## 5つのコンテンツ

- 資産寿命シミュレータ（simulator.html）— このサイトの指針となるコンテンツ。メイン画面に本体を埋め込んで操作できる
- 戦略記事（strategy.html）— 要約版を掲載し、全文は note で公開
- 転職情報（strategy.html 内「1. 薬剤師としての労働力を生かす」）
- 投資コンテンツ（note への導線）
- 土地の未来図（land.html、不動産投資の入口）

## 戦略上の4つの部品

「部品」という言葉は、戦略上の武器である4要素（仕事選び・自分の事業・不動産投資・株式投資）だけを指して使います（トップページの「組み立ての地図」参照）。シミュレータはコンテンツであり指針ですが、部品とは呼びません。

## 画面の構成（2026-11 リデザイン）

- PC（幅1024px以上）: 左に固定のサイドパネル（メニュー、シミュレータへのボタン、広告1枠）、右がメイン画面（コンテンツ・ツール）。
- スマホ: 上にメニュー切り替え（横スクロールのタブ）、中央にコンテンツ・ツール、画面の一番下に広告バー（閉じられる）。
- デザインの約束事は style.css 冒頭のコメントにまとめています。緑（--accent）は行動してほしい場所だけに使います。

## 広告枠（PR）

広告はすべて「PR」と表記します。ASP（アクセストレード）が発行したリンクコードは改変せずにそのまま貼ります（rel="nofollow" などもコードのまま）。提携先が決まっていない枠は `is-pending` クラスの付いた空き枠として表示されます。

| 枠（data-ad-slot） | 場所 | 今の中身 |
| --- | --- | --- |
| side | PC の左パネル下 | お仕事ラボ 320x50 |
| anchor | スマホの画面下部バー | お仕事ラボ 320x50 |
| top-career / strategy-career / future-career | 本文中の転職の話の直後 | お仕事ラボ 468x60 |
| top-bottom / strategy-end | トップ・戦略記事の本文中 | 空き枠（資産形成の道具） |

バナーのコードは生成スクリプトの共通部分（AD_SP / AD_PC）にまとめています。差し替えるときは、枠の中の `.ad-creative` に ASP のコードを貼り、`is-pending` を外します。
資産寿命シミュレータのページには広告を置きません（プライバシーポリシーの約束）。左パネルと下部バーの広告もこのページでは出しません。

## AIエージェント向けの読み取り口

- `/llms.txt` — サイトの索引（手書き）。
- 各ページの Markdown 版 — `/strategy.md` のように拡張子を `.md` に（トップは `/index.md`）、または `Accept: text/markdown` で同じ URL を取得。Worker が HTML の `<main>` から変換して返します（提携前の広告枠は省き、提携済みの広告は「PR（広告）」と明示）。
- `/llms-full.txt` — 全ページの Markdown をまとめたもの。
- 各ページに JSON-LD（WebSite・Person・WebPage・BreadcrumbList、記事は Article、ツールは WebApplication、FAQ は FAQPage）。
- 各ページ冒頭の「要点」ボックス（人にも AI にも、結論を先に）。

## 配信

素の HTML+CSS（演出用の小さな site.js 付き）の静的サイトです。Cloudflare の Worker「pharmacist-hub」で配信しています。

```
node tools/build.mjs   # dist/worker.js ができる（全ファイルを埋め込んだ1ファイル）
```

main に push すると、GitHub Actions（`.github/workflows/deploy.yml`）が dist/worker.js を作って Worker「pharmacist-hub」へアップロードします（1〜2分）。Worker のコードは worker/index.js と worker/admin.js です。

## 管理画面（/admin）

`https://pharma.ai-investment-research.net/admin` で、ページの文章をその場で直して保存できます。

- 文章をクリックして直し、「確認して保存」で変更点を確かめてから保存します。タイトルと説明文は右側の欄で直します。
- 保存は GitHub へのコミットとして記録され、上の自動反映で本番に出ます。履歴から元に戻せます。
- タグや広告コードは触らず、文章の部分だけを差し替えます。同じ文言の目次や構造化データ（FAQ など）も一緒に直ります。
- メニューとフッターは全ページ共通なので、管理画面では直せません。

入口は Cloudflare Access で守り、Worker 側でも Access のトークンを検証します。動かすには次の設定が要ります。

| 設定 | 場所 | 中身 |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | Worker の変数 | Access のチーム名ドメイン（例: `xxxx.cloudflareaccess.com`） |
| `ACCESS_AUD` | Worker の変数 | /admin 用 Access アプリの Application Audience (AUD) タグ |
| `GITHUB_TOKEN` | Worker のシークレット | このリポジトリの Contents に読み書きできる fine-grained トークン |
| `CLOUDFLARE_API_TOKEN` | GitHub の Secrets | Workers Scripts の編集権限だけを持つ Cloudflare の API トークン（自動反映用） |

3つの Worker 設定が揃うまで、本番の /admin は「準備中」を表示します。プレビュー（`SOURCE_BASE` あり）では、保存できない見本として開きます。
