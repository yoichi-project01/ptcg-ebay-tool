// decisions.json（make-decisions.mjs）の「入れる」行の英語名を cardData に書く（2026-10-10）。
//   node scripts/en-name-fix3/person/apply.mjs --set <弾>   今の英語名が decisions の「変更前」と同じ行だけ書き換え、changed.tsv に追記する
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "..", "src", "cardData.json");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!SET || !process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const dec = JSON.parse(fs.readFileSync(path.join(__dirname, "decisions.json"), "utf8")).filter((r) => r.status.startsWith("入れる") && r.id.slice(0, r.id.lastIndexOf("-")) === SET);
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const s = data.find((x) => x.c === SET);
const lines = [];
for (const r of dec) {
  const k = s.k.find((k) => `${SET}-${k[0]}` === r.id);
  if (!k || k[1] !== r.ja || k[2] !== r.before) throw new Error(`今の値が想定と違います: ${r.id} ${k?.[1]} ${JSON.stringify(k?.[2])}`);
  k[2] = r.after;
  lines.push([r.id, r.ja, r.before, r.after, r.note].join("\t"));
}
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
const T = path.join(__dirname, "changed.tsv");
if (!fs.existsSync(T)) fs.writeFileSync(T, "card_id\tja\tbefore\tafter\tbasis\n");
fs.appendFileSync(T, lines.map((l) => l + "\n").join(""));
console.log(SET, lines.length);
