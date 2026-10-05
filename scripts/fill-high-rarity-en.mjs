// 英語名が空の高レアのカード（scripts/en-name-fix2/targets.json）に、2つの情報源で一致した英語名だけを入れる（2026-10-06）。
//   node scripts/fill-high-rarity-en.mjs                  照合して decisions-check.tsv・summary-check.json を書く（cardData は変えない）
//   node scripts/fill-high-rarity-en.mjs --apply --set S4a  1弾分を cardData.json に書き込む（根拠は decisions.tsv・summary.json、{弾}-changed-card-ids.txt）
//
// 入力（scripts/en-name-fix2/）:
//   targets.json     対象 2,675行（英語名が空で、レアリティが SAR・SR・HR・UR・AR・CSR・CHR・BWR・MUR・K・A・H・PR・ACE 等か、番号が弾の総数を超えるもの）
//   tcgdex-ja.json   TCGdex 日本語版（/v2/ja/cards/{弾}-{番号}）のイラストレーター・種類・図鑑番号
//   illustrators.json  TCGdex に無いものを公式 details.php から（fetch-illustrators.mjs）
//   bulbapedia.tsv   Bulbapedia の各弾のページの日本版の一覧（番号の分母が cardData の総数と一致する節だけ）。列 page・setArg はページ名と節の見出し
//   .cache/tcgdex-en-*.json  TCGdex 英語版の全カード（GraphQL、カテゴリごと。.gitignore 対象）
// 1. Bulbapedia の日本版の弾のカード一覧の英語名（bulbapedia.tsv。ブラウザで各弾のページの Setlist から書き写したもの）
// 2. TCGdex 英語版に、その英語名で、同じイラストレーター・同じ種類のカードがあること
//    - イラストレーター: TCGdex 日本語版（tcgdex-ja.json）、無ければ公式 details.php（illustrators.json。番号が一致したものだけ）
//    - 種類: ポケモン／トレーナーズ（サポート・グッズ・どうぐ・スタジアム）／エネルギー。ポケモンは全国図鑑番号も分かれば一致を求める
//    - 英語版の候補が複数あっても、英語名が1つに決まれば採用（同じ名前の別の刷り）
// 名前の付け方の確認（英語版の規則。合わないものは入れない）:
//   かがやく↔"Radiant "、ひかる↔"Shining "、プリズムスター↔末尾" ◇"、ex/EX/GX/V/VMAX/VSTAR/V-UNION/BREAK の末尾、
//   アローラ↔Alolan・ガラル↔Galarian・ヒスイ↔Hisuian・パルデア↔Paldean、"&"（TAG TEAM）、英語名が Mega/M で始まるなら日本語名もメガで始まる
// 書き込む英語名は Bulbapedia の表記（英語版のカードの正式な書き方 "Lycanroc-GX"・"M Rayquaza-EX"）。プリズムスターは TCGdex と同じ ◇（Bulbapedia は ♢）。
// TCGdex 英語版は "Lycanroc GX" と "Lycanroc-GX" が混在するため、空白・ハイフンだけが違う同じ名前として照合する（ex と EX は区別する）。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts", "en-name-fix2");
const DATA = path.join(ROOT, "src", "cardData.json");
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.includes("--set") ? process.argv[process.argv.indexOf("--set") + 1] : null;
if (APPLY && !ONLY) throw new Error("--apply は --set で1弾ずつ指定してください");

const load = (f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
const targets = load("targets.json");
const tja = load("tcgdex-ja.json");
const ill = existsSync(path.join(DIR, "illustrators.json")) ? load("illustrators.json") : {};
const isPocket = (id) => /^(A\d|B\d|P-A)/.test(id);
const en = ["Pokemon", "Trainer", "Energy"].flatMap((c) => load(`.cache/tcgdex-en-${c}.json`).data.cards).filter((c) => !isPocket(c.id));

const norm = (s) => (s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
// 比較用のキー。空白・ハイフン・大文字小文字の違いは同じとみなす（"Lycanroc GX" と "Lycanroc-GX"）が、末尾の ex（SV 世代）と EX（XY 世代）は別のカードなので区別する
const key = (s) => { const n = norm(s).replace(/♢/g, "◇"); const tail = /\bex$/.test(n) ? "|ex" : /EX$/.test(n) ? "|EX" : ""; return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-–.']/g, "") + tail; };
const illKey = (s) => norm(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
// イラストレーターの表記ゆれ（公式・TCGdex の綴りの誤り。例 Souichirou/Souchirou、Ryta/Ryuta）は、8文字以上で2文字以内の違いなら同じ人とみなす
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const sameIll = (a, b) => { const x = illKey(a), y = illKey(b); if (!x || !y) return false; return x === y || (Math.min(x.length, y.length) >= 8 && lev(x, y) <= 2); };
const enByKey = new Map();
for (const c of en) { const k = key(c.name); if (!enByKey.has(k)) enByKey.set(k, []); enByKey.get(k).push(c); }

const bp = new Map();
for (const l of readFileSync(path.join(DIR, "bulbapedia.tsv"), "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean)) {
  const [id, page, setArg, name, type] = l.split("\t");
  if (!bp.has(id)) bp.set(id, []);
  bp.get(id).push({ page, setArg, name, type });
}

const TRAINER_OF = { Supporter: "Supporter", Item: "Item", "Pokémon Tool": "Tool", Stadium: "Stadium", "Technical Machine": "Technical Machine" };
function kindOfBp(type) {
  if (TRAINER_OF[type]) return { category: "Trainer", trainerType: TRAINER_OF[type] };
  if (type === "Trainer") return { category: "Trainer", trainerType: null };
  if (/Energy/.test(type)) return { category: "Energy", trainerType: null };
  return type ? { category: "Pokemon", trainerType: null } : null;
}
const SUFFIX = /(V-UNION|VMAX|VSTAR|GX|EX|ex|V|BREAK)$/;
function ruleErrors(ja, enName, category) {
  const e = [];
  const has = (b, a, label) => { if (b !== a) e.push(label); };
  has(ja.startsWith("かがやく"), enName.startsWith("Radiant "), "かがやく↔Radiant");
  has(ja.startsWith("ひかる"), enName.startsWith("Shining "), "ひかる↔Shining");
  has(/プリズムスター/.test(ja), /\s◇$/.test(enName), "プリズムスター↔◇");
  if (category === "Pokemon") { // トレーナーズは「ポッドとデントとコーン」「ヒスイの仲間たち（Friends in Hisui）」のように対応しないので確かめない
    has(/&|＆/.test(ja), /&/.test(enName), "&");
    for (const [j, w] of [["アローラ", "Alolan"], ["ガラル", "Galarian"], ["ヒスイ", "Hisuian"], ["パルデア", "Paldean"]]) has(ja.includes(j), enName.includes(w), `${j}↔${w}`);
  }
  if (/^(Mega |M )/.test(enName) && !ja.replace(/^(かがやく|ひかる)/, "").startsWith("メガ")) e.push("Mega↔メガ");
  if (category === "Pokemon") {
    const js = (ja.replace(/\s*プリズムスター$/, "").match(SUFFIX) || [])[1] ?? null;
    const es = (enName.replace(/\s*◇$/, "").replace(/\s/g, "").replace(/-(GX|EX)$/, "$1").match(SUFFIX) || [])[1] ?? null;
    if (js !== es) e.push(`末尾 ${js ?? "なし"}↔${es ?? "なし"}`);
  }
  return e;
}

const data = JSON.parse(readFileSync(DATA, "utf8"));
const bySet = new Map(data.map((s) => [s.c, s]));
const out = [];
for (const t of targets) {
  const j = tja[t.id] || null;
  const illustrator = j?.illustrator || ill[t.id]?.illustrator || null;
  const illSrc = j?.illustrator ? "TCGdex日本語版" : ill[t.id]?.illustrator ? `公式details.php(${ill[t.id].cardId})` : "";
  const bps = bp.get(t.id) || [];
  const r = { id: t.id, set: t.set, ja: t.ja, rarity: t.rarity, bpPage: bps[0]?.page ?? "", bpSet: bps[0]?.setArg ?? "", bpName: bps[0]?.name ?? "", bpType: bps[0]?.type ?? "", illustrator: illustrator ?? "", illSrc, en: "", tcgdexIds: "", status: "" };
  out.push(r);
  if (!bps.length) { r.status = "Bulbapedia の一覧に無い"; continue; }
  if (new Set(bps.map((b) => b.name)).size > 1) { r.status = "Bulbapedia の同じ番号に複数の名前"; continue; }
  if (!illustrator) { r.status = "イラストレーターが分からない（TCGdex・公式とも無し）"; continue; }
  const kb = kindOfBp(r.bpType);
  const kind = j?.category ? { category: j.category, trainerType: j.trainerType ?? null } : kb;
  if (!kind) { r.status = "種類が分からない"; continue; }
  if (kb && j?.category && (kb.category !== j.category || (kb.trainerType && j.trainerType && kb.trainerType !== j.trainerType && !(kb.trainerType === "Item" && j.trainerType === "Tool")))) { /* Bulbapedia はどうぐを Item と書くことがある */ r.status = `種類が食い違う（Bulbapedia ${r.bpType}／TCGdex ${j.category} ${j.trainerType ?? ""}）`; continue; }
  const sameName = enByKey.get(key(r.bpName)) || [];
  if (!sameName.length) { r.status = "TCGdex 英語版にその英語名のカードが無い"; continue; }
  const sameKind = sameName.filter((c) => c.category === kind.category && (kind.category !== "Trainer" || !kind.trainerType || c.trainerType === kind.trainerType)
    && (!(j?.dexId?.length && c.dexId?.length) || c.dexId.some((d) => j.dexId.includes(d))));
  if (!sameKind.length) { r.status = "TCGdex 英語版の同じ名前のカードと種類（図鑑番号）が違う"; continue; }
  const hit = sameKind.filter((c) => sameIll(c.illustrator, illustrator));
  const illNote = [...new Set(hit.filter((c) => illKey(c.illustrator) !== illKey(illustrator)).map((c) => c.illustrator))];
  if (illNote.length) r.note = `イラストレーターの表記ゆれ: ${illustrator} / ${illNote.join(" / ")}`;
  if (!hit.length) { r.status = `TCGdex 英語版の同じ名前のカードとイラストレーターが違う（英語版: ${[...new Set(sameKind.map((c) => c.illustrator))].join(" / ")}）`; continue; }
  let names = [...new Set(hit.map((c) => norm(c.name)))];
  // TCGdex 英語版で同じ名前の書き方が割れている（"Lycanroc GX" / "Lycanroc-GX"）ときは、Bulbapedia と同じ書き方を使う
  const bpForm = norm(r.bpName).replace(/♢/g, "◇");
  if (names.length > 1 && names.includes(bpForm)) names = [bpForm];
  if (names.length > 1) { r.status = `TCGdex 英語版の表記が1つに決まらない（${names.join(" / ")}）`; continue; }
  const errs = ruleErrors(t.ja, bpForm, kind.category);
  r.tcgdexIds = hit.map((c) => c.id).join(" ");
  if (errs.length) { r.status = `名前の付け方が合わない（${errs.join("・")}）`; r.en = names[0]; continue; }
  r.en = bpForm; r.status = "入れる"; // 照合で同じ名前と確かめた Bulbapedia の書き方
}

const sum = {};
for (const r of out) { const s = (sum[r.set] ??= { 対象: 0, 入れる: 0, 空欄のまま: 0, 理由: {} }); s.対象++; if (r.status === "入れる") s.入れる++; else { s.空欄のまま++; const k = r.status.replace(/（.*$/, ""); s.理由[k] = (s.理由[k] ?? 0) + 1; } }
const cols = ["id", "ja", "rarity", "bpPage", "bpSet", "bpName", "bpType", "illustrator", "illSrc", "en", "tcgdexIds", "status", "note"];
const tsv = (rows) => [cols.join("\t"), ...rows.map((r) => cols.map((c) => String(r[c] ?? "").replace(/[\t\n]/g, " ")).join("\t"))].join("\n") + "\n";

if (!APPLY) {
  writeFileSync(path.join(DIR, "decisions-check.tsv"), tsv(out));
  writeFileSync(path.join(DIR, "summary-check.json"), JSON.stringify(sum, null, 1));
  const tot = Object.values(sum).reduce((a, s) => [a[0] + s.入れる, a[1] + s.空欄のまま], [0, 0]);
  const why = {}; for (const r of out) if (r.status !== "入れる") { const k = r.status.replace(/（.*$/, ""); why[k] = (why[k] ?? 0) + 1; }
  console.log(`入れる ${tot[0]}・空欄のまま ${tot[1]}`); console.log(why);
} else {
  const set = bySet.get(ONLY);
  const changed = [];
  for (const r of out.filter((x) => x.set === ONLY && x.status === "入れる")) {
    const row = set.k.find((k) => `${set.c}-${k[0]}` === r.id);
    if (!row || row[1] !== r.ja) throw new Error(`cardData の行が想定と違います: ${r.id}`);
    if (row[2] === r.en) continue;
    if (row[2]) throw new Error(`英語名が空ではありません: ${r.id} ${row[2]}`);
    row[2] = r.en; changed.push(r.id);
  }
  const raw = readFileSync(DATA, "utf8");
  writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  // 根拠（全弾分）は毎回書き直す。cardData に入れた弾の結果は check 時と同じ
  writeFileSync(path.join(DIR, "decisions.tsv"), tsv(out));
  writeFileSync(path.join(DIR, "summary.json"), JSON.stringify(sum, null, 1));
  writeFileSync(path.join(DIR, `${ONLY}-changed-card-ids.txt`), changed.join("\n") + (changed.length ? "\n" : ""));
  console.log(`[${ONLY}] ${changed.length}件に英語名を入れました（空欄のまま ${sum[ONLY]?.空欄のまま ?? 0}件）`);
}
