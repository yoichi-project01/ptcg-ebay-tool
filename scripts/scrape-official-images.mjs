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
const DETAIL_CACHE_PATH = path.join(__dirname, "official-detail-cache.json");
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

// cardThumbFile のファイル名先頭6桁 ("042987_P_KOIKINGU.jpg") がそのまま cardID (42987)
function extractCardId(cardThumbFile) {
  const m = cardThumbFile.match(/\/(\d+)_/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// カード詳細ページから実際のカード番号 ("022"/"073" のうち "022") を取得
// 同じ日本語名で複数の印刷違い（AR/SAR等）がある場合の判別に使う
async function fetchCardLocalNumber(cardId) {
  const url = `${API_BASE}/card-search/details.php/card/${cardId}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const m = html.match(/img-regulation"[^>]*\/>\s*&nbsp;(\d+)&nbsp;/);
      return m ? m[1] : null;
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return null;
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

// 同じ日本語名で公式DBに複数候補があり、かつ cardData 側にも同名で複数 local がある場合、
// 詳細ページで実際のカード番号を調べて local ごとに正しい cardThumbFile を突き止める
async function resolveAmbiguousNames(officialCards, cardsInSet, detailCache, dirtyFlag) {
  const cacheByName = new Map();
  for (const c of officialCards) {
    if (!c.jaName) continue;
    if (!cacheByName.has(c.jaName)) cacheByName.set(c.jaName, []);
    cacheByName.get(c.jaName).push(c);
  }
  const localsByName = new Map();
  for (const k of cardsInSet) {
    if (!k[1]) continue;
    if (!localsByName.has(k[1])) localsByName.set(k[1], []);
    localsByName.get(k[1]).push(k[0]);
  }

  // 判別が必要な (name, candidates) のリストを作る
  const jobs = [];
  for (const [name, locals] of localsByName) {
    if (locals.length <= 1) continue;
    const candidates = cacheByName.get(name);
    if (!candidates || candidates.length <= 1) continue;
    jobs.push([name, candidates]);
  }

  const ambiguousMap = new Map(); // jaName -> Map<numericLocal, cardThumbFile>
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < jobs.length) {
      const [name, candidates] = jobs[idx++];
      const localMap = new Map();
      for (const c of candidates) {
        const cardId = extractCardId(c.cardThumbFile);
        if (!cardId) continue;
        let localNumber = detailCache[cardId];
        if (localNumber === undefined) {
          localNumber = await fetchCardLocalNumber(cardId);
          detailCache[cardId] = localNumber;
          dirtyFlag.value = true;
          await sleep(DELAY_MS);
        }
        if (localNumber) localMap.set(parseInt(localNumber, 10), c.cardThumbFile);
      }
      ambiguousMap.set(name, localMap);
    }
  });
  await Promise.all(workers);
  return ambiguousMap;
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

  let detailCache = {};
  if (await exists(DETAIL_CACHE_PATH)) {
    detailCache = JSON.parse(await fs.readFile(DETAIL_CACHE_PATH, "utf-8"));
  }
  const dirtyFlag = { value: false };

  const targetSets = onlySet ? [cardData.find(s => s.c === onlySet)].filter(Boolean) : cardData;

  const results = { downloaded: 0, skipped: 0, noJaName: 0, noMatch: 0, failed: 0, sets: {} };

  for (const setData of targetSets) {
    const setCode = setData.c;
    const officialCards = setMap[setCode];

    if (!officialCards || officialCards.length === 0) {
      console.log(`[${setCode}] 公式DBに画像なし → スキップ`);
      continue;
    }

    // 日本語名 → cardThumbFile のマップ（候補が1つだけの名前用の高速パス）
    const nameMap = new Map();
    for (const c of officialCards) {
      if (c.jaName && !nameMap.has(c.jaName)) nameMap.set(c.jaName, c.cardThumbFile);
    }

    // 同名で複数印刷（AR/SAR等）がある名前は詳細ページでカード番号を突き合わせる
    const ambiguousMap = await resolveAmbiguousNames(officialCards, setData.k, detailCache, dirtyFlag);
    if (ambiguousMap.size > 0) {
      await fs.writeFile(DETAIL_CACHE_PATH, JSON.stringify(detailCache), "utf-8");
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

        const resolved = ambiguousMap.get(jaName);
        const cardThumbFile = resolved ? resolved.get(parseInt(localId, 10)) : nameMap.get(jaName);
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
