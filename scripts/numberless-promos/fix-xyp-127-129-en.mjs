#!/usr/bin/env node
// XY-P の X31066 バシャーモEX・X31067 ケムッソ・X31068 ジラーチの英語名を入れる（2026-10-09）。
//   node scripts/numberless-promos/fix-xyp-127-129-en.mjs [--apply]
// 番号の無いプロモとして追加したが、Bulbapedia「XY-P Promotional cards (TCG)」では番号付きの 127〜129/XY-P として載っており
// （配布の説明も公式 details.php の本文と一致）、公式の画像（/assets/images/card_images/large/XYP/0310xx_*.jpg）にも
// 127/XY-P・128/XY-P・129/XY-P と印刷されている（2026-10-09 に目で確認）。details.php のページに番号が表示されないだけ。
// 2026-10-09 に型番を XY-P-127〜129 に変えた（renumber-xyp-127-129.mjs）。この行はもう無いので再実行しないこと（止まる）。
// 英語名は日本語名から作った名前（バシャーモEX→Blaziken-EX 等）と Bulbapedia の名前の一致で入れる。型番（X＋cardID）は変えていない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const APPLY = process.argv.includes("--apply");
const PLAN = [
  { id: "X31066", ja: "バシャーモEX", rule: "Blaziken-EX", bulbapedia: "Blaziken-EX", printed: "127/XY-P",
    line: "Setlist/nmentry|127/XY-P|[[Blaziken-EX (XY-P Promo 127)|Blaziken]]{{EX}}|Fire|||{{TCGMerch|XY|Era|Rayquaza Mega Battle Mega Pack}}", official: "メガパック「レックウザメガバトル」" },
  { id: "X31067", ja: "ケムッソ", rule: "Wurmple", bulbapedia: "Wurmple", printed: "128/XY-P",
    line: "Setlist/nmentry|128/XY-P|{{TCG ID|XY-P Promo|Wurmple|128}}|Grass|||Pokémon Card Gym Promotional Card Pack 5 (May-July 2015)", official: "ポケモンカードゲーム プロモーションカードパック(2015/5)" },
  { id: "X31068", ja: "ジラーチ", rule: "Jirachi", bulbapedia: "Jirachi", printed: "129/XY-P",
    line: "Setlist/nmentry|129/XY-P|{{TCG ID|XY-P Promo|Jirachi|129}}|Metal|||Pokémon Card Gym Promotional Card Pack 5 (May-July 2015)<br>Pokémon Card Gym Promotional Card Pack 8 (November 2016-January 2017)", official: "プロモーションカードパック（2016/11）" },
];
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === "XY-P");
const ids = [];
for (const p of PLAN) {
  const k = set.k.find((x) => x[0] === p.id);
  if (!k || !k[1].startsWith(p.ja + "（")) throw new Error(`行が想定と違います: XY-P-${p.id} ${k?.[1]}`);
  if (p.rule !== p.bulbapedia) throw new Error(`規則と Bulbapedia が違います: ${p.id}`);
  if (k[2] && k[2] !== p.bulbapedia) throw new Error(`英語名が既にあります: ${p.id} ${k[2]}`);
  if (APPLY) k[2] = p.bulbapedia;
  ids.push(`XY-P-${p.id}`);
}
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(__dirname, "fix-xyp-127-129-en.json"), JSON.stringify({ note: "型番は X＋cardID のまま。カードには 127〜129/XY-P と印刷されている", rows: PLAN }, null, 1) + "\n");
  fs.writeFileSync(path.join(__dirname, "fix-xyp-127-129-en-changed-card-ids.txt"), ids.join("\n") + "\n");
}
console.log(ids.join(" "), APPLY ? "入れた" : "（確認のみ）");
