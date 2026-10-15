#!/usr/bin/env node
// ADV 世代の拡張パック5弾を足す（2026-10-15、ユーザーの確認済み）。  node scripts/adv/add-adv.mjs --set ADV1 [--apply]
// 公式のカード検索・TCGdex（弾はあるがカードが0件）には無いため、公式以外の3つの情報源の一致で足す:
//   1. ポケモンWiki の弾のページの表（pokemonwiki-{弾}-2026-10-15.wikitext。番号・種類・タイプ・名前・レアリティの印 ●◆★☆）
//   2. pcg-search.com のカードのページ（pcg-search-adv-2026-10-15.json。fetch-pcg-search-adv.mjs。名前・番号・レアリティの印・イラストレーター・画像）
//   3. Bulbapedia の日本版の一覧（bulbapedia-adv-ja-2026-10-15.tsv。番号・英語名・種類。英語版の弾のページにある日本版の一覧）
//   番号・名前・レアリティの印（1 と 2）がすべて一致し、Bulbapedia の番号の数・ポケモン/トレーナーズの別が合うものを足す。
//   レアリティは ●→C、◆→U、★→R、☆（ex）→R（PCG の ex の行と同じ。ユーザーの指示）。Bulbapedia のレアリティ（Rare/Rare Holo 等）は
//   4枚（ADV1-028・ADV2-053・ADV3-023・ADV3-040）でポケモンWiki と違うが、pcg-search はポケモンWiki と同じなのでそちらを使う。
//   画像は pcg-search の画像（旧裏〜PCG と同じ出どころ）。強化拡張パックex1 の番号の無い基本エネルギー8枚（-/080）は足さない（ユーザーの指示）。
// 英語名: ポケモンは Bulbapedia の名前と日本語名から作った規則の名前（en-name-fix3/species-ja-en.json）の一致。
//   規則で作れない名前（アクア団の〜等）とトレーナーズ・エネルギーは、Bulbapedia の名前のカードが TCGdex 英語版の対応する弾（ex1〜ex5）にあり、
//   同じ種類・同じイラストレーター（日本版のイラストレーターは pcg-search のページ）であること。確かめられなければ空欄。
// 弾コードは pcg-search・ポケモンWiki に合わせる（とかれた封印＝ADV4、ふたつの野望＝ADVex1）。TCGdex の日本版は発売順に ADV4＝ふたつの野望・ADV5＝とかれた封印（sources.json に別名として記録）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildFileName, writeFileAtomic } from "../filename-utils.mjs";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, "sources.json"), "utf8"));
const meta = SRC.sets[SET];
if (!meta) throw new Error(`--set は ${Object.keys(SRC.sets).join("・")} のどれか: ${SET}`);

// 1. ポケモンWiki
const wiki = fs.readFileSync(path.join(__dirname, `pokemonwiki-${SET}-2026-10-15.wikitext`), "utf8").replace(/\r\n/g, "\n");
const pw = [];
for (const r of wiki.split(/\n\|-/).slice(1)) {
  const c = [...r.matchAll(/\n\|\s*([^\n]*)/g)].map((m) => m[1].trim());
  if (c.length >= 5 && /^\d{3}\/\d{3}$/.test(c[0])) pw.push({ num: c[0], kind: c[1], type: c[2], name: c[3].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1"), mark: c[4] });
}
// 2. pcg-search
const ps = JSON.parse(fs.readFileSync(path.join(__dirname, "pcg-search-adv-2026-10-15.json"), "utf8"));
// 3. Bulbapedia
const bp = fs.readFileSync(path.join(__dirname, "bulbapedia-adv-ja-2026-10-15.tsv"), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t")).filter((r) => r[0] === SET);
const den = String(meta.of).padStart(3, "0");
if (pw.length !== meta.of || bp.length !== meta.of) throw new Error(`枚数が合わない: ポケモンWiki ${pw.length}・Bulbapedia ${bp.length}・総数 ${meta.of}`);

const N = (s) => s.normalize("NFKC").replace(/\s/g, "");
const RAR = { "●": "C", "◆": "U", "★": "R", "☆": "R" };
const species = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const ruleEn = (ja) => { const n = N(ja); if (species.has(n)) return species.get(n); const m = n.match(/^(.+)ex$/); return m && species.has(m[1]) ? `${species.get(m[1])} ex` : null; };
const enCache = ["Pokemon", "Trainer", "Energy"].flatMap((c) => JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", ".cache", `tcgdex-en-${c}.json`), "utf8")).data.cards)
  .filter((c) => c.id.startsWith(`${meta.tcgdexEn}-`));
const BP_KIND = { P: "Pokemon", I: "Item", S: "Supporter", T: "Tool", M: "Item", D: "Stadium", E: "Energy" };
const tKind = (c) => (c.category === "Trainer" ? c.trainerType : c.category);
const illKey = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const nameKey = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const rows = [];
const report = [];
for (let i = 0; i < meta.of; i++) {
  const w = pw[i], b = bp[i];
  const local = String(i + 1).padStart(3, "0");
  const p = ps[`${meta.pcg}${local}`];
  if (w.num !== `${local}/${den}` || b[1] !== w.num || !p || `${p.num}/${p.den}` !== w.num) throw new Error(`番号が合わない: ${SET} ${local}`);
  if (N(p.name) !== N(w.name)) throw new Error(`ポケモンWiki と pcg-search の名前が合わない: ${SET}-${local} ${w.name} ${p.name}`);
  // pcg-search はホロのレアに「★(キラ)」と書く（印は ★。ホロかどうかは記録だけ残し、レアリティは ★→R のまま）
  const holo = /\(キラ\)$/.test(p.rarity);
  if (p.rarity.replace(/\(キラ\)$/, "") !== w.mark || !RAR[w.mark]) throw new Error(`レアリティの印が合わない: ${SET}-${local} ${w.mark} ${p.rarity}`);
  if ((w.kind === "ポケモン") !== (b[3] === "P")) throw new Error(`ポケモン/トレーナーズの別が合わない: ${SET}-${local} ${w.kind} ${b[3]}`);
  let en = "", how = "";
  const rule = w.kind === "ポケモン" ? ruleEn(w.name) : null;
  if (rule && rule === b[2]) { en = b[2]; how = "規則の名前と Bulbapedia が一致"; }
  else {
    const kind = BP_KIND[b[3]];
    const c = enCache.filter((x) => nameKey(x.name) === nameKey(b[2]) && (tKind(x) === kind || (kind === "Item" && tKind(x) === "Item")));
    const same = c.filter((x) => illKey(x.illustrator) && illKey(x.illustrator) === illKey(p.illustrator));
    if (same.length) { en = b[2]; how = `TCGdex 英語版 ${same.map((x) => x.id).join(" ")}（${kind}・${p.illustrator}）と一致`; }
    else how = c.length ? `TCGdex 英語版 ${c.map((x) => `${x.id}:${x.illustrator}`).join(" ")} とイラストレーター（${p.illustrator}）が違う` : `TCGdex 英語版 ${meta.tcgdexEn} に同じ名前・種類が無い`;
  }
  rows.push({ local, ja: w.name, en, rarity: RAR[w.mark], p, how, bp: b, holo });
}
console.log(`${SET} ${meta.ja}: ${rows.length}行（英語名あり ${rows.filter((r) => r.en).length}）レアリティ ${JSON.stringify(rows.reduce((a, r) => ((a[r.rarity] = (a[r.rarity] || 0) + 1), a), {}))}`);
for (const r of rows.filter((x) => !x.en)) console.log(`  英語名なし ${SET}-${r.local} ${r.ja}（Bulbapedia ${r.bp[2]}）: ${r.how}`);
if (!APPLY) process.exit(0);

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
if (data.some((s) => s.c === SET)) throw new Error(`既に ${SET} があります`);
const CACHE = path.join(ROOT, "scripts", "pcg-search-cache", "adv", "img");
for (const r of rows) {
  const buf = fs.readFileSync(path.join(CACHE, path.basename(r.p.image)));
  if (crypto.createHash("sha256").update(buf).digest("hex") !== r.p.sha256) throw new Error(`画像の SHA-256 が取得時と違う: ${r.p.image}`);
  const rel = path.posix.join("cards", "ADV", SET, buildFileName(r.ja, SET, r.local, r.rarity, meta.of) + path.extname(r.p.image));
  await writeFileAtomic(path.join(ROOT, "public", rel), buf);
}
data.push({ c: SET, ja: meta.ja, en: meta.en, psaName: meta.psaName, sr: "ADV", of: meta.of, y: meta.y, k: rows.map((r) => [r.local, r.ja, r.en, r.rarity]) });
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
rebuildCardKinds();
fs.writeFileSync(path.join(__dirname, `${SET}-added-card-ids-2026-10-15.txt`), rows.map((r) => `${SET}-${r.local}`).join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-rows-2026-10-15.tsv`), rows.map((r) => [`${SET}-${r.local}`, r.ja, r.rarity, r.holo ? "キラ" : "", r.p.illustrator, r.bp[2], r.en, r.how].join("\t")).join("\n") + "\n");
console.log(`${SET}: ${rows.length}行を足した`);
