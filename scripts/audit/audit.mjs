#!/usr/bin/env node
// cardData 全体の点検（2026-10-10、読み取りのみ。cardData・画像・対応表は変えない）。
//   node scripts/audit/audit.mjs      結果は scripts/audit/{blank-counts.tsv, findings.json, summary.json}
// 調べること:
//   1. 英語名・レアリティ・画像が空の行を、世代（sr）・弾・種類（ポケモン/トレーナーズ/エネルギー）ごとに数える
//      種類は TCGdex 日本語版の category（en-name-fix3/tcgdex-ja.json）、無ければ日本語名から（エネルギーで終わる→エネルギー、
//      種族名で終わる→ポケモン、それ以外→トレーナーズ）。レアリティは「弾の中にレアリティのある行があるのに空」の行を別に数える
//      （マークの無い商品は弾の全行が空で正しい）
//   2. これまでに見つかった種類の誤りがほかに残っていないか:
//      a. 日本語名: 公式サイトにある弾は、公式の一覧（official-card-scan.json）の同じ印刷記号のキーにその名前のカードがあるか。
//         旧裏〜PCG は pcg-search.com の同じ番号の名前（old-ja-check/pcg-search-titles.json）と同じか。機械翻訳らしい語（。・教授・ダーク等）を含むか
//      b. 英語名の持ち主・前置き・末尾の抜け（日本語名の 〜の・わるい・ひかる・かがやく・メガ・地方名・ex・EX・GX・V・VMAX・VSTAR・BREAK・δ・☆・◇・LV.X と英語名の対応）
//      c. 同じ弾の中の番号の重なり（同じ番号に違う名前）
//      d. 画像の対応表のファイル名の日本語名と行の日本語名が違う行（画像の取り違えの手がかり）
//   英語名の混入・行ズレ・弾の総数・同じ中身の画像は既存のスクリプト（detect-contaminated-en-names.py・check-row-alignment.mjs・
//   check-set-totals.mjs・find-duplicate-images.mjs）で確かめる（この点検ではそれらの結果も summary に入れる）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const rj = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const data = rj("src/cardData.json");
const index = rj("src/imageIndex.json");
const tja = rj("scripts/en-name-fix3/tcgdex-ja.json");
const species = rj("scripts/en-name-fix3/species-ja-en.json").species;
const scan = rj("scripts/official-card-scan.json").setMap;
const pcg = rj("scripts/old-ja-check/pcg-search-titles.json");

const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const speciesKeys = [...J.keys()].filter((k) => k.length >= 2).map((k) => k.replace(/\s+/g, ""));
const stripSuffix = (n) => n.normalize("NFKC").replace(/\s+/g, "").replace(/[（(][^）)]*[）)]$/, "").replace(/(VMAX|VSTAR|V-UNION|V|ex|EX|GX|BREAK|LV\.X|δ|☆|◇|-デルタ種|δ-デルタ種)+$/, "");
const isPokemonName = (n) => { const s = stripSuffix(n); return speciesKeys.some((k) => s.endsWith(k)); };
function kindOf(id, ja) {
  const c = tja[id]?.category;
  if (c === "Pokemon") return "ポケモン";
  if (c === "Energy") return "エネルギー";
  if (c === "Trainer") return "トレーナーズ";
  if (/エネルギー/.test(ja) && !isPokemonName(ja)) return "エネルギー";
  return isPokemonName(ja) ? "ポケモン" : "トレーナーズ";
}
const OLD = /^(PMCG\d|neo\d|E\d|PCG\d|VS1|web1)$/;
const gen = (s) => s.sr || "?";

// --- 1. 空の行 ---
const counts = new Map(); // key: sr|set|kind
const bump = (k, f) => { const o = counts.get(k) || { rows: 0, noEn: 0, noRarity: 0, noRarityInMarkedSet: 0, noImage: 0 }; o.rows++; f(o); counts.set(k, o); };
for (const s of data) {
  const marked = s.k.some((k) => k[3]);
  for (const k of s.k) {
    const id = `${s.c}-${k[0]}`, kind = kindOf(id, k[1]);
    const key = `${s.c}/${/^\d+$/.test(k[0]) ? parseInt(k[0], 10) : k[0]}`;
    bump(`${gen(s)}\t${s.c}\t${kind}`, (o) => {
      if (!k[2]) o.noEn++;
      if (!k[3]) { o.noRarity++; if (marked) o.noRarityInMarkedSet++; }
      if (!index[key]) o.noImage++;
    });
  }
}
const rows = [...counts].map(([k, v]) => [...k.split("\t"), v.rows, v.noEn, v.noRarity, v.noRarityInMarkedSet, v.noImage]);
fs.writeFileSync(path.join(__dirname, "blank-counts.tsv"), ["世代\t弾\t種類\t行\t英語名が空\tレアリティが空\tうちレアリティのある弾で空\t画像なし", ...rows.map((r) => r.join("\t"))].join("\n") + "\n");

// --- 2. 誤りの手がかり ---
const findings = { jaNotInOfficial: [], jaDiffPcg: [], jaMachineLike: [], enMissingPart: [], numberClash: [], imageNameDiff: [] };
// a. 日本語名
const norm = (s) => (s || "").normalize("NFKC").replace(/\s+/g, "").replace(/[＆&]/g, "&").replace(/[・･]/g, "");
const scanNames = new Map(); // 印刷記号（キー）→ 名前の集合
for (const [key, list] of Object.entries(scan)) scanNames.set(key, new Set(list.map((e) => norm((e.jaName ?? e.cardNameViewText ?? "").replace(/<[^>]*>/g, "")))));
const allScan = new Set([...scanNames.values()].flatMap((s) => [...s]));
for (const s of data) {
  const keys = [s.c, s.codeAlias, s.c.replace(/-P$/, "P")].filter(Boolean);
  const own = keys.map((k) => scanNames.get(k)).filter(Boolean);
  const isOld = OLD.test(s.c);
  for (const k of s.k) {
    const id = `${s.c}-${k[0]}`;
    if (/[。]|教授|素晴らしい|ダーク[^ラ]|輝く|サイキック|稲妻|オーク|ジョバンニ|ミスティ|ブロック|exp|スター$/.test(k[1])) findings.jaMachineLike.push({ id, ja: k[1] });
    if (isOld) {
      const t = pcg[`${s.c}-${k[0]}`]?.title?.split(" | ")[0];
      if (t && norm(t).replace(/δ-デルタ種|（デルタ種）/g, "δ") !== norm(k[1]).replace(/δ-デルタ種|（デルタ種）/g, "δ")) findings.jaDiffPcg.push({ id, ja: k[1], pcgSearch: t });
      continue;
    }
    if (!own.length || /^X\d+$/.test(k[0])) continue; // 公式の一覧に印刷記号のキーが無い弾・番号の無いプロモ（名前に配布の説明を付けている）は除く
    const n = norm(k[1]), base = norm(k[1].replace(/[（(][^）)]*[）)]$/, ""));
    if (!own.some((set) => set.has(n) || set.has(base)) && !allScan.has(n) && !allScan.has(base)) findings.jaNotInOfficial.push({ id, ja: k[1] });
  }
}
// b. 英語名の抜け（日本語名にある要素が英語名に無い）
const RULES = [
  [/^(?!.*(?:ボスの指令|博士の研究)).+の[^の]*$/, /'s |'s$|’s /, "持ち主（〜の）", (ja) => !/^(?:.*(?:ポケモン|げんきのかけら|エネルギー|おまもり|ばんにん|たいせつ|ふしぎ|ちから|ゆうき|きずな|ひかり|やみ|ほのお|こおり|みず|でんき|くさ|かくとう|あく|はがね|ドラゴン|フェアリー|むし|ひこう|どく|じめん|いわ|ゴースト|エスパー)の)/.test(ja) && isPokemonName(ja)],
  [/^わるい/, /^Dark /, "わるい→Dark"],
  [/^やさしい/, /^Light /, "やさしい→Light"],
  [/^ひかる/, /^Shining /, "ひかる→Shining"],
  [/^かがやく/, /^Radiant /, "かがやく→Radiant"],
  [/^(メガ|M)(?!ニウム)/, /^(Mega |M )/, "メガ→Mega/M", (ja) => isPokemonName(ja)],
  [/^アローラ/, /Alolan /, "アローラ→Alolan"],
  [/^ガラル/, /Galarian /, "ガラル→Galarian"],
  [/^ヒスイ/, /Hisuian /, "ヒスイ→Hisuian"],
  [/^パルデア/, /Paldean /, "パルデア→Paldean"],
  [/ex$/, /ex$/, "末尾 ex"],
  [/EX$/, /EX$/, "末尾 EX"],
  [/GX$/, /GX$/, "末尾 GX"],
  [/VMAX$/, /VMAX$/, "末尾 VMAX"],
  [/VSTAR$/, /VSTAR$/, "末尾 VSTAR"],
  [/[^XA-Z]V$/, /V$/, "末尾 V"],
  [/BREAK$/, /BREAK$/, "末尾 BREAK"],
  [/δ|デルタ種/, /δ/, "δ"],
  [/☆|スター$/, /☆|Star/, "☆"],
  [/◇/, /◇/, "◇"],
  [/LV\.X/, /LV\.X/, "LV.X"],
];
for (const s of data) for (const k of s.k) {
  if (!k[2]) continue;
  const ja = k[1].normalize("NFKC");
  for (const [jr, er, label, extra] of RULES) {
    if (jr.test(ja) && !er.test(k[2]) && (!extra || extra(ja))) findings.enMissingPart.push({ id: `${s.c}-${k[0]}`, ja: k[1], en: k[2], missing: label });
  }
}
// c. 番号の重なり
for (const s of data) {
  const m = new Map();
  for (const k of s.k) { const n = k[0]; if (m.has(n) && m.get(n) !== k[1]) findings.numberClash.push({ set: s.c, num: n, names: [m.get(n), k[1]] }); m.set(n, k[1]); }
}
// d. 画像のファイル名と行の名前
const fnSafe = (s) => s.replace(/[\\/:*?"<>|]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
for (const s of data) for (const k of s.k) {
  const key = `${s.c}/${/^\d+$/.test(k[0]) ? parseInt(k[0], 10) : k[0]}`;
  const p = index[key]; if (!p) continue;
  const base = decodeURIComponent(p.split("/").pop()).replace(/\.[a-z]+$/, "");
  const fileJa = base.slice(0, base.lastIndexOf(`_${s.c}-`));
  if (fileJa && norm(fileJa) !== norm(fnSafe(k[1]))) findings.imageNameDiff.push({ id: `${s.c}-${k[0]}`, ja: k[1], file: base });
}
fs.writeFileSync(path.join(__dirname, "findings.json"), JSON.stringify(findings, null, 1) + "\n");

// --- まとめ ---
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const byGen = {}, byKind = {};
for (const r of rows) {
  const [g, , kind, n, ne, nr, nrm, ni] = r;
  for (const [o, key] of [[byGen, g], [byKind, kind]]) { const x = (o[key] ??= { rows: 0, noEn: 0, noRarity: 0, noRarityInMarkedSet: 0, noImage: 0 }); x.rows += n; x.noEn += ne; x.noRarity += nr; x.noRarityInMarkedSet += nrm; x.noImage += ni; }
}
const summary = {
  at: new Date().toISOString(), sets: data.length, rows: sum((r) => r[3]),
  noEn: sum((r) => r[4]), noRarity: sum((r) => r[5]), noRarityInMarkedSet: sum((r) => r[6]), noImage: sum((r) => r[7]),
  byGen, byKind,
  findings: Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length])),
};
fs.writeFileSync(path.join(__dirname, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
