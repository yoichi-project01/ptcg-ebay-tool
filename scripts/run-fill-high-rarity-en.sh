#!/usr/bin/env bash
# 高レアの英語名（fill-high-rarity-en.mjs）を弾ごとに cardData.json に入れてコミット・push する（2026-10-06）。
#   bash scripts/run-fill-high-rarity-en.sh            「入れる」行がある弾をすべて処理
#   bash scripts/run-fill-high-rarity-en.sh S4a SM8b   指定した弾だけ
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -gt 0 ]; then SETS="$*"; else
  node scripts/fill-high-rarity-en.mjs > /dev/null
  SETS=$(node -e 'const p=require("./scripts/en-name-fix2/summary-check.json");console.log(Object.entries(p).filter(([,c])=>c["入れる"]>0).map(([s])=>s).join(" "))')
fi

git_retry() { for i in $(seq 1 20); do "$@" && return 0; echo "git が失敗（${i}回目）。10秒待ってやり直します"; sleep 10; done; return 1; }

for s in $SETS; do
  node scripts/fill-high-rarity-en.mjs --apply --set "$s"
  n=$(grep -c . "scripts/en-name-fix2/${s}-changed-card-ids.txt" || true)
  if [ "${n:-0}" = "0" ]; then echo "[$s] 入れる行なし"; continue; fi
  blank=$(node -e "const p=require('./scripts/en-name-fix2/summary.json');console.log(p['$s'].空欄のまま)")
  git_retry git add src/cardData.json scripts/en-name-fix2/decisions.tsv scripts/en-name-fix2/summary.json "scripts/en-name-fix2/${s}-changed-card-ids.txt"
  git_retry git commit -q -m "${s}: 英語名が空だった高レア ${n}行に英語名を入れる（Bulbapedia の日本版の一覧と TCGdex 英語版の同じ名前・イラストレーター・種類のカードが一致したもの。空欄のまま ${blank}行）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git_retry git push -q
  echo "[$s] ${n}行 空欄のまま ${blank}行 $(git log -1 --format=%h)"
done
