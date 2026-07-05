#!/usr/bin/env node
/**
 * S/SV セット未取得カードの補完スクレーパー
 *
 * 公式キャッシュにある画像なのに名前マッチに失敗した2つのケースを処理:
 *
 * A) 括弧付き名前: "博士の研究（ナナカマド博士）" がキャッシュでは "博士の研究" で登録済み
 * B) 複数バージョン: 同一名が複数存在する場合、ファイル番号順→localId昇順で対応付け
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const LIST_PATH = path.join(__dirname, "card-list.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");

const API_BASE = "https://www.pokemon-card.com";
const CONCURRENCY = 4;
const DELAY_MS = 200;
const TIMEOUT_MS = 15000;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function downloadImage(cardThumbFile, destPath) {
  const url = API_BASE + cardThumbFile;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { signal: ctrl.signal, headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.pokemon-card.com/",
        }});
        clearTimeout(t);
        if (r.status === 404) return false;
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 1000) {
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.writeFile(destPath, buf);
            return true;
          }
        }
        await sleep(500 * (i + 1));
      } catch (e) {
        if (i === 2) throw e;
        await sleep(500 * (i + 1));
      }
    }
  } finally { clearTimeout(t); }
  return false;
}

// カード名から括弧部分を除去: "博士の研究（ナナカマド博士）" → "博士の研究"
function stripParens(name) {
  return name.replace(/（[^）]+）$/, "").trim();
}

// cardThumbFile のファイル番号を抽出 (例: "042420_T_HAKASE..." → 42420)
function fileNum(cardThumbFile) {
  const m = cardThumbFile.match(/(\d+)_/);
  return m ? parseInt(m[1], 10) : 0;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const cardList = JSON.parse(await fs.readFile(LIST_PATH, "utf-8"));
  const { setMap } = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));

  // cardData: setCode → localId → jaName / rarity
  const jaMap = new Map();
  const rarityMap = new Map();
  for (const sd of cardData) {
    const jm = new Map();
    const rm = new Map();
    for (const [local, jaName, , rarity] of sd.k) {
      jm.set(local, jaName);
      rm.set(local, rarity || "");
    }
    jaMap.set(sd.c, jm);
    rarityMap.set(sd.c, rm);
  }

  // imageIndex to check existing images
  const imgIdx = JSON.parse(await fs.readFile(path.join(ROOT, "src", "imageIndex.json"), "utf-8"));

  let totalDl = 0, totalFail = 0, totalSkip = 0;

  for (const sd of cardData) {
    const setCode = sd.c;
    const serie = sd.sr;
    const setTotal = computeSetTotal(sd.k);
    const officialCards = setMap[setCode];
    if (!officialCards || officialCards.length === 0) continue;

    // Find cards in this set that are still missing
    const setCards = cardList.filter(c => c.set === setCode);
    const missingCards = setCards.filter(c => !imgIdx[`${setCode}/${c.local}`]);
    if (missingCards.length === 0) continue;

    // Build: strippedName → sorted [{cardThumbFile, jaName}]
    const strippedMap = new Map();
    for (const c of officialCards) {
      if (!c.jaName) continue;
      const stripped = stripParens(c.jaName);
      if (!strippedMap.has(stripped)) strippedMap.set(stripped, []);
      strippedMap.get(stripped).push(c);
    }
    // Sort each by file number
    for (const arr of strippedMap.values()) {
      arr.sort((a, b) => fileNum(a.cardThumbFile) - fileNum(b.cardThumbFile));
    }

    // Build: exact name → sorted [{cardThumbFile}] (for duplicate detection)
    const exactMap = new Map();
    for (const c of officialCards) {
      if (!c.jaName) continue;
      if (!exactMap.has(c.jaName)) exactMap.set(c.jaName, []);
      exactMap.get(c.jaName).push(c);
    }
    for (const arr of exactMap.values()) {
      arr.sort((a, b) => fileNum(a.cardThumbFile) - fileNum(b.cardThumbFile));
    }

    // Track which entries have been used (for duplicate assignment)
    const usedEntries = new Set();
    // Mark entries already used by cards that were already downloaded
    const downloadedCards = setCards.filter(c => imgIdx[`${setCode}/${c.local}`]);
    for (const c of downloadedCards) {
      const jaName = jaMap.get(setCode)?.get(c.local) || "";
      const exact = exactMap.get(jaName) || [];
      const stripped = stripParens(jaName);
      const strippedArr = strippedMap.get(stripped) || [];
      // Mark the first unused entry as used
      for (const entry of [...exact, ...strippedArr]) {
        const key = entry.cardThumbFile;
        if (!usedEntries.has(key)) { usedEntries.add(key); break; }
      }
    }

    const setResult = { dl: 0, fail: 0, skip: 0 };
    let hasWork = false;

    // Process missing cards in localId order
    const sortedMissing = missingCards.sort((a, b) => {
      const na = parseInt(a.local) || 0;
      const nb = parseInt(b.local) || 0;
      return na - nb;
    });

    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < sortedMissing.length) {
        const card = sortedMissing[idx++];
        const jaName = jaMap.get(setCode)?.get(card.local) || "";
        const rarity = rarityMap.get(setCode)?.get(card.local) || "";
        const dest = path.join(OUT_DIR, serie, setCode, buildFileName(jaName || card.local, setCode, card.local, rarity, setTotal) + ".jpg");

        if (await exists(dest)) { setResult.skip++; totalSkip++; continue; }

        // Try exact name first, then stripped
        const stripped = stripParens(jaName);
        let candidates = [];
        if (jaName && exactMap.has(jaName)) candidates = exactMap.get(jaName);
        else if (stripped && strippedMap.has(stripped)) candidates = strippedMap.get(stripped);

        if (candidates.length === 0) continue;

        // Find first unused candidate
        let chosen = null;
        for (const entry of candidates) {
          if (!usedEntries.has(entry.cardThumbFile)) {
            chosen = entry;
            usedEntries.add(entry.cardThumbFile);
            break;
          }
        }
        // Fallback: reuse last candidate if all used
        if (!chosen) chosen = candidates[candidates.length - 1];

        hasWork = true;
        const ok = await downloadImage(chosen.cardThumbFile, dest);
        if (ok) { setResult.dl++; totalDl++; }
        else { setResult.fail++; totalFail++; }
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    if (hasWork || setResult.dl > 0) {
      console.log(`[${setCode}] 取得:${setResult.dl} 失敗:${setResult.fail} スキップ:${setResult.skip}`);
    }
  }

  console.log(`\n完了: 取得${totalDl} 失敗${totalFail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
