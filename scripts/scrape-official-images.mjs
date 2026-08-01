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
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";

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

const CONCURRENCY = 3;
const DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 15000;
// 失敗ページがこの件数を超えたら、公式DBキャッシュを保存せず異常終了する
// （不完全なキャッシュで「公式DBに無い」と誤判定するのを防ぐため）
const MAX_FAILED_PAGES = 5;

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

// 公式APIの cardNameViewText はHTMLエスケープ済みで返るためデコードする
// (例: "グズマ&amp;ハラ" -> "グズマ&ハラ")
function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchPage(page) {
  const url = `${API_URL}?regulation_sidebar_form=all&page=${page}&sortBy=new`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
      const r = await fetch(url, {
        headers: { "User-Agent": HEADERS["User-Agent"], "Referer": API_BASE + "/" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// 末尾の説明的な括弧（例: "博士の研究（ナナカマド博士）" → "博士の研究"）を除いた照合用の名前
// 公式DB側は同じトレーナーカードでもキャラクター注記なしで1本化されていることが多いため
function matchName(jaName) {
  return jaName.replace(/[（(][^）)]*[）)]\s*$/, "").trim();
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
      const r = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
        jaName: decodeHtmlEntities(c.cardNameViewText),
        cardThumbFile: c.cardThumbFile,
      });
    }
  };

  addCards(first.cardList);

  const failedPages = [];
  for (let page = 2; page <= maxPage; page++) {
    if (page % 50 === 0) process.stdout.write(`\r  ${page}/${maxPage} ページ完了`);
    const data = await fetchPage(page);
    if (data?.cardList) addCards(data.cardList);
    else failedPages.push(page);
    await sleep(DELAY_MS);
  }
  process.stdout.write(`\r  ${maxPage}/${maxPage} ページ完了\n`);

  if (failedPages.length > 0) {
    console.warn(`\n警告: ${failedPages.length}ページの取得に失敗しました: [${failedPages.join(", ")}]`);
  }
  if (failedPages.length > MAX_FAILED_PAGES) {
    throw new Error(
      `失敗ページ数 (${failedPages.length}) が上限 (${MAX_FAILED_PAGES}) を超えたため、` +
      `不完全なキャッシュを保存せず中断します。ネットワーク状況を確認し、--rescan で再試行してください。`
    );
  }

  console.log(`セットコード数: ${Object.keys(setMap).length}`);
  await fs.writeFile(CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), failedPages, setMap }, null, 2), "utf-8");
  return setMap;
}

// 同じ日本語名で公式DBに複数候補があり、かつ cardData 側にも同名で複数 local がある場合、
// 詳細ページで実際のカード番号を調べて local ごとに正しい cardThumbFile を突き止める
async function resolveAmbiguousNames(cacheByName, cardsInSet, detailCache, dirtyFlag) {
  const localsByName = new Map();
  for (const k of cardsInSet) {
    if (!k[1]) continue;
    if (!localsByName.has(k[1])) localsByName.set(k[1], []);
    localsByName.get(k[1]).push(k[0]);
  }

  // 判別が必要な (name, candidates) のリストを作る
  const jobs = [];
  const orderPaired = []; // 候補数と local 数が一致する場合は詳細ページを見ずに順序で対応付ける
  for (const [name, locals] of localsByName) {
    if (locals.length <= 1) continue;
    // 公式DB側はキャラクター注記なしの名前で1本化されていることがあるためフォールバックする
    const candidates = cacheByName.get(name) || cacheByName.get(matchName(name));
    if (!candidates || candidates.length <= 1) continue;
    if (locals.length === candidates.length) {
      orderPaired.push([name, locals, candidates]);
    } else {
      jobs.push([name, candidates]);
    }
  }

  const ambiguousMap = new Map(); // jaName -> Map<numericLocal, cardThumbFile>

  // 件数が一致する組は local 番号順・掲載順で1:1対応付け。
  // 印刷違い(パラレル等)を厳密には判別できないが、写真が全く無いよりはよい。
  for (const [name, locals, candidates] of orderPaired) {
    const sortedLocals = [...locals].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const sortedCandidates = [...candidates].sort(
      (a, b) => (parseInt(extractCardId(a.cardThumbFile), 10) || 0) - (parseInt(extractCardId(b.cardThumbFile), 10) || 0)
    );
    const localMap = new Map();
    sortedLocals.forEach((local, i) => localMap.set(parseInt(local, 10), sortedCandidates[i].cardThumbFile));
    ambiguousMap.set(name, localMap);
  }

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
          // 失敗(null)はキャッシュしない。一時的な通信エラーが恒久的な欠損に化けるのを防ぐ
          if (localNumber) {
            detailCache[cardId] = localNumber;
            dirtyFlag.value = true;
          }
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
    // 日本語名 → 候補一覧（曖昧判定・括弧注記フォールバック用）
    const cacheByName = new Map();
    for (const c of officialCards) {
      if (!c.jaName) continue;
      if (!nameMap.has(c.jaName)) nameMap.set(c.jaName, c.cardThumbFile);
      if (!cacheByName.has(c.jaName)) cacheByName.set(c.jaName, []);
      cacheByName.get(c.jaName).push(c);
    }

    // 同名で複数印刷（AR/SAR等）がある名前は詳細ページでカード番号を突き合わせる
    const ambiguousMap = await resolveAmbiguousNames(cacheByName, setData.k, detailCache, dirtyFlag);
    if (dirtyFlag.value) {
      await fs.writeFile(DETAIL_CACHE_PATH, JSON.stringify(detailCache), "utf-8");
      dirtyFlag.value = false;
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

        // .jpg が存在すればスキップ
        if (await isUsableImage(dest)) { setResult.skipped++; results.skipped++; continue; }

        const resolved = ambiguousMap.get(jaName);
        let cardThumbFile = resolved ? resolved.get(parseInt(localId, 10)) : nameMap.get(jaName);
        // 末尾の括弧注記(例:「（ナナカマド博士）」)違いでの不一致は、
        // 括弧なし名の公式候補が1件だけなら安全に採用する
        if (!cardThumbFile) {
          const stripped = matchName(jaName);
          if (stripped !== jaName) {
            const strippedCandidates = cacheByName.get(stripped);
            if (strippedCandidates && strippedCandidates.length === 1) {
              cardThumbFile = strippedCandidates[0].cardThumbFile;
            }
          }
        }
        if (!cardThumbFile) { setResult.noMatch++; results.noMatch++; continue; }

        const buf = await downloadImage(cardThumbFile, dest);
        if (buf) {
          await writeFileAtomic(dest, buf);
          setResult.downloaded++;
          results.downloaded++;
        } else {
          setResult.failed++;
          results.failed++;
        }
        await sleep(DELAY_MS);
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
