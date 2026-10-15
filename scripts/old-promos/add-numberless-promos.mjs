#!/usr/bin/env node
// 番号の無い古いプロモ（旧裏・neo）を弾として足す（2026-10-15、ユーザーの確認済み）。  node scripts/old-promos/add-numberless-promos.mjs --set PMCG-P [--apply]
// 型番は「Y＋pcg-search の通し番号」（例 PMCG-P-Y001＝pcg-search の 1stp001。ユーザーの指示）。公式の cardID が無いので X は使わない。
// 公式に無いため、公式以外の情報源の一致で足す:
//   1. pcg-search.com のカードのページ（pcg-search-promos-2026-10-15.json。名前・イラストレーター・画像。配布元は書かれていない）
//   2. Bulbapedia「Unnumbered Promotional cards (TCG)/1996-2005」（bulbapedia-unnumbered-1996-2005-2026-10-15.txt。年・各カードのページの日本語名 jname・英語名・種類。
//      SHA-256 をブラウザの値と照合）
//   3. ポケモンWiki「プロモーションカード」のコレクションナンバーなしの表（pokemonwiki-promo-2026-10-15.wikitext。日付・名前・入手法）
//   同じ名前のカードが何枚もある（ピカチュウ等）ので、名前と並び順では結び付けない（CLAUDE.md）。pcg-search の名前が、pcg-search の古いプロモの中で1枚だけで、
//   Bulbapedia の jname（1996〜2001年）でも1件だけのものを足す。配布元（入手法・日付）は、ポケモンWiki でも1件だけでその年が Bulbapedia と合うときに記録する。
//   それ以外（同じ名前が2枚以上・どれかに無い・年が合わない）は保留の一覧（{弾}-held-2026-10-15.tsv）に出す。
// レアリティは空欄、画像は pcg-search。英語名は Bulbapedia の名前（[Glossy] 等の注記を外す）と、日本語名から作った規則の名前（ポケモン）の一致。
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
  "PMCG-P": { groups: ["1st:プロモ"], sr: "PMCG", en: "Promo", psaName: "Promo" },
  "neo-P": { groups: ["neo:プロモ", "neo:プレミアムファイル", "neo:プレミアムファイル2", "neo:プレミアムファイル3"], sr: "neo", en: "Promo", psaName: "Promo" },
  // ADV・PCG の番号の無いもの（pcg-search の「ナンバー外」）は、番号付きの ADV-P・PCG-P の弾に Y の行として足す（SM-P の X の行と同じ形）。Bulbapedia は 2002〜2005年
  "ADV-PY": { target: "ADV-P", groups: ["adv:ナンバー外"], scope: ["adv:ナンバー外", "pcg:ナンバー外"], years: [2002, 2005] },
  "PCG-PY": { target: "PCG-P", groups: ["pcg:ナンバー外"], scope: ["adv:ナンバー外", "pcg:ナンバー外"], years: [2002, 2005] },
};
const conf = CONF[SET];
if (!conf) throw new Error(`--set は ${Object.keys(CONF).join("・")} のどれか: ${SET}`);
const TARGET = conf.target ?? SET;
const OLD_GROUPS = conf.scope ?? Object.values(CONF).filter((c) => !c.target).flatMap((c) => c.groups);
const [YMIN, YMAX] = conf.years ?? [1996, 2001];

const N = (s) => (s ?? "").normalize("NFKC").replace(/[\s_＿]/g, "").replace(/[!！]/g, "!").replace(/[?？]/g, "?");
const ps = JSON.parse(fs.readFileSync(path.join(__dirname, "pcg-search-promos-2026-10-15.json"), "utf8"));
const allOld = Object.entries(ps).filter(([, v]) => OLD_GROUPS.includes(v.group));
const mine = allOld.filter(([, v]) => conf.groups.includes(v.group));
const bp = fs.readFileSync(path.join(__dirname, "bulbapedia-unnumbered-1996-2005-2026-10-15.txt"), "utf8").trim().split(/\r?\n/)
  .map((l) => { const [idx, year, jname, en, type] = l.split("|"); return { idx, year: +year, jname, en, type }; }).filter((b) => b.year >= YMIN && b.year <= YMAX);
const wiki = fs.readFileSync(path.join(__dirname, "pokemonwiki-promo-2026-10-15.wikitext"), "utf8").replace(/\r\n/g, "\n");
const sec = wiki.slice(wiki.indexOf("=== コレクションナンバーなし"), wiki.indexOf("=== P,T,J"));
const pw = sec.split(/\n\|-/).slice(1).map((r) => r.trim().split("\n")[0].replace(/^\|/, "").split("||").map((c) => c.trim())).filter((c) => c.length >= 4)
  .map((c) => ({ date: c[0], kind: c[1], name: c[2].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/LV\.\d+$/, ""), how: c[3].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/<br\s*\/?>/g, "・").replace(/\{\{[^}]*\}\}/g, "").trim() }));

const species = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const key = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const POKEMON_TYPES = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Colorless"]);

const rows = [], held = [];
for (const [page, p] of mine) {
  const local = "Y" + page.match(/(\d+)$/)[1]; // pcg-search の通し番号（1stp006 → Y006、neopf1001 → Y1001）
  const id = `${TARGET}-${local}`;
  const n = N(p.name);
  const samePs = allOld.filter(([, v]) => N(v.name) === n);
  const sameBp = bp.filter((b) => N(b.jname) === n);
  const samePw = pw.filter((w) => N(w.name) === n);
  const hold = (why) => held.push([id, page, p.name, p.illustrator, sameBp.map((b) => `${b.idx}:${b.year}:${b.en}`).join(" / "), samePw.map((w) => `${w.date}:${w.how}`).join(" / "), why]);
  if (samePs.length !== 1) { hold(`pcg-search の古いプロモに同じ名前が${samePs.length}枚`); continue; }
  if (sameBp.length !== 1) { hold(sameBp.length ? `Bulbapedia に同じ名前が${sameBp.length}件` : `Bulbapedia の${YMIN}〜${YMAX}年に無い`); continue; }
  const b = sameBp[0];
  const w = samePw.length === 1 && Math.floor(parseFloat(samePw[0].date)) === b.year ? samePw[0] : null;
  // ADV・PCG の番号の無いもの（勝利のリング等）は年ごとに別の版がある。ポケモンWiki にその名前があるのに Bulbapedia と同じ年の行が無ければ、どの年の版か決まらないので保留
  if (conf.target && samePw.length && !samePw.some((x) => (x.date.match(/\d{4}/g) || []).map(Number).includes(b.year))) { hold(`ポケモンWiki（${samePw.map((x) => (x.date.match(/\d{4}/g) || []).join("・")).join("／")}年）と Bulbapedia（${b.year}年）で年が合わない`); continue; }
  const en0 = b.en.replace(/\s*\[[^\]]*\]/g, "").replace(/？/g, "?").trim();
  let en = "", how = "";
  if (POKEMON_TYPES.has(b.type)) {
    const rule = species.get(n);
    if (rule && key(rule) === key(en0)) { en = rule; how = "規則の名前と Bulbapedia が一致"; } else how = "規則の名前で作れない（持ち主付き・名前の付いたポケモン等）";
  } else how = "トレーナーズ（英語版の同じカードを確かめられない）";
  rows.push({ local, page, p, b, w, en, en0, how });
}
console.log(`${SET}: 足す ${rows.length}行（英語名あり ${rows.filter((r) => r.en).length}・ポケモンWiki の配布元あり ${rows.filter((r) => r.w).length}）・保留 ${held.length}`);
if (!APPLY) { for (const r of rows) console.log("  ", r.local, r.p.name, "|", r.b.year, r.b.en, "|", r.w ? `${r.w.date} ${r.w.how}` : "-", "|", r.en); for (const h of held) console.log("  保留", h.join(" | ")); process.exit(0); }

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const target = data.find((s) => s.c === TARGET);
if (conf.target ? !target : target) throw new Error(conf.target ? `${TARGET} がありません` : `既に ${SET} があります`);
if (target && rows.some((r) => target.k.some((k) => k[0] === r.local))) throw new Error(`${TARGET} に同じ型番がある`);
const sr = conf.sr ?? target.sr;
const CACHE = path.join(ROOT, "scripts", "pcg-search-cache", "promo", "img");
for (const r of rows) {
  const buf = fs.readFileSync(path.join(CACHE, path.basename(r.p.image)));
  if (crypto.createHash("sha256").update(buf).digest("hex") !== r.p.sha256) throw new Error(`画像の SHA-256 が取得時と違う: ${r.p.image}`);
  const rel = path.posix.join("cards", sr, TARGET, buildFileName(r.p.name, TARGET, r.local, "", 0) + path.extname(r.p.image));
  await writeFileAtomic(path.join(ROOT, "public", rel), buf);
}
if (target) target.k.push(...rows.map((r) => [r.local, r.p.name, r.en, ""]));
else data.push({ c: SET, ja: "", en: conf.en, psaName: conf.psaName, sr: conf.sr, of: 0, k: rows.map((r) => [r.local, r.p.name, r.en, ""]) });
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
rebuildCardKinds();
fs.writeFileSync(path.join(__dirname, `${SET}-added-card-ids-2026-10-15.txt`), rows.map((r) => `${TARGET}-${r.local}`).join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-rows-2026-10-15.tsv`), ["card_id\tpcg-search\t日本語名\tイラストレーター\tキラ\tBulbapedia（番号:年:英語名）\t配布元（ポケモンWiki の日付・入手法）\t英語名\t英語名の確かめ方",
  ...rows.map((r) => [`${TARGET}-${r.local}`, r.page, r.p.name, r.p.illustrator, /キラ/.test(r.p.rarity) ? "キラ" : "", `${r.b.idx}:${r.b.year}:${r.b.en}`, r.w ? `${r.w.date} ${r.w.how}` : "", r.en, r.how].join("\t"))].join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-held-2026-10-15.tsv`), ["card_id（予定）\tpcg-search\t名前\tイラストレーター\tBulbapedia の同じ名前（番号:年:英語名）\tポケモンWiki の同じ名前（日付:入手法）\t保留の理由", ...held.map((h) => h.join("\t"))].join("\n") + "\n");
console.log(`${SET}: ${rows.length}行を足した`);
