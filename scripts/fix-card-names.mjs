#!/usr/bin/env node
/**
 * cardData.json の誤った日本語名を修正し、対応する画像ファイルをリネームします。
 *
 * 問題の種類:
 *   1. 英語のジムリーダー名 (Surge→マチス, Bugsy→アンズ, etc.)
 *   2. 英語のまま残ったカード名 (pokedex→ポケモン図鑑, ecogym→エコジム, etc.)
 *   3. pcg-searchサイトの位置から判明した実際の日本語名
 *
 * 使い方: node scripts/fix-card-names.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

// 修正マップ: `${setCode}/${localId}` → 正しい日本語名
// ソース: pcg-searchキャッシュ、ポケモンTCG公式知識
const CORRECTIONS = new Map([
  // PMCG1 (初代拡張パック)
  ["PMCG1/082", "ポケモン図鑑"],           // "pokedex"
  ["PMCG1/091", "ピッピにんぎょう"],         // "Clefairy Doll"

  // PMCG5 (ジム1拡張) - pcg-searchキャッシュ site=081, 093 の実際のカード名
  ["PMCG5/081", "マチスの交渉"],            // "Surgeの条約" (Surge=マチス)
  ["PMCG5/093", "抵抗力低下ジム"],           // "Surgeの秘密計画中"

  // PMCG6 (ジム2拡張) - pcg-searchキャッシュ site=085, 087 の実際のカード名
  ["PMCG6/085", "カツラ"],                 // "Cinnabar City Gym"
  ["PMCG6/087", "カツラのギャンブル"],        // "Sabrina's esp"

  // neo1 (neo元祖拡張)
  ["neo1/077",  "ミルクのみ"],              // "Moomooミルク"
  ["neo1/086",  "エコジム"],               // "ecogym"

  // PCG1
  ["PCG1/077",  "ポケモンずかん・ハンディ909"],  // "pokedex Handy909"

  // VS1 (VSシリーズ) - 英語のジムリーダー名を日本語に変換
  ["VS1/105",   "アンズのテクニカルマシン01"],   // "Bugsyのテクニカルマシン01" (Bugsy=アンズ)
  ["VS1/106",   "アンズのテクニカルマシン02"],   // "Bugsyのテクニカルマシン02"
  ["VS1/109",   "マツバのテクニカルマシン01"],   // "Morty's Technical Machine 01" (Morty=マツバ)
  ["VS1/110",   "マツバのテクニカルマシン02"],   // "Morty's Technical Machine 02"
  ["VS1/117",   "イブキのテクニカルマシン01"],   // "Clair's Technical Machine 01" (Clair=イブキ)
  ["VS1/118",   "イブキのテクニカルマシン02"],   // "Clair's Technical Machine 02"
  ["VS1/131",   "ミルクのみ"],              // "Moomooミルク"

  // web1 (webシリーズ)
  ["web1/030",  "げんきのかたまり"],          // "Max Revive"

  // S-P (プロモ) - 公式APIのcardNameViewTextがHTMLエスケープされたまま取り込まれていた
  ["S-P/134", "グズマ&ハラ"],
  ["S-P/135", "シロナ&カトレア"],
  ["S-P/136", "マオ&スイレン"],
  ["S-P/222", "アルセウス&ディアルガ&パルキアGX"],
]);

async function walk(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(jpg|png|webp)$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  const raw = await fs.readFile(CARD_DATA_PATH, "utf-8");
  const cardData = JSON.parse(raw);

  // serieMap / totalMap
  const serieMap = new Map();
  const totalMap = new Map();
  for (const set of cardData) {
    serieMap.set(set.c, set.sr);
    totalMap.set(set.c, computeSetTotal(set.k));
  }

  // 全ファイルをスキャン: key `${setCode}/${localId}` → filePath
  const allFiles = await walk(CARDS_DIR);
  const fileMap = new Map(); // `${setCode}/${localId}` → filePath
  for (const fp of allFiles) {
    const dir = path.dirname(fp);
    const base = path.basename(fp);
    const ext = path.extname(base);
    const stem = base.slice(0, -ext.length);
    const setCode = path.basename(dir);
    // 新形式: stem に `_${setCode}-` が含まれる
    const marker = `_${setCode}-`;
    const idx = stem.lastIndexOf(marker);
    if (idx < 0) continue;
    const after = stem.slice(idx + marker.length);
    const end = after.search(/[／_]/);
    const localId = end >= 0 ? after.slice(0, end) : after;
    fileMap.set(`${setCode}/${localId}`, fp);
  }

  let cardDataChanged = false;
  let filesRenamed = 0;

  // 修正を適用
  for (const [key, newJaName] of CORRECTIONS) {
    const [setCode, localId] = key.split("/");

    // 1. cardData.json を更新
    const setEntry = cardData.find(s => s.c === setCode);
    if (setEntry) {
      const cardEntry = setEntry.k.find(k => k[0] === localId);
      if (cardEntry) {
        const oldJaName = cardEntry[1];
        if (oldJaName !== newJaName) {
          console.log(`cardData [${setCode}/${localId}]: "${oldJaName}" → "${newJaName}"`);
          cardEntry[1] = newJaName;
          cardDataChanged = true;
        }
      }
    }

    // 2. ファイルをリネーム
    const currentPath = fileMap.get(key);
    if (!currentPath) {
      console.log(`  ファイルなし: ${key}`);
      continue;
    }

    const dir = path.dirname(currentPath);
    const ext = path.extname(currentPath);
    const stem = path.basename(currentPath).slice(0, -ext.length);
    const setCodeFromDir = path.basename(dir);

    // 現在の rarity を stem から抽出
    const marker = `_${setCodeFromDir}-`;
    const idx = stem.lastIndexOf(marker);
    let rarity = "";
    if (idx >= 0) {
      const after = stem.slice(idx + marker.length);
      const uIdx = after.lastIndexOf("_");
      if (uIdx >= 0) rarity = after.slice(uIdx + 1);
    }

    const total = totalMap.get(setCode) || 0;
    const newStem = buildFileName(newJaName, setCode, localId, rarity, total);
    const newPath = path.join(dir, newStem + ext);

    if (newPath === currentPath) {
      console.log(`  スキップ (変更なし): ${path.basename(currentPath)}`);
      continue;
    }

    await fs.rename(currentPath, newPath);
    console.log(`  ファイル: "${path.basename(currentPath)}" → "${path.basename(newPath)}"`);
    filesRenamed++;
  }

  // cardData.json を保存
  if (cardDataChanged) {
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
    console.log("\ncardData.json を更新しました");
  }

  console.log(`\n完了: cardData修正=${[...CORRECTIONS.keys()].length}件, ファイルリネーム=${filesRenamed}件`);
}

main().catch(e => { console.error(e); process.exit(1); });
