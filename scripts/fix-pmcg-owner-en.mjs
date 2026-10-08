// 日本語名は正しいのに英語名に持ち主が抜けている PMCG5・PMCG6 の行の英語名を直す（2026-10-08）。node scripts/fix-pmcg-owner-en.mjs [--apply]
// 日本語名の持ち主（タケシの→Brock's・カツラの→Blaine's・＿の→_____'s）＋今の英語名 が、Bulbapedia の日本版の一覧（bulbapedia-old-3.txt、cardData と同じ並び）の
// 同じ位置の名前と一致したときだけ入れる。根拠は scripts/old-ja-check/pmcg-owner-en.json。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const CHK = path.join(__dirname, "old-ja-check");
const APPLY = process.argv.includes("--apply");
const IDS = ["PMCG5-043", "PMCG6-034", "PMCG6-075"];
const OWNER = { "タケシ": "Brock's", "カツラ": "Blaine's", "_": "_____'s" };
const bp = new Map(); let cur = null;
for (const l of fs.readFileSync(path.join(CHK, "bulbapedia-old-3.txt"), "utf8").split(/\r?\n/)) {
  if (l.startsWith("## ")) { cur = l.slice(3).split("|")[0]; continue; }
  if (l) bp.set(`${cur}-${l.split("|")[0].replace("*", "")}`, l.split("|")[1]);
}
const raw = fs.readFileSync(DATA, "utf8"), data = JSON.parse(raw);
const rows = [];
for (const id of IDS) {
  const [c, num] = [id.slice(0, 5), id.slice(6)];
  const k = data.find((s) => s.c === c).k.find((x) => x[0] === num);
  const m = k[1].normalize("NFKC").match(/^(.+?)の/);
  const built = m && OWNER[m[1]] ? `${OWNER[m[1]]} ${k[2]}` : null;
  const r = { id, ja: k[1], before: k[2], built, bulbapedia: bp.get(id) ?? null, after: "", ok: false };
  rows.push(r);
  if (built && built === r.bulbapedia) { r.after = built; r.ok = true; if (APPLY) k[2] = built; }
}
console.table(rows);
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(CHK, "pmcg-owner-en.json"), JSON.stringify(rows, null, 1) + "\n");
}
