#!/usr/bin/env node
/**
 * 既存の画像ファイルをリネームします（冪等）
 * 旧形式:   {localId}.ext
 * 中間形式: {jaName}_{setCode}-{localId}_{rarity}.ext
 * 新形式:   {jaName}_{setCode}-{localId}／{total}_{rarity}.ext
 *
 * 使い方: node scripts/rename-images.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

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

// ファイル名から localId を柔軟に抽出（全形式対応）
function flexLocalId(stem, setCode) {
  const marker = `_${setCode}-`;
  const idx = stem.lastIndexOf(marker);
  if (idx < 0) return stem; // 旧形式: ステム自体が localId
  const after = stem.slice(idx + marker.length);
  const end = after.search(/[／_]/);
  return end >= 0 ? after.slice(0, end) : after;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));

  // lookup: `${setCode}/${localId}` → { jaName, rarity }
  const lookup = new Map();
  // totalMap: setCode → 最大数値 localId
  const totalMap = new Map();

  for (const set of cardData) {
    for (const [localId, jaName, , rarity] of set.k) {
      lookup.set(`${set.c}/${localId}`, { jaName: jaName || "", rarity: rarity || "" });
    }
    totalMap.set(set.c, computeSetTotal(set.k));
  }

  const files = await walk(CARDS_DIR);
  let renamed = 0, skipped = 0, notFound = 0;

  for (const filePath of files) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const ext = path.extname(base);
    const stem = base.slice(0, -ext.length);

    const relDir = path.relative(CARDS_DIR, dir);
    const dirParts = relDir.split(path.sep);
    if (dirParts.length < 2) continue;
    const setCode = dirParts[dirParts.length - 1];

    const localId = flexLocalId(stem, setCode);
    const info = lookup.get(`${setCode}/${localId}`);
    if (!info) { notFound++; continue; }

    const total = totalMap.get(setCode) || 0;
    const newStem = buildFileName(info.jaName, setCode, localId, info.rarity, total);
    const newPath = path.join(dir, newStem + ext);

    if (newPath === filePath) { skipped++; continue; }

    await fs.rename(filePath, newPath);
    renamed++;
    if (renamed % 500 === 0) process.stdout.write(`\r  ${renamed} 件リネーム済み...`);
  }

  if (renamed > 0) process.stdout.write("\r");
  console.log(`リネーム: 変更=${renamed}, スキップ=${skipped}, cardData未登録=${notFound}`);
}

main().catch(e => { console.error(e); process.exit(1); });
