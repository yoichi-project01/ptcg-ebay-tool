// fix-old-ja-names.mjs で日本語名を直したポケモンの行の英語名を直す（2026-10-08）。
//   node scripts/fix-old-en-names.mjs --set PCG3 [--apply]
// 直した日本語名から作った英語名（わるい→Dark・やさしい→Light・ひかる→Shining・R団の→Rocket's・ホロンの→Holon's、ex・☆・δ、アンノーンの文字）が、
// Bulbapedia の日本版の一覧（scripts/old-ja-check/bulbapedia-old.txt、同じ番号。neo は番号が無く並び順）の名前と一致したときだけ入れる。
// 書き換えるのは、今の英語名が種族の英語名だけ（前置き・ex・δ・☆ が抜けた形）のときか空のときだけ。根拠は scripts/old-ja-check/en-fix-{弾}.json。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const CHK = path.join(__dirname, "old-ja-check");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const APPLY = process.argv.includes("--apply");

const species = JSON.parse(fs.readFileSync(path.join(__dirname, "en-name-fix3", "species-ja-en.json"), "utf8")).species;
const ja2en = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en]));
const PREFIX = [["わるい", "Dark "], ["やさしい", "Light "], ["ひかる", "Shining "], ["R団の", "Rocket's "], ["ホロンの", "Holon's "],
  // ポワルンのフォルム（EX 期の書き方。PCG6＝英語版 EX Delta Species の Sunny/Rain/Snow-cloud Castform。後の世代の "Castform Sunny Form" とは違う。2026-10-08）
  ["太陽の", "Sunny "], ["雨水の", "Rain "], ["雪雲の", "Snow-cloud "]];

// Bulbapedia の一覧
const bp = new Map();
let cur = null;
for (const line of fs.readFileSync(path.join(CHK, "bulbapedia-old.txt"), "utf8").split(/\r?\n/)) {
  if (line.startsWith("## ")) { cur = line.slice(3).split("|")[0]; continue; }
  if (!line || cur !== SET) continue;
  const [num, name] = line.split("|");
  bp.set(num.replace("*", ""), name);
}

// 日本語名 → 英語名（作れなければ null）
function build(ja) {
  let s = ja.normalize("NFKC").trim(), pre = "", post = [];
  for (const [j, e] of PREFIX) if (s.startsWith(j)) { pre = e; s = s.slice(j.length); break; }
  let delta = false, star = false, ex = false, unown = null;
  if (/δ-デルタ種$/.test(s)) { delta = true; s = s.replace(/δ-デルタ種$/, ""); }
  if (/☆$/.test(s)) { star = true; s = s.replace(/☆$/, ""); }
  if (/ex$/.test(s)) { ex = true; s = s.replace(/ex$/, ""); }
  const u = s.match(/^アンノーン\[(.)\]$/); if (u) { unown = u[1]; s = "アンノーン"; }
  const en = ja2en.get(s); if (!en) return null;
  if (ex) post.push("ex"); if (star) post.push("☆"); if (delta) post.push("δ");
  return pre + en + (unown ? " " + unown : "") + (post.length ? " " + post.join(" ") : "");
}
const key = (s) => (s || "").normalize("NFKC").toLowerCase().replace(/[\s\-.'’:]/g, "");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const fix = JSON.parse(fs.readFileSync(path.join(CHK, `fix-${SET}.json`), "utf8"));
const rows = [];
for (const f of fix.rows.filter((r) => r.status === "直す")) {
  const k = set.k.find((x) => `${SET}-${x[0]}` === f.id);
  if (!k[2]) continue; // 英語名の無い行（トレーナーズ等）は対象外
  const r = { id: f.id, ja: k[1], before: k[2], built: build(k[1]), bulbapedia: bp.get(k[0]) ?? null, after: "", status: "" };
  rows.push(r);
  if (!r.built) { r.status = "日本語名から英語名を作れない"; continue; }
  if (!r.bulbapedia) { r.status = "Bulbapedia の一覧に無い"; continue; }
  if (key(r.built) !== key(r.bulbapedia)) { r.status = "作った名前と Bulbapedia が一致しない"; continue; }
  if (k[2] === r.bulbapedia) { r.status = "すでに同じ"; continue; }
  const base = ja2en.get(k[1].normalize("NFKC").replace(/^(わるい|やさしい|ひかる|R団の|ホロンの|太陽の|雨水の|雪雲の)/, "").replace(/(δ-デルタ種|☆|ex|\[.\])+$/g, "").replace(/ex$/, ""));
  if (key(k[2]) !== key(base) && !key(r.bulbapedia).startsWith(key(k[2]))) { r.status = `今の英語名が種族の英語名だけの形でない（${k[2]}）`; continue; }
  r.after = r.bulbapedia; r.status = "直す";
  if (APPLY) k[2] = r.bulbapedia;
}
const fixed = rows.filter((r) => r.status === "直す");
const reasons = {}; for (const r of rows) if (r.status !== "直す") reasons[r.status] = (reasons[r.status] || 0) + 1;
fs.writeFileSync(path.join(CHK, `en-fix-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, fixed: fixed.length, rows }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(CHK, `en-fix-${SET}-changed-card-ids.txt`), fixed.map((r) => r.id).join("\n") + (fixed.length ? "\n" : ""));
}
console.log(JSON.stringify({ set: SET, targets: rows.length, fixed: fixed.length, reasons }));
