// 英語名（k[2]）を、2つの情報源で一致したものだけ入れる（2026-10-05）。
//   node scripts/fix-en-names.mjs            照合して scripts/en-name-fix/decisions-check.tsv・summary-check.json を書く（cardData は変えない）
//   node scripts/fix-en-names.mjs --apply    照合して、一致したものを cardData.json に書き込む（根拠は decisions.tsv・summary.json）
//
// 対象は scripts/en-name-fix/bulbapedia.tsv の行（英語版に無い名前で空欄にした71件と、デルタ種の28件）。
// 1. Bulbapedia の日本版の弾のカード一覧の英語名（bulbapedia.tsv。ブラウザで各弾のページの Setlist から書き写したもの）
// 2. TCGdex 英語版に、その英語名で、日本語版（TCGdex /v2/ja/cards）と同じイラストレーター・同じ種類のカードがあるか
//    - トレーナーズ: 種類（サポート/グッズ/ポケモンのどうぐ）とイラストレーターが同じ
//    - ポケモン: 全国図鑑番号とイラストレーターが同じ
//    - 旧裏・PCG（TCGdex 日本語版にイラストレーターが無い）: 対応する英語版の弾（Bulbapedia の同じページの英語版の弾）に、
//      全国図鑑番号が同じでその英語名のカードがある
// 1 と 2 が一致したものだけ採用。一致しないものは空欄のまま（デルタ種は今の値のまま）。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts", "en-name-fix");
const DATA = path.join(ROOT, "src", "cardData.json");
const APPLY = process.argv.includes("--apply");

// Bulbapedia のページ（英語版の弾）→ TCGdex 英語版の弾（旧裏・PCG の照合に使う）
const EN_SET_OF_PAGE = {
  "EX Unseen Forces (TCG)": "ex10", "EX Delta Species (TCG)": "ex11", "EX Holon Phantoms (TCG)": "ex13",
  "EX Crystal Guardians (TCG)": "ex14", "EX Dragon Frontiers (TCG)": "ex15", "Expedition Base Set (TCG)": "ecard1", "Neo Genesis (TCG)": "neo1",
};
const TYPE_OF = { Supporter: "Supporter", Item: "Item", "Pokémon Tool": "Tool" };
const norm = (s) => (s ?? "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const low = (s) => norm(s).toLowerCase();
const isPocket = (id) => /^(A\d|B\d|P-A)/.test(id);

async function getJson(url, body) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) } : { signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`取得できません: ${url}`);
}
const enByName = new Map();
async function englishCards(name) {
  if (!enByName.has(name)) {
    const q = `{ cards(filters:{name:${JSON.stringify(name)}}) { id name illustrator category trainerType dexId } }`;
    const j = await getJson("https://api.tcgdex.net/v2/graphql", { query: q });
    enByName.set(name, (j?.data?.cards ?? []).filter((c) => !isPocket(c.id) && norm(c.name) === norm(name)));
  }
  return enByName.get(name);
}

const rows = readFileSync(path.join(DIR, "bulbapedia.tsv"), "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [id, page, jpSet, en, type] = l.split("\t"); return { id, page, jpSet, en, type }; });
const raw = readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const bySet = new Map(data.map((s) => [s.c, s]));

const out = [];
for (const r of rows) {
  const set = r.id.slice(0, r.id.lastIndexOf("-")), num = r.id.slice(r.id.lastIndexOf("-") + 1);
  const k = bySet.get(set)?.k.find((x) => x[0] === num);
  const ja = await getJson(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(r.id)}`);
  const cands = await englishCards(r.en);
  let match = [], rule = "";
  if (ja?.category === "Trainer") {
    rule = "トレーナーズ: 英語名・イラストレーター・種類";
    match = cands.filter((c) => c.category === "Trainer" && c.trainerType === ja.trainerType && TYPE_OF[r.type] === ja.trainerType && low(c.illustrator) === low(ja.illustrator));
  } else if (ja?.category === "Pokemon" && ja.illustrator) {
    rule = "ポケモン: 英語名・イラストレーター・図鑑番号";
    match = cands.filter((c) => c.category === "Pokemon" && low(c.illustrator) === low(ja.illustrator) && (c.dexId ?? []).some((d) => (ja.dexId ?? []).includes(d)));
  } else if (ja?.category === "Pokemon") {
    const enSet = EN_SET_OF_PAGE[r.page];
    rule = `ポケモン（日本語版にイラストレーター無し）: 英語版の弾 ${enSet ?? "?"} に同じ英語名・図鑑番号`;
    match = enSet ? cands.filter((c) => c.id.startsWith(`${enSet}-`) && (c.dexId ?? []).some((d) => (ja.dexId ?? []).includes(d))) : [];
  }
  const ok = match.length > 0;
  const before = k?.[2] ?? null;
  // 書き換えてよいのは、空欄（71件）か、英語名から δ・☆ を除いた値（デルタ種の今の値）のときだけ
  const expectedBefore = ["", norm(r.en.replace(/\s*(☆\s*)?δ$/, ""))];
  const writable = k && expectedBefore.includes(norm(before));
  const status = !k ? "cardData に無い" : !ok ? "空欄のまま（2つの情報源で一致しない）" : before === r.en ? "変更なし（すでに同じ）" : !writable ? "書き換えない（今の値が想定外）" : "直す";
  if (APPLY && status === "直す") k[2] = r.en;
  out.push({ id: r.id, ja: k?.[1] ?? "", before, after: status === "直す" ? r.en : before, bulbapedia: r.en, bulbapediaPage: r.page, jaIllustrator: ja?.illustrator ?? "", jaCategory: ja?.trainerType ?? ja?.category ?? "", rule, tcgdexEnglish: match.map((c) => `${c.id} ${c.name} (${c.illustrator ?? ""})`).join("; "), status });
}

if (APPLY) writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
const cols = ["id", "ja", "before", "after", "bulbapedia", "bulbapediaPage", "jaIllustrator", "jaCategory", "rule", "tcgdexEnglish", "status"];
writeFileSync(path.join(DIR, APPLY ? "decisions.tsv" : "decisions-check.tsv"), "﻿" + [cols.join("\t"), ...out.map((o) => cols.map((c) => String(o[c] ?? "").replace(/[\t\r\n]/g, " ")).join("\t"))].join("\r\n"));
const count = out.reduce((m, o) => (m[o.status] = (m[o.status] ?? 0) + 1, m), {});
writeFileSync(path.join(DIR, APPLY ? "summary.json" : "summary-check.json"), JSON.stringify({ at: new Date().toISOString(), applied: APPLY, total: out.length, byStatus: count, notFixed: out.filter((o) => o.status !== "直す" && o.status !== "変更なし（すでに同じ）").map((o) => `${o.id} ${o.ja}: ${o.status}（Bulbapedia ${o.bulbapedia}）`) }, null, 1));
console.log(count);
for (const o of out.filter((o) => o.status !== "直す")) console.log(`${o.id} ${o.ja} → ${o.bulbapedia}: ${o.status}`);
