#!/usr/bin/env bash
# レアリティが空の行を、公式 details.php のレアリティで弾ごとに埋めてコミット・push する（2026-10-05）。
#   bash scripts/run-fill-rarity.sh            「入れる」行がある弾をすべて処理
#   bash scripts/run-fill-rarity.sh SV1S SV1V  指定した弾だけ
# 1弾ごとに: fill-rarity-from-details.mjs --apply → 画像の対応表の全件にファイルがあるか確認 → コミット・push。
# 確認に失敗した弾は止める（コミットしない）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -gt 0 ]; then SETS="$*"; else
  node scripts/fill-rarity-from-details.mjs > /dev/null
  SETS=$(node -e 'const p=require("./scripts/rarity-fix/plan-check.json");console.log(Object.entries(p).filter(([,c])=>c["入れる"]).map(([s])=>s).join(" "))')
fi

git_retry() { for i in $(seq 1 20); do "$@" && return 0; echo "git が失敗（${i}回目）。10秒待ってやり直します"; sleep 10; done; return 1; }

for s in $SETS; do
  node scripts/fill-rarity-from-details.mjs --set "$s" --apply
  n=$(grep -c . "scripts/rarity-fix/${s}-changed-card-ids.txt" || true)
  if [ "${n:-0}" = "0" ]; then echo "[$s] 入れる行なし"; continue; fi
  # 確認: 対応表の全件にファイルがある・同じ card_id の画像は1つだけ・対応表に無いファイルは無い
  node scripts/archive-stray-images.mjs --verify
  git_retry git add src/cardData.json src/imageIndex.json "scripts/rarity-fix/${s}.json" "scripts/rarity-fix/${s}-changed-card-ids.txt"
  [ -f "scripts/scan-progress/${s}.json" ] && git_retry git add "scripts/scan-progress/${s}.json"
  git_retry git commit -q -m "${s}: レアリティが空だった ${n}行に公式 details.php のレアリティを入れる（画像のファイル名も合わせる）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git_retry git push -q
  echo "[$s] ${n}行 $(git log -1 --format=%h)"
done
