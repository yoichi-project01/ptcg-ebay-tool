# cardData の点検（2026-10-10、修正はしていない）

| ファイル | 中身 |
|---|---|
| `audit.mjs` | 点検のスクリプト（読み取りのみ）。`node scripts/audit/audit.mjs` で下の3つを作り直す |
| `summary.json` | 件数のまとめ（空の行・世代別・種類別・手がかりの件数） |
| `blank-counts.tsv` | 世代・弾・種類ごとの、英語名・レアリティ・画像が空の行の数 |
| `findings.json` | 誤りの手がかり（公式一覧に無い日本語名・pcg-search と違う日本語名・機械翻訳らしい語・英語名の要素の抜け・番号の重なり・画像のファイル名と行の名前の違い）。すべて確認し、誤検出だった（CLAUDE.md 参照） |
| `en-name-check-summary.json`・`en-name-check-affected.tsv` | `check-en-names.mjs` の結果の写し（実行で上書きされる `en-name-check/` は元に戻した） |
| `duplicate-images-summary.json`・`duplicate-images.tsv` | `find-duplicate-images.mjs` の結果の写し |
| `set-total-report.tsv` | `check-set-totals.mjs` の結果の写し |

まとめと残っている作業の一覧は CLAUDE.md「点検（2026-10-10）: cardData 全体の今の状態・残っている作業」。
