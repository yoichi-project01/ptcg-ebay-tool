#!/usr/bin/env bash
# 破損セットの作り直しを再開する（Git Bash / macOS / Linux 共通）。
# 1セットずつ「全件確認 → 作り直し → 画像インデックス再生成 → 行ズレ検査 → 検証 → コミット」を行う。
# details.php の取得結果は scripts/scan-progress/ に保存済みの分を飛ばすので、途中で止めても再実行で続きから再開する。
#
# 注意: 同時に2つ以上実行しないこと（cardData.json の書き込みが上書きし合い、作り直した内容が消える）。
#
# 使い方: bash scripts/resume-rebuild.sh            # 残りのセット（S10P S11 S10a）
#         bash scripts/resume-rebuild.sh S10P       # 指定したセットだけ
set -u
cd "$(dirname "$0")/.."
codes=("$@")
[ ${#codes[@]} -eq 0 ] && codes=(S10P S11 S10a)

for code in "${codes[@]}"; do
  echo "===== $code"
  node scripts/patch-from-scan.mjs --full-fetch --set "$code" || { echo "FAIL-FETCH $code（再実行すると続きから再開します）"; exit 1; }
  if ! node scripts/patch-from-scan.mjs --rebuild --set "$code"; then
    echo "FAIL-REBUILD $code"; git checkout -- src/cardData.json; exit 1
  fi
  node scripts/build-image-index.mjs --only "$code" | tail -1
  node scripts/check-row-alignment.mjs | tail -1
  node scripts/verify-rebuilt-sets.mjs "$code" || { echo "VERIFY-NG $code"; exit 1; }
  git add src/cardData.json src/imageIndex.json "scripts/scan-progress/$code.json" "scripts/scan-patch-report/$code-rebuild.json"
  git commit -q -m "$code: details.php の全件確認結果で作り直し" \
    -m "末尾が別カードの名前で埋まっていた（S4a 型の破損）ため、全件を確かめて置き換え、欠けていたシークレットも追加。変化は scripts/scan-patch-report/$code-rebuild.json。" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git log --oneline -1
done
echo ALLDONE
