#!/usr/bin/env node
// カードの種類（ポケモン以外）の一覧 src/cardKinds.json を作る（2026-10-11）。
//   node scripts/card-kinds/build-card-kinds.mjs [--write]
// Item Specifics の Character を決めるのに使う（src/App.jsx の characterOf）。ポケモンの行は一覧に入れない（入っていない行はポケモン扱い）。
// 値: Supporter / Item / Tool / Stadium / Energy / Trainer（トレーナーズだが細かい種類が分からない）
// 種類の決め方（上ほど優先。食い違いは report.json に記録）:
//   1. Bulbapedia の日本版の一覧の type 列（これまでの英語名の作業でブラウザから書き写したもの。番号で行と結び付ける）
//   2. TCGdex 日本語版の category・trainerType（en-name-fix3/tcgdex-ja.json）
//   3. 公式 details.php の本文の種類の欄（DP 世代 dp-x/details.json・番号の無いプロモ numberless-promos/remaining-details.json）
//   4. 日本語名（種族名で終わる→ポケモン、「エネルギー」を含む→Energy、それ以外→Trainer）
//   5. 細かい種類が分からない Trainer は、同じ名前のほかの行の種類が1つに決まればそれを使う
// Bulbapedia の行は、cardData の英語名があるときは一覧の名前と同じときだけ使う（並びのずれ・番号の違う弾を避ける）。
// 一覧の type が色（Psychic 等）でも名前が "… Energy" なら特殊エネルギー（SV-T の一覧は特殊エネルギーに色を書いている）。
// 英語名が空で、Bulbapedia と日本語名の判定が食い違うときは、日本語名に種族名を含むかで決める（SVB は cardData の並びが一覧と違う）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const S = path.join(__dirname, "..");
const ROOT = path.join(S, "..");
const rj = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const data = rj("src/cardData.json");

const POKEMON_TYPES = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Colorless", "Dragon", "Fairy"]);
const norm = (t) => {
  if (POKEMON_TYPES.has(t)) return "Pokemon";
  return { Item: "Item", Supporter: "Supporter", Stadium: "Stadium", Energy: "Energy", Trainer: "Trainer", "Pokémon Tool": "Tool", Tool: "Tool",
    "Technical Machine": "Item", "Goods": "Item" }[t] ?? null;
};
const key = (n) => (n || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sameNum = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) && parseInt(a, 10) === parseInt(b, 10);

// 1. Bulbapedia
const bp = new Map(); // id -> kind
const listFiles = [
  ...fs.readdirSync(path.join(S, "en-name-fix3/bulbapedia")).map((f) => `en-name-fix3/bulbapedia/${f}`),
  "en-name-fix3/bulbapedia-owner/SV-owner-2026-10-09.txt",
  "old-ja-check/bulbapedia-old.txt", "old-ja-check/bulbapedia-old-2.txt", "old-ja-check/bulbapedia-old-3.txt", "old-ja-check/bulbapedia-old-4.txt",
];
const byCode = new Map(data.map((s) => [s.c, s]));
for (const f of listFiles) {
  let code = null;
  for (const l of fs.readFileSync(path.join(S, f), "utf8").split(/\r?\n/)) {
    if (l.startsWith("## ")) { code = l.slice(3).split("|")[0]; continue; }
    const p = l.split("|");
    if (p.length < 3 || !code) continue;
    const num = p[0].replace(/\*$/, "");
    const set = byCode.get(code);
    const row = set?.k.find((r) => sameNum(r[0], num));
    let k = norm(p[2]);
    if (k === "Pokemon" && /\bEnergy$/.test(p[1])) k = "Energy";
    if (row && k && !bp.has(`${code}-${row[0]}`) && (!row[2] || key(p[1]).startsWith(key(row[2])) || key(row[2]).startsWith(key(p[1])))) bp.set(`${code}-${row[0]}`, k);
  }
}
for (const l of fs.readFileSync(path.join(S, "en-name-fix2/bulbapedia.tsv"), "utf8").split(/\r?\n/).slice(1)) {
  const p = l.split("\t"); let k = norm(p[4]);
  if (k === "Pokemon" && /\bEnergy$/.test(p[3] || "")) k = "Energy";
  if (p[0] && k && !bp.has(p[0])) bp.set(p[0], k);
}

// 2. TCGdex 日本語版
const tja = rj("scripts/en-name-fix3/tcgdex-ja.json");
const td = (id) => {
  const v = tja[id]; if (!v) return null;
  if (v.category === "Pokemon") return "Pokemon";
  if (v.category === "Energy") return "Energy";
  if (v.category === "Trainer") return norm(v.trainerType) ?? "Trainer";
  return null;
};

// 3. 公式 details.php の本文
const JA_KIND = { サポート: "Supporter", サポーター: "Supporter", グッズ: "Item", スタジアム: "Stadium", ポケモンのどうぐ: "Tool", ワザマシン: "Item",
  特殊エネルギー: "Energy", 基本エネルギー: "Energy", トレーナー: "Trainer", 化石: "Item" };
const fromText = (text) => {
  const w = text.find((s) => JA_KIND[s]); if (w) return JA_KIND[w];
  return text.some((s) => s === "HP" || /^HP\s*\d/.test(s)) ? "Pokemon" : null;
};
const det = new Map();
for (const [cid, x] of Object.entries(rj("scripts/dp-x/details.json"))) det.set(cid, fromText(x.text || []));
for (const [cid, x] of Object.entries(rj("scripts/numberless-promos/remaining-details.json"))) det.set(String(cid), fromText(x.text || []));
const detOf = (id, local) => { const m = /^X(\d+)$/.exec(local); return m ? det.get(m[1]) ?? null : null; };

// 4. 日本語名
const species = rj("scripts/en-name-fix3/species-ja-en.json").species.map((s) => s.ja.normalize("NFKC").replace(/\s+/g, "")).filter((k) => k.length >= 2);
const stripSuffix = (n) => n.normalize("NFKC").replace(/\s+/g, "").replace(/[（(][^）)]*[）)]$/, "").replace(/\[[^\]]*\]$/, "")
  .replace(/(VMAX|VSTAR|V-UNION|V|ex|EX|GX|BREAK|LV\.X|LEGEND|δ|☆|◇|-デルタ種|δ-デルタ種|G|GL|FB|C|4|X|Y)+$/, "");
const nameKind = (ja) => {
  // 「ポワルン たいようのすがた」のように後ろにフォルム名が付く名前は、空白で区切った最初の部分でも見る
  if ([ja, ja.split(/\s+/)[0]].some((n) => { const s = stripSuffix(n); return species.some((k) => s.endsWith(k)); })) return "Pokemon";
  return /エネルギー/.test(ja) ? "Energy" : "Trainer";
};

const out = {}, report = { counts: {}, sources: {}, conflicts: [] };
for (const s of data) for (const r of s.k) {
  const id = `${s.c}-${r[0]}`;
  const cands = [["bulbapedia", bp.get(id) ?? null], ["tcgdex", td(id)], ["details", detOf(id, r[0])]].filter(([, k]) => k);
  let [src, kind] = cands[0] ?? ["name", nameKind(r[1])];
  if (!r[2] && src === "bulbapedia" && (kind === "Pokemon") !== (nameKind(r[1]) === "Pokemon")) {
    const s2 = stripSuffix(r[1]);
    const hasSpecies = species.some((k) => s2.includes(k) && k.length >= 3);
    const nk = nameKind(r[1]);
    [src, kind] = hasSpecies ? ["name-contains", "Pokemon"] : ["name", nk];
  }
  // Trainer（細かい種類なし）は、ほかの情報源に細かい種類があればそちらを使う
  if (kind === "Trainer") { const better = cands.find(([, k]) => k && !["Trainer", "Pokemon", "Energy"].includes(k)); if (better) [src, kind] = better; }
  const isP = (k) => k === "Pokemon";
  const all = [...cands, ["name", nameKind(r[1])]];
  if (all.some(([, k]) => isP(k) !== isP(kind)) && cands.length) report.conflicts.push({ id, ja: r[1], en: r[2], chosen: `${src}:${kind}`, all: all.map(([a, k]) => `${a}:${k}`).join(" ") });
  report.counts[kind] = (report.counts[kind] || 0) + 1;
  report.sources[src] = (report.sources[src] || 0) + 1;
  if (kind !== "Pokemon") out[id] = kind;
}
// 細かい種類が分からない Trainer は、同じ名前（日本語名の末尾の括弧注記を外したもの・英語名）のほかの行の種類が1つに決まればそれを使う
// （同じ名前のトレーナーズは種類も同じ。ナンジャモ・博士の研究 などのシークレットやプロモの行）
const baseJa = (ja) => ja.replace(/[（(][^）)]*[）)]$/, "").replace(/\s+/g, "");
const byName = new Map();
for (const s of data) for (const r of s.k) {
  const k = out[`${s.c}-${r[0]}`];
  if (!k || k === "Trainer") continue;
  for (const n of [`ja:${baseJa(r[1])}`, r[2] && `en:${r[2]}`]) if (n) { if (!byName.has(n)) byName.set(n, new Set()); byName.get(n).add(k); }
}
for (const s of data) for (const r of s.k) {
  const id = `${s.c}-${r[0]}`;
  if (out[id] !== "Trainer") continue;
  const ks = new Set([...(byName.get(`ja:${baseJa(r[1])}`) ?? []), ...(r[2] ? byName.get(`en:${r[2]}`) ?? [] : [])]);
  if (ks.size === 1) { const [k] = ks; out[id] = k; report.counts.Trainer--; report.counts[k]++; report.sources["same-name"] = (report.sources["same-name"] || 0) + 1; }
}
// ミラーの柄の版の行（型番の末尾に版の印 "025-PB" 等。scripts/mirror-variants/）は元の行と同じカードなので、元の行の種類を使う
for (const s of data) for (const r of s.k) {
  const m = /^(.+)-[A-Z]+$/.exec(r[0]);
  if (!m || !s.k.some((x) => x[0] === m[1])) continue;
  const id = `${s.c}-${r[0]}`, base = out[`${s.c}-${m[1]}`];
  if (base) out[id] = base; else delete out[id];
}
console.log(report.counts, report.sources, "食い違い", report.conflicts.length);
fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify(report, null, 1) + "\n");
if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "src", "cardKinds.json"), JSON.stringify(out) + "\n");
