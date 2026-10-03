#!/usr/bin/env bash
# SM 世代の本弾・強化拡張パック・ハイクラスパックの、公式サイトに無いシークレットを
# add-secrets-from-sources.mjs で補完し、弾ごとにコミットする（2026-10-04）。
# 列: 弾コード / ポケカくらぶの一覧ID / ポケカくらぶの型番の先頭 / TCGdex の弾ID / 遊々亭の弾名
set -e
cd "$(dirname "$0")/.."
# 他のプロセス（エディタ等）が git の index を一時的に掴むと失敗するため、数回やり直す
retry() { for i in $(seq 1 20); do "$@" && return 0; sleep 10; done; return 1; }
while read -r code pk prefix tdx yt; do
  [ -z "$code" ] && continue
  from=$(node -e 'const s=require("./src/cardData.json").find(x=>x.c===process.argv[1]);console.log(Math.max(...s.k.map(r=>parseInt(r[0],10)).filter(Number.isFinite))+1)' "$code")
  echo "=== $code (from $from)"
  node scripts/add-secrets-from-sources.mjs --set "$code" --from "$from" --tcgdex-id "$tdx" --yuyutei-slug "$yt" \
    --extra "https://www.pokeca.net/product-list/$pk" --extra-prefix "$prefix" | tail -3
  if ! git diff --quiet -- src/cardData.json; then
    n=$(git diff -U0 src/cardData.json | grep -c '^+        "[0-9]')
    retry git add src/cardData.json "scripts/secret-sources/$code.json" "scripts/secret-sources/$code-added-card-ids.txt" "scripts/secret-progress/$code.json"
    retry git commit -q -m "$code: 公式に無いシークレットを TCGdex・遊々亭・ポケカくらぶの照合で補完（${n}枚）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    echo "committed $code ($n)"
  else
    git add "scripts/secret-sources/$code.json" "scripts/secret-progress/$code.json" 2>/dev/null || true
  fi
done <<'LIST'
SM1S 118 SM1S SM1S sm01s
SM1M 119 SM1M SM1M sm01m
SM1p 135 SM1+ SM1+ sm01plus
SM2K 141 SM2K SM2K sm02k
SM2L 148 SM2L SM2L sm02l
SM2p 159 SM2+ SM2+ sm02plus
SM3H 176 SM3H SM3H sm03h
SM3N 182 SM3N SM3N sm03n
SM3p 195 SM3+ SM3+ sm03plus
SM4S 204 SM4S SM4S sm04s
SM4A 212 SM4A SM4A sm04a
SM4p 220 SM4+ SM4+ sm04plus
SM5S 247 SM5S SM5S sm05s
SM5M 248 SM5M SM5M sm05m
SM5p 266 SM5+ SM5+ sm05plus
SM6 281 SM6K SM6 sm06
SM6a 290 SM6A SM6a sm06a
SM6b 297 SM6B SM6b sm06b
SM7 305 SM7R SM7 sm07
SM7a 313 SM7A SM7a sm07a
SM7b 321 SM7B SM7b sm07b
SM8 342 SM8C SM8 sm08
SM8a 350 SM8AD SM8a sm08a
SM8b 357 SM8B SM8b sm08b
SM9 374 SM9T SM9 sm09
SM9a 384 SM9AN SM9a sm09a
SM9b 391 SM9BF SM9b sm09b
SM10 400 SM10 SM10 sm10
SM10a 411 SM10A SM10a sm10a
SM10b 421 SM10B SM10b sm10b
SM11 431 SM11 SM11 sm11
SM11a 440 SM11A SM11a sm11a
SM11b 472 SM11B SM11b sm11b
SM12 493 SM12 SM12 sm12
SM12a 500 SM12A SM12a sm12a
LIST
