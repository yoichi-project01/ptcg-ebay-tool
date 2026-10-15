#!/usr/bin/env node
// 拡張シート 第1〜3弾（自販機）と映画公開記念パック「サザンアイランド」を足す（2026-10-15、ユーザーの指示）。
//   node scripts/vending/add-vending.mjs --set VM1 [--apply]      （VM1・VM2・VM3・SI99。SI はスタートデッキ100 で使っている）
// 公式のカード検索に無いので、公式以外の情報源の一致で足す（CLAUDE.md の「データの決まり」）:
//   1. pcg-search のカードのページ（名前・レアリティの印・LV・illus.・画像。scripts/old-promos/fetch-pcg-search-promos.mjs --list pcg-search-vending-list-2026-10-15.json
//      --out pcg-search-vending-2026-10-15.json → scripts/old-promos/pcg-search-vending-2026-10-15.json、画像の SHA-256 つき）
//   2. ポケモンWiki の商品のページ（カード名・LV・レアリティの印・発売日。pokemonwiki-{vm1,vm2,vm3,si-pack,si-set}-2026-10-15.wikitext）
//   3. Bulbapedia の一覧（英語名・レアリティ。bulbapedia-vending-2026-10-15.txt・bulbapedia-southern-islands-2026-10-15.txt、SHA-256 をブラウザの値と照合）
// カードには番号が印刷されていない（Bulbapedia: 拡張シートの一覧は番号が None、サザンアイランドの日本版は "the Japanese cards remained unnumbered"）ので、
// 型番は「Y＋pcg-search の通し番号の下3桁」（1stex1001 → VM1-Y001、1stmv001 → SI99-Y001）。名前と並び順では結び付けない（pcg-search と Bulbapedia で並びが違う）。
// pcg-search の名前とレアリティの印がポケモンWiki の行と一致し（同じ名前が2行あるときは LV で1行に決まること）、ポケモンWiki の1行に pcg-search の1ページだけが
// 合うものを足す。英語名は、規則の名前（種族名）が Bulbapedia のその弾の同じレアリティの行にあるときだけ入れる（トレーナーズ・エキストラカードは空欄）。
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
// 弾の情報。ja は pcg-search とポケモンWiki の商品名の一致、y はポケモンWiki の発売日と Bulbapedia の日付の一致（下で確かめる）。
// psaName は PSA のページタイトル（「1998 POKEMON JAPANESE VENDING Doduo」「1999 POKEMON JAPANESE PROMO SOUTHERN ISLANDS Wartortle」）。
// enAlias は Bulbapedia の Series 1〜3 と PSA の Vending の区分から（拡張シートの英語の正式名は無い。Bulbapedia も Vending Machine は通称と書いている）
const CONF = {
  VM1: { group: "1st:拡張シート 第1弾(青版)", wiki: ["vm1"], bp: "1", bpYear: 1998, ja: "拡張シート 第1弾（青版）", enAlias: "Vending Series 1", psaName: "Vending" },
  VM2: { group: "1st:拡張シート 第2弾(赤版)", wiki: ["vm2"], bp: "2", bpYear: 1998, ja: "拡張シート 第2弾（赤版）", enAlias: "Vending Series 2", psaName: "Vending" },
  VM3: { group: "1st:拡張シート 第3弾(緑版)", wiki: ["vm3"], bp: "3", bpYear: 1998, ja: "拡張シート 第3弾（緑版）", enAlias: "Vending Series 3", psaName: "Vending" },
  SI99: { group: "1st:映画公開記念パック「サザンアイランド」", wiki: ["si-pack", "si-set"], bp: "SI99", bpYear: 1999, ja: "サザンアイランド", en: "Southern Islands", psaName: "Promo Southern Islands" },
};
const conf = CONF[SET];
if (!conf) throw new Error("--set は VM1・VM2・VM3・SI99");
const N = (s) => (s ?? "").normalize("NFKC").replace(/[\s_＿・]/g, "").replace(/[!?]/g, "");
const MARK = { "●": "C", "◆": "U", "★": "R" };

const ps = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "old-promos", "pcg-search-vending-2026-10-15.json"), "utf8"));
const species = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en]));
// ポケモンWiki: 表の行（カード名のリンク先・表示名・レアリティの印）とエキストラカードの表、発売日
const wikiRows = [], extras = [];
let wikiYear = 0;
for (const w of conf.wiki) {
  const t = fs.readFileSync(path.join(__dirname, `pokemonwiki-${w}-2026-10-15.wikitext`), "utf8").replace(/\r\n/g, "\n");
  wikiYear ||= +((t.match(/発売日\s*=\s*(\d{4})年/) || [])[1] ?? 0);
  const main = t.slice(0, t.indexOf("== 備考 =="));
  for (const r of main.split("\n|-").slice(1)) {
    const cells = r.split("\n").filter((l) => l.startsWith("|")).map((l) => l.slice(1).trim());
    const link = cells.find((c) => /\[\[/.test(c));
    if (!link) continue;
    const m = link.match(/\[\[([^|\]]*)(?:\|([^\]]*))?\]\]/);
    const label = m[2] ?? m[1].replace(/\s*\(.*\)$/, "");
    const lv = (m[1].match(/LV\.(\d+)/) || [])[1] ?? "";
    const mark = cells.find((c) => /^[●◆★]$/.test(c)) ?? "";
    if (!wikiRows.some((x) => x.target === m[1])) wikiRows.push({ target: m[1], name: label.replace(/LV\.\d+$/, ""), lv, mark, kind: cells[0] });
  }
  const bik = t.slice(t.indexOf("== 備考 =="));
  for (const r of bik.split("\n|-").slice(1)) {
    const cells = r.split("\n").filter((l) => l.startsWith("|")).map((l) => l.slice(1).trim());
    if (cells.length >= 2 && /^#\d+$/.test(cells[0])) extras.push({ sheet: cells[0], name: cells[1].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").trim() });
  }
}
if (wikiYear !== conf.bpYear) throw new Error(`発売年が合わない: ポケモンWiki ${wikiYear}・Bulbapedia ${conf.bpYear}`);
// Bulbapedia
const bp = conf.bp === "SI99"
  ? fs.readFileSync(path.join(__dirname, "bulbapedia-southern-islands-2026-10-15.txt"), "utf8").trim().split(/\r?\n/).map((l) => ({ en: l.split(":").slice(1).join(":"), r: "" }))
  : fs.readFileSync(path.join(__dirname, "bulbapedia-vending-2026-10-15.txt"), "utf8").trim().split(/\r?\n/).map((l) => l.split(":")).filter((c) => c[0] === conf.bp).map((c) => ({ en: c.slice(1, -1).join(":"), r: c.at(-1) === "N" ? "" : c.at(-1) }));

const pages = Object.entries(ps).filter(([, v]) => v.group === conf.group);
const cand = pages.map(([page, v]) => {
  const html = fs.readFileSync(path.join(ROOT, "scripts", "pcg-search-cache", "promo", `${page}.html`), "utf8");
  const s = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "|").replace(/\|[\s|]*\|/g, "|").replace(/\s+/g, " ");
  const i = s.indexOf("お気に入り削除|"), text = s.slice(i, s.indexOf("|収録", i)); // カードの部分（HP・ワザ・illus.）
  return { page, v, hp: (text.match(/HP:(\d+)/) || [])[1] ?? "", text, local: "Y" + page.slice(-3) };
});
// ポケモンWiki のカードのページ（scripts/pcg-search-cache/pokemonwiki/、.gitignore 対象。resolve-same-name.mjs と同じ置き場所）
function wikiCard(title) {
  const f = path.join(ROOT, "scripts", "pcg-search-cache", "pokemonwiki", encodeURIComponent(title) + ".wikitext");
  if (!fs.existsSync(f)) return null;
  const t = fs.readFileSync(f, "utf8");
  const g = (k) => (t.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n]*)`)) || [])[1]?.trim() ?? "";
  return { hp: g("HP"), attacks: [1, 2, 3, 4].map((n) => g(`ワザ${n}`)).filter(Boolean) };
}
const rows = [], held = [];
const used = new Map();
for (const c of cand) {
  const nm = c.v.name;
  let hit = wikiRows.filter((w) => N(w.name) === N(nm));
  // 同じ名前が2行（VM3 のユンゲラー LV.39／LV.40 等）: pcg-search には LV が無いので、HP とワザの名前をポケモンWiki のカードのページと比べる
  if (hit.length > 1) hit = hit.filter((w) => { const p = wikiCard(w.target); return p && p.hp === c.hp && p.attacks.length && p.attacks.every((a) => c.text.includes(a)); });
  let why = "";
  let wr = null, extra = null;
  if (hit.length === 1) {
    wr = hit[0];
    // pcg-search の「-(キラ)」はレアリティの印が無いキラのカード（サザンアイランド）
    if ((wr.mark || "") !== (c.v.rarity || "").replace(/\(キラ\)$/, "").replace(/^-$/, "")) why =`レアリティの印が違う（pcg-search ${c.v.rarity}・ポケモンWiki ${wr.mark}）`;
  } else if (hit.length === 0 && c.v.den === "" && SET === "VM3") {
    const ex = extras.filter((e) => N(e.name) === N(nm));
    const exNames = [...new Set(ex.map((e) => N(e.name)))];
    if (nm === "-" || !nm) why = "pcg-search に名前が無い";
    else if (exNames.length === 1) extra = ex[0];
    else why = "ポケモンWiki のエキストラカードの表に同じ名前が無い";
  } else why = `ポケモンWiki の行で合うものが${hit.length}つ`;
  if (!why) {
    const key = wr ? wr.target : `extra:${N(extra.name)}`;
    if (used.has(key)) why = `ポケモンWiki の同じ行に pcg-search の ${used.get(key)} も合う`;
    used.set(key, c.page);
  }
  if (why) { held.push([`${SET}-${c.local}`, c.page, nm, c.v.rarity, why]); continue; }
  const rarity = wr ? (MARK[wr.mark] ?? "") : "";
  // 英語名: 規則の名前が Bulbapedia のこの弾の同じレアリティの行にあるときだけ
  const rule = wr && wr.kind === "ポケモン" ? species.get(nm.normalize("NFKC")) : undefined;
  const en = rule && bp.some((b) => b.en === rule && b.r === rarity) ? rule : "";
  rows.push({ c, nm, wr, extra, rarity, en, rule });
}
// 同じ弾に同じ名前が2枚あるとき（VM3 のユンゲラー・ゴースト）は日本語名の末尾に LV の括弧注記
const count = new Map();
for (const r of rows) count.set(r.nm, (count.get(r.nm) ?? 0) + 1);
for (const r of rows) r.ja = count.get(r.nm) > 1 && r.wr?.lv ? `${r.nm}（LV.${r.wr.lv}）` : r.nm;
// 相互の確かめ: ポケモンWiki の表の行がすべて使われたか
const missing = wikiRows.filter((w) => !used.has(w.target));
for (const r of rows) console.log(`${SET}-${r.c.local}`, r.c.page, r.ja, r.rarity, "|", r.en || "(英語名なし)", r.extra ? `| エキストラ ${r.extra.sheet}` : "");
for (const h of held) console.log("保留", ...h);
console.log(`${SET}: 足す ${rows.length}・保留 ${held.length}・ポケモンWiki の行で合うページが無いもの ${missing.length}`, missing.map((m) => m.target).join(" "));
if (!APPLY) process.exit(0);

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
if (data.some((s) => s.c === SET)) throw new Error(`既にある: ${SET}`);
const set = { c: SET, ja: conf.ja, en: conf.en ?? "", ...(conf.enAlias ? { enAlias: conf.enAlias } : {}), psaName: conf.psaName, sr: "PMCG", y: conf.bpYear, of: 0, k: [] };
for (const r of rows) {
  const buf = fs.readFileSync(path.join(ROOT, "scripts", "pcg-search-cache", "promo", "img", path.basename(r.c.v.image)));
  if (crypto.createHash("sha256").update(buf).digest("hex") !== r.c.v.sha256) throw new Error(`画像の SHA-256 が取得時と違う: ${r.c.v.image}`);
  await writeFileAtomic(path.join(ROOT, "public", "cards", set.sr, SET, buildFileName(r.ja, SET, r.c.local, r.rarity, 0) + path.extname(r.c.v.image)), buf);
  set.k.push([r.c.local, r.ja, r.en, r.rarity]);
}
// PMCG-P の後ろ（旧裏の弾の並び）に入れる
const at = data.findIndex((s) => s.c === "PMCG-P");
data.splice(at + 1 + Object.keys(CONF).filter((k) => k < SET && data.some((s) => s.c === k)).length, 0, set);
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
rebuildCardKinds();
fs.writeFileSync(path.join(__dirname, `${SET}-added-card-ids-2026-10-15.txt`), rows.map((r) => `${SET}-${r.c.local}`).join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-rows-2026-10-15.tsv`), ["card_id\tpcg-search\t日本語名\tレアリティ（pcg-search・ポケモンWiki）\tLV\tイラストレーター\tポケモンWiki の行\t英語名\t英語名の確かめ方",
  ...rows.map((r) => [`${SET}-${r.c.local}`, r.c.page, r.ja, `${r.c.v.rarity || "-"}・${r.wr?.mark || "-"}`, r.wr?.lv ?? "", r.c.v.illustrator, r.wr ? r.wr.target : `エキストラカード ${r.extra.sheet} ${r.extra.name}`,
    r.en, r.en ? `規則の名前 ${r.rule} が Bulbapedia の${conf.bp === "SI99" ? " Southern Islands" : ` Series ${conf.bp}`} の${r.rarity || "レアリティ無し"}の行にある` : ""].join("\t"))].join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-held-2026-10-15.tsv`), ["card_id（予定）\tpcg-search\t名前\tレアリティの印\t保留の理由", ...held.map((h) => h.join("\t"))].join("\n") + "\n");
console.log(`${SET}: ${rows.length}行の弾を作った`);
