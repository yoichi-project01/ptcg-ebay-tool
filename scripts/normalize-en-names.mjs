#!/usr/bin/env node
/**
 * cardData.json の英語名フィールドの表記ゆれを正規化する。
 *
 * 1. 末尾の角括弧（カード種別注記、例: "Studio Berlatih[Stadium]"）を除去する。
 *    誤った取り込み経路で英語名に紛れ込んだもので、正規の英語カード名には現れない。
 * 2. アポストロフィ・引用符をUnicodeの湾曲形（U+2018/2019/201C/201D）から
 *    直線形（U+0027/0022）に統一する。eBayのバイヤーは直線アポストロフィで
 *    検索するため（例: "Farfetch'd"）。
 *
 * 使い方: node scripts/normalize-en-names.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

function normalize(en) {
  return en
    .replace(/\[[^\]]*\]\s*$/, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  let count = 0;
  for (const set of cardData) {
    for (const k of set.k) {
      const en = k[2];
      if (!en) continue;
      const next = normalize(en);
      if (next !== en) {
        console.log(`${set.c}/${k[0]} | ${en} -> ${next}`);
        k[2] = next;
        count++;
      }
    }
  }
  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
  console.log(`${count}件の英語名を正規化しました。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
