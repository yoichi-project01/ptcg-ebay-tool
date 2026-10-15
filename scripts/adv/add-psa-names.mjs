#!/usr/bin/env node
// scripts/adv/sources.json の弾の PSA の表記を scripts/set-psa-names.json に書く（2026-10-15）。  node scripts/adv/add-psa-names.mjs ADV1
import fs from "node:fs";
const src = JSON.parse(fs.readFileSync("scripts/adv/sources.json", "utf8")).sets;
const F = "scripts/set-psa-names.json";
const raw = fs.readFileSync(F, "utf8");
const j = JSON.parse(raw);
for (const c of process.argv.slice(2)) {
  const m = src[c];
  j[c] = { psaName: m.psaName, source: m.psaSource, note: `PSA のページタイトル「${m.psaTitle}」（2026-10-15 に psacard.com に限った検索結果で確認）` };
  console.log(c, m.psaName);
}
fs.writeFileSync(F, JSON.stringify(j, null, raw.match(/\n( +)"/)[1].length) + (raw.endsWith("\n") ? "\n" : ""));
