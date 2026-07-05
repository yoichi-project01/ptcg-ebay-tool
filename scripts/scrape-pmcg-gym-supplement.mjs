#!/usr/bin/env node
/**
 * PMCG5/6 ジムセット補完スクレーパー
 *
 * cardData の jaName にジムリーダー接頭辞がない場合（例: "ナゾノクサ"）、
 * pcg-search キャッシュのサイト名から接頭辞を除去してベース名で照合する。
 *
 * 通常の normalizeJaName マッチで取得済みのカードはスキップする。
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
const CACHE_DIR = path.join(__dirname, "pcg-search-cache");

const BASE_URL = "https://pcg-search.com";
const TIMEOUT_MS = 20000;
const DELAY_MS = 400;

const GYM_SETS = {
  PMCG5: { imgDir: "1st", imgPrefix: "1stgym1", cacheFile: "1stgym1-namemap.json" },
  PMCG6: { imgDir: "1st", imgPrefix: "1stgym2", cacheFile: "1stgym2-namemap.json" },
};

// サイト名に現れるすべてのジムリーダー接頭辞
const SITE_PREFIXES = [
  "タケシの", "カスミの", "マチスの", "エリカの",
  "キョウの", "サカキの", "カツラの", "ナツメの",
  "r団の",
];

// cardDataのjaNameを正規化してサイト名と照合できるようにする
const LEADER_NAME_MAP = new Map([
  ["ブロック", "タケシ"], ["ミスティ", "カスミ"], ["マチス", "マチス"],
  ["エリカ", "エリカ"], ["コガ", "キョウ"], ["キョウ", "キョウ"],
  ["ジョバンニ", "サカキ"], ["ジョヴァンニ", "サカキ"], ["ブレイン", "カツラ"], ["サブリナ", "ナツメ"],
]);

function normalize(name) {
  if (!name) return "";
  let n = name;
  for (const [from, to] of LEADER_NAME_MAP) {
    if (n.startsWith(from + "の")) { n = to + "の" + n.slice(from.length + 1); break; }
  }
  return n.replace(/\s+/g, "").toLowerCase();
}

function stripSitePrefix(normalizedSiteName) {
  for (const pfx of SITE_PREFIXES) {
    if (normalizedSiteName.startsWith(pfx.toLowerCase())) {
      return normalizedSiteName.slice(pfx.length);
    }
  }
  return normalizedSiteName;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ptcg-ebay-tool/1.0",
            "Referer": BASE_URL + "/",
          },
        });
        if (r.status === 404) return null;
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 500) { clearTimeout(timer); return buf; }
        }
      } catch {}
      await sleep(500 * (i + 1));
    }
  } finally { clearTimeout(timer); }
  return null;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const cardList = JSON.parse(await fs.readFile(LIST_PATH, "utf-8"));

  const jaNameMap = new Map();
  const rarityMap = new Map();
  for (const set of cardData) {
    const jm = new Map();
    const rm = new Map();
    for (const k of set.k) {
      if (k[1] && k[1].trim()) jm.set(k[0], k[1].trim());
      rm.set(k[0], k[3] || "");
    }
    jaNameMap.set(set.c, jm);
    rarityMap.set(set.c, rm);
  }

  for (const [setCode, conf] of Object.entries(GYM_SETS)) {
    const setData = cardData.find(s => s.c === setCode);
    if (!setData) { console.log(`[${setCode}] cardData なし → スキップ`); continue; }

    const cacheFile = path.join(CACHE_DIR, conf.cacheFile);
    let cacheEntries;
    try {
      cacheEntries = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    } catch {
      console.log(`[${setCode}] キャッシュなし → スキップ (先に scrape-pcg-search.mjs を実行してください)`);
      continue;
    }

    // nameMap: normalizedSiteName → siteNum
    const nameMap = new Map(cacheEntries);
    // baseToSite: strippedBase → [{siteNum, normalName}]
    const baseToSite = new Map();
    for (const [normalName, siteNum] of nameMap) {
      const base = stripSitePrefix(normalName);
      if (!baseToSite.has(base)) baseToSite.set(base, []);
      baseToSite.get(base).push({ siteNum, normalName });
    }

    const setJaMap = jaNameMap.get(setCode) || new Map();
    const setRarityMap = rarityMap.get(setCode) || new Map();
    const setTotal = computeSetTotal(setData.k);
    const jaCards = cardList.filter(c => c.set === setCode);

    console.log(`\n[${setCode}] ベース名マッチングで補完中... (${jaCards.length}件)`);
    let downloaded = 0, skipped = 0, noMatch = 0, failed = 0;

    for (const card of jaCards) {
      const serie = card.serie;
      const jaName = setJaMap.get(card.local) || "";
      const rarity = setRarityMap.get(card.local) || "";
      const destBase = path.join(OUT_DIR, serie, setCode, buildFileName(jaName || card.local, setCode, card.local, rarity, setTotal));

      // 既存画像があればスキップ
      if (await exists(destBase + ".jpg") || await exists(destBase + ".png")) {
        skipped++;
        continue;
      }

      if (!jaName) { noMatch++; continue; }

      const normalizedJa = normalize(jaName);

      // 1. 通常マッチ
      let siteNum = nameMap.get(normalizedJa);

      // 2. ベース名マッチ（接頭辞なし）
      if (!siteNum) {
        const candidates = baseToSite.get(normalizedJa);
        if (candidates && candidates.length === 1) {
          siteNum = candidates[0].siteNum;
        }
      }

      if (!siteNum) { noMatch++; continue; }

      const imgUrl = `${BASE_URL}/img/${conf.imgDir}/${conf.imgPrefix}${siteNum}.png`;
      const buf = await downloadImage(imgUrl);

      if (buf) {
        const dest = destBase + ".png";
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, buf);
        downloaded++;
        process.stdout.write(`  取得: ${card.local} (${jaName} → site ${siteNum})\n`);
      } else {
        failed++;
      }

      await sleep(DELAY_MS);
    }

    console.log(`[${setCode}] 取得:${downloaded} スキップ:${skipped} 不一致:${noMatch} 失敗:${failed}`);
  }

  console.log("\n=== 完了 ===");
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
