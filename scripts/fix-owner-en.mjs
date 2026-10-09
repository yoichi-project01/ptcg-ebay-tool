#!/usr/bin/env node
// 日本語名に持ち主・前置き・フォルムがあるのに、英語名がポケモンの名前だけになっている行を直す（2026-10-09）。
//   node scripts/fix-owner-en.mjs --set SV10 [--apply]
// 1つ目: 日本語名から作った名前（持ち主「ロケット団の」→"Team Rocket's " 等、ロトムのフォルム「カット」→"Mow Rotom" 等、わるい→"Dark "）
// 2つ目: Bulbapedia の日本版の弾の一覧の同じ番号の名前（scripts/en-name-fix3/bulbapedia-owner/SV-owner-2026-10-09.txt、ブラウザで wikitext から
//   取り出し SHA-256 bdde9911e39a3cfd6b79c4030fb214e021f1bd9c5b1934b353296b492581cc99 をブラウザの値と照合）。neo4 は番号の無い一覧の並び（下の EXTRA）。
// 両方が一致し、今の英語名が種族の英語名だけのときに Bulbapedia の名前を入れる。
// web1-025 なみのりピカチュウは規則で作れないため、Bulbapedia の名前（Surfing Pikachu）と TCGdex 英語版の同じ名前・同じイラストレーター
// （pcg-search のカードのページの illus. Toshinao Aoki）で確かめる（EXTRA の tcgdex）。
// 根拠は scripts/en-name-fix3/owner-fix-{弾}.json、直した card_id は owner-fix-{弾}-changed-card-ids.txt。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const DIR = path.join(__dirname, "en-name-fix3");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const APPLY = process.argv.includes("--apply");

const species = JSON.parse(fs.readFileSync(path.join(DIR, "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const OWNER = [["ロケット団の", "Team Rocket's "], ["ナンジャモの", "Iono's "], ["リーリエの", "Lillie's "], ["ホップの", "Hop's "], ["ヒビキの", "Ethan's "],
  ["シロナの", "Cynthia's "], ["カスミの", "Misty's "], ["ペパーの", "Arven's "], ["Nの", "N's "], ["わるい", "Dark "]];
const ROTOM = { カットロトム: "Mow Rotom", ヒートロトム: "Heat Rotom", ウォッシュロトム: "Wash Rotom", スピンロトム: "Fan Rotom", フロストロトム: "Frost Rotom" };
const SUF = { ex: " ex", V: " V", VMAX: " VMAX", VSTAR: " VSTAR", GX: "-GX", EX: "-EX" };

// Bulbapedia（番号 → 名前）
const bp = new Map();
let cur = null;
for (const l of fs.readFileSync(path.join(DIR, "bulbapedia-owner", "SV-owner-2026-10-09.txt"), "utf8").split(/\r?\n/)) {
  if (l.startsWith("## ")) { cur = l.slice(3).split("|")[0]; continue; }
  if (!l || cur !== SET) continue;
  const [num, name] = l.split("|");
  if (name !== "?") bp.set(num, name);
}
// 一覧のファイルに無い弾の根拠（ブラウザで確かめたもの）
const EXTRA = {
  "neo4-024": { bulbapedia: "Dark Houndoom", source: "Bulbapedia「Neo Destiny (TCG)」の日本版の一覧（番号なし・113件）の24番目（前後は Dark Magcargo・Shining Charizard。cardData の neo4 は Bulbapedia と同じ並び）" },
  "web1-025": { bulbapedia: "Surfing Pikachu", source: "Bulbapedia「Pokémon Web (TCG)」の一覧の 025", tcgdex: { illustrator: "Toshinao Aoki", illSource: "pcg-search.com/card/web/web0025.php の illus." } },
};

const key = (s) => (s || "").normalize("NFKC").toLowerCase().replace(/[\s\-.'’:]/g, "");
function build(ja) {
  let s = ja.normalize("NFKC").replace(/\s+/g, ""), suf = "";
  for (const k of Object.keys(SUF)) if (s.endsWith(k) && J.has(s.slice(0, -k.length).replace(/^.*の|^わるい/, "")) ) { suf = SUF[k]; s = s.slice(0, -k.length); break; }
  if (ROTOM[s]) return ROTOM[s] + suf;
  for (const [j, e] of OWNER) if (s.startsWith(j) && J.has(s.slice(j.length))) return e + J.get(s.slice(j.length)) + suf;
  return null;
}
const bareOf = (ja) => { const s = ja.normalize("NFKC").replace(/\s+/g, "").replace(/(ex|V|VMAX|VSTAR|GX|EX)$/, ""); if (ROTOM[s]) return "Rotom";
  for (const [j] of OWNER) if (s.startsWith(j)) return J.get(s.slice(j.length)); return J.get(s.replace(/^なみのり/, "")); };

let tcg = null;
const tcgdex = () => tcg ??= JSON.parse(fs.readFileSync(path.join(DIR, ".cache", "tcgdex-en-Pokemon.json"), "utf8")).data.cards;

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const rows = [];
for (const k of set.k) {
  const id = `${SET}-${k[0]}`;
  if (!k[2]) continue;
  const bare = bareOf(k[1]);
  if (!bare || k[2].replace(/ (ex|V|VMAX|VSTAR)$|-(GX|EX)$/, "") !== bare) continue; // 英語名が種族の名前だけの行
  if (J.has(k[1].normalize("NFKC").replace(/\s+/g, "").replace(/(ex|V|VMAX|VSTAR|GX|EX)$/, ""))) continue; // 日本語名も種族の名前だけ（対象外）
  const ex = EXTRA[id];
  const r = { id, ja: k[1], before: k[2], built: build(k[1]), bulbapedia: ex?.bulbapedia ?? bp.get(k[0]) ?? null, source: ex?.source ?? "SV-owner-2026-10-09.txt", tcgdexIds: "", after: "", status: "" };
  if (!r.built && !ex?.tcgdex && !bp.has(k[0])) continue; // 持ち主・フォルムの付かない名前（対象外）
  rows.push(r);
  if (!r.bulbapedia) { r.status = "Bulbapedia の一覧に無い"; continue; }
  if (ex?.tcgdex) {
    const m = tcgdex().filter((c) => key(c.name) === key(r.bulbapedia) && key(c.illustrator) === key(ex.tcgdex.illustrator));
    if (!m.length) { r.status = "TCGdex 英語版に同じ名前・イラストレーターのカードが無い"; continue; }
    r.tcgdexIds = m.map((c) => c.id).join(" "); r.illustrator = `${ex.tcgdex.illustrator}（${ex.tcgdex.illSource}）`;
  } else {
    if (!r.built) { r.status = "日本語名から英語名を作れない"; continue; }
    if (key(r.built) !== key(r.bulbapedia)) { r.status = "作った名前と Bulbapedia が一致しない"; continue; }
  }
  r.after = r.bulbapedia; r.status = "直す";
  if (APPLY) k[2] = r.after;
}
const fixed = rows.filter((r) => r.status === "直す");
const reasons = {}; for (const r of rows) if (r.status !== "直す") reasons[r.status] = (reasons[r.status] || 0) + 1;
fs.writeFileSync(path.join(DIR, `owner-fix-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, fixed: fixed.length, reasons, rows }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(DIR, `owner-fix-${SET}-changed-card-ids.txt`), fixed.map((r) => r.id).join("\n") + (fixed.length ? "\n" : ""));
}
console.log(JSON.stringify({ set: SET, targets: rows.length, fixed: fixed.length, reasons }));
