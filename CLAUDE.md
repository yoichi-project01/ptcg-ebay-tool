# CLAUDE.md — ptcg-ebay-tool プロジェクト概要

このファイルは Claude Code が作業を始める際の参照ドキュメントです。

---

## プロジェクト概要

日本語版ポケモンカードの情報から **eBay 出品用の英語タイトルと説明文を自動生成する** ローカル Web アプリ。

- フロント: Vite + React (`src/App.jsx`)
- カードデータ: `src/cardData.json`（128 セット、TCGdex のオープンデータから生成）
- カード画像: **ローカルにダウンロードして同梱** (`public/cards/` 配下、`src/imageIndex.json` で参照）

---

## 重要ルール

- **`public/cards/` 配下の画像ファイル（.webp/.png/.jpg）を Read ツールで読み込まないこと**

---

## 現在の状態（2026-07-06時点）

### 画像カバレッジ

日本語カード画像: **9371 / 9372 枚 (99.99%)**  
`src/imageIndex.json` にインデックス済み。jpg=7188, png=2183, webp=0

| シリーズ | 状態 |
|----------|------|
| SV (スカーレット&バイオレット) | ✓ 完了（公式 jpg）|
| S (ソード&シールド) | ✓ 完了（公式 jpg）|
| M (メガ) | ✓ 完了（公式 jpg）|
| PCG (EX era: PCG1-9) | ✓ 完了（pcg-search.com png）|
| neo (neo1-4) | ✓ 完了（neo4/229 ヘルガーのみ未取得）|
| E (e series: E1-E5) | ✓ 完了（pcg-search.com png）|
| VS1 | ✓ 完了（特殊エネルギーは vs0en7-9.png）|
| web1 | ✓ 完了（pcg-search.com png）|
| PMCG1-6 | ✓ 完了（PMCG1エネルギーは 1st1s001-006.png）|

### 未解決: neo4/229 ヘルガー (Houndoom) — 1枚

- neo4 の通常カード番号(1-113)を大きく超えた 229 番で、データベースの誤りである可能性が高い
- pcg-search.com のいかなるセクション（プロモ・プレミアムファイル・GB専用・ナンバー外）にも存在しない
- 公式 pokemon-card.com API にもない
- 「わるいヘルガー」は neo4/024 として正常に存在する

### スキップセット（英語版 / 対象外）

SC*, SV*s, SVDs, SDL, SDM, SDP, CSMPiC

---

## ファイル構成

```
src/
  App.jsx              # メインUIコンポーネント
  cardData.json        # 全セット・全カードのマスターデータ
  imageIndex.json      # セット/localId → 画像パスのマップ（自動生成）

scripts/
  build-image-index.mjs          # imageIndex.json を再生成
  scrape-official-images.mjs     # 公式サイトから日本語JPGを取得（S/SV/M系）
  scrape-pcg-search.mjs          # pcg-search.com からpngを取得（旧シリーズ）
  scrape-pmcg-gym-supplement.mjs # PMCG5/6 トレーナーカード補完（手動マッピング）
  scrape-missing-sv.mjs          # S/SV系 括弧付き名前・重複名マッチング補完
  official-card-cache.json       # pokemon-card.com APIキャッシュ（2026-07-04生成）
  card-list.json                 # 全カードフラットリスト [{serie, set, local, ja}]
  pcg-search-cache/              # PMCG5/6 用 name→siteNum キャッシュ

public/
  cards/               # ダウンロード済み画像（{sr}/{set}/{localId}.jpg or .png）
```

---

## 画像ソースと URL パターン

### 公式サイト（S/SV/M系）
`https://www.pokemon-card.com/assets/images/card_images/large/{set}/{filename}.jpg`

### pcg-search.com（旧シリーズ）

| セット | URL パターン |
|--------|-------------|
| PMCG1 通常 | `/img/1st/1st1{NNN}.png` |
| PMCG1 エネルギー(097-102) | `/img/1st/1st1s001.png` 〜 `1st1s006.png` |
| PMCG2-4 | `/img/1st/1st{2-4}{NNN}.png` |
| PMCG5 | `/img/1st/1stgym1{NNN}.png` |
| PMCG6 | `/img/1st/1stgym2{NNN}.png` |
| neo1-4 | `/img/neo/neo{1-4}{NNN}.png` |
| E1-E5 | `/img/e/e{1-5}{NNN}.png` |
| PCG1-9 | `/img/pcg/pcg{1-9}{NNN}.png` |
| VS1 通常 | `/img/vs/vs0{NNNN}.png`（4桁、142まで）|
| VS1 基本エネルギー | `/img/vs/vs0en1.png` 〜 `vs0en6.png` |
| VS1 特殊エネルギー | `/img/vs/vs0en7.png`(悪) `vs0en8.png`(鋼) `vs0en9.png`(レインボー) |
| web1 | `/img/web/web{NNNN}.png`（4桁）|

---

## imageIndex.json について

- `node scripts/build-image-index.mjs` で再生成
- 優先度: `.jpg` > `.png`（webp は完全除外）
- キー形式: `"{setCode}/{localId}"` → 値: `"/{sr}/{set}/{localId}.jpg"` など

---

## PMCG5/6 の名前不一致について

cardData.json のトレーナーカード名が英語化・意訳されており、pcg-search.com の本来の日本語名と異なる。
手動マッピング（`scrape-pmcg-gym-supplement.mjs` の MAP 定数）で解決済み。

例: cardData「ミスティの決闘」→ サイト「カスミの勝負」

---

## eBay 出品文ノウハウ（`src/App.jsx` の `buildSingleDesc` / `buildPackDesc` に反映済み）

- シングル: 状態表記（NM/LP/MP/HP）、sleeve + toploader 梱包を記載
- パック/BOX: 「Factory Sealed」「Never weighed」、「開封結果は運＝返品不可」の自衛文
- 共通: 日本からの発送日数・追跡付き、タイトルは 80 文字以内

---

## ユーザー情報

- 名前: よういち
- 販売: eBay で日本語版ポケカを海外向けに販売（仕入れ: メルカリ / ヤフオク / 駿河屋）
- 日本語でやり取りしている。回答は簡潔さを好む
