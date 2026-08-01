#!/usr/bin/env node
/**
 * !!! DEPRECATED — 実行しないこと !!!
 * TCGdex CDN の画像は英語版アートワーク（.webp）。日本語カードの出品に
 * 英語アートワークを使うのは実物と異なり不適切なため使用禁止（CLAUDE.md参照）。
 * npm run scrape / package.json からは既に削除済み。参考保存のみ。
 *
 * ポケモンカード画像スクレイパー (TCGdex CDN)
 *
 * card-list.json の全カードについて、TCGdexのCDNから画像をダウンロードし
 * public/cards/{SERIE}/{SET}/{localId}.webp に保存します。
 *
 * 特徴:
 *  - URL形式の大文字/小文字・番号ゼロ埋め有無を順に試して当たりを探す
 *  - 既にダウンロード済みのファイルはスキップ（何度でも再実行可・レジューム対応）
 *  - 同時実行数を制限してサーバーに負荷をかけない
 *  - 結果を scripts/scrape-report.json に記録（成功/失敗/未検出の一覧）
 *
 * 使い方:
 *   node scripts/scrape-images.mjs            # 全件
 *   node scripts/scrape-images.mjs --set SV2a # 特定セットだけ
 *   node scripts/scrape-images.mjs --limit 50 # 先頭50件だけ（動作確認用）
 *   CONCURRENCY=16 node scripts/scrape-images.mjs
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const LIST_PATH = path.join(__dirname, "card-list.json");
const REPORT_PATH = path.join(__dirname, "scrape-report.json");

const CONCURRENCY = Number(process.env.CONCURRENCY || 12);
const QUALITY = process.env.QUALITY || "high"; // high | low
const RETRY = 2;

// --- CLI引数 ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const onlySet = getArg("--set");
const limit = getArg("--limit") ? Number(getArg("--limit")) : Infinity;

// --- 画像URLの候補生成（当たりを探す） ---
function imageUrlCandidates({ serie, set, local }) {
  const srVars = [serie.toLowerCase(), serie];
  const cVars = [set.toLowerCase(), set];
  const stripped = local.replace(/^0+/, "") || local;
  const idVars = stripped === local ? [stripped] : [stripped, local];
  const seen = new Set();
  const urls = [];
  for (const sr of srVars)
    for (const c of cVars)
      for (const id of idVars) {
        const u = `https://assets.tcgdex.net/ja/${sr}/${c}/${id}/${QUALITY}.webp`;
        if (!seen.has(u)) {
          seen.add(u);
          urls.push(u);
        }
      }
  return urls;
}

function outPath({ serie, set, local }) {
  return path.join(OUT_DIR, serie, set, `${local}.webp`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchImage(url) {
  for (let attempt = 0; attempt <= RETRY; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ptcg-ebay-tool/1.0 (personal use)" },
      });
      if (res.status === 200) {
        const buf = Buffer.from(await res.arrayBuffer());
        // 極端に小さいレスポンスは画像でない可能性が高いので弾く
        if (buf.length > 500) return buf;
      }
      if (res.status === 404) return null; // このURLは無い
    } catch {
      // ネットワークエラーはリトライ
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return null;
}

async function processCard(card) {
  const dest = outPath(card);
  if (await exists(dest)) return { status: "skip", card };

  const urls = imageUrlCandidates(card);
  for (const url of urls) {
    const buf = await fetchImage(url);
    if (buf) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      return { status: "ok", card, url };
    }
  }
  return { status: "missing", card };
}

// --- 簡易並列プール ---
async function runPool(items, worker, concurrency) {
  const results = [];
  let idx = 0;
  let done = 0;
  const total = items.length;
  const runners = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur]);
      done++;
      if (done % 100 === 0 || done === total) {
        const ok = results.filter((r) => r?.status === "ok").length;
        const miss = results.filter((r) => r?.status === "missing").length;
        const skip = results.filter((r) => r?.status === "skip").length;
        process.stdout.write(
          `\r進捗 ${done}/${total}  取得:${ok} スキップ:${skip} 未検出:${miss}   `
        );
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const list = JSON.parse(await fs.readFile(LIST_PATH, "utf-8"));
  let cards = list;
  if (onlySet) cards = cards.filter((c) => c.set.toLowerCase() === onlySet.toLowerCase());
  if (Number.isFinite(limit)) cards = cards.slice(0, limit);

  console.log(`対象: ${cards.length} 枚 / 同時実行: ${CONCURRENCY} / 画質: ${QUALITY}`);
  console.log(`保存先: ${OUT_DIR}\n`);

  const results = await runPool(cards, processCard, CONCURRENCY);
  console.log("\n");

  const ok = results.filter((r) => r?.status === "ok");
  const missing = results.filter((r) => r?.status === "missing");
  const skip = results.filter((r) => r?.status === "skip");

  // 最初に成功したURLの形式を集計（正しい形式の把握用）
  const formatCount = {};
  for (const r of ok) {
    const m = r.url.match(/assets\.tcgdex\.net\/ja\/([^/]+)\/([^/]+)\//);
    if (m) {
      const key = `serie=${m[1] === r.card.serie ? "UPPER" : "lower"} set=${m[2] === r.card.set ? "UPPER" : "lower"}`;
      formatCount[key] = (formatCount[key] || 0) + 1;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    downloaded: ok.length,
    skipped: skip.length,
    missing: missing.length,
    winningFormats: formatCount,
    missingCards: missing.map((r) => `${r.card.set}-${r.card.local} (${r.card.ja})`),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  console.log("=== 完了 ===");
  console.log(`取得: ${ok.length} / スキップ済: ${skip.length} / 未検出: ${missing.length}`);
  console.log(`当たったURL形式:`, formatCount);
  console.log(`詳細レポート: scripts/scrape-report.json`);
  if (missing.length) {
    console.log(
      `\n※ 未検出のカードはTCGdexに画像が無い可能性が高いです。scrape-report.json の missingCards を確認してください。`
    );
  }
}

main().catch((e) => {
  console.error("\nエラー:", e);
  process.exit(1);
});
