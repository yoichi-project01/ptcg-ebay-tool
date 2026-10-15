#!/usr/bin/env node
// 番号付きの古いプロモ（ADV-P・PLAY・PCG-P、のちに E-P・E-T・E-J）を弾として足す（2026-10-15、ユーザーの確認済み）。
//   node scripts/old-promos/add-numbered-promos.mjs --set ADV-P [--apply]
// 公式のカード検索に無いため、公式以外の情報源の一致で足す:
//   1. pcg-search.com のカードのページ（pcg-search-promos-2026-10-15.json。名前・印刷された番号「(001/063)」・イラストレーター・画像）
//   2. ポケモンWiki の一覧（pokemonwiki-{弾}-2026-10-15.wikitext。番号・日本語名・入手法）
//   3. Bulbapedia の一覧（bulbapedia-numbered-promos-2026-10-15.txt。番号・英語名・種類）と各カードのページの日本語名 jname
//      （bulbapedia-jnames-2026-10-15.txt）。どちらも SHA-256 をブラウザの値と照合
//   番号ごとに、pcg-search の名前がポケモンWiki か Bulbapedia の jname の名前と一致し（日本語名は2つ以上の一致）、Bulbapedia にその番号があって
//   ポケモン/トレーナーズの別が合うものを足す。ポケモンWiki の一覧に無いもの（PCG-P のトレーナーズ・エネルギー、e の P・T・J）は jname との一致で決める。
//   どれかが無い・合わないものは足さずに保留の一覧（{弾}-held-2026-10-15.tsv）に出す。
//   レアリティはプロモに印が無いので空欄（pcg-search の「キラ」は rows の tsv に記録だけ）。画像は pcg-search。
// 英語名: ポケモンは Bulbapedia の名前と日本語名から作った規則の名前（種族名・ex・☆・δ）の一致。それ以外は Bulbapedia の名前のカードが
//   TCGdex 英語版（EX シリーズ・POP・Nintendo プロモ）に同じ種類・同じイラストレーターであること。確かめられなければ空欄。
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
const CONF = {
  "ADV-P": { groups: ["adv:プロモ"], wiki: "ADV-P", wikiNumCol: 3, sr: "ADV", en: "Promo", psaName: "Promo", ja: "" },
  "PLAY": { groups: ["adv:プレイヤーズ", "pcg:プレイヤーズ"], wiki: "PLAY", wikiNumCol: 2, sr: "PCG", en: "Play Promo", psaName: "Play Promo", ja: "" },
  "PCG-P": { groups: ["pcg:プロモ"], wiki: "PCG-P", wikiNumCol: 3, sr: "PCG", en: "Promo", psaName: "Promo", ja: "" },
  // e の P・T・J は弾コードを E1〜E5 にそろえて E-P・E-T・E-J、印刷された記号は codeAlias（ユーザーの指示）。ポケモンWiki の一覧は無い（P,T,J の節は stub）
  "E-P": { groups: ["e:プロモ"], bp: "P", printed: "P", codeAlias: "P", sr: "e", en: "Promo", psaName: "Promo", ja: "" },
  "E-T": { groups: ["e:トレーナーズ", "adv:トレーナーズ"], bp: "T", printed: "T", codeAlias: "T", sr: "e", en: "Promo Trainers Magazine", psaName: "Promo Trainers Magazine", ja: "" },
  "E-J": { groups: ["e:J"], bp: "J", printed: "J", codeAlias: "J", sr: "e", en: "", psaName: "", ja: "" },
};
const conf = CONF[SET];
if (!conf) throw new Error(`--set は ${Object.keys(CONF).join("・")} のどれか: ${SET}`);
const printed = conf.printed ?? SET;

// 1. pcg-search（印刷された番号 → ページ）
const ps = JSON.parse(fs.readFileSync(path.join(__dirname, "pcg-search-promos-2026-10-15.json"), "utf8"));
const psByNum = new Map();
for (const [page, v] of Object.entries(ps)) if (conf.groups.includes(v.group) && /^\d{3}$/.test(v.num)) {
  if (psByNum.has(v.num)) throw new Error(`pcg-search で番号が重なる: ${SET} ${v.num}`);
  psByNum.set(v.num, { page, ...v });
}
// 2. ポケモンWiki
const wiki = conf.wiki ? fs.readFileSync(path.join(__dirname, `pokemonwiki-${conf.wiki}-2026-10-15.wikitext`), "utf8").replace(/\r\n/g, "\n") : "";
const pw = new Map();
for (const r of wiki.split(/\n\|-/).slice(1)) {
  const cells = [...r.split("\n|}")[0].matchAll(/\n\|[ \t]?([^\n]*)/g)].map((m) => m[1].trim());
  const m = (cells[conf.wikiNumCol] || "").match(new RegExp(`^([\\d,]+)/${printed.replace("-", "\\-")}`));
  if (!m) continue;
  const name = cells[conf.wikiNumCol - 1].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");
  const kind = conf.wikiNumCol === 3 ? cells[1] : cells[0];
  const how = cells[conf.wikiNumCol + 1] ?? "", date = conf.wikiNumCol === 3 ? cells[0] : "";
  for (const n of m[1].split(",")) pw.set(n.trim().padStart(3, "0"), { name, kind, how: how.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/<br\s*\/?>/g, "・"), date });
}
// 3. Bulbapedia
const BP = conf.bp ?? SET;
const bpLine = fs.readFileSync(path.join(__dirname, "bulbapedia-numbered-promos-2026-10-15.txt"), "utf8").split(/\r?\n/).find((l) => l.startsWith(`${BP}\t`));
const bp = new Map(bpLine.split("\t")[1].split(" ").map((t) => { const m = t.match(/^(\d{3})=(.*)\/([A-Za-z])$/); return [m[1], { name: m[2], kind: m[3] }]; }));

const N = (s) => s.normalize("NFKC").replace(/[\s_]/g, "");
// Bulbapedia の各カードのページの jname（PLAY の ☆ 5枚は英語版 POP5 のページに転送されるので、別の行 PLAY-STAR を英語名の種族で結び付ける）
const jnLines = Object.fromEntries(fs.readFileSync(path.join(__dirname, "bulbapedia-jnames-2026-10-15.txt"), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t")));
const jn = new Map((jnLines[BP] ?? "").split(" ").filter(Boolean).map((t) => { const i = t.indexOf("="); return [t.slice(0, i), t.slice(i + 1)]; }));
const species = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
function ruleEn(ja) {
  let n = N(ja), suf = "";
  for (const [j, e] of [["δ-デルタ種", " δ"], ["δ", " δ"], ["☆", " ☆"], ["ex", " ex"]]) if (n.endsWith(j) && species.has(n.slice(0, -j.length))) { suf = e; n = n.slice(0, -j.length); break; }
  return species.has(n) ? species.get(n) + suf : null;
}
const enCache = ["Pokemon", "Trainer", "Energy"].flatMap((c) => JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", ".cache", `tcgdex-en-${c}.json`), "utf8")).data.cards)
  .filter((c) => /^(ex\d+|pop\d+|np)-/.test(c.id));
const BP_KIND = { e: "Energy", t: "Tool", d: "Stadium", s: "Supporter", r: "Item" };
const tKind = (c) => (c.category === "Trainer" ? c.trainerType : c.category);
const key = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9☆δ]/g, "");
const bpName = (s) => (/^_{5}/.test(s) ? "_____" + s.slice(5).replace(/_/g, " ") : s.replace(/_/g, " ")).replace(/\s+\[[^\]]*stamp\]$/i, "").replace(/\s+/g, " ").trim();

if (BP === "PLAY") for (const t of jnLines["PLAY-STAR"].split(" ")) {
  const j = t.slice(t.indexOf("=") + 1);
  for (const [num, b] of bp) if (!jn.has(num) && ruleEn(j) && key(ruleEn(j)) === key(bpName(b.name))) jn.set(num, j);
}
const numbers = [...new Set([...psByNum.keys(), ...pw.keys(), ...bp.keys()])].sort();
const rows = [], held = [];
for (const num of numbers) {
  const p = psByNum.get(num), w = pw.get(num), b = bp.get(num), j = jn.get(num);
  const hold = (why) => held.push([`${SET}-${num}`, p?.name ?? "", w?.name ?? "", j ?? "", b ? bpName(b.name) : "", why]);
  if (!p) { hold("pcg-search に無い"); continue; }
  if (!b) { hold("Bulbapedia の一覧に無い"); continue; }
  const jaSrc = [w && N(p.name) === N(w.name) ? "ポケモンWiki" : "", j && N(p.name) === N(j) ? "Bulbapedia の jname" : ""].filter(Boolean);
  if (!jaSrc.length) { hold(w || j ? "pcg-search の名前がポケモンWiki・Bulbapedia の jname と違う" : "日本語名が pcg-search だけ"); continue; }
  if (w && (w.kind === "ポケモン") !== /^[A-Z]$/.test(b.kind)) { hold(`ポケモン/トレーナーズの別が違う（ポケモンWiki ${w.kind}・Bulbapedia ${b.kind}）`); continue; }
  if (/\{\{|\[No stamp\]/.test(b.name.replace(/_/g, " "))) { hold("Bulbapedia で同じ番号にスタンプの有無の2種類がある"); continue; }
  const en0 = bpName(b.name);
  let en = "", how = "";
  const rule = /^[A-Z]$/.test(b.kind) ? ruleEn(p.name) : null;
  if (rule && key(rule) === key(en0)) { en = rule; how = "規則の名前と Bulbapedia が一致"; }
  else {
    const kind = /^[A-Z]$/.test(b.kind) ? "Pokemon" : BP_KIND[b.kind];
    const c = enCache.filter((x) => key(x.name) === key(en0) && (kind === "Item" ? ["Item", "Tool", "Stadium", "Supporter"].includes(tKind(x)) : tKind(x) === kind));
    const same = c.filter((x) => key(x.illustrator) && key(x.illustrator) === key(p.illustrator));
    if (same.length) { en = en0; how = `TCGdex 英語版 ${same.map((x) => x.id).join(" ")}（${p.illustrator}）と一致`; }
    else how = c.length ? `TCGdex 英語版 ${c.map((x) => `${x.id}:${x.illustrator}`).join(" ")} とイラストレーター（${p.illustrator}）が違う` : "TCGdex 英語版に同じ名前・種類が無い（日本だけのカード等）";
  }
  rows.push({ num, ja: p.name, en, p, w: w ?? { how: "", date: "" }, b: en0, how, jaSrc: ["pcg-search", ...jaSrc].join("・") });
}
console.log(`${SET}: 足す ${rows.length}行（英語名あり ${rows.filter((r) => r.en).length}）・保留 ${held.length}`);
for (const h of held) console.log("  保留", h.join(" | "));
if (!APPLY) { for (const r of rows.filter((x) => !x.en)) console.log("  英語名なし", r.num, r.ja, r.b, r.how); process.exit(0); }

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
if (data.some((s) => s.c === SET)) throw new Error(`既に ${SET} があります`);
const CACHE = path.join(ROOT, "scripts", "pcg-search-cache", "promo", "img");
for (const r of rows) {
  const buf = fs.readFileSync(path.join(CACHE, path.basename(r.p.image)));
  if (crypto.createHash("sha256").update(buf).digest("hex") !== r.p.sha256) throw new Error(`画像の SHA-256 が取得時と違う: ${r.p.image}`);
  const rel = path.posix.join("cards", conf.sr, SET, buildFileName(r.ja, SET, r.num, "", 0) + path.extname(r.p.image));
  await writeFileAtomic(path.join(ROOT, "public", rel), buf);
}
data.push({ c: SET, ja: conf.ja, en: conf.en, psaName: conf.psaName, sr: conf.sr, of: 0, ...(conf.codeAlias ? { codeAlias: conf.codeAlias } : {}), k:rows.map((r) => [r.num, r.ja, r.en, ""]) });
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
rebuildCardKinds();
fs.writeFileSync(path.join(__dirname, `${SET}-added-card-ids-2026-10-15.txt`), rows.map((r) => `${SET}-${r.num}`).join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-rows-2026-10-15.tsv`), ["card_id\t日本語名\t日本語名の一致\tpcg-search\tキラ\tイラストレーター\t入手法（ポケモンWiki）\t日付\tBulbapedia\t英語名\t英語名の確かめ方",
  ...rows.map((r) => [`${SET}-${r.num}`, r.ja, r.jaSrc, r.p.page, /キラ/.test(r.p.rarity) ? "キラ" : "", r.p.illustrator, r.w.how, r.w.date, r.b, r.en, r.how].join("\t"))].join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-held-2026-10-15.tsv`), ["card_id\tpcg-search の名前\tポケモンWiki の名前\tBulbapedia の jname\tBulbapedia の英語名\t保留の理由", ...held.map((h) => h.join("\t"))].join("\n") + "\n");
console.log(`${SET}: ${rows.length}行を足した`);
