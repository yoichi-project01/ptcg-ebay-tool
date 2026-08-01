#!/usr/bin/env node
/**
 * !!! DEPRECATED — 実行しないこと !!!
 * 英語版アートワークを取得するスクリプト。日本語カードの出品に英語アートワークを
 * 使うのは実物と異なり不適切なため使用禁止（CLAUDE.md参照）。npm run images には未組み込み。参考保存のみ。
 *
 * 旧世代カード画像スクレイパー（英語TCGdex CDN経由）
 *
 * 日本語旧セット(PMCG/neo/e系)の英語対応セットから画像を取得します。
 * cardData.json の英語名をキーに英語TCGdexのカードを探し、
 * 同一アートワークの英語版画像を日本語カードのパスに保存します。
 *
 * 使い方:
 *   node scripts/scrape-old-images.mjs           # 全対象セット
 *   node scripts/scrape-old-images.mjs --set neo1 # 特定セットだけ
 *   node scripts/scrape-old-images.mjs --refresh  # APIキャッシュを再取得
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const LIST_PATH = path.join(__dirname, "card-list.json");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_DIR = path.join(__dirname, "en-card-cache");
const REPORT_PATH = path.join(__dirname, "scrape-old-report.json");

const QUALITY = "high";
const CONCURRENCY = 4;
const TIMEOUT_MS = 15000;

// 日本語セットID → 英語TCGdex APIセットID（複数候補）
const mkEx   = (...ids) => ids.map(id => ({ apiId: id, cdn: `en/ex/${id}` }));
const mkHgss = (...ids) => ids.map(id => ({ apiId: id, cdn: `en/hgss/${id}` }));
const mkBw   = (...ids) => ids.map(id => ({ apiId: id, cdn: `en/bw/${id}` }));
const mkNeo  = (...ids) => ids.map(id => ({ apiId: id, cdn: `en/neo/${id}` }));
const SET_MAP = {
  PMCG1: [{ apiId: "base1", cdn: "en/base/base1" }],
  PMCG2: [{ apiId: "base2", cdn: "en/base/base2" }],
  PMCG3: [{ apiId: "base3", cdn: "en/base/base3" }],
  PMCG4: [{ apiId: "base5", cdn: "en/base/base5" }],
  PMCG5: [{ apiId: "gym1",  cdn: "en/gym/gym1"  }, { apiId: "gym2", cdn: "en/gym/gym2" }],
  PMCG6: [{ apiId: "gym2",  cdn: "en/gym/gym2"  }, { apiId: "gym1", cdn: "en/gym/gym1" }],
  neo1:  [{ apiId: "neo1",  cdn: "en/neo/neo1"  }],
  neo2:  [{ apiId: "neo2",  cdn: "en/neo/neo2"  }],
  neo3:  [{ apiId: "neo3",  cdn: "en/neo/neo3"  }],
  neo4:  [{ apiId: "neo4",  cdn: "en/neo/neo4"  }],
  E1:    [{ apiId: "ecard1", cdn: "en/ecard/ecard1" }],
  E2:    [{ apiId: "ecard2", cdn: "en/ecard/ecard2" }],
  E3:    [{ apiId: "ecard2", cdn: "en/ecard/ecard2" }, { apiId: "ecard1", cdn: "en/ecard/ecard1" }],
  E4:    [{ apiId: "ecard3", cdn: "en/ecard/ecard3" }, { apiId: "ecard1", cdn: "en/ecard/ecard1" }, { apiId: "ecard2", cdn: "en/ecard/ecard2" }],
  E5:    [{ apiId: "ecard3", cdn: "en/ecard/ecard3" }, { apiId: "ecard2", cdn: "en/ecard/ecard2" }, { apiId: "ecard1", cdn: "en/ecard/ecard1" }],
  // PCG era (EX era English equivalents + HGSS/BW/neo fallback)
  PCG1:  mkEx("ex6","ex5","ex4","ex3","ex2","ex1","ex7","ex8","ex9","ex10","ex11"),
  PCG2:  mkEx("ex8","ex9","ex6","ex7","ex10","ex11","ex12"),
  PCG3:  mkEx("ex7","ex6","ex8","ex9","ex10","ex11","ex12"),
  PCG4:  [...mkEx("ex10","ex9","ex11","ex8","ex12","ex13"), ...mkHgss("hgss1","hgss2","hgss3","hgss4"), ...mkBw("bw10","bw9","bw5")],
  PCG5:  mkEx("ex12","ex13","ex11","ex10","ex14","ex15"),
  PCG6:  mkEx("ex11","ex10","ex12","ex13","ex14"),
  PCG7:  [...mkEx("ex13","ex7","ex3","ex12","ex14","ex11","ex15","ex16"), ...mkBw("bw7","bw9"), ...mkHgss("hgss2","hgss4")],
  PCG8:  mkEx("ex14","ex13","ex15","ex12","ex16"),
  PCG9:  [...mkEx("ex16","ex15","ex14","ex13","ex3","ex7","ex10","ex11"), ...mkHgss("hgss1","hgss2","hgss3","hgss4"), ...mkBw("bw7","bw8","bw9","bw10","bw11"), ...mkNeo("neo1","neo2","neo3","neo4")],
};

// 日本語ジムリーダー名プレフィックス → 英語プレフィックス
const GYM_LEADERS = new Map([
  ["ブロック",       "brock's"],
  ["ミスティ",       "misty's"],
  ["マチス",         "lt. surge's"],
  ["エリカ",         "erika's"],
  ["キョウ",         "koga's"],
  ["コガ",           "koga's"],
  ["ジョバンニ",     "giovanni's"],
  ["ジョヴァンニ",   "giovanni's"],
  ["ブレイン",       "blaine's"],
  ["サブリナ",       "sabrina's"],
  ["マツバ",         "morty's"],
  ["カスミ",         "misty's"],
]);

const args = process.argv.slice(2);
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
const forceRefresh = args.includes("--refresh");

async function apiFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ptcg-ebay-tool/1.0" },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return r.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// 英語セットのカードマップをキャッシュから読む or API から取得
async function getEnMap(candidates) {
  const entries = [];
  const seen = new Set();

  for (const { apiId, cdn } of candidates) {
    const cachePath = path.join(CACHE_DIR, `${apiId}.json`);
    let cards = null;

    // キャッシュ優先
    if (!forceRefresh) {
      try {
        const raw = await fs.readFile(cachePath, "utf-8");
        const cached = JSON.parse(raw.replace(/^﻿/, ""));
        cards = cached.entries; // [[name_lower, {localId, cdn}], ...]
        process.stdout.write(` [cache:${apiId}]`);
      } catch {}
    }

    // キャッシュなし → API から取得
    if (!cards) {
      process.stdout.write(` [API:${apiId}]`);
      const data = await apiFetch(`https://api.tcgdex.net/v2/en/sets/${apiId}`);
      if (!data || !data.cards) {
        process.stdout.write(` FAILED`);
        continue;
      }
      cards = [];
      for (const c of data.cards) {
        if (c.name && c.localId) {
          cards.push([c.name.toLowerCase(), { localId: c.localId, cdn }]);
        }
      }
      // API 取得分をキャッシュ保存
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify({ entries: cards, apiId }, null, 2), "utf-8");
      await new Promise(r => setTimeout(r, 500));
    }

    for (const [key, val] of cards) {
      if (!seen.has(key)) {
        seen.add(key);
        entries.push([key, val]);
      }
    }
  }

  return entries.length > 0 ? { map: new Map(entries) } : null;
}

async function downloadImage(url) {
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "ptcg-ebay-tool/1.0" },
      });
      clearTimeout(timer);
      if (r.status === 200) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 500) return buf;
      }
      if (r.status === 404) return null;
    } catch {
      clearTimeout(timer);
    }
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  const cardList = JSON.parse(await fs.readFile(LIST_PATH, "utf-8"));
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));

  // cardData を setId → {localId → englishName} / {localId → jaName} の Map
  const enNameMap = new Map();
  const jaNameMap = new Map();
  for (const set of cardData) {
    const em = new Map();
    const jm = new Map();
    for (const k of set.k) {
      const [local, ja, en] = k;
      if (en && en.trim()) em.set(local, en.trim());
      if (ja && ja.trim()) jm.set(local, ja.trim());
    }
    enNameMap.set(set.c, em);
    jaNameMap.set(set.c, jm);
  }

  const targetSets = onlySet
    ? [onlySet].filter(s => SET_MAP[s])
    : Object.keys(SET_MAP);

  if (targetSets.length === 0) {
    console.log("対象セットが見つかりません。");
    process.exit(1);
  }

  console.log(`対象セット: ${targetSets.join(", ")}`);

  const results = { downloaded: 0, skipped: 0, noEnName: 0, noMatch: 0, failed: 0, sets: {} };

  for (const jaSet of targetSets) {
    const candidates = SET_MAP[jaSet];
    process.stdout.write(`\n[${jaSet}] カードマップを準備中...`);

    const result = await getEnMap(candidates);
    if (!result) {
      console.log(" → 取得失敗、スキップ（--refresh で再試行）");
      continue;
    }
    const { map: enMap } = result;
    console.log(` → ${enMap.size} 種類の英語カード名`);

    const jaCards = cardList.filter(c => c.set === jaSet);
    const setEnMap = enNameMap.get(jaSet) || new Map();
    const setJaMap = jaNameMap.get(jaSet) || new Map();
    const setResult = { downloaded: 0, skipped: 0, noEnName: 0, noMatch: 0, failed: 0 };

    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < jaCards.length) {
        const card = jaCards[idx++];
        if (!card) continue;
        const dest = path.join(OUT_DIR, card.serie, card.set, `${card.local}.webp`);

        if (await exists(dest)) { setResult.skipped++; results.skipped++; continue; }

        const enName = setEnMap.get(card.local);
        if (!enName) { setResult.noEnName++; results.noEnName++; continue; }

        // 1. まず正確一致
        let match = enMap.get(enName.toLowerCase());

        // 2. ジムリーダープレフィックスフォールバック (PMCG5/6)
        if (!match) {
          const jaName = setJaMap.get(card.local) || "";
          for (const [jaPfx, enPfx] of GYM_LEADERS) {
            if (jaName.startsWith(jaPfx)) {
              match = enMap.get(enPfx + " " + enName.toLowerCase());
              if (match) break;
            }
          }
        }

        // 3. Dark/Light プレフィックスフォールバック (neo4)
        if (!match) {
          match = enMap.get("dark " + enName.toLowerCase()) ||
                  enMap.get("light " + enName.toLowerCase());
        }

        if (!match) { setResult.noMatch++; results.noMatch++; continue; }

        const url = `https://assets.tcgdex.net/${match.cdn}/${match.localId}/${QUALITY}.webp`;
        const buf = await downloadImage(url);
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

    results.sets[jaSet] = setResult;
    console.log(`  取得:${setResult.downloaded} スキップ:${setResult.skipped} 英語名なし:${setResult.noEnName} 不一致:${setResult.noMatch} 失敗:${setResult.failed}`);
  }

  console.log("\n=== 完了 ===");
  console.log(`取得:${results.downloaded} スキップ:${results.skipped} 英語名なし:${results.noEnName} 不一致:${results.noMatch} 失敗:${results.failed}`);
  await fs.writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...results }, null, 2), "utf-8");
  console.log("詳細: scripts/scrape-old-report.json");
}

main().catch(e => { console.error("エラー:", e); process.exit(1); });
