#!/usr/bin/env node
/**
 * TCGdex API から各セットの releaseDate を取得し、cardData.json に
 * y（発売年, 例: 2023）フィールドとして追加する。
 *
 * 使い方: node scripts/fetch-set-years.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

const CONCURRENCY = 3;
const DELAY_MS = 300;

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchReleaseYear(setCode) {
  const url = `https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(setCode)}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const data = await r.json();
      const m = data.releaseDate?.match(/^(\d{4})-/);
      return m ? parseInt(m[1], 10) : null;
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  let idx = 0;
  const notFound = [];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < cardData.length) {
      const setData = cardData[idx++];
      const year = await fetchReleaseYear(setData.c);
      if (year) {
        setData.y = year;
        console.log(`[${setData.c}] ${year}`);
      } else {
        notFound.push(setData.c);
        console.log(`[${setData.c}] 取得失敗`);
      }
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(workers);

  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
  console.log(`\n完了: ${cardData.length - notFound.length}/${cardData.length} セットに発売年を追加`);
  if (notFound.length) {
    console.log(`取得失敗: ${notFound.join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
