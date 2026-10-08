// fix-old-ja-names.mjs で日本語名を直した行の英語名を直す（2026-10-08）。
//   node scripts/fix-old-en-names.mjs --set PCG3 [--kind pokemon|trainer] [--apply]
// ポケモン（--kind pokemon、既定）: 直した日本語名から作った英語名（わるい→Dark・やさしい→Light・ひかる→Shining・R団の→Rocket's・ホロンの→Holon's・
//   ジムリーダー等の持ち主、ex・☆・δ、アンノーンの文字、ポワルンのフォルム）が、Bulbapedia の日本版の一覧（scripts/old-ja-check/bulbapedia-old.txt・
//   bulbapedia-old-2.txt、同じ番号。neo は番号が無く並び順）の名前と一致したときだけ入れる。書き換えるのは、今の英語名が種族の英語名だけ
//   （前置き・ex・δ・☆ が抜けた形）のときだけ。
// トレーナーズ・エネルギー（--kind trainer、英語名が空の行）: 直した日本語名と、Bulbapedia の同じ番号のカードのページの日本語名（jname、bulbapedia-old-2.txt）が一致し、
//   Bulbapedia の英語名が TCGdex 英語版のトレーナーズ・エネルギーのカード名にもあるときだけ、その行の Bulbapedia の英語名を入れる（時代で英語名が違うカードもその行の名前）。
// 根拠は scripts/old-ja-check/en-fix-{弾}.json（トレーナーズは en-fix-{弾}-trainer.json）。
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
const KIND = process.argv.includes("--kind") ? process.argv[process.argv.indexOf("--kind") + 1] : "pokemon";
const OUTBASE = KIND === "trainer" ? `en-fix-${SET}-trainer` : `en-fix-${SET}`;

const species = JSON.parse(fs.readFileSync(path.join(__dirname, "en-name-fix3", "species-ja-en.json"), "utf8")).species;
const ja2en = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en]));
const PREFIX = [["わるい", "Dark "], ["やさしい", "Light "], ["ひかる", "Shining "], ["R団の", "Rocket's "], ["ホロンの", "Holon's "],
  // ポワルンのフォルム（EX 期の書き方。PCG6＝英語版 EX Delta Species の Sunny/Rain/Snow-cloud Castform。後の世代の "Castform Sunny Form" とは違う。2026-10-08）
  ["太陽の", "Sunny "], ["雨水の", "Rain "], ["雪雲の", "Snow-cloud "],
  // VS1 のジムリーダー・四天王の持ち主（英語版の公式名。Bulbapedia の一覧と一致したときだけ使う）
  ["ハヤトの", "Falkner's "], ["ツクシの", "Bugsy's "], ["アカネの", "Whitney's "], ["マツバの", "Morty's "], ["ミカンの", "Jasmine's "], ["シジマの", "Chuck's "],
  ["ヤナギの", "Pryce's "], ["イブキの", "Clair's "], ["マチスの", "Lt. Surge's "], ["ナツメの", "Sabrina's "], ["カスミの", "Misty's "], ["エリカの", "Erika's "],
  ["アンズの", "Janine's "], ["タケシの", "Brock's "], ["カツラの", "Blaine's "], ["イツキの", "Will's "], ["キョウの", "Koga's "], ["シバの", "Bruno's "],
  ["カリンの", "Karen's "], ["ワタルの", "Lance's "],
  // PMCG5・PMCG6（ジム拡張）の持ち主
  ["サカキの", "Giovanni's "]];

// Bulbapedia の一覧（番号 → 英語名・種類・カードのページの日本語名）
const bp = new Map();
let cur = null;
for (const file of ["bulbapedia-old.txt", "bulbapedia-old-2.txt", "bulbapedia-old-3.txt"]) for (const line of fs.readFileSync(path.join(CHK, file), "utf8").split(/\r?\n/)) {
  if (line.startsWith("## ")) { cur = line.slice(3).split("|")[0]; continue; }
  if (!line || cur !== SET) continue;
  const [num, name, type, jname] = line.split("|");
  bp.set(num.replace("*", ""), { name, type, jname: jname ?? "" });
}
// neo2: Bulbapedia も遺跡の石版2種を1行にまとめているので、055 以降は1つ前の行（fix-old-ja-names.mjs と同じ）
const bpAt = (num) => { const n = parseInt(num, 10); const m = SET === "neo2" && n >= 55 ? n - 1 : n; return bp.get(String(m).padStart(3, "0")) ?? null; };

const key = (s) => (s || "").normalize("NFKC").toLowerCase().replace(/[\s\-.'’:]/g, "");
const normJa = (s) => (s || "").normalize("NFKC").replace(/\s/g, "");
const tcgNames = new Set();
for (const t of ["Trainer", "Energy"]) for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, "en-name-fix3", ".cache", `tcgdex-en-${t}.json`), "utf8")).data.cards) tcgNames.add(key(c.name));

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

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const fixRows = [`fix-${SET}.json`, `fix-${SET}-part1.json`].filter((f) => fs.existsSync(path.join(CHK, f)))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(CHK, f), "utf8")).rows.filter((r) => r.status.startsWith("直す")));
const ids = [...new Set(fixRows.map((r) => r.id))];
const rows = [];
if (KIND === "trainer") for (const id of ids) {
  const k = set.k.find((x) => `${SET}-${x[0]}` === id);
  if (k[2]) continue; // 英語名がある行はポケモンの方で扱う
  const b = bpAt(k[0]);
  const r = { id, ja: k[1], bulbapedia: b?.name ?? null, bulbapediaJa: b?.jname ?? null, after: "", status: "" };
  rows.push(r);
  if (!b) { r.status = "Bulbapedia の一覧に無い"; continue; }
  if (!b.jname) { r.status = "Bulbapedia のカードのページに日本語名が無い"; continue; }
  if (normJa(k[1]) !== normJa(b.jname)) { r.status = "日本語名が Bulbapedia の日本語名と一致しない"; continue; }
  if (!tcgNames.has(key(b.name))) { r.status = "TCGdex 英語版に同じ名前のトレーナーズ・エネルギーが無い"; continue; }
  r.after = b.name; r.status = "直す";
  if (APPLY) k[2] = b.name;
}
if (KIND === "pokemon") for (const id of ids) {
  const k = set.k.find((x) => `${SET}-${x[0]}` === id);
  if (!k[2]) continue; // 英語名の無い行（トレーナーズ等）は --kind trainer
  const r = { id, ja: k[1], before: k[2], built: build(k[1]), bulbapedia: bpAt(k[0])?.name ?? null, after: "", status: "" };
  rows.push(r);
  if (!r.built) { r.status = "日本語名から英語名を作れない"; continue; }
  if (!r.bulbapedia) { r.status = "Bulbapedia の一覧に無い"; continue; }
  if (key(r.built) !== key(r.bulbapedia)) { r.status = "作った名前と Bulbapedia が一致しない"; continue; }
  if (k[2] === r.bulbapedia) { r.status = "すでに同じ"; continue; }
  const base = ja2en.get(PREFIX.reduce((x, [j]) => (x.startsWith(j) ? x.slice(j.length) : x), k[1].normalize("NFKC")).replace(/(δ-デルタ種|☆|ex|\[.\])+$/g, "").replace(/ex$/, ""));
  if (key(k[2]) !== key(base) && !key(r.bulbapedia).startsWith(key(k[2]))) { r.status = `今の英語名が種族の英語名だけの形でない（${k[2]}）`; continue; }
  r.after = r.bulbapedia; r.status = "直す";
  if (APPLY) k[2] = r.bulbapedia;
}
const fixed = rows.filter((r) => r.status === "直す");
const reasons = {}; for (const r of rows) if (r.status !== "直す") reasons[r.status] = (reasons[r.status] || 0) + 1;
fs.writeFileSync(path.join(CHK, `${OUTBASE}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, kind: KIND, fixed: fixed.length, rows }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(CHK, `${OUTBASE}-changed-card-ids.txt`), fixed.map((r) => r.id).join("\n") + (fixed.length ? "\n" : ""));
}
console.log(JSON.stringify({ set: SET, kind: KIND, targets: rows.length, fixed: fixed.length, reasons }));
