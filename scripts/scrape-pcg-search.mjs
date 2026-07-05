#!/usr/bin/env node
/**
 * pcg-search.com から旧世代日本語カード画像を取得
 *
 * 公式日本語画像を PNG 形式で保存します。
 * 対象: PMCG1-6, neo1-4, E1-E5, PCG1-9
 *
 * 使い方:
 *   node scripts/scrape-pcg-search.mjs          # 全対象セット
 *   node scripts/scrape-pcg-search.mjs --set neo1
 *   node scripts/scrape-pcg-search.mjs --dry-run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const LIST_PATH = path.join(__dirname, "card-list.json");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_DIR = path.join(__dirname, "pcg-search-cache");
const REPORT_PATH = path.join(__dirname, "scrape-pcg-search-report.json");

const BASE_URL = "https://pcg-search.com";
const CONCURRENCY = 3;
const TIMEOUT_MS = 20000;
const DELAY_MS = 400;

// セットコード → { imgDir, imgPrefix, nameMatch }
// nameMatch=true のセットはカード名→サイト番号の対応表が必要
const SET_MAP = {
  // 1st series (PMCG: 第1弾～ロケット団)
  PMCG1: { imgDir: "1st", imgPrefix: "1st1",    count: 102 },
  PMCG2: { imgDir: "1st", imgPrefix: "1st2",    count: 48  },
  PMCG3: { imgDir: "1st", imgPrefix: "1st3",    count: 48  },
  PMCG4: { imgDir: "1st", imgPrefix: "1st4",    count: 65  },
  // ジム拡張 — 印刷番号順(★先)なので名前マッチが必要
  PMCG5: { imgDir: "1st", imgPrefix: "1stgym1", count: 96,  nameMatch: true },
  PMCG6: { imgDir: "1st", imgPrefix: "1stgym2", count: 98,  nameMatch: true },
  // neo series
  neo1:  { imgDir: "neo", imgPrefix: "neo1",    count: 96  },
  neo2:  { imgDir: "neo", imgPrefix: "neo2",    count: 57  },
  neo3:  { imgDir: "neo", imgPrefix: "neo3",    count: 57  },
  neo4:  { imgDir: "neo", imgPrefix: "neo4",    count: 113 },
  // e series
  E1:    { imgDir: "e",   imgPrefix: "e1",      count: 128 },
  E2:    { imgDir: "e",   imgPrefix: "e2",      count: 92  },
  E3:    { imgDir: "e",   imgPrefix: "e3",      count: 90  },
  E4:    { imgDir: "e",   imgPrefix: "e4",      count: 91  },
  E5:    { imgDir: "e",   imgPrefix: "e5",      count: 91  },
  // PCG series (伝説の飛翔以降)
  PCG1:  { imgDir: "pcg", imgPrefix: "pcg1",   count: 82  },
  PCG2:  { imgDir: "pcg", imgPrefix: "pcg2",   count: 82  },
  PCG3:  { imgDir: "pcg", imgPrefix: "pcg3",   count: 85  },
  PCG4:  { imgDir: "pcg", imgPrefix: "pcg4",   count: 106 },
  PCG5:  { imgDir: "pcg", imgPrefix: "pcg5",   count: 86  },
  PCG6:  { imgDir: "pcg", imgPrefix: "pcg6",   count: 86  },
  PCG7:  { imgDir: "pcg", imgPrefix: "pcg7",   count: 52  },
  PCG8:  { imgDir: "pcg", imgPrefix: "pcg8",   count: 75  },
  PCG9:  { imgDir: "pcg", imgPrefix: "pcg9",   count: 68  },
  // VS series (4桁ゼロパディング: vs0001.png 等)
  VS1:   { imgDir: "vs",  imgPrefix: "vs",     count: 141, digits: 4 },
  // web series (4桁ゼロパディング: web0001.png 等)
  web1:  { imgDir: "web", imgPrefix: "web",    count: 48,  digits: 4 },
};

const args = process.argv.slice(2);
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
const dryRun  = args.includes("--dry-run");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ptcg-ebay-tool/1.0",
        "Referer": BASE_URL + "/",
        ...opts.headers,
      },
    });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function downloadImage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(url);
      if (r.status === 404) return null;
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 500) return buf;
      }
    } catch {}
    await sleep(500 * (i + 1));
  }
  return null;
}

// カードページ HTML からカード名を抽出
// ページタイトル形式: "{カード名} | ポケモンカード..."
async function fetchCardName(url) {
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return null;
    const html = await r.text();
    const titleMatch = html.match(/<title>([^|<]+)/i);
    if (titleMatch) return titleMatch[1].trim();
    const h1Match = html.match(/<h1[^>]*>([^<]+)/i);
    if (h1Match) return h1Match[1].trim();
  } catch {}
  return null;
}

// nameMatch セット用: カード番号 → 日本語名 の対応表を構築
async function buildNameMap(setConf) {
  const { imgDir, imgPrefix, count } = setConf;
  const cacheFile = path.join(CACHE_DIR, `${imgPrefix}-namemap.json`);

  // キャッシュがあれば使用
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    process.stdout.write(` [cache:${imgPrefix}]`);
    return new Map(cached); // [[jaName, siteNum], ...]
  } catch {}

  process.stdout.write(` [building name map for ${imgPrefix}...]`);
  const map = new Map(); // jaName (normalized) → site card number (3-digit string)

  for (let n = 1; n <= count; n++) {
    const num = String(n).padStart(3, "0");
    const pageUrl = `${BASE_URL}/card/${imgDir}/${imgPrefix}${num}.php`;
    const jaName = await fetchCardName(pageUrl);
    if (jaName) map.set(normalizeJaName(jaName), num);
    if (n % 10 === 0) process.stdout.write(` ${n}/${count}`);
    await sleep(DELAY_MS);
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify([...map]), "utf-8");
  return map;
}

// 英語音訳のジムリーダー名 → 本来の日本語名 (サイト側の表記に合わせる)
const LEADER_NAME_MAP = new Map([
  ["ブロック",     "タケシ"],  // Brock
  ["ミスティ",     "カスミ"],  // Misty
  ["マチス",       "マチス"],  // Lt. Surge (同じ)
  ["エリカ",       "エリカ"],  // Erika (同じ)
  ["コガ",         "キョウ"],  // Koga
  ["キョウ",       "キョウ"],  // Koga (すでに正しい)
  ["ジョバンニ",   "サカキ"],  // Giovanni
  ["ジョヴァンニ", "サカキ"],  // Giovanni (別表記)
  ["ブレイン",     "カツラ"],  // Blaine
  ["サブリナ",     "ナツメ"],  // Sabrina
]);

// 日本語カード名をサイト表記に正規化
// "ブロックのズバット" → "タケシのズバット"
function normalizeJaName(name) {
  if (!name) return "";
  let normalized = name;
  for (const [from, to] of LEADER_NAME_MAP) {
    if (normalized.startsWith(from + "の")) {
      normalized = to + "の" + normalized.slice(from.length + 1);
      break;
    }
  }
  return normalized.replace(/\s+/g, "").toLowerCase();
}

async function main() {
  const cardList = JSON.parse(await fs.readFile(LIST_PATH, "utf-8"));
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  await fs.mkdir(CACHE_DIR, { recursive: true });

  // cardData: setId → (localId → jaName)
  const jaNameMap = new Map();
  for (const set of cardData) {
    const m = new Map();
    for (const k of set.k) {
      if (k[1] && k[1].trim()) m.set(k[0], k[1].trim());
    }
    jaNameMap.set(set.c, m);
  }

  const targetSets = onlySet
    ? [onlySet].filter(s => SET_MAP[s])
    : Object.keys(SET_MAP);

  if (targetSets.length === 0) {
    console.log("対象セットが見つかりません");
    process.exit(1);
  }

  console.log(`対象セット: ${targetSets.join(", ")}`);

  const results = { downloaded: 0, skipped: 0, noJaName: 0, noMatch: 0, failed: 0, sets: {} };

  for (const setCode of targetSets) {
    const conf = SET_MAP[setCode];
    const setData = cardData.find(s => s.c === setCode);
    if (!setData) { console.log(`\n[${setCode}] cardData なし → スキップ`); continue; }

    const jaCards = cardList.filter(c => c.set === setCode);
    const setJaMap = jaNameMap.get(setCode) || new Map();
    const setResult = { downloaded: 0, skipped: 0, noJaName: 0, noMatch: 0, failed: 0 };

    process.stdout.write(`\n[${setCode}]`);

    // nameMatch セット: カード名 → サイト番号 の対応表
    let nameMap = null;
    if (conf.nameMatch) {
      nameMap = await buildNameMap(conf);
      console.log(` → ${nameMap.size}件の名前対応を構築`);
    } else {
      console.log(` 直接URLで取得`);
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] スキップ`);
      continue;
    }

    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < jaCards.length) {
        const card = jaCards[idx++];
        if (!card) continue;

        const serie = card.serie;
        const destBase = path.join(OUT_DIR, serie, setCode, card.local);
        // 既存の日本語画像（.jpg, .png）があればスキップ（.webpは英語プロキシなのでスキップしない）
        if (await exists(destBase + ".jpg") ||
            await exists(destBase + ".png")) {
          setResult.skipped++; results.skipped++;
          continue;
        }

        let siteNum;
        if (conf.nameMatch) {
          // 名前ベース: jaName → サイト番号
          const jaName = setJaMap.get(card.local);
          if (!jaName) { setResult.noJaName++; results.noJaName++; continue; }
          siteNum = nameMap.get(normalizeJaName(jaName));
          if (!siteNum) { setResult.noMatch++; results.noMatch++; continue; }
        } else {
          // 直接: localId → サイト番号 (digits桁ゼロ埋め、デフォルト3桁)
          const digits = conf.digits || 3;
          siteNum = card.local.padStart(digits, "0");
        }

        const imgUrl = `${BASE_URL}/img/${conf.imgDir}/${conf.imgPrefix}${siteNum}.png`;
        const buf = await downloadImage(imgUrl);

        if (buf) {
          const dest = destBase + ".png";
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, buf);
          setResult.downloaded++; results.downloaded++;
        } else {
          setResult.failed++; results.failed++;
        }

        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    results.sets[setCode] = setResult;
    const total = jaCards.length;
    console.log(`  取得:${setResult.downloaded} スキップ:${setResult.skipped} 日本語名なし:${setResult.noJaName} 不一致:${setResult.noMatch} 失敗:${setResult.failed} / ${total}件`);
  }

  console.log("\n=== 完了 ===");
  console.log(`取得:${results.downloaded} スキップ:${results.skipped} 日本語名なし:${results.noJaName} 不一致:${results.noMatch} 失敗:${results.failed}`);
  await fs.writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...results }, null, 2), "utf-8");
  console.log("詳細: scripts/scrape-pcg-search-report.json");
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
