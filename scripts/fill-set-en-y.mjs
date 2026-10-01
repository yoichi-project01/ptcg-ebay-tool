#!/usr/bin/env node
// cardData.json の弾の英語名（en）・発売年（y）の空欄を、出典付きの一覧から埋める。
// 既に値がある弾は変更しない（食い違いは表示するだけ）。
//   英語名: scripts/set-en-sources.json（PSA の日本版カードのラベル表記）
//   発売年: scripts/set-y-sources.json（Limitless TCG の発売日、PSA の登録年と照合済み）
// 使い方: node scripts/fill-set-en-y.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const enSrc = read(path.join(__dirname, "set-en-sources.json"));
const ySrc = read(path.join(__dirname, "set-y-sources.json"));
const dry = process.argv.includes("--dry-run");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const byCode = new Map(data.map((s) => [s.c, s]));
let enFilled = 0, yFilled = 0;

for (const [code, v] of Object.entries(enSrc)) {
  if (code.startsWith("_")) continue;
  const s = byCode.get(code);
  if (!s) { console.warn(`! en: cardData に無い弾 ${code}`); continue; }
  if (s.en) { if (s.en !== v.en) console.log(`  en 既存値あり（変更しない）: ${code} "${s.en}" / 出典 "${v.en}"`); continue; }
  s.en = v.en;
  enFilled++;
}
for (const [code, v] of Object.entries(ySrc)) {
  if (code.startsWith("_")) continue;
  const s = byCode.get(code);
  if (!s) { console.warn(`! y: cardData に無い弾 ${code}`); continue; }
  if (s.y) { if (s.y !== v.y) console.log(`  y 既存値あり（変更しない）: ${code} ${s.y} / 出典 ${v.y}`); continue; }
  // 既存データと同じキー順にする（codeAlias を持つ弾は c,ja,en,sr,of,y,k,codeAlias、それ以外は k の後ろ）
  if (s.codeAlias !== undefined) {
    const { k, codeAlias, ...head } = s;
    for (const key of Object.keys(s)) delete s[key];
    Object.assign(s, head, { y: v.y, k, codeAlias });
  } else s.y = v.y;
  yFilled++;
}

console.log(`en を埋めた弾: ${enFilled} / y を埋めた弾: ${yFilled}${dry ? "（dry-run）" : ""}`);
if (!dry) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
