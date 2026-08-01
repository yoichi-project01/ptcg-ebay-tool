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

## 現在の状態（2026-08-01時点）

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

### 対応履歴（2026-08-01）: 外部レビュー指摘への対応

出品事故につながりうる不具合を中心に、外部コードレビューの指摘に対応した。

- **英語名の引き継ぎバグ（最重要）**: `applyCandidate`（`src/App.jsx`）が英語名未登録カードを選んだ際、
  前に選んだカードの英語名を引き継いでいた（`en || p.pokemonEn`）。空のまま入力するよう修正し、
  候補タイルへの「英語名なし」バッジ表示、生成欄への警告表示を追加。データ上、画像ありカードの
  45.1%・Sシリーズの92%で英語名が欠損しているため頻発しうる不具合だった。
- **履歴読み込みのクラッシュ対策**: `DEFAULT_FORM` を定数化し、`loadFromHistory` で
  `{ ...DEFAULT_FORM, ...entry.f }` にマージすることで、フィールド追加前の古い履歴を読んでも
  未定義プロパティで落ちないように修正。壊れた履歴エントリは `loadHistory` でフィルタ。
  `ErrorBoundary` も追加し、想定外のエラーで画面全体が白くならないようにした。
- **英語版アートワーク混入経路の遮断**: `build-image-index.mjs` の `.webp` 収集を削除、
  `package.json` から `scrape`（`scrape-images.mjs`）を削除、`scrape-images.mjs` /
  `scrape-old-images.mjs` は `scripts/deprecated/` に移動。
- **スクレイパ堅牢性**: `scrape-official-images.mjs` の詳細キャッシュがnullを永久保存する不具合を修正、
  画像書き込みをtemp+renameでアトミック化（`scrape-pcg-search.mjs` も同様）、
  ページ取得失敗の記録と一定数超過時の中断、同時実行数/待機時間を `scrape-pcg-search.mjs` と同じ
  `CONCURRENCY=3, DELAY_MS=400` に統一、全fetchに `AbortSignal.timeout` を付与、
  HTMLエンティティのデコード処理を追加（S-Pの4件のTAG TEAMカード名混入を修正）。
- **旧裏（オールドバック）対象の拡大**: `PMCG1-6` のみだった判定を `neo1-4` / `VS1` / `web1` にも拡大
  （`OLD_BACK_SET_RE`）。1st Editionの判定は従来通り `PMCG1-6` のまま。
- **検索の改善**: `normalize` にNFKC正規化（全角英数吸収）・中黒/空白の吸収を追加、
  日本語名・英語名がどちらも無いカード（1,739件）を検索候補から除外。
- **利益計算**: `eBay手数料率` のヒントに国際手数料・為替スプレッド込みの実効レート目安
  （17〜19%）を追記。
- **DP/DPt/BW/ADV/LEGEND/XY/SM世代のデータ補完は見送り**（詳細は下記セクション参照）。

### 未解決: 残り41枚

- **SVB/SVD/SVF/SLD/SLL/SN（24枚）**: 主にBOX付属の基本エネルギーカード。公式DBに個別カードとして掲載されていない（名前を直しても解決しない、画像ソースが存在しない）
- **SI/SV6/S11（11枚）**: 公式DB側の同名カード候補数と cardData 側の local 数が一致しないため、1:1フォールバックが使えないケース（例: 候補3件に対しlocalが2件）
- **PMCG5（2枚）/PMCG6（1枚）**: 「慈善」「レジスタンスジム」など、対応する公式サイト側のカードを特定できなかったトレーナーカード

### スキップセット（英語版 / 対象外）

SC*, SV*s, SVDs, SDL, SDM, SDP, CSMPiC

### 収録範囲の限界: DP・DPt・BW・ADV・LEGEND・XY・SM世代は非対応（2026-08-01調査）

`SERIE_ORDER`（`src/App.jsx`）には `XY, BW, DP, DPt, L, ADV, XYb` のキーが定義されているが、
実データ（`cardData.json`）には一切収録されていない。調査の結果、以下の理由で意図的に見送りとした:

- **TCGdex側**: JPシリーズ一覧は `PMCG/neo/VS/web/e/ADV/PCG/L/XY/XYb/SM/S/SV/M` の14種のみ存在するが、
  実際にカード個票データ（`/v2/ja/sets/{id}` の `cards` 配列）が入っているのは PMCG/neo/e/PCG/VS/web/M
  （旧世代）と S/SV（現行）のみ。ADV/L/XY/XYb/SM/DP/DPt/BW は**セットの入れ物だけあってカード個票が
  ほぼ空**（例外: CP1のみ34枚）。DP/DPt/BWはシリーズ自体がTCGdexに存在しない。
- **公式サイト側**: `pokemon-card.com` の `resultAPI.php` は `cardID/cardThumbFile/cardNameViewText` の
  4項目のみでカード番号を含まない。詳細ページ（`details.php`）も、この世代（例: DP1）は
  カード番号を表示するUI要素自体が存在しない（新しいテンプレートにのみある機能）。
  つまり**カード番号を検証する手段がどこにもない**。

このため、この世代のカードは「日本語名は取れるが、カード番号・レアリティ・英語名は検証不能」という
状態になり、出品事故防止の観点から追加を見送った。対応する場合は、掲載順を擬似カード番号として
使わざるを得ないことを理解した上で作業すること。

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
