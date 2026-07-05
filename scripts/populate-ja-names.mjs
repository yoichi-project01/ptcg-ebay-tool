#!/usr/bin/env node
/**
 * 公式キャッシュを使って cardData.json と card-list.json の日本語名を補完
 *
 * 方式: 公式サイトの製品番号（cardThumbFileの数字）でソートすると
 *       TCGdex の localId 順（001, 002, ...）と一致するため、
 *       位置マッチングで jaName を埋める。
 *
 * 使い方:
 *   node scripts/populate-ja-names.mjs           # 全対象セット
 *   node scripts/populate-ja-names.mjs --set S4a # 特定セットのみ
 *   node scripts/populate-ja-names.mjs --dry-run # 変更なしで確認のみ
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CARD_LIST_PATH = path.join(__dirname, "card-list.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");

const args = process.argv.slice(2);
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
const dryRun = args.includes("--dry-run");

function extractNum(cardThumbFile) {
  const m = cardThumbFile?.match(/\/(\d+)_/);
  return m ? parseInt(m[1]) : 0;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const cardList = JSON.parse(await fs.readFile(CARD_LIST_PATH, "utf-8"));
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
  const setMap = cache.setMap;

  // card-list.json を set+local でインデックス
  const listIndex = new Map();
  for (const c of cardList) {
    listIndex.set(c.set + "/" + c.local, c);
  }

  let totalUpdated = 0;
  let totalSkipped = 0;

  const targetSets = onlySet
    ? cardData.filter(s => s.c === onlySet)
    : cardData.filter(s => !s.k.some(c => c[1] && c[1].trim())); // 日本語名なしセット

  for (const setData of targetSets) {
    const setCode = setData.c;
    const officialCards = setMap[setCode];

    if (!officialCards || officialCards.length === 0) {
      console.log(`[${setCode}] 公式キャッシュなし → スキップ`);
      totalSkipped++;
      continue;
    }

    // 製品番号でソート（=localId順）
    const sorted = officialCards
      .map(c => ({ num: extractNum(c.cardThumbFile), jaName: c.jaName }))
      .sort((a, b) => a.num - b.num);

    const n = setData.k.length;
    const available = Math.min(n, sorted.length);
    let updated = 0;

    for (let i = 0; i < available; i++) {
      const card = setData.k[i];
      const jaName = sorted[i].jaName;
      if (!jaName) continue;

      if (!card[1] || !card[1].trim()) {
        if (!dryRun) {
          card[1] = jaName;
          // card-list.jsonも更新
          const listCard = listIndex.get(setCode + "/" + card[0]);
          if (listCard) listCard.ja = jaName;
        }
        updated++;
      }
    }

    const status = available < n
      ? ` (公式${sorted.length}件 < cardData${n}件 → ${n - available}件は空のまま)`
      : ` (${Math.min(sorted.length, n)}/${n}件)`;
    console.log(`[${setCode}] ${updated}件を更新${dryRun ? " [DRY-RUN]" : ""}${status}`);
    totalUpdated += updated;
  }

  if (!dryRun && totalUpdated > 0) {
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
    await fs.writeFile(CARD_LIST_PATH, JSON.stringify(cardList, null, 2), "utf-8");
    console.log(`\n更新完了: ${totalUpdated}件の日本語名を追加`);
    console.log("cardData.json と card-list.json を上書き保存しました。");
  } else if (dryRun) {
    console.log(`\n[DRY-RUN] 合計 ${totalUpdated} 件が更新対象です`);
  }
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
