#!/usr/bin/env node
// 保留にしていた BW7-B-077 リザードン・BW7-B-078 カメックス（UR）を足す（2026-10-18、ユーザーの指示）。
//   node scripts/bw-secrets/add-bw7-077-078.mjs [--apply]
// add-bw-secrets.mjs では、ポケカくらぶの一覧が 077 カメックス・078 リザードンで遊々亭と入れ違っていたので保留にした。
// ユーザーの判断: 077 は Bulbapedia・遊々亭・PSA の鑑定ラベル（「2012 POKEMON JAPANESE BLACK & WHITE PLASMA GALE 077 CHARIZARD」）の3つ、
// 078 は Bulbapedia・遊々亭の2つが一致し、ポケカくらぶは 077 と 078 を入れ違えている。根拠は psa-2026-10-18.tsv。
// レアリティ・英語名はほかの BW のシークレットと同じやり方（レアリティは情報源の印 UR、英語名は日本語名から作った規則の名前が Bulbapedia と一致したもの）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const HELD = path.join(__dirname, "held-2026-10-18.tsv");
const APPLY = process.argv.includes("--apply");
const tsv = (f) => fs.readFileSync(path.join(__dirname, f), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t"));
const species = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "en-name-fix3", "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en]));

const ROWS = [["077", "リザードン"], ["078", "カメックス"]];
const bp = tsv("bulbapedia-2026-10-18.tsv");
const yy = tsv("yuyutei-2026-10-18.tsv").slice(1);
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === "BW7-B");
const add = [];
for (const [num, ja] of ROWS) {
  const b = bp.find((r) => r[0] === "BW7-B" && r[1] === num);
  const y = yy.filter((r) => r[0] === "BW7-B" && r[1] === num && !/\(ミラー\)$/.test(r[3]));
  const en = J.get(ja);
  // 確かめ: Bulbapedia の名前が規則の名前と同じ、遊々亭（販売・買取）がすべて同じ名前・レアリティ、cardData にその番号が無い
  if (!b || b[2] !== en) throw new Error(`Bulbapedia と規則の名前が合わない: ${num} ${b?.[2]} ${en}`);
  if (!y.length || y.some((r) => r[3].normalize("NFKC").trim() !== ja || r[2] !== b[4])) throw new Error(`遊々亭と合わない: ${num} ${JSON.stringify(y)}`);
  if (set.k.some((r) => r[0] === num)) throw new Error(`cardData に同じ番号がもう有る: ${num}`);
  add.push([num, ja, en, b[4]]);
}
console.log(add);
if (!APPLY) process.exit(0);
set.k.push(...add);
set.k.sort((x, y) => (+x[0] || 0) - (+y[0] || 0) || String(x[0]).localeCompare(String(y[0])));
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(path.join(__dirname, "added-card-ids-bw7-2026-10-18.txt"), add.map((r) => `BW7-B-${r[0]}`).join("\n") + "\n");
const held = fs.readFileSync(HELD, "utf8").split(/\r?\n/).filter((l) => !/^BW7-B-07[78]\t/.test(l));
fs.writeFileSync(HELD, held.join("\n"));
rebuildCardKinds();
console.log(`足した ${add.length}`);
