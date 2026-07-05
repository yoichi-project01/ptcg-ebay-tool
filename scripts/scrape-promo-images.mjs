#!/usr/bin/env node
/**
 * S-P / SV-P プロモカードの画像を公式キャッシュから位置マッチングでダウンロード
 *
 * プロモセットは pg フィルターで全件取得できないため、
 * 公式キャッシュの製品番号順（リリース順）で位置マッチングを行います。
 *
 * 使い方:
 *   node scripts/scrape-promo-images.mjs
 *   node scripts/scrape-promo-images.mjs --set S-P
 *   node scripts/scrape-promo-images.mjs --dry-run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CARD_LIST_PATH = path.join(__dirname, "card-list.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");

const API_BASE = "https://www.pokemon-card.com";
const CONCURRENCY = 4;
const DELAY_MS = 300;

const args = process.argv.slice(2);
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
const dryRun = args.includes("--dry-run");

// プロモセットの一覧
const PROMO_SETS = ["S-P", "SV-P"];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function downloadImage(cardThumbFile) {
  const url = `${API_BASE}${cardThumbFile}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Referer": API_BASE + "/",
        },
      });
      if (r.status === 404) return null;
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
    } catch {}
    await sleep(500 * (i + 1));
  }
  return null;
}

function extractNum(cardThumbFile) {
  const m = cardThumbFile?.match(/\/(\d+)_/);
  return m ? parseInt(m[1]) : 0;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const cardList = JSON.parse(await fs.readFile(CARD_LIST_PATH, "utf-8"));
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));

  const listIndex = new Map();
  for (const c of cardList) listIndex.set(c.set + "/" + c.local, c);

  const targetSetCodes = onlySet ? [onlySet] : PROMO_SETS;
  const results = { downloaded: 0, skipped: 0, failed: 0, namesAdded: 0 };

  for (const setCode of targetSetCodes) {
    const setData = cardData.find(s => s.c === setCode);
    const officialCards = cache.setMap[setCode];

    if (!setData) { console.log(`[${setCode}] cardData なし → スキップ`); continue; }
    if (!officialCards || officialCards.length === 0) {
      console.log(`[${setCode}] 公式キャッシュなし → スキップ`);
      continue;
    }

    // 製品番号順にソート
    const sorted = officialCards
      .map(c => ({ num: extractNum(c.cardThumbFile), jaName: c.jaName, cardThumbFile: c.cardThumbFile }))
      .sort((a, b) => a.num - b.num);

    const n = setData.k.length;
    const available = Math.min(n, sorted.length);

    console.log(`[${setCode}] ${available}/${n}件を処理 (公式DB=${sorted.length}件)`);
    if (dryRun) continue;

    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < available) {
        const i = idx++;
        const card = setData.k[i];
        const official = sorted[i];
        if (!card || !official) continue;

        const [localId] = card;
        const dest = path.join(OUT_DIR, setData.sr, setCode, `${localId}.jpg`);
        const destWebp = dest.replace(/\.jpg$/, ".webp");

        if (await exists(dest) || await exists(destWebp)) {
          results.skipped++;
          continue;
        }

        const buf = await downloadImage(official.cardThumbFile);
        if (buf) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, buf);
          results.downloaded++;
          // 日本語名も更新
          if (!card[1] || !card[1].trim()) {
            card[1] = official.jaName;
            const listCard = listIndex.get(setCode + "/" + localId);
            if (listCard) listCard.ja = official.jaName;
            results.namesAdded++;
          }
        } else {
          results.failed++;
        }
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    console.log(`  完了: 取得=${results.downloaded} スキップ=${results.skipped} 失敗=${results.failed}`);
  }

  if (!dryRun) {
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
    await fs.writeFile(CARD_LIST_PATH, JSON.stringify(cardList, null, 2), "utf-8");
    console.log(`\n完了: 画像取得=${results.downloaded}, 日本語名追加=${results.namesAdded}`);
  } else {
    console.log("[DRY-RUN] 変更なし");
  }
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
