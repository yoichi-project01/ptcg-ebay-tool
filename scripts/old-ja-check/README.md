# 旧裏・neo・VS・web・e・PCG の日本語名の調査（2026-10-08、未修正）

cardData の日本語名（`k[1]`）を、番号で pcg-search.com・ポケモンWiki と照らし合わせた結果。cardData は変更していない。

| ファイル | 中身 |
|---|---|
| `pcg-search-titles.json` | pcg-search.com のカードページの `<title>`（カード名・弾名・番号）。neo1〜4・e1〜5・PCG1〜9・VS1・web1 の 1,736 ページ（`fetch-pcg-titles.mjs`、1接続・2〜3秒間隔） |
| `pokemonwiki-names.json` | ポケモンWiki の弾のページ（wikitext）の番号付き一覧。PCG1〜9・E2〜E5・VS1（ハーフデッキの一部のみ） |
| `diff.tsv` | cardData と pcg-search で名前が違う行（`classify.cjs` の出力。分類・cardData・pcg-search・英語名） |
| `by-set.json` | 弾ごとの件数 |
| `pmcg-diff.tsv` | PMCG1〜6: pcg-search の名前の一覧（`pcg-search-cache/*-namemap.json`）に無い cardData の名前（番号の並びがサイトと違うため名前の有無だけで照合） |

`classify.cjs` は `%TEMP%/claude/oldja/pcg-titles.json` を読む使い捨てのスクリプト（再実行するときはパスを直す）。
