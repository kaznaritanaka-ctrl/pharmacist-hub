# pharmacist-hub

薬剤師の資産形成・起業・FIREを目指すための総合支援サイト「薬剤師ハブ」（pharma.ai-investment-research.net）のソースです。

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

広告はすべて「PR」と表記し、リンクには `rel="sponsored noopener"` を付けます。提携が決まるまでは `is-pending` クラスの付いた空き枠として表示されます。

| 枠（data-ad-slot） | 場所 |
| --- | --- |
| side | PC の左パネル下（シミュレータのページ以外の全ページ） |
| anchor | スマホの画面下部バー（シミュレータのページ以外の全ページ） |
| top-career / top-bottom | トップページ本文（組み立ての地図の直後 / 方針の直後） |
| strategy-career / strategy-end | 戦略記事（「1. 労働力」の直後 / 締めの直後） |
| future-career | 薬剤師の将来とAI（手札の章の直後） |

差し替え方: 枠の中身（タイトル・説明・ボタンの href）を ASP の広告リンクに置き換え、`is-pending` を外し、`tabindex="-1" aria-disabled="true"` を消して `rel="sponsored noopener"` を付けます。ASP の計測用画像（1px）はボタンの直後に置きます。
資産寿命シミュレータのページには広告を置きません（プライバシーポリシーの約束）。

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

dist/worker.js を Worker「pharmacist-hub」にアップロードすると本番に反映されます。Worker のコードは worker/index.js です。
