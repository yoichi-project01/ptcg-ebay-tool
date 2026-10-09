#!/usr/bin/env node
// VS1 の番号の無い特殊エネルギー3枚の日本語名・英語名を直す（2026-10-09）。
//   node scripts/old-ja-check/fix-vs1-special-energy.mjs [--apply]
// 日本語名（2つの情報源の一致）:
//   1. pcg-search.com のカードのページの title（vs0en7.php「悪エネルギー」・vs0en8.php「鋼エネルギー」・vs0en9.php「レインボーエネルギー」）。
//      行の画像が pcg-search のその画像とバイト単位で同じことを SHA-256 で確かめた（下の siteSha）。
//   2. ポケモンWiki の記事「悪エネルギー」「鋼エネルギー」の「呼称の変遷」: neo〜PCG シリーズまでは特殊エネルギーの正式名称が「悪エネルギー」「鋼エネルギー」
//      （DP から「〜(特殊エネルギー)」、LEGEND から「特殊悪/鋼エネルギー」）。VS（2001年）はこの時期。
//   Bulbapedia のカードのページの jname「特殊悪エネルギー」「特殊鋼エネルギー」は全版共通の今の呼び方なので使わない。
// 英語名: Bulbapedia「Pokémon VS (TCG)」の一覧の番号の無いエネルギー（Darkness Energy・Metal Energy・Rainbow Energy）と、
//   TCGdex 英語版に同じ名前・同じイラストレーター（pcg-search のページの illus.: Milky Isobe・Milky Isobe・Takumi Akabane）のエネルギーがあること。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName } from "../filename-utils.mjs";
import { renameHashPaths, loadHashes } from "../image-hashes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const APPLY = process.argv.includes("--apply");
const PLAN = [
  { num: "143", before: "金属エネルギー", ja: "鋼エネルギー", en: "Metal Energy", site: "vs0en8", siteSha: "6340e2e16abf9b2fc16d4a1de56e328b49115cc95f69b3219b7742e7956c5c36", illustrator: "Milky Isobe" },
  { num: "144", before: "闇のエネルギー", ja: "悪エネルギー", en: "Darkness Energy", site: "vs0en7", siteSha: "733d035d9423a5c459a5a50d8ce5a3f43faec54b4e3b5cd23568b9a73d9db2df", illustrator: "Milky Isobe" },
  { num: "151", before: "レインボーエネルギー", ja: "レインボーエネルギー", en: "Rainbow Energy", site: "vs0en9", siteSha: "6f53a6a7a8ed9f9b29e76bb08b3f95e7ef1d272989ecb3ea9a35601e13b8001b", illustrator: "Takumi Akabane" },
];
const energy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "en-name-fix3", ".cache", "tcgdex-en-Energy.json"), "utf8")).data.cards;
const hashes = loadHashes();
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === "VS1");
const fileNamePart = (ja) => buildFileName(ja, "ZZ", "1", "").replace(/_ZZ-1$/, "");
const rows = [], renames = [];
for (const p of PLAN) {
  const k = set.k.find((x) => x[0] === p.num);
  const key = `VS1/${parseInt(p.num, 10)}`;
  const r = { id: `VS1-${p.num}`, beforeJa: k[1], beforeEn: k[2], ja: p.ja, en: p.en, site: `https://pcg-search.com/card/vs/${p.site}.php`, illustrator: p.illustrator, tcgdexIds: "", imageFile: "", status: "" };
  rows.push(r);
  if (k[1] !== p.before) throw new Error(`日本語名が想定と違います: ${r.id} ${k[1]}`);
  if (hashes.get(key)?.sha256 !== p.siteSha) throw new Error(`画像が pcg-search の ${p.site} と違います: ${key}`);
  const m = energy.filter((c) => c.name === p.en && c.illustrator === p.illustrator);
  if (!m.length) { r.status = "TCGdex 英語版に同じ名前・イラストレーターのエネルギーが無い"; continue; }
  r.tcgdexIds = m.map((c) => c.id).join(" ");
  r.status = "直す";
  if (!APPLY) continue;
  if (k[2] && k[2] !== p.en) throw new Error(`英語名が既にあります: ${r.id} ${k[2]}`);
  k[1] = p.ja; k[2] = p.en;
  const rel = index[key], dir = rel.slice(0, rel.lastIndexOf("/") + 1), file = rel.slice(rel.lastIndexOf("/") + 1), at = file.lastIndexOf("_VS1-");
  const newRel = dir + fileNamePart(p.ja) + file.slice(at);
  if (newRel !== rel) {
    if (fs.existsSync(path.join(ROOT, "public", newRel))) throw new Error(`変更先のファイルが既にあります: ${newRel}`);
    fs.renameSync(path.join(ROOT, "public", rel), path.join(ROOT, "public", newRel));
    index[key] = newRel; renames.push({ key, to: newRel }); r.imageFile = `${rel} → ${newRel}`;
  }
}
const fixed = rows.filter((r) => r.status === "直す");
fs.writeFileSync(path.join(__dirname, `fix-VS1-special-energy${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: "VS1", fixed: fixed.length, rows }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  renameHashPaths(renames, index);
  fs.writeFileSync(path.join(__dirname, "fix-VS1-special-energy-changed-card-ids.txt"), fixed.map((r) => r.id).join("\n") + "\n");
}
console.log(JSON.stringify({ fixed: fixed.length, renamed: renames.length, rows: rows.map((r) => `${r.id} ${r.beforeJa}→${r.ja} / ${r.en} : ${r.status}`) }, null, 1));
