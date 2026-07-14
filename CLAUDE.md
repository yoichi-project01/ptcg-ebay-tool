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

## 現在の状態（2026-07-13時点）

### 出品作成機能（`src/App.jsx`）

- 印刷バリエーション: PMCG1〜6（拡張パック〜ジム拡張2）は 1st Edition マーク有無をタイトル/説明文に反映
- 鑑定品モード: PSA/BGS/CGC/SGC のグレード・鑑定書番号に応じてタイトル/説明文を切替
- 選択カードの eBay 相場（売却済み/現在の出品）へのリンク表示
- 仕入れ値・為替・eBay 手数料（定率＋固定額）から想定利益を計算
- 出品履歴: 出品内容を localStorage に保存し、一覧から再読み込み・削除可能

### 画像カバレッジ

日本語カード画像: **9331 / 9372 枚 (99.6%)**  
jpg=7150, png=2181, webp=0

| シリーズ | 状態 |
|----------|------|
| SV (スカーレット&バイオレット) | ほぼ完了（公式 jpg。SVB/SVD/SVF に計24枚の欠け、公式DBに存在しないエネルギー付属カード）|
| S (ソード&シールド) | ✓ ほぼ完了（公式 jpg。SI/S6/S11 に計11枚の欠け、同名カードの候補数不一致）|
| M (メガ) | ✓ 完了（公式 jpg）|
| PCG (EX era: PCG1-9) | ✓ 完了（pcg-search.com png）|
| neo (neo1-4) | ✓ 完了 |
| E (e series: E1-E5) | ✓ 完了（pcg-search.com png）|
| VS1 | ✓ 完了（特殊エネルギーは vs0en7-9.png）|
| web1 | ✓ 完了（pcg-search.com png）|
| PMCG1-4 | ✓ 完了 |
| PMCG5-6 | ほぼ完了（PMCG5に2枚、PMCG6に1枚の欠け）|
| S-P / SV-P（プロモ） | ✓ 完了（`scrape-promo-images.mjs`、公式キャッシュの位置マッチングで取得。**`npm run images` には未組み込み**、手動実行が必要）|

### 対応履歴（2026-07-13）

このワークツリーの `public/cards`（`.gitignore` 対象）は一時的に約900枚不足していた。以下の対応で 8466枚 → 9331枚まで回収：

1. `npm run images` + `scrape-promo-images.mjs`（未組み込みスクリプト）の再実行で475枚回収
2. `scrape-official-images.mjs` の同名カード判別ロジックを改善（296枚回収）。詳細ページでの番号照合が失敗するケース（同名カードが公式サイト上で同じ号数を共有しているなど）向けに、**候補数とcardData側のlocal数が一致する場合は号数照合をスキップし、番号順・掲載順で1:1に対応付けるフォールバック**を追加。さらに末尾の括弧注記（例:「博士の研究（ナナカマド博士）」）が公式DB側にない場合のフォールバックも追加
3. PMCG1-6でトレーナーカードの意訳・パラフレーズ名を pcg-search.com の実名に修正（計109件）。「わるい」プレフィックスの欠落（PMCG4）、ジムリーダー名の言い回し違い（PMCG5/6、例:「ミスティの決闘」→「カスミの勝負」）、全角/半角表記ゆれ（SV4M/SV10/SV4K）など
4. SV4M/SV10のポリゴン２/ポリゴンZの全角数字・全角アルファベット表記を半角に修正

**試したが不採用**: `scrape-old-images.mjs`（英語版TCGdex CDNから代替画像を取得）。日本語カードの出品に英語アートワークを使うのは実物と異なり不適切なため、ダウンロードした1446枚のwebpは削除済み。

### 未解決: 残り41枚

- **SVB/SVD/SVF/SLD/SLL/SN（24枚）**: 主にBOX付属の基本エネルギーカード。公式DBに個別カードとして掲載されていない（名前を直しても解決しない、画像ソースが存在しない）
- **SI/SV6/S11（11枚）**: 公式DB側の同名カード候補数と cardData 側の local 数が一致しないため、1:1フォールバックが使えないケース（例: 候補3件に対しlocalが2件）
- **PMCG5（2枚）/PMCG6（1枚）**: 「慈善」「レジスタンスジム」など、対応する公式サイト側のカードを特定できなかったトレーナーカード

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
  filename-utils.mjs             # ファイル名ビルド・解析ユーティリティ（共通）
  rename-images.mjs              # 既存画像を新ファイル名形式にリネーム（冪等）
  build-image-index.mjs          # imageIndex.json を再生成
  scrape-official-images.mjs     # 公式サイトから日本語JPGを取得（S/SV/M系）
  scrape-pcg-search.mjs          # pcg-search.com からpngを取得（旧シリーズ）
  scrape-pmcg-gym-supplement.mjs # PMCG5/6 トレーナーカード補完（手動マッピング）
  scrape-missing-sv.mjs          # S/SV系 括弧付き名前・重複名マッチング補完
  fix-card-names.mjs             # cardData.json の誤った日本語名を修正しファイルもリネーム
  official-card-cache.json       # pokemon-card.com APIキャッシュ（2026-07-04生成）
  card-list.json                 # 全カードフラットリスト [{serie, set, local, ja}]
  pcg-search-cache/              # PMCG5/6 用 name→siteNum キャッシュ

public/
  cards/               # ダウンロード済み画像（{sr}/{set}/{jaName}_{setCode}-{localId}／{total}_{rarity}.ext）
```

---

## 画像ファイル名形式

`{jaName}_{setCode}-{localId}／{total}_{rarity}.ext`

- `／` は全角スラッシュ (U+FF0F)。Windows ではファイル名に `/` が使えないため代替
- `total` は各セットの最大数値 localId（`computeSetTotal` 関数で計算）
- レアリティなしの場合は `_{rarity}` を省略

例:
```
フシギダネ_SV1S-001／198_C.jpg
サンドリュー_PMCG5-043／96_C.png
草のエネルギー_PMCG1-097／102.png
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
- キー形式: `"{setCode}/{localId}"` → 値: `"/cards/{sr}/{set}/{jaName}_{setCode}-{localId}／{total}_{rarity}.jpg"` など

---

## 画像を一から取得し直す場合

```bash
npm run images
```

`scripts/scrape-all.mjs` が以下を順番に実行します:
1. 既存ファイルを新ファイル名形式にリネーム（`rename-images.mjs`、冪等）
2. 公式サイト (S/SV/M 系 JPG)
3. pcg-search.com（旧シリーズ PNG）
4. PMCG5/6 トレーナーカード補完
5. S/SV 括弧付き名前・重複カード補完
6. 特殊 URL エネルギー9枚（PMCG1スターター + VS1特殊エネルギー）
7. imageIndex.json 再生成

`npm run images` に含まれないスクリプト（手動実行が必要）:
- `scrape-promo-images.mjs` — S-P / SV-P プロモの位置マッチング取得
- `scrape-old-images.mjs` — 英語版 TCGdex CDN からの代替取得。**日本語カードの出品に英語アートワークは不適切なため通常は使わないこと**

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
