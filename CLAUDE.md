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

### 対応履歴（2026-08-02）: 発売年データ追加・英語名の言語混入バグ修正

- **セット発売年（`y`フィールド）を追加**: TCGdex API（`/v2/ja/sets/{id}` の `releaseDate`）から
  128セット中81セットの発売年を取得（`scripts/fetch-set-years.mjs`）。残り47セット
  （プロモ・構築済みデッキ等の細分化コード、例: `S-P`/`SV-P`/`SI`/`SDL`/`SVB`等）は
  TCGdexに該当セットが存在せず404のため `y` なし。Item Specifics の
  Year Manufactured / Vintage判定はこの `y` の有無に依存する。**未取得47セット**（プロモ・
  構築済みデッキ・スターターセット等の細分化コード）: `S-P, SC1D, SC1a, SC1b, SC2D, SC2a,
  SC2b, SCA, SCB, SCC, SCD, SDL, SDM, SDP, SH, SI, SJ, SK, SLD, SLL, SN, SP5, SP6, SPD, SPZ,
  CSMPiC, SV-P, SV3s, SV4s, SV5s, SV6s, SV7s, SV8s, SV9s, SVAL, SVAM, SVAW, SVB, SVC, SVD,
  SVDs, SVEL, SVEM, SVF, SVHK, SVHM, SVP1`。TCGdexにセット情報自体が無いため手で埋めるしか
  なく、対応する場合は公式サイト等で発売年を個別に確認して `cardData.json` の該当セットに
  `y` フィールドを追記すること。
- **英語名フィールドへのインドネシア語混入を発見・修正（重要）**: 主にSVシリーズの
  トレーナー/エネルギーカード151件（86種類のユニーク値、`SV1S/SV1V/SV1a/SV2D/SV2P/SV2a/
  SV3s/SV4a/SV4s/SV5s/SV6s/SV7s/SV8a/SV8s/SV9s/SVAL/SVAM/SVAW/SVDs/SVHK/SVHM` 等）で、
  英語名フィールドに英語ではなくインドネシア語の翻訳文が入っていた（例:
  「博士の研究（オーリム博士）」の英語名が `Penelitian Profesor (Profesor Olim)`）。
  一部の構築済みデッキ系セット（SVAL/SVAM/SVAW等）では日本語名と英語名が別カードの
  データになっている（位置ズレ）ケースもあった（例: `SVAL/011` の日本語名は「ロトム」だが
  英語名は無関係なエネルギーカードの訳文）。原因未特定（TCGdex側かこのリポジトリの生成
  過程かは未調査）。**汚染された英語名は空文字列にリセット**（`scripts/
  blank-contaminated-en-names.mjs`）。誤った情報を出品に使うより、A-1で追加した
  「英語名なし」警告で安全に運用する方針。**正しい英語名への復元は別タスクとして未着手**。

### 対応履歴（2026-08-03）: 英語名混入の再調査（単語リスト方式の限界と復元の断念）

外部レビューで「除外リスト方式は原理的にこの問題を解決できない（部分混入・固有名詞は検出不可）」
との指摘を受け、再調査した。結果、指摘は正しく、以下の追加対応を行った。

- **単語リストを大幅拡張し検出漏れを追加で74件発見・空欄化**: 色・数字・日用品・感情表現などの
  一般語彙を追加（"Ursaluna Bulan Merah ex"＝正しい英語のポケモン名＋インドネシア語の混成、
  "Pelajar Paldea"＝固有名詞以外が全てインドネシア語、等）。ランダムサンプリングで検証するたびに
  新たな検出漏れが見つかったため、**単語リスト方式では100%の検出は原理的に不可能**と判断し、
  現実的な工数で追加検証を打ち切った。
- **構造的に行ズレしている5セットを発見・全体空欄化**: `SVAL`/`SVAM`/`SVAW`/`SVHK`/`SVHM`
  （いずれも構築済み半デッキ系の型番のみのセットコード）は、日本語名の列に対して英語名の列全体が
  数行分ズレて入っていた（例: `SVHK`は+2行、`SVAM`/`SVAW`は+3行ズレ）。ズレた結果として
  **文法的に正しい英語のカード名が「別のカードの名前として」入ってしまう**ため、言語判定
  （インドネシア語検出）では原理的に発見できない。実例: `SVAM/017`の日本語名「きずぐすり」
  （Potion）に対し英語名は無関係な `Pokégear 3.0` になっていた。該当5セットの英語名列は
  全件空文字列にリセットした。同様の行ズレがSV4a内の一部区間（Trainerカード172-175番、
  クラベル/サカキのカリスマ/ナンジャモ/ネルケ周辺）にも局所的に見つかり、個別に空欄化した。
- **「クリーンなデータから対応表を作り空欄を埋める」復元方針は不採用（重要）**: 上記の行ズレ
  発見の過程で、**一見正しく見える cardData.json 内の(日本語名, 英語名)ペア自体に、既に
  誤ったペアが混在している**ことが判明した（`SVAM/017`の`きずぐすり→Pokégear 3.0`が好例。
  両方とも正規の英語カード名であるため、汚染検出をすり抜けて「クリーンなデータ」として
  対応表に採用されてしまう）。実際に対応表方式を試したところ2,018件を自動補完できたが、
  この誤ペアが伝播し、無関係なカードに別カードの正しい英語名が付与される事故を引き起こした
  ため、**適用前に発覚し全件revertした**。試作スクリプトは
  `scripts/deprecated/fill-blank-en-from-ja-map.mjs` に不採用の理由コメント付きで保存。
  **正しい英語名の復元には外部の権威あるソース（公式カードリスト等）との突き合わせが必須**で、
  cardData.json内のデータだけを信頼した復元は危険。
- **残存リスクについて**: 単語リスト＋構造的行ズレセットの全体空欄化により大部分の既知の
  汚染は除去したが、単語リスト方式の性質上、**検出漏れが皆無であるとは保証できない**。
  高額カードを出品する際は、生成された英語名が実際のカード名と一致しているか目視確認することを
  推奨する。

### 対応履歴（2026-08-03）: eBay出品効率化機能を追加

- **アイテムスペシフィック生成**（`buildItemSpecifics`）: フォーム入力から Card Name / Set /
  Card Number / Rarity（英語表記変換）/ Language / Manufacturer / Character（ex/V/VMAX等の
  接尾辞を除去） / Graded / Card Condition / Features（Old Back・1st Edition） /
  Year Manufactured（セットの`y`フィールド依存）を生成しコピーできるUIを追加。
  レアリティ英語表記（`RARITY_EN_LABELS`）はSV世代（Art Rare/Double Rare等）は公式表記と一致、
  それ以外は日本語圏コミュニティのベストエフォート訳である点に注意。
- **コンディション記述子ガイド**（`buildConditionGuide`）: 現在の状態設定がeBayの
  Ungraded/Gradedどちらに対応し、どのCard Condition/Grade等を選ぶべきかを案内する文言を表示。
- **SKU自動生成**（`buildSku`）: `{setCode}-{cardNo先頭}-{状態or鑑定}-{1ST}` 形式。
- **価格決定支援**: `computeRecommendedPrice`で目標利益率から売値を逆算し
  `roundUpToPsychologicalPrice`で$X.99に切り上げ（必ず入力値以上になる方向に丸める）。
  出品履歴から同一セット・レアリティの前回売値もヒント表示。
- **出品キュー + CSV一括アップロード（試験的機能）**: 出品キューをlocalStorage
  （`ptcg-ebay-tool:queue`）に保持し、`buildListingCsv`でFile Exchange相当の列構成のCSVを
  生成しダウンロード可能に。**`CSV_CONDITION_ID`（2750=Graded/4000=Ungraded）とカテゴリID
  （183454=CCG Individual Cards）はユーザー確認ベースの値であり、本番アップロード前に
  eBay側の最新テンプレートで要検証**。`PicURL`列は画像ホスティング環境が無いため空欄出力
  （手動で埋める前提）。ロット仕入れ値（1BOX÷枚数等）をキュー全件に一括適用する機能も追加。

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

### 対応履歴（2026-08-03）: インドネシア語混入の検出方式を単語リストから言語頻度方式に変更

外部レビューで、既存の `scripts/blank-contaminated-en-names.mjs`（単語リスト方式）では
78件の混入未検出が発見された。原因は方式そのものの限界: 単語リスト方式は「英語には現れない
インドネシア語」を列挙するため、`"Ursaluna Bulan Merah ex"`（正しい英語のポケモン名＋
インドネシア語の混成）のような**部分混入**は、混入した単語をリストに追加するまで検出できない
（列挙が原理的に終わらない）。

- **`scripts/detect-contaminated-en-names.py` を新規作成**: 各単語について
  `wordfreq` ライブラリで英語/インドネシア語それぞれの出現頻度（Zipf frequency）を計算し、
  「インドネシア語での頻度が高く、かつ英語との差が大きい」単語を機械的に混入とみなす方式に
  変更。単語を列挙する必要がないため、未知の混入語にも対応できる。
  `EXEMPT` セット（`lele`/`tapu`/`rotom`/`mega` 等、インドネシア語の一般語と衝突する
  英語ポケモン名由来のトークン）のみ手動管理。
- **dry-runで78件検出、`--apply`後は0件**: 検出0件になることを確認済み。
  セット別内訳（SV5s=11, SV8s=11, SV8a=10, SVDs=9, SV6s=6, SV9s=6, SV1V=4, SV3s=4,
  SV7s=4, SV1a=3, SV2a=3, SV4a=3, SV4s=2, SV1S=1, SV2D=1）は外部レビュー時の想定と完全一致。
- **旧スクリプトは `scripts/deprecated/` へ移動**し、非推奨の理由をコメントで明記。
- 復元は行っていない（`k[2]` を空文字列にリセットするのみ）。「絶対にやってはいけないこと」
  （対応表による補完）は今回も踏んでいない。

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
