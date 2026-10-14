#!/usr/bin/env node
// SVG-050〜052（フシギダネ・ヒトカゲ・ゼニガメ。総数 049 を超える番号）の英語名を入れる（2026-10-15）。  node scripts/en-name-fix2/fill-svg-050-052.mjs [--apply]
// fill-high-rarity-en.mjs はイラストレーターが分からない（TCGdex・公式とも無し）ため空欄にした（decisions.tsv）。
// ポケモンの英語名のこれまでの確かめ方（fill-common-en.mjs）と同じく、2つの一致で入れる:
//   1. Bulbapedia の日本版の一覧（bulbapedia.tsv の SVG-050〜052。Venusaur & Charizard & Blastoise Special Deck Set ex (TCG)）
//   2. 日本語名から作った規則の名前（en-name-fix3/species-ja-en.json の種族名）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === "SVG");
const species = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en]));
const bp = new Map(fs.readFileSync(path.join(__dirname, "bulbapedia.tsv"), "utf8").split(/\r?\n/).map((l) => l.split("\t")).filter((c) => /^SVG-05[0-2]$/.test(c[0])).map((c) => [c[0], c[3]]));
const changed = [];
for (const num of ["050", "051", "052"]) {
  const row = set.k.find((r) => r[0] === num);
  const rule = species.get(row[1].normalize("NFKC"));
  const b = bp.get(`SVG-${num}`);
  if (row[2]) { console.log(`SVG-${num} 入れ済み: ${row[2]}`); continue; }
  if (!rule || rule !== b) throw new Error(`一致しない: SVG-${num} ${row[1]} 規則=${rule} Bulbapedia=${b}`);
  console.log(`SVG-${num} ${row[1]}: （空） → ${b}`);
  row[2] = b;
  changed.push(`SVG-${num}`);
}
if (process.argv.includes("--apply") && changed.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(__dirname, "SVG-changed-card-ids-2026-10-15.txt"), changed.join("\n") + "\n");
  rebuildCardKinds();
}
