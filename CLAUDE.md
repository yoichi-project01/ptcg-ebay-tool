# CLAUDE.md — ptcg-ebay-tool プロジェクト概要

このファイルは Claude Code が作業を始める際の参照ドキュメントです。今の決まり・手順・注意点だけを書く。
**作業の記録（いつ・何を・なぜ直したか、件数、出典）は `docs/history.md`**（2026-10-14 にこのファイルから移した）。
経緯や「なぜこうなっているか」を知りたいときは `docs/history.md` を日付・弾コードで検索すること。

---

## プロジェクト概要

日本語版ポケモンカードの情報から **eBay 出品用の英語タイトルと説明文を自動生成する** ローカル Web アプリ。

- フロント: Vite + React (`src/App.jsx`)
- カードデータ: `src/cardData.json`（2026-10-14 時点で 292弾・24,642行。最初は TCGdex のオープンデータから作り、その後は公式 details.php などで確かめて足し・直した）
- カードの種類: `src/cardKinds.json`（Item Specifics の Character 用。`scripts/card-kinds/build-card-kinds.mjs` で作る）
- カード画像: **ローカルにダウンロードして同梱** (`public/cards/` 配下、`.gitignore` 対象。`src/imageIndex.json` で参照、23,646件)
- 全体の点検と改善の一覧: `docs/review-2026-10-14.md`

---

## 重要ルール

- **`public/cards/` 配下の画像ファイル（.webp/.png/.jpg/.gif）を Read ツールで読み込まないこと**
- **外部のサイトに個人の情報を送らないこと**（メールアドレス・名前・住所・アカウント名など。User-Agent などの HTTP ヘッダ、URL、検索語、
  フォームへの入力を含む）。スクリプトやコマンドで外部にアクセスするときは、個人を特定できない User-Agent（例 `Mozilla/5.0`）だけを使う。
  外部サイトへのログインもしない。経緯: 2026-10-07 に、Bulbapedia にスクリプトから届くかのテストで、User-Agent にユーザーのメールアドレスを
  入れたリクエストを1回送ってしまった（応答は 403）。
- **推測でデータを埋めない**。確かめられないもの（英語名・レアリティ・発売年・PSA の表記など）は空欄のままにする。
  公式で確かめられないものは、**公式以外の情報源の2つ以上が一致したものだけ**入れる（下の「データの決まり」）。
- **コミット前に画像の照合**（`node scripts/image-hashes.mjs --verify`）。pre-commit フックが自動で行う（下の「コミット前の確認」）。

---

## 作業環境

- 作業はこの PC（1台）だけで行う。場所: ptcg-ebay-tool `C:\Users\setoy\Documents\ptcg-ebay-tool`、カイトリレーダー `C:\Users\setoy\Documents\psa-kaitori`。
- **D: のフォルダ（`D:\product\ptcg-ebay-tool`）では作業しないこと**（2026-10-07 に C: へ移した。D: は SATA の CRC エラーで画像が化けた）。
  退避した画像（`D:\product\ptcg-ebay-tool-stray-images`）は D: に残したまま。
- **画像のビット化けが C: でも続いている**（2026-10-06〜10 に十数件。更新日時は変わらず1ビット反転、多くは 0x80 のビット）。
  PC 本体（メモリ等）を疑い、MemTest86 などで長時間のメモリ検査を勧める。化けたら元の出どころ（公式 details.php の画像・pcg-search）から取り直し、
  SHA-256 の一覧と一致を確かめて戻す（記録は `scripts/image-decode-report/fixed-*.json`）。一覧の値の方が化けていたこともある（S10D-085）ので、
  「中身が変わった」と出たら公式の画像と比べてどちらが正しいか確かめること。
- `public/cards/` はこの PC にすべてそろっている。消えたら `node scripts/restore-images-from-index.mjs`。

---

## コミット前の確認（2026-10-14〜）

- **pre-commit フック** `.githooks/pre-commit`（有効にするには一度だけ `git config core.hooksPath .githooks`。この PC では設定済み）:
  - `src/cardData.json`・`src/imageIndex.json`・`src/cardKinds.json`・`scripts/image-hashes.tsv` がコミットに入るとき、または `public/cards` の画像が
    前回の照合（`.git/ptcg-last-image-verify`）より後に変わったとき: `npm run check`（画像の照合＋テスト＋行のずれの検査）
  - それ以外: テストだけ（`npx vitest run`）
- 手で確かめるとき: `npm run check`（まとめて）、`npm run verify:images`、`npx vitest run`、`python scripts/detect-contaminated-en-names.py`（インドネシア語の混入）、
  `node scripts/check-row-alignment.mjs`（名前の並びのずれ）
- 弾ごと・項目ごとにコミットして push する。コミットメッセージは日本語。

---

## 今の状態（2026-10-14）

- **取り込み済みの世代**: 旧裏（PMCG1〜6・neo1〜4・VS1・web1）・e・PCG・DP（DP1〜5・EP08、型番 X＋cardID）・DPt1〜4・LEGEND・BW・XY・SM・S・SV・M、
  各世代の番号付きプロモ（S-P・SV-P・SM-P・XY-P・BW-P・DP-P・DPt-P・L-P・M-P）と番号の無いプロモ（型番 X＋cardID、306枚）、構築済みデッキ・特殊な商品の多く。
- **出品の画面**（`src/App.jsx`）: カードを検索して選ぶとタイトル・説明文・Item Specifics・SKU を作る。シングル／未開封パック・BOX／セット品の3つのタブ。
  タイトル・説明文は手で直せる（カード・タブを切り替えるまで残る）。鑑定品（PSA/BGS/CGC/SGC）、旧裏の 1st Edition・No Rarity、利益計算、出品履歴・出品キュー・CSV（試験的）。
- **残っている作業**: `docs/review-2026-10-14.md` の「確認待ちの案」の残りと、`docs/history.md` の「点検（2026-10-10）」の表
  （店舗の情報で足した HR・UR の画像 454行、psaName が無い弾、公式一覧にあって取り込んでいないキー、英語名の残り等）。
- **公式に未掲載で待っているもの**: M6a 104〜135、M-P の 052・077〜084・101〜127、SV-P 291。載ったら「新しいカードの取り込み」の手順で足す。

---

## データの決まり（cardData.json）

- **弾**: `c`（弾コード）・`ja`・`en`・`psaName`・`psaNames`・`enAlias`（旧裏の英語通称）・`codeAlias`（カードに印刷された型番。弾コードと違うとき）・
  `sr`（シリーズ。画像のフォルダ名）・`y`（発売年）・`of`（総数。プロモ・DP は 0）・`k`（行）。
- **行** `k`: `[型番, 日本語名, 英語名, レアリティ]`。card_id は「弾コード-型番」（例 `SV2a-201`）。
  - 型番は3桁の番号（"001"）。総数を超える番号（シークレット）もある。
  - **番号の無いカードは「X＋公式 details.php の cardID」**（例 `SM-P-X33404`、DP 世代 `DP1-X1013`）。
  - **ミラーの柄の版は元の型番の末尾に版の印**（例 `SV2a-025-MB`。PB・MB・EN・FB・LB・DB・QB・R）。日本語名の末尾に「（マスターボールミラー）」などが付く。
    番号を `parseInt` で読むと元の行と同じ番号になるので注意（`audit.mjs` の番号の重なりの検査など）。
  - 同じ名前のカードの見分けは日本語名の末尾の括弧注記（「（ホロ）」「（ノーマル）」「（構築ハーフデッキ「…」）」「（大会名 優勝）」など）。
- **psaName / psaNames**（買取レーダーなどほかのプロジェクトが読む）: `psaName` は PSA のラベルの主の表記、`psaNames` は追加の表記の配列
  （PSA が1つの弾を分けている／複数の弾をまとめている場合）。**弾の PSA の表記をすべて得るには `[psaName, ...(psaNames ?? [])]` から空を除いたもの**。
  1つの表記が複数の弾に入ることがある（"XY" は XY1-Bx と XY1-By）。出典は `scripts/set-psa-names.json`、反映は `node scripts/apply-set-metadata.mjs`。
- **情報源と入れる条件**:
  - 番号・日本語名・レアリティは**公式 details.php**（1件ずつ番号を確かめる）。公式一覧（resultAPI.php）は漏れがある（BREAK・LEGEND など）ので一覧だけで決めない。
  - 公式に無いもの（S・SM 世代前半の HR・UR など）は、TCGdex・遊々亭・ポケカくらぶのうち**2つ以上で番号と名前が一致**したものだけ。画像は無し（店舗の画像は使わない）。
  - 英語名は、**Bulbapedia の日本版の一覧の名前**と、日本語名から作った規則の名前（ポケモン）または **TCGdex 英語版の同じ名前・種類・イラストレーター**（トレーナーズ等）の一致。
    Bulbapedia はスクリプトから開けない（Cloudflare）ので、ブラウザで wikitext から取り出し、SHA-256 をブラウザの値と照合して `scripts/en-name-fix3/bulbapedia/` などに保存する。
    TCGdex の英語名だけで決めない（再録・別の絵柄で取り違える）。インドネシア語版の名前を英語名として使わない。
  - 旧裏〜PCG の日本語名は pcg-search.com とポケモンWiki の一致（TCGdex の日本語は機械翻訳）。PMCG はカードに番号が無いので、画像の SHA-256 と Bulbapedia の並びで結び付ける。
  - 弾の ja・y は公式の商品ページ・ポケモンWiki・Bulbapedia・Limitless のうち2つの一致。en・psaName は PSA の表記で確かめたものだけ。
- **やってはいけないこと**: cardData の中の（日本語名, 英語名）の組から対応表を作って空欄を埋める（誤った組が伝播する。`scripts/deprecated/fill-blank-en-from-ja-map.mjs`）、
  並び順・名前だけで画像や名前を対応づける（下の「止めてある古いスクリプト」）、未確認の欠番・番号の重なりを無視して取り込む。
- **カードを足した・英語名を入れた後**は `src/cardKinds.json` を作り直す（足すスクリプト・英語名を入れるスクリプトは自動。手では `node scripts/card-kinds/build-card-kinds.mjs --write`）。
- **公式サイトへのアクセス**: 同時接続1本・2〜3秒間隔、403・通信エラーは待って再試行（30→90→300秒）。大量に取ると CloudFront に 403 で止められる（2026-08-29）。
  取得中は進捗ファイル（`scan-progress/*.json` など）を別のコマンドで開かない（Windows で置き換えが EPERM で失敗する）。同じスクリプトを2本同時に動かさない。

---

## 出品の出力の決まり（src/App.jsx）

- **タイトル**（80文字以内）: 現代カードは `buildModernTitle`、旧裏（`OLD_BACK_SET_RE`: PMCG1-6・neo1-4・VS1・web1）は `buildVintageTitle`。
  - 現代カード: 鑑定情報 → カード名 → レアリティ略号 → カード番号 → ミラーの版 → Japanese → 型番（codeAlias 優先）→ Pokemon Card → 状態 → セット英語名 → 発売年 → Holo → レアリティのフルスペル。
  - 80文字を超えたら、レアリティのフルスペル → Holo → 発売年 → セット英語名の順に落とし、それでも超えたら最後の手段で
    状態 → "Pokemon Card" を "Pokemon" に → レアリティの略号 → 型番 → "Pokemon"（"Pokemon" より検索に効きにくく Item Specifics にあるものを先に落とす）。
    落とした後、収まるものは優先度の高い順に戻す。ただし "Card" は "Pokemon" があるとき、状態は "Pokemon Card" があるときだけ戻す。
    全カードが80文字以内で "Pokemon" を含むことを `src/dataIntegrity.test.js`・`App.test.jsx` で確かめている（2026-10-14 時点で "Pokemon" を外すカードは無い）。
  - 番号付きのプロモはカード番号に弾の記号が入る（`001/S-P`）ので、タイトルに型番を重ねて書かない。
  - 旧裏: 鑑定情報 → カード名 → No.006 → セット通称 → 印刷バリエーション → Japanese → 発売年 → Old Back → Pokemon Card → レアリティ語 → 状態。
    80文字を超えたら 状態 → レアリティ語 → "Pokemon Card" を "Pokemon" に → 発売年 → セット通称 → "Pokemon" の順に落とす。
  - プリズムスターの ◇ はタイトル・Character では外す（Card Name は ◇ 付き）。PR の略号は "Prism Star"、H（ひかる）は略号なし。
  - ホロ版とノーマル版を分けたカード（日本語名の末尾「（ホロ）」「（ノーマル）」）は Holo／Non-Holo を最後まで残す。
- **カード番号**: 総数のある弾は `001/165`。**番号付きのプロモは印刷された形 `001/S-P`**（2026-10-14〜）。型番 X のカード・SP5 は番号なし。ミラーの版は番号部分。
- **Item Specifics**: Card Name・Character・Set・Card Number・Rarity（`RARITY_EN_LABELS`。SR は Super Rare、MA は Mega Attack Rare）・Finish（ミラーの版 Reverse Holo、
  ホロ／ノーマルを分けたカード Holo／Regular）・Language・Manufacturer・Graded・Card Condition 等・Features（Old Back・1st Edition・No Rarity・Error）・
  Year Manufactured（弾の y）・Vintage（旧裏だけ Yes。年数のしきい値は推測で決めない）。値が空の項目は出さない。
  - **Character**: ポケモンはポケモンの名前（ex・V 等と持ち主の「〜's」を外す）、サポートは絵の人物、グッズ・どうぐ・スタジアム・エネルギー・種類の分からないトレーナーズは出さない。
- **SKU**: `{弾コード}-{番号 or 型番}-{状態 or 鑑定}-{1ST/NR/ERR}-{ミラーの版の印}`（例 `SV2A-025-NM-MB`、`SM-P-X33404-NM`）。
- **説明文**: Card の行にミラーの版の名前を付ける。相場リンクの検索語にも版の名前（ボール柄は "Master Ball" 等、エネルギーマーク柄・R柄は "… Reverse Holo"）。
- **CSV**（試験的）: `CSV_CONDITION_ID`（2750/4000）・カテゴリ 183454 はユーザー確認ベース。本番アップロード前に eBay の最新テンプレートで確かめる。鑑定品の Condition Descriptor の値 ID は未確認で空欄。
- 出力を変える直しをしたら、全カードの出力を比べる: `OUT=before.json npx vitest run scripts/audit/output-snapshot.test.jsx` → 直す → 同じく after.json →
  `node scripts/audit/compare-snapshots.mjs before.json after.json 出力.json`。直す前と後の例を `scripts/audit/*-日付.json` に残す。

---

## 止めてある古いスクリプト（2026-10-14〜）

名前や並び順で画像・名前を対応づける古いスクリプトは `scripts/deprecated/` に移してあり（2026-10-14）、実行すると理由を出して何も変えずに終わる（`scripts/legacy-guard.mjs`。どうしても使うときは `PTCG_LEGACY=1`）:
`scrape-all.mjs`（`npm run images`）・`scrape-official-images.mjs`・`scrape-missing-sv.mjs`・`scrape-pmcg-gym-supplement.mjs`・`scrape-promo-images.mjs`・`scrape-pcg-search.mjs`・
`populate-ja-names.mjs`・`populate-ja-names-v2.mjs`・`fix-card-names.mjs`・`fetch-set-years.mjs`（手で直した発売年を上書きする）・`scrape-bw-xy.mjs`（`scrape-missing-sets.mjs` に置き換え済み）。
`scripts/deprecated/` のもの（英語版の画像を取る `scrape-old-images.mjs` など）も使わない。

---

## ファイル構成

主なものだけ（2026-10-14）。スクリプトの整理の案は `docs/review-2026-10-14.md` の「D. スクリプト・運用」。

```
docs/
  history.md               # 作業の記録（2026-10-14 に CLAUDE.md から移した）
  review-2026-10-14.md     # 全体の点検と改善の一覧

.githooks/
  pre-commit               # コミット前の確認（git config core.hooksPath .githooks）

src/
  App.jsx                  # 画面と出品の出力（タイトル・説明文・Item Specifics・SKU・CSV）
  App.test.jsx             # 出品の出力のテスト
  dataIntegrity.test.js    # cardData・画像の対応表・全カードのタイトル/SKU の整合性のテスト
  cardData.json            # 全弾・全カードのデータ
  cardKinds.json           # カードの種類（ポケモン以外）。build-card-kinds.mjs で作る
  imageIndex.json          # 弾/型番 → 画像パス（build-image-index.mjs で作る）

scripts/
  new-cards.mjs            # 新しいカードの取り込み（下の「新しいカードの取り込み」）
  scrape-missing-sets.mjs  # 公式 details.php で番号を確かめて弾を作る処理の本体（new-cards.mjs が使う）
  scrape-promo-sets.mjs    # 番号付きプロモ
  add-numberless-promos.mjs # 番号の無いプロモ（型番 X＋cardID）
  patch-from-scan.mjs      # 既存の弾の補完・作り直し（--full-fetch → --rebuild）
  fix-rows-from-details.mjs # 公式の結果で食い違う行だけ直す
  fill-common-en.mjs ほか  # 英語名（Bulbapedia と TCGdex 英語版の一致）
  build-image-index.mjs    # 画像の対応表（弾を直したら --only <弾>）
  image-hashes.mjs         # 画像の SHA-256 の照合（--verify。コミット前に必ず）
  legacy-guard.mjs         # 古いスクリプト（名前・並び順で対応づけるもの）を止める
  audit/                   # 点検（audit.mjs）と、直す前後の例
  filename-utils.mjs       # 画像のファイル名の組み立て・解析

public/
  cards/                   # 画像（{sr}/{set}/{jaName}_{setCode}-{localId}／{total}_{rarity}.ext）。.gitignore 対象
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
- 弾を足したり作り直したりしたときは `node scripts/build-image-index.mjs --only <弾>`（全体の作り直しは古いファイルを拾うので使わない）
- 優先度: `.jpg` > `.png` > `.gif`（webp は完全除外）
- キー形式: `"{setCode}/{localId}"` → 値: `"/cards/{sr}/{set}/{jaName}_{setCode}-{localId}／{total}_{rarity}.jpg"` など

---

## 新しいカードの取り込み（定期的に行う。2026-10-09〜）

新しい弾・既存の弾やプロモに新しく載ったカードを、公式のカード検索から見つけて取り込む。`scripts/new-cards.mjs` を使う。
1回の作業の目安は、一覧の取り直し約25分＋候補の details.php の取得（1件2〜3秒）。

1. **作業の前に** `node scripts/image-hashes.mjs --verify`（0件であること）
2. **一覧を取り直して候補を出す**: `node scripts/new-cards.mjs --rescan`
   - 公式の一覧（resultAPI.php）を取り直して `scripts/official-card-scan.json` を上書きし、これまでに確かめた cardID に無いカードの details.php を取得する（1接続・2〜3秒間隔、途中で止まっても再実行で続きから）。
   - 結果は `scripts/new-cards/report.tsv`（cardID・印刷記号・番号・総数・名前・レアリティ・追加先・状態）と、画面の弾ごとのまとめ。**ここで内容を確かめてから追加する**。
   - 状態: 「追加」（既存の弾に足せる）／「新しい弾」／「登録済み（同じカードの別掲載）」／「番号が重なる」（止まる。人が確かめる）／「番号なし（要確認）」／「弾が1つに決まらない」。
   - 番号の無い基本エネルギーは自動で台帳（`scripts/new-cards/ledger.json`）に skip として記録され、次から出ない。
   - 一覧を取り直さずに候補だけ出し直すときは `node scripts/new-cards.mjs`（取得もするなら `--fetch`）。
3. **既存の弾に足す**: `node scripts/new-cards.mjs --apply --set <弾>`
   - 印刷記号が弾の codeAlias（無ければ弾コード）と同じで、総数が弾の of と同じ（プロモは「NNN / 弾コード」）カードだけを足す。画像は公式から取り、
     画像の対応表をその弾だけ作り直し（`build-image-index.mjs --only`）、`--verify` まで行う。足した card_id は `scripts/new-cards/{弾}-added-card-ids-{日付}.txt`。
   - 番号が無いのに画像に番号が印刷されているカード（CL2023 の基本エネルギー等）は自動では足せない。画像で番号を確かめ、プロモなら `scrape-promo-sets.mjs` の
     `printedNumbers` に書いて `add-promo-rows.mjs --set <弾>` で足す。
4. **新しい弾を作る**: `node scripts/new-cards.mjs --apply --new <印刷記号>`（初回は `scripts/new-cards/set-meta.json` の雛形を出して止まる）
   - 弾の情報を `set-meta.json` に書く。**推測で埋めない**。確かめられないものは空欄（en・psaName）。
     - `c`（弾コード）: 印刷記号と同じにする（同じ記号の弾が既にあれば「記号-区別」の形。例 S8a-P・XY-BEST）。`codeAlias` は印刷記号。
     - `ja`: 公式の商品ページ・ニュースの商品名。
     - `y`（発売年）: 公式の商品ページの発売日。Limitless TCG の日本版の一覧（型番で一致）と一致すること。
     - `sr`（シリーズ）: 弾の世代（M・SV・S など。画像のフォルダ名になる）。
     - `en`・`psaName`: PSA の日本版のラベル表記（鑑定書・集計ページのタイトル）で確かめたものだけ。PSA にまだ無ければ空欄にし、後で埋める
       （`scripts/set-psa-names.json`・`set-en-sources.json` に出典を書いて `apply-set-metadata.mjs`／`fill-set-en-y.mjs`）。
   - 1〜最大番号に欠番があれば止まる（公式に載っていないカードがある。足さずに様子を見る）。
   - カードを足した後、カードの種類の一覧 `src/cardKinds.json` は自動で作り直される（`--set` でも同じ。Item Specifics の Character に使う）。
5. **英語名**: 足したカードの英語名は空欄。これまでと同じ方法（`fill-common-en.mjs`・`fill-high-rarity-en.mjs`：Bulbapedia の日本版の一覧をブラウザで取り出し、
   規則の名前か TCGdex 英語版の同じ名前・種類・イラストレーターとの一致）で入れる。新しい弾は Bulbapedia・TCGdex の掲載を待つことが多い。
   英語名を入れるスクリプトも `--apply` の最後に `src/cardKinds.json` を自動で作り直す（英語名が入ると Bulbapedia の一覧と結び付けられる行が増えるため）。
   手で作り直すときは `node scripts/card-kinds/build-card-kinds.mjs --write`。
6. **取り込まないカード**: `node scripts/new-cards.mjs --skip <cardID,…> --reason "理由"`（台帳に記録し、次から出さない）。
7. **作業の後に** `--verify`・`npx vitest run`（`src/cardKinds.json` が変わっていればそれもコミットする）・`python scripts/detect-contaminated-en-names.py`・`node scripts/check-row-alignment.mjs`。弾ごとにコミットして push。
   カイトリレーダーへの反映（R2 への画像の送り・見本の特徴）は向こうの手順で行う。

## 画像を一から取得し直す場合

**`npm run images`（`scripts/deprecated/scrape-all.mjs`）は使わない**（2026-10-14 に止めた。`scripts/legacy-guard.mjs`）。中で名前で画像を探す
`scrape-official-images.mjs`・`scrape-missing-sv.mjs` などを実行し、画像の無い高レアに通常版の画像を保存してしまう（2,227枚の取り違えの原因）。
同じく `scrape-promo-images.mjs`・`populate-ja-names*.mjs`・`fix-card-names.mjs`・`fetch-set-years.mjs`・`scrape-bw-xy.mjs`・
`scrape-pcg-search.mjs`・`scrape-pmcg-gym-supplement.mjs` も止めてある（実行すると理由を出して終わる。どうしても使うときは `PTCG_LEGACY=1`）。

- 画像が消えたとき: `node scripts/restore-images-from-index.mjs`（Git の `imageIndex.json` どおりにそろえる）、または退避した画像を戻す
- 画像が化けたとき: `node scripts/image-hashes.mjs --verify` で見つけ、元の出どころ（公式 details.php の画像・pcg-search）から取り直して一覧の SHA-256 と一致を確かめる
- 弾ごとに取り直すとき: `patch-from-scan.mjs --full-fetch --set <弾>` → `--rebuild --set <弾>`（番号で確かめる）
- `scrape-old-images.mjs`（`scripts/deprecated/`）— 英語版のアートワーク。**日本語カードの出品には使わない**

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
