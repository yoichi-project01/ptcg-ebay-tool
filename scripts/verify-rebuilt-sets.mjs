#!/usr/bin/env node
/**
 * patch-from-scan.mjs --rebuild で作り直したセットが、scripts/scan-progress/{セット}.json に
 * 保存した details.php の結果（公式データ）と全行一致しているかを確かめる（通信なし）。
 * 番号・名前（末尾の括弧注記の有無は同一扱い）・レアリティを比べる。
 *
 * 使い方: node scripts/verify-rebuilt-sets.mjs S4 S5I S5R ...
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAndBuildK } from "./scrape-missing-sets.mjs";
import { normalizeName } from "./patch-from-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codes = process.argv.slice(2);
if (codes.length === 0) { console.error("セットコードを指定してください"); process.exit(1); }

const cardData = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "cardData.json"), "utf-8"));
const strip = (s) => normalizeName(s).replace(/[（(][^（()）]*[)）]$/, "").trim();
let ng = 0;
for (const code of codes) {
  const set = cardData.find((s) => s.c === code);
  const progress = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "scan-progress", `${code}.json`), "utf-8"));
  const badges = new Set([code, set.codeAlias].filter(Boolean));
  const details = [];
  for (const d of Object.values(progress)) if (badges.has(d.badge)) for (const c of d.cards) details.push(c);
  const { k, total } = validateAndBuildK(details, code);
  const cur = new Map(set.k.map((r) => [parseInt(r[0], 10), r]));
  const bad = k.filter((r) => {
    const x = cur.get(parseInt(r[0], 10));
    return !x || strip(x[1]) !== strip(r[1]) || x[3] !== r[3];
  });
  const ok = bad.length === 0 && set.k.length === k.length && set.of === total;
  if (!ok) ng++;
  console.log(`${code}: 公式 ${k.length}件 / cardData ${set.k.length}件、of ${set.of}（公式 ${total}）、不一致 ${bad.length} → ${ok ? "OK" : "NG"}`);
}
process.exit(ng ? 1 : 0);
