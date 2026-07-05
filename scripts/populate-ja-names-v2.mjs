#!/usr/bin/env node
/**
 * 公式API（pgフィルター）から日本語名を取得して cardData.json / card-list.json を更新
 *
 * pgフィルター経由のAPIはカードをセット番号順（001, 002, ...）で返すことを確認済み。
 * これにより localId → 日本語名 を正確に対応付けられる。
 *
 * 使い方:
 *   node scripts/populate-ja-names-v2.mjs           # 全対象セット
 *   node scripts/populate-ja-names-v2.mjs --set S4a # 特定セット
 *   node scripts/populate-ja-names-v2.mjs --dry-run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CARD_LIST_PATH = path.join(__dirname, "card-list.json");

const API_BASE = "https://www.pokemon-card.com";
const API_URL = `${API_BASE}/card-search/resultAPI.php`;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://www.pokemon-card.com/card-search/index.php/",
};
const DELAY_MS = 300;

// セットコード → pg値（官サイトの製品フィルターID）
// pg経由のAPIはカードをセット番号順で返す（S12で検証済み）
const SET_PG_MAP = {
  S4:   721,
  S4a:  723,
  S5I:  727,
  S5R:  728,
  S5a:  730,
  S6H:  731,
  S6K:  732,
  S6a:  736,
  SH:   738,
  S7D:  739,
  S7R:  740,
  SP5:  744,
  S8:   745,
  S8a:  746,
  SJ:   747,
  S8b:  748,
  SK:   849,
  SI:   850,
  S10D: 856,
  S10P: 857,
  S10a: 858,
  S10b: 861,
  S11:  862,
  S11a: 866,
  SVAM: 872,
  SVAL: 873,
  SVAW: 874,
  SVB:  875,
  "SV-P": 876,
  SVC:  878,
  SVP1: 881,
  SVD:  883,
  SVF:  895,
  SVEM: 898,
  SVEL: 899,
  SV5M: 907,
  SVHK: 908,
  SVHM: 909,
  SV6a: 917,
  // 部分的に空のセット（既存の日本語名は保持し、空のカードだけ補完）
  SV6:  914,
};

const args = process.argv.slice(2);
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
const dryRun = args.includes("--dry-run");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllForPg(pg) {
  const cards = [];
  let page = 1;
  while (true) {
    const url = `${API_URL}?regulation_sidebar_form=all&pg=${pg}&page=${page}&sortBy=new`;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        for (const c of (data.cardList || [])) {
          cards.push(c.cardNameViewText || c.cardNameAltText || "");
        }
        if (page >= data.maxPage) return cards;
        page++;
        break;
      } catch (e) {
        if (i < 2) await sleep(1000 * (i + 1));
        else throw e;
      }
    }
    await sleep(DELAY_MS);
  }
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const cardList = JSON.parse(await fs.readFile(CARD_LIST_PATH, "utf-8"));

  // card-list.json を set+local でインデックス
  const listIndex = new Map();
  for (const c of cardList) listIndex.set(c.set + "/" + c.local, c);

  // 対象セット（日本語名なし、かつ pg あり）
  const targetSets = onlySet
    ? cardData.filter(s => s.c === onlySet)
    : cardData.filter(s => {
        const hasJa = s.k.some(c => c[1] && c[1].trim());
        return !hasJa && SET_PG_MAP[s.c] !== undefined;
      });

  let totalUpdated = 0;

  for (const setData of targetSets) {
    const setCode = setData.c;
    const pg = SET_PG_MAP[setCode];

    if (!pg) {
      console.log(`[${setCode}] pg値なし → スキップ`);
      continue;
    }

    process.stdout.write(`[${setCode}] pg=${pg} からカードを取得中...`);
    let officialNames;
    try {
      officialNames = await fetchAllForPg(pg);
    } catch (e) {
      console.log(` 失敗: ${e.message}`);
      continue;
    }

    const n = setData.k.length;
    const available = Math.min(n, officialNames.length);
    let updated = 0;

    for (let i = 0; i < available; i++) {
      const card = setData.k[i];
      const jaName = officialNames[i];
      if (!jaName) continue;
      if (!card[1] || !card[1].trim()) {
        if (!dryRun) {
          card[1] = jaName;
          const listCard = listIndex.get(setCode + "/" + card[0]);
          if (listCard) listCard.ja = jaName;
        }
        updated++;
      }
    }

    const extra = n > officialNames.length ? ` (API${officialNames.length}件 < cardData${n}件 → ${n - officialNames.length}件空のまま)` : "";
    console.log(` → ${updated}件更新${dryRun ? " [DRY-RUN]" : ""}${extra}`);
    totalUpdated += updated;

    await sleep(DELAY_MS);
  }

  if (!dryRun && totalUpdated > 0) {
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
    await fs.writeFile(CARD_LIST_PATH, JSON.stringify(cardList, null, 2), "utf-8");
    console.log(`\n更新完了: ${totalUpdated}件の日本語名を追加`);
  } else if (dryRun) {
    console.log(`\n[DRY-RUN] 合計 ${totalUpdated} 件が更新対象`);
  }
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
