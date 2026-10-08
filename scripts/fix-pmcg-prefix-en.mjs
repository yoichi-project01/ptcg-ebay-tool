// PMCG の日本語名に前置き（わるい→Dark・イマクニ?の→Imakuni?'s）があるのに英語名に無い行を直す（2026-10-08）。node scripts/fix-pmcg-prefix-en.mjs --set PMCG4 [--apply]
// 前置き＋今の英語名 が、Bulbapedia の日本版の一覧（bulbapedia-old-3.txt・-4.txt、cardData と同じ並び）の同じ位置の名前と一致したときだけ入れる。
// 根拠は scripts/old-ja-check/prefix-en-{弾}.json。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const CHK = path.join(__dirname, "old-ja-check");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!/^PMCG[1-6]$/.test(SET)) throw new Error("--set PMCG1〜6");
const APPLY = process.argv.includes("--apply");
const PREFIX = [["わるい", "Dark "], ["イマクニ?の", "Imakuni?'s "]];
const bp = new Map(); let cur = null;
for (const f of ["bulbapedia-old-3.txt", "bulbapedia-old-4.txt"]) for (const l of fs.readFileSync(path.join(CHK, f), "utf8").split(/\r?\n/)) {
  if (l.startsWith("## ")) { cur = l.slice(3).split("|")[0]; continue; }
  if (l && cur === SET) bp.set(l.split("|")[0].replace("*", ""), l.split("|")[1]);
}
const raw = fs.readFileSync(DATA, "utf8"), data = JSON.parse(raw);
const rows = [];
for (const k of data.find((s) => s.c === SET).k) {
  const ja = k[1].normalize("NFKC"), pre = PREFIX.find(([j]) => ja.startsWith(j));
  if (!pre || !k[2] || k[2].startsWith(pre[1])) continue;
  const built = pre[1] + k[2], b = bp.get(k[0]) ?? null;
  const r = { id: `${SET}-${k[0]}`, ja: k[1], before: k[2], built, bulbapedia: b, after: "", status: built === b ? "直す" : "Bulbapedia と一致しない" };
  if (r.status === "直す") { r.after = built; if (APPLY) k[2] = built; }
  rows.push(r);
}
fs.writeFileSync(path.join(CHK, `prefix-en-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, rows }, null, 1) + "\n");
if (APPLY) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
const fixed = rows.filter((r) => r.status === "直す");
console.log(JSON.stringify({ set: SET, targets: rows.length, fixed: fixed.length }));
for (const r of rows) if (r.status !== "直す") console.log(r.id, r.ja, r.built, r.bulbapedia);
