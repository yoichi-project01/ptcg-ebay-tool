#!/usr/bin/env node
/**
 * ポケモンカード公式サイト（pokemon-card.com）から日本語カード画像を取得
 *
 * 公式サイトの resultAPI.php を利用してすべての日本語カード画像を取得します。
 * TCGdex CDN では取得できない旧世代セット（PMCG/neo/e/PCG/M/VS/web など）もカバーします。
 *
 * 使い方:
 *   node scripts/scrape-official-images.mjs           # 全セット
 *   node scripts/scrape-official-images.mjs --set M1L # 特定セットのみ
 *   node scripts/scrape-official-images.mjs --rescan  # 公式DBを再スキャン
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");
const REPORT_PATH = path.join(__dirname, "scrape-official-report.json");

const API_BASE = "https://www.pokemon-card.com";
const API_URL = `${API_BASE}/card-search/resultAPI.php`;
const IMG_BASE = `${API_BASE}/assets/images/card_images/large`;

const CONCURRENCY = 6;
const DELAY_MS = 250;

const args = process.argv.slice(2);
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
const forceRescan = args.includes("--rescan");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://www.pokemon-card.com/card-search/index.php/",
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(page) {
  const url = `${API_URL}?regulation_sidebar_form=all&page=${page}&sortBy=new`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } catch (e) {
      if (i < 2) await sleep(1000 * (i + 1));
    }
  }
  return null;
}

async function downloadImage(cardThumbFile, destPath) {
  const url = `${API_BASE}${cardThumbFile}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"], "Referer": API_BASE + "/" } });
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

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// 公式DBをスキャンしてsetCode→[{jaName, cardThumbFile}]のマップを作成
async function buildOfficialCache() {
  console.log("公式サイトをスキャン中...");
  const first = await fetchPage(1);
  if (!first) throw new Error("APIに接続できません");

  const maxPage = first.maxPage;
  console.log(`総カード数: ${first.hitCnt}, ページ数: ${maxPage}`);

  const setMap = {};

  const addCards = (cardList) => {
    for (const c of cardList) {
      const m = c.cardThumbFile?.match(/large\/([^\/]+)\//);
      if (!m) continue;
      const setCode = m[1];
      if (!setMap[setCode]) setMap[setCode] = [];
      setMap[setCode].push({
        jaName: c.cardNameViewText,
        cardThumbFile: c.cardThumbFile,
      });
    }
  };

  addCards(first.cardList);

  for (let page = 2; page <= maxPage; page++) {
    if (page % 50 === 0) process.stdout.write(`\r  ${page}/${maxPage} ページ完了`);
    const data = await fetchPage(page);
    if (data?.cardList) addCards(data.cardList);
    await sleep(DELAY_MS);
  }
  process.stdout.write(`\r  ${maxPage}/${maxPage} ページ完了\n`);

  console.log(`セットコード数: ${Object.keys(setMap).length}`);
  await fs.writeFile(CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), setMap }, null, 2), "utf-8");
  return setMap;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));

  // 公式DBキャッシュを読む or スキャン
  let setMap;
  if (!forceRescan && await exists(CACHE_PATH)) {
    const raw = await fs.readFile(CACHE_PATH, "utf-8");
    const cached = JSON.parse(raw);
    setMap = cached.setMap;
    console.log(`キャッシュから読み込み: ${Object.keys(setMap).length} セット`);
  } else {
    setMap = await buildOfficialCache();
  }

  const targetSets = onlySet ? [cardData.find(s => s.c === onlySet)].filter(Boolean) : cardData;

  const results = { downloaded: 0, skipped: 0, noJaName: 0, noMatch: 0, failed: 0, sets: {} };

  for (const setData of targetSets) {
    const setCode = setData.c;
    const officialCards = setMap[setCode];

    if (!officialCards || officialCards.length === 0) {
      console.log(`[${setCode}] 公式DBに画像なし → スキップ`);
      continue;
    }

    // 日本語名 → cardThumbFile のマップ
    const nameMap = new Map();
    for (const c of officialCards) {
      if (c.jaName && !nameMap.has(c.jaName)) nameMap.set(c.jaName, c.cardThumbFile);
    }

    const cards = setData.k;
    const setTotal = computeSetTotal(cards);
    const setResult = { downloaded: 0, skipped: 0, noJaName: 0, noMatch: 0, failed: 0 };

    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < cards.length) {
        const card = cards[idx++];
        if (!card) continue;
        const [localId, jaName, , rarity] = card;

        if (!jaName) { setResult.noJaName++; results.noJaName++; continue; }

        const dest = path.join(OUT_DIR, setData.sr, setCode, buildFileName(jaName, setCode, localId, rarity, setTotal) + ".jpg");

        // .jpg が存在すればスキップ（.webpは英語プロキシなのでスキップしない）
        if (await exists(dest)) { setResult.skipped++; results.skipped++; continue; }

        const cardThumbFile = nameMap.get(jaName);
        if (!cardThumbFile) { setResult.noMatch++; results.noMatch++; continue; }

        const buf = await downloadImage(cardThumbFile, dest);
        if (buf) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, buf);
          setResult.downloaded++;
          results.downloaded++;
        } else {
          setResult.failed++;
          results.failed++;
        }
      }
    });
    await Promise.all(workers);

    results.sets[setCode] = setResult;
    console.log(`[${setCode}] 取得:${setResult.downloaded} スキップ:${setResult.skipped} 日本語名なし:${setResult.noJaName} 不一致:${setResult.noMatch} 失敗:${setResult.failed}`);
  }

  console.log("\n=== 完了 ===");
  console.log(`取得:${results.downloaded} スキップ:${results.skipped} 不一致:${results.noMatch} 失敗:${results.failed}`);
  await fs.writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...results }, null, 2), "utf-8");
  console.log("詳細: scripts/scrape-official-report.json");
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
