#!/usr/bin/env bash
# duplicate-images.tsv の画像を弾ごとに取り直し（refetch-duplicate-images.mjs）、画像索引をその弾だけ更新し、
# バイト一致が残っていないか確かめてから弾ごとにコミット・push する（2026-10-05）。
# 途中で止まっても再実行すれば、確認まで済んだ弾は飛ばし、途中の弾は取得済みの分を飛ばして続きから進む。
set -e
cd "$(dirname "$0")/.."
# 他のプロセス（エディタ等）が git の index を一時的に掴むと失敗するため、やり直す
retry() { for i in $(seq 1 20); do "$@" && return 0; sleep 10; done; return 1; }
# 保留する弾（cardData の番号のずれが見つかったもの。SJ は 018〜030 がずれている、2026-10-05）
HOLD=" SJ "
SETS=$(node scripts/refetch-duplicate-images.mjs --plan | grep -v '^合計' | cut -f1)
for s in $SETS; do
  if [ "${HOLD/ $s /}" != "$HOLD" ]; then echo "=== $s 保留（HOLD）"; continue; fi
  if node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j.verify&&!j.verify.remainingDuplicates.length?0:1)' "scripts/image-dup-report/refetch/$s.json" 2>/dev/null \
     && git diff --quiet HEAD -- "scripts/image-dup-report/refetch/$s.json" && git ls-files --error-unmatch "scripts/image-dup-report/refetch/$s.json" >/dev/null 2>&1; then
    echo "=== $s 済み"; continue
  fi
  echo "=== $s"
  node scripts/refetch-duplicate-images.mjs --set "$s"
  node scripts/build-image-index.mjs --only "$s" --keep-keys
  # 確認で別の番号とのバイト一致が残った弾はコミットせずに次へ（cardData 自体のずれなど、人が判断するもの）。画像索引は元に戻す
  if ! node scripts/refetch-duplicate-images.mjs --set "$s" --verify; then
    echo "要確認 $s（コミットしない）"; retry git checkout -- src/imageIndex.json; continue
  fi
  n=$(grep -c . "scripts/image-dup-report/refetch/$s-refetched-card-ids.txt" || true)
  c=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.refetched.filter(r=>r.changed).length)' "scripts/image-dup-report/refetch/$s.json")
  retry git add src/imageIndex.json "scripts/scan-progress/$s.json" "scripts/image-dup-report/refetch/$s.json" "scripts/image-dup-report/refetch/$s-refetched-card-ids.txt"
  retry git commit -q -m "$s: 中身が別の番号と同じだった画像を公式 details.php で番号を確かめて取り直し（${n}枚、うち中身が変わった ${c}枚）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  retry git push -q
  echo "committed $s ($n / changed $c)"
done
