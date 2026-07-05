# 引き継ぎドキュメント（Claude Code 用）

このファイルは、Claude（チャット版）との会話で作ったプロジェクトを **Claude Code で継続する** ための引き継ぎメモです。
Claude Code で作業を始めるとき、最初にこのファイルを読ませてください。

例（Claude Code のプロンプト）:
> `HANDOFF.md` と `README.md` を読んで、このプロジェクトの続きを手伝ってください。まずは画像スクレイピングを実行して、うまく画像が取得できるか確認したいです。

---

## 1. このプロジェクトは何か

日本語版ポケモンカードの情報から、**eBay 出品用の英語タイトルと説明文を自動生成する**ローカル Web アプリ。
ユーザー（よういち）は日本語版ポケカ（シングル・未開封パック・BOX）を eBay で海外向けに販売しており、
毎回タイトルと説明文を手で考えるのが大変なため、このツールを作っている。

- フロント: Vite + React（`src/App.jsx`）
- カードデータ: `src/cardData.json`（128 セット / 12,654 枚、TCGdex のオープンデータから生成）
- カード画像: **ローカルにダウンロードして同梱する方式**（`public/cards/` 配下、`src/imageIndex.json` で参照）

## 2. これまでの経緯（重要な設計判断）

会話の中で、画像表示の方式が次のように変遷した。**なぜ今の方式なのか**を理解しておくこと。

1. 最初は AI（Claude API + Web検索）でカード候補を検索していた → 遅い・不安定なので却下
2. 次に TCGdex の画像 CDN URL を**アプリから直接叩く**方式にした
   → しかしチャット版 Claude の実行環境は `assets.tcgdex.net` に接続できず、**正しい URL 形式を検証できなかった**
   → URL の大文字/小文字・番号のゼロ埋めを推測で当てにいったが、ユーザー環境で画像が出ないことが続いた
3. 最終的にユーザーの希望で **「画像を実際にダウンロードして同梱する」** 方式に決定（対象は全 12,654 枚）
   → これが今の方式。**Claude Code はネットワーク制限がないので、この方式が実行できる**のがポイント

### TCGdex 画像 URL について（判明していること）

- 公式の URL 形式（英語カードで実証済み）: `https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}/{quality}.webp`
  - 例（英語）: `https://assets.tcgdex.net/en/swsh/swsh4/1/high.webp`（**localId はゼロ埋めなし**）
- 日本語（`ja`）について、CDN が serie/set の ID を**大文字で持つか小文字で持つか未確定**。
  - 英語 DB は ID が小文字（`base`, `swsh4`）だが、日本語 DB（TCGdex の data-asia）は ID が大文字（`SV`, `SV2a`）
  - そのため `scripts/scrape-images.mjs` は**大文字/小文字・ゼロ埋め有無の全パターンを順に試す**実装になっている
- スクレイパー実行後、`scripts/scrape-report.json` の `winningFormats` に**実際に当たった形式**が記録される。
  → これを見れば正しい形式が確定する。確定したら、必要に応じてアプリ側 or スクレイパーを最適化してよい。

## 3. 現在の状態

- アプリ・スクレイパー・データはすべて作成済みで、構文チェック済み。
- **まだ画像スクレイピングは実行していない**（チャット版の環境では不可能だったため）。
  - `public/cards/` は空、`src/imageIndex.json` は `{}`（空）の状態。
  - この状態でも `npm run dev` でアプリは起動するが、画像は全部「画像なし」表示になる。

## 4. 次にやること（Claude Code での想定タスク）

優先度順:

1. **画像スクレイピングの実行と検証**
   - まず少数で試す: `npm run scrape -- --set SV2a`（ポケモンカード151 だけ）
   - `scripts/scrape-report.json` を開き、`downloaded` が増えているか、`winningFormats` に何が入ったか確認
   - 取得できていれば `npm run index` → `npm run dev` で画像が表示されるか確認
   - 問題なければ全件: `npm run images`
2. **もし画像が取得できない場合**
   - `scrape-report.json` の `missingCards` を確認し、URL 形式の仮説が外れていないか検証
   - `scripts/scrape-images.mjs` の `imageUrlCandidates()` を調整（実際に 1 枚でも当たる URL をブラウザや curl で見つけて、そこから逆算するのが確実）
   - TCGdex に日本語画像が無いセットは諦めて「画像なし」で運用する判断もあり
3. **英語名・レアリティの精度改善（任意）**
   - `src/cardData.json` の一部カードは英語名が空、またはトレーナーカードで誤り（例: ナンジャモが "Mistika" になっている＝データ元の誤り。正しくは "Iono"）
   - レアリティは AR/SAR/SR などシークレット枠が未登録の場合がある
   - 必要なら主要セットだけ手作業で精査、またはトレーナーカードの対訳を追加

## 5. データの作り方（再生成が必要になったとき）

`src/cardData.json` は TCGdex の `cards-database` リポジトリ（`data-asia/` 配下）から生成した。
生成ロジックの要点（会話で使った Python スクリプトの内容）:

- リポジトリ: `https://github.com/tcgdex/cards-database`（`data-asia/{シリーズ}/{セット}.ts` と `.../{番号}.ts`）
- 各カード .ts から `name.ja`（日本語名）、`name.id`（英語名）、`rarity` を正規表現で抽出
- 日本語名が壊れているカードは PokeAPI の種族名対訳（`pokemon_species_names.csv`）で補修
- 英語名が無いカードは、種族名 + 接頭辞/接尾辞（メガ→Mega、ex/V/VMAX 等）から生成
- レアリティは TCGdex 表記を略号へマッピング（Double rare→RR, Illustration rare→AR, Special illustration rare→SAR 等）
- 出力構造: `[{ c:セット型番, ja:セット名日, en:セット名英, sr:シリーズID, of:公式カード数, k:[[番号, 日本語名, 英語名, レアリティ], ...] }, ...]`

`scripts/card-list.json` は上記から `[{serie, set, local, ja}]` のフラット一覧にしたもの（スクレイパーの入力）。

## 6. eBay 出品文のノウハウ（説明文テンプレに反映済み）

会話で調べた「売れているセラー」の傾向。`src/App.jsx` の `buildSingleDesc` / `buildPackDesc` に反映済み。

- シングル: 状態表記（NM/LP/MP/HP）を正確に、迷ったら1段階低く。「写真のカード＝届くカード」明記。sleeve + toploader 梱包を記載
- パック/BOX: 「Factory Sealed」「Never weighed（重量未測定）」を明記。「開封結果は運＝返品不可」の自衛文。BOX はシュリンク有無を明記
- 共通: 日本からの発送日数・追跡付きを明記。タイトルは 80 文字以内（eBay 上限）、検索されるキーワード（Japanese / Sealed / セット型番・カード番号）を入れる

## 7. ユーザーについて

- 名前: よういち
- 販売: eBay で日本語版ポケカを海外向けに販売。仕入れは メルカリ / ヤフオク / 駿河屋 など
- eBay アカウントは作成済み、Payoneer 連携の段階まで進んでいる
- 日本語でやり取りしている。回答は簡潔さを好む
