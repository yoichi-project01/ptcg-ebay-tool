#!/usr/bin/env node
/**
 * 日本語カード画像 一括取得スクリプト
 *
 * すべてのソースから順番に画像を取得し、imageIndex.json を更新します。
 * npm run images で実行してください。
 *
 * 取得順:
 *   1. 公式サイト (pokemon-card.com) — S / SV / M 系 JPG
 *   2. pcg-search.com — 旧シリーズ (PMCG/neo/E/PCG/VS/web) PNG
 *   3. pcg-search.com — PMCG5/6 トレーナーカード補完 (名前不一致を手動マッピングで解決)
 *   4. 公式キャッシュ — S/SV 括弧付き名前・重複カード補完
 *   5. pcg-search.com — 特殊URLエネルギー9枚 (PMCG1スターター + VS1特殊エネルギー)
 *   6. imageIndex.json 再生成
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");

const PCG_BASE = "https://pcg-search.com";
const PCG_HDR = {
  "User-Agent": "Mozilla/5.0 ptcg-ebay-tool/1.0",
  "Referer": PCG_BASE + "/",
};

async function download(url, dest) {
  if (await isUsableImage(dest)) { console.log("  skip:", path.basename(dest)); return; }
  const r = await fetch(url, { headers: PCG_HDR, signal: AbortSignal.timeout(15000) });
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 500) {
      await writeFileAtomic(dest, buf);
      console.log("  OK:", path.basename(dest));
      return;
    }
  }
  console.log("  FAIL:", path.basename(dest), r.status);
}

function runScript(scriptName) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`実行: ${scriptName}`);
  console.log("=".repeat(60));
  const result = spawnSync("node", [path.join(__dirname, scriptName)], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (result.error) {
    console.error(`エラー (${scriptName}):`, result.error.message);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`中断 (${scriptName}): シグナル ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`エラー (${scriptName}): 終了コード ${result.status} で終了しました`);
    process.exit(1);
  }
}

async function downloadSpecialEnergies(cardLookup, serieMap, totalMap) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("特殊URLエネルギーカード（9枚）");
  console.log("=".repeat(60));

  // PMCG1 スターターパック基本エネルギー: 通常の 1st1NNN.png とは異なり 1st1sNNN.png
  // VS1 特殊エネルギー: 通常の vs0NNN.png とは異なり vs0enN.png
  const SPECIAL = [
    { setCode: "PMCG1", localId: "097", url: PCG_BASE + "/img/1st/1st1s001.png" },
    { setCode: "PMCG1", localId: "098", url: PCG_BASE + "/img/1st/1st1s002.png" },
    { setCode: "PMCG1", localId: "099", url: PCG_BASE + "/img/1st/1st1s003.png" },
    { setCode: "PMCG1", localId: "100", url: PCG_BASE + "/img/1st/1st1s004.png" },
    { setCode: "PMCG1", localId: "101", url: PCG_BASE + "/img/1st/1st1s005.png" },
    { setCode: "PMCG1", localId: "102", url: PCG_BASE + "/img/1st/1st1s006.png" },
    { setCode: "VS1",   localId: "143", url: PCG_BASE + "/img/vs/vs0en8.png" },
    { setCode: "VS1",   localId: "144", url: PCG_BASE + "/img/vs/vs0en7.png" },
    { setCode: "VS1",   localId: "151", url: PCG_BASE + "/img/vs/vs0en9.png" },
  ];

  for (const { setCode, localId, url } of SPECIAL) {
    const info = cardLookup.get(`${setCode}/${localId}`) || { jaName: localId, rarity: "" };
    const serie = serieMap.get(setCode) || setCode;
    const total = totalMap.get(setCode) || 0;
    const fileName = buildFileName(info.jaName, setCode, localId, info.rarity, total) + ".png";
    await download(url, path.join(OUT_DIR, serie, setCode, fileName));
  }
}

async function main() {
  console.log("=== 日本語カード画像 一括取得 ===");

  // cardData を読み込んで特殊エネルギーのファイル名計算に使用
  const cardData = JSON.parse(await fs.readFile(path.join(ROOT, "src", "cardData.json"), "utf-8"));
  const cardLookup = new Map();
  const serieMap = new Map();
  const totalMap = new Map();
  for (const set of cardData) {
    serieMap.set(set.c, set.sr);
    totalMap.set(set.c, computeSetTotal(set.k));
    for (const [localId, jaName, , rarity] of set.k) {
      cardLookup.set(`${set.c}/${localId}`, { jaName: jaName || "", rarity: rarity || "" });
    }
  }

  // 旧形式ファイルを新形式にリネーム（冪等）
  runScript("rename-images.mjs");

  runScript("scrape-official-images.mjs");
  runScript("scrape-pcg-search.mjs");
  runScript("scrape-pmcg-gym-supplement.mjs");
  runScript("scrape-missing-sv.mjs");
  await downloadSpecialEnergies(cardLookup, serieMap, totalMap);
  runScript("build-image-index.mjs");

  console.log("\n=== すべての処理が完了しました ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
