#!/usr/bin/env node
// M6a-147 パルキア の英語名を "Palkia LV.X" にする（2026-10-14）。  node scripts/en-name-fix2/fix-m6a-147-lvx.mjs [--apply]
// fill-high-rarity-en.mjs は TCGdex 英語版に "Palkia LV.X" という名前のカードが無いため空欄にした（TCGdex は DP 期の LV.X を名前に LV.X を付けずに載せる）。
// これまでの LV.X の確かめ方（dp-x/fix-dpt-lvx-en.mjs・fix-lvx-en.mjs と同じ）で、3つが一致したので入れる:
//   1. 公式 details.php（cardID 50724）: 147 / 103、イラストレーター Ryo Ueda、段階「レベルアップ」・LV. X、HP 120、ワザ ハイドロリフレクト 60（2026-10-14 に確認）
//   2. Bulbapedia「30th Celebration (TCG)」の日本版の一覧 147/103「Palkia LV.X」（en-name-fix3/bulbapedia/M6a-136-157-2026-10-14.txt）
//   3. TCGdex 英語版 dp4-106 Palkia（イラストレーター Ryo Ueda、stage LEVEL-UP、rarity Rare Holo LV.X、HP 120、Hydro Reflect 60）。
//      英語版 30th Classic Collection の 30th-c-022 Palkia（Ryo Ueda、HP 120、Hydro Reflect 60）も同じカードの再録
// 日本語名は変えない（公式のカード名は「パルキア」。LV.X は段階の欄）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const row = data.find((s) => s.c === "M6a").k.find((r) => r[0] === "147");
if (row[2] === "Palkia LV.X") { console.log("直し済み"); process.exit(0); }
if (row[1] !== "パルキア" || row[2] !== "") throw new Error(`想定と違う行: ${row}`);
console.log(`M6a-147 ${row[1]}: （空） → Palkia LV.X`);
if (process.argv.includes("--apply")) {
  row[2] = "Palkia LV.X";
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.appendFileSync(path.join(__dirname, "M6a-changed-card-ids-2026-10-14.txt"), "M6a-147\n");
  rebuildCardKinds();
}
