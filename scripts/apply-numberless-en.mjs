#!/usr/bin/env node
// 番号の無いプロモ（scripts/numberless-promos/*.json の計画ファイル）の英語名を cardData に入れる（2026-10-06）。
//   node scripts/apply-numberless-en.mjs            計画ファイルの各カードの en を、cardData の該当行（{弾}-X{cardID}）に書く
// 英語名は計画ファイルの enRule（名前の付け方と根拠：英語版の公式の呼び方・PSA のラベル）に従って各カードに入れた en を使う。
// en が無いカード（確かめられなかったもの）は空欄のまま。既に別の英語名が入っている行は変えずに止める。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(__dirname, "numberless-promos");
const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
let changed = 0, blank = 0;
const ids = [];
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.endsWith("-result.json"))) {
  const plan = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (!plan.cards) continue;
  const set = data.find((s) => s.c === plan.set);
  for (const c of plan.cards) {
    const row = set.k.find((k) => k[0] === `X${c.cardId}`);
    if (!row) continue;
    if (!c.en) { blank++; continue; }
    if (row[2] === c.en) continue;
    if (row[2]) throw new Error(`英語名が既にあります: ${plan.set}-X${c.cardId} ${row[2]}`);
    row[2] = c.en; changed++; ids.push(`${plan.set}-X${c.cardId}`);
  }
}
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(path.join(DIR, "en-changed-card-ids.txt"), ids.join("\n") + (ids.length ? "\n" : ""));
console.log(`英語名を入れた ${changed}件・空欄のまま ${blank}件`);
