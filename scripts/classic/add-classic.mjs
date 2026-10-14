#!/usr/bin/env node
// 「ポケモンカードゲーム Classic」（2023）の3つのデッキを弾 CLF・CLL・CLK として足す（2026-10-15）。
//   node scripts/classic/add-classic.mjs --set CLF [--apply]
// 公式のカード検索には各デッキの基本エネルギー2種しか無い（番号なし）ため、001〜032 は公式以外の3つの情報源の一致で足す（ユーザーの確認済み）:
//   1. ポケモンWiki「ポケモンカードゲーム Classic」の各デッキの表（pokemonwiki-classic-2026-10-15.wikitext／.tsv。番号・種類・タイプ・名前・枚数）
//   2. Bulbapedia「Pokémon Trading Card Game Classic (TCG)」の日本版のデッキの一覧（bulbapedia-classic-ja-2026-10-15.tsv。番号・英語名・タイプ・枚数）
//   3. 遊々亭の一覧（yuyutei-classic-2026-10-15.tsv。番号・名前。レアリティは「-」）
//   番号・名前（1 と 3）、番号・枚数・ポケモンのタイプ（1 と 2）がすべて一致したら足す。レアリティはマークが無いので空欄。画像は無し（公式に無い。店舗の画像は使わない）。
// 基本エネルギー2種は公式 details.php（番号なし、印刷記号 CLF 等）で確かめ、型番 X＋cardID で足し、画像も公式から取る。
// 英語名:
//   ポケモン: Bulbapedia の日本版の一覧の名前と、日本語名から作った規則の名前（en-name-fix3/species-ja-en.json）の一致。
//     規則で作れない名前（マチスのコラッタ等）は、下のトレーナーズと同じ英語版のデッキの一覧との一致。
//   トレーナーズ・エネルギー: Bulbapedia の日本版の一覧の名前が、英語版（2023、Pokémon Trading Card Game Classic）の同じデッキの一覧に
//     同じ名前・種類・枚数で1枚だけあること（bulbapedia-classic-en-2026-10-15.tsv）。英語版はトレーナーズの番号の並びが違う（名前の順）ので番号では合わせない。
//   Bulbapedia の "Boss's Orders [Giovanni]" は S4a と同じく "Boss's Orders (Giovanni)" と書く。
// 弾の en・psaName は PSA のページタイトル（set-psa-names.json）、ja は公式の特設サイトのデッキ名、y は ポケモンWiki・Bulbapedia の発売時期（2023年10月下旬）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, writeFileAtomic } from "../filename-utils.mjs";
import { politeDelay, politeFetch } from "../scrape-promo-sets.mjs";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");

const DECKS = {
  CLF: { pw: "フシギバナ&ルギアexデッキ", bp: "Venusaur", ja: "ポケモンカードゲーム Classic フシギバナ&ルギアexデッキ", en: "Trading Card Game Classic Venusaur & Lugia ex Deck",
    energies: [{ cardId: 44413, ja: "基本草エネルギー", code: "GRA" }, { cardId: 44418, ja: "基本闘エネルギー", code: "FIG" }] },
  CLL: { pw: "リザードン&ホウオウexデッキ", bp: "Charizard", ja: "ポケモンカードゲーム Classic リザードン&ホウオウexデッキ", en: "Trading Card Game Classic Charizard & Ho-Oh ex Deck",
    energies: [{ cardId: 44414, ja: "基本炎エネルギー", code: "FIR" }, { cardId: 44416, ja: "基本雷エネルギー", code: "LIG" }] },
  CLK: { pw: "カメックス&スイクンexデッキ", bp: "Blastoise", ja: "ポケモンカードゲーム Classic カメックス&スイクンexデッキ", en: "Trading Card Game Classic Blastoise & Suicune ex Deck",
    energies: [{ cardId: 44415, ja: "基本水エネルギー", code: "WAT" }, { cardId: 44417, ja: "基本超エネルギー", code: "PSY" }] },
};
const deck = DECKS[SET];
if (!deck) throw new Error(`--set は CLF・CLL・CLK のどれか: ${SET}`);

const tsv = (f) => fs.readFileSync(path.join(__dirname, f), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t"));
const pw = tsv("pokemonwiki-classic-2026-10-15.tsv").filter((r) => r[0] === deck.pw);          // デッキ, 番号, 種類, タイプ, 名前, 枚数
const bpJa = tsv("bulbapedia-classic-ja-2026-10-15.tsv").filter((r) => r[0] === deck.bp);      // デッキ, 番号, 英語名, タイプ等, …, 枚数
const bpEn = tsv("bulbapedia-classic-en-2026-10-15.tsv").filter((r) => r[0] === deck.bp);
const yt = new Map(tsv("yuyutei-classic-2026-10-15.tsv").filter((r) => r[0] === SET).map((r) => [r[1], r[2]]));
const species = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
if (pw.length !== 34 || bpJa.length !== 34 || bpEn.length !== 34 || yt.size !== 32) throw new Error(`行の数が合わない: ポケモンWiki ${pw.length}・Bulbapedia ${bpJa.length}/${bpEn.length}・遊々亭 ${yt.size}`);

const N = (s) => s.normalize("NFKC").replace(/\s/g, "");
// 遊々亭の書き方の違い（同じカード）: 「ボスの指令[サカキ]」「オーキド博士」
const ytNorm = (s) => N(s).replace(/\[(.*)\]$/, "$1").replace(/^オーキド博士$/, "オーキドはかせ");
const TYPE = { 草: "Grass", 炎: "Fire", 水: "Water", 雷: "Lightning", 超: "Psychic", 闘: "Fighting", 無: "Colorless", 無色: "Colorless" };
const ruleEn = (ja) => { const n = N(ja); if (species.has(n)) return species.get(n); const m = n.match(/^(.+)ex$/); return m && species.has(m[1]) ? `${species.get(m[1])} ex` : null; };
const enName = (s) => s.replace(/ \[(.+)\]$/, " ($1)");

const rows = [];
const report = [];
for (const p of pw) {
  const [, num, kind, type, ja, qty] = p;
  if (!/^\d{3}\/032$/.test(num)) continue;
  const local = num.slice(0, 3);
  const b = bpJa.find((r) => r[1] === num);
  if (!b || b[5] !== qty) throw new Error(`ポケモンWiki と Bulbapedia の番号・枚数が合わない: ${SET} ${num} ${ja}`);
  if (kind === "ポケモン" && TYPE[type] !== b[3]) throw new Error(`タイプが合わない: ${SET} ${num} ${type} ${b[3]}`);
  if (ytNorm(yt.get(local) ?? "") !== N(ja)) throw new Error(`ポケモンWiki と遊々亭の名前が合わない: ${SET} ${num} ${ja} ${yt.get(local)}`);
  const jaName = ja.replace(/^ボスの指令 サカキ$/, "ボスの指令（サカキ）");
  let en = "", how = "";
  const rule = kind === "ポケモン" ? ruleEn(ja) : null;
  if (rule && rule === b[2]) { en = b[2]; how = "規則の名前と Bulbapedia が一致"; }
  else {
    const e = bpEn.filter((r) => r[2] === b[2] && r[3] === b[3] && r[4] === b[4] && r[5] === b[5]);
    if (e.length === 1) { en = enName(b[2]); how = `Bulbapedia の英語版のデッキの一覧 ${e[0][1]} と一致`; }
    else how = `英語版のデッキの一覧と合わない（${e.length}件）`;
  }
  rows.push([local, jaName, en, ""]);
  report.push({ id: `${SET}-${local}`, ja: jaName, en, how });
}
if (rows.length !== 32) throw new Error(`001〜032 がそろわない: ${rows.length}`);

// 基本エネルギー（公式 details.php で確かめる）
const energyRows = [];
for (const e of deck.energies) {
  const b = bpJa.find((r) => r[1] === e.code);
  const be = bpEn.filter((r) => r[2] === b[2] && r[3] === "Energy");
  const id = `X${e.cardId}`;
  const en = be.length === 1 ? b[2] : "";
  energyRows.push({ ...e, id, en, how: be.length === 1 ? `Bulbapedia の日本版 ${e.code}・英語版 ${be[0][1]} と一致` : "合わない" });
}

console.log(`${SET} ${deck.ja}: 001〜032 ${rows.length}行（英語名あり ${rows.filter((r) => r[2]).length}）＋ 基本エネルギー ${energyRows.length}行`);
for (const r of report.filter((x) => !x.en)) console.log("  英語名なし", r.id, r.ja, r.how);
if (!APPLY) { for (const r of report) console.log(`  ${r.id}\t${r.ja}\t${r.en}\t${r.how}`); for (const e of energyRows) console.log(`  ${SET}-${e.id}\t${e.ja}\t${e.en}\t${e.how}`); process.exit(0); }

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
if (data.some((s) => s.c === SET)) throw new Error(`既に ${SET} があります`);
const folder = path.posix.join("cards", "CL", SET);
for (const e of energyRows) {
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${e.cardId}`);
  await politeDelay();
  if (!html) throw new Error(`details.php を取得できない: ${e.cardId}`);
  const name = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "");
  const badge = (html.match(/<img[^>]*class="img-regulation"[^>]*alt="([^"]+)"/) || [])[1] ?? null;
  const hasNumber = /&nbsp;\d+&nbsp;\/&nbsp;/.test(html);
  const img = (html.match(/<img class="fit" src="([^"]+)"/) || [])[1] ?? null;
  if (name !== e.ja || badge !== SET || hasNumber || !img) throw new Error(`details.php が想定と違う: ${e.cardId} ${name} ${badge} 番号${hasNumber} 画像${img}`);
  const buf = await politeFetch(`https://www.pokemon-card.com${img}`, true);
  await politeDelay();
  if (!buf || buf.length < 1000) throw new Error(`画像を取得できない: ${e.cardId}`);
  const ext = buf[0] === 0x89 ? ".png" : buf[0] === 0x47 ? ".gif" : ".jpg";
  const rel = path.posix.join(folder, buildFileName(e.ja, SET, e.id, "", 0) + ext);
  await writeFileAtomic(path.join(ROOT, "public", rel), buf);
  e.file = rel;
}
const set = { c: SET, ja: deck.ja, en: deck.en, psaName: deck.en, sr: "CL", of: 32, y: 2023, k: [...rows, ...energyRows.map((e) => [e.id, e.ja, e.en, ""])] };
data.push(set);
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
rebuildCardKinds();
const ids = set.k.map((r) => `${SET}-${r[0]}`);
fs.writeFileSync(path.join(__dirname, `${SET}-added-card-ids-2026-10-15.txt`), ids.join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `${SET}-en-2026-10-15.tsv`), [...report.map((r) => [r.id, r.ja, r.en, r.how]), ...energyRows.map((e) => [`${SET}-${e.id}`, e.ja, e.en, e.how])].map((r) => r.join("\t")).join("\n") + "\n");
console.log(`${SET}: ${ids.length}行を足した。画像 ${energyRows.map((e) => e.file).join(" ")}`);
