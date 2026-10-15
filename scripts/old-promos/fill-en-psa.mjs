#!/usr/bin/env node
// 古いプロモで英語名が空欄の行に、Bulbapedia のカードの英語の呼び方と PSA のラベルの表記（psacard.com のページタイトル）の2つが一致したものを入れる（2026-10-15、ユーザーの指示）。
//   node scripts/old-promos/fill-en-psa.mjs --set PMCG-P [--apply]
// 2026-10-15（2回目、ユーザーの指示）: PSA の表記は見つかったが Bulbapedia と一致しない高額なプロモ（ポケモンイラストレーター → PSA "Pikachu-Holo Illustrator" 等）は、
// PSA の表記を英語名にし、Bulbapedia の呼び方を src/enAltNames.json に入れる（タイトルに余地があれば括弧で添える）。tsv の6列目が Bulbapedia の呼び方（PSA と違うときだけ）、
// 7列目が PSA の表記のカード名（PSA セットレジストリのラベルなど、年・区分・番号・注記が混ざるもの。空なら PSA の表記から取り出す）。
// 7列目のカード名は PSA の表記（-Holo・-Glossy・Glossy・Holofoil を外したもの）の中にあること、英語名と一致すること、
// Bulbapedia の名前が6列目（無ければ英語名）と一致することを確かめる
// 根拠は en-psa-2026-10-15.tsv（card_id・英語名・PSA のページタイトルと URL）。英語名が、保存した Bulbapedia の名前（番号付きは bulbapedia-numbered-promos、
// 番号の無いものは {弾}-rows の Bulbapedia の列）と、PSA のページタイトルのカード名（年・PSA の区分を除き、-Holo・-Glossy 等の注記を外したもの）の両方と一致するときだけ入れる。
// 比べるときは大文字小文字・アクセント（é）・記号・空白（____ の数）を無視する。持ち主付き・日本だけのトレーナーズも同じ決まり。一致しないもの（Pikachu Illustrator と
// Pokémon Illustrator、Tropical Mega Battle と Tropical Wind、Fruit Of Miracle と Miracle Berry 等）は入れない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");
const key = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ev = fs.readFileSync(path.join(__dirname, "en-psa-2026-10-15.tsv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split("\t"))
  .map(([id, ja, en, title, url, alt, subj]) => ({ id, ja, en, title, url, alt: alt ?? "", subj: subj ?? "" })).filter((e) => e.id.startsWith(`${SET}-`) && /^-?[A-Z0-9]+$/.test(e.id.slice(SET.length + 1)));
// Bulbapedia の名前
const bpName = new Map();
const numbered = fs.readFileSync(path.join(__dirname, "bulbapedia-numbered-promos-2026-10-15.txt"), "utf8").split(/\r?\n/).filter(Boolean);
const BP_OF = { "ADV-P": "ADV-P", PLAY: "PLAY", "PCG-P": "PCG-P", "E-P": "P", "E-T": "T" };
const ALT = path.join(ROOT, "src", "enAltNames.json");
const alts = fs.existsSync(ALT) ? JSON.parse(fs.readFileSync(ALT, "utf8")) : {};
const stripNotes = (t) => t.replace(/-(Holo|Glossy)\b|\b(Glossy|Holofoil)\b/gi, " ");
const line = numbered.find((l) => l.startsWith(`${BP_OF[SET]}\t`));
if (line) for (const t of line.split("\t")[1].split(" ")) { const m = t.match(/^(\d{3})=(.*)\/[A-Za-z]$/); bpName.set(`${SET}-${m[1]}`, m[2].replace(/_/g, " ")); }
const rowsFile = path.join(__dirname, `${SET}-rows-2026-10-15.tsv`);
if (!line && fs.existsSync(rowsFile)) for (const l of fs.readFileSync(rowsFile, "utf8").trim().split(/\r?\n/).slice(1)) { const c = l.split("\t"); bpName.set(c[0], c[5].split(":").slice(2).join(":").replace(/\s*\[[^\]]*\]/g, "")); }
// PSA のページタイトルのカード名（年・POKEMON JAPANESE・区分の語を除いた残り。区分の語は PSA の区分名として既知のもの）
const SECTIONS = /^\d{4}\s+POKEMON\s+JAPANESE\s+(?:(?:PROMO COROCORO COMICS|PROMO GAME BOY|COROCORO COMICS PROMO|CD PROMO|PLAY PROMO|NEO \d PROMO|POKEPARK FOREST|PROMO)\s+)/i;
const psaSubject = (t) => t.replace(SECTIONS, "").replace(/(-Holo|-Glossy)\b/gi, "").replace(/\s+(CD PROMO|2ND SEASON SUBSCRIPTION|Trainers Vol\. \d+)$/i, "").trim();

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const changed = [];
for (const e of ev) {
  const row = set.k.find((r) => `${SET}-${r[0]}` === e.id);
  const b = bpName.get(e.id), s = e.subj || psaSubject(e.title);
  if (row && row[2] === e.en) { console.log("入れ済み", e.id, e.en); continue; }
  const inTitle = key(stripNotes(e.title)).includes(key(s));
  const ok = row && row[1] === e.ja && !row[2] && b && inTitle && key(s) === key(e.en) && key(b) === key(e.alt || e.en);
  console.log(ok ? "入れる" : "入れない", e.id, e.ja, "|", e.en, e.alt ? `（Bulbapedia ${e.alt}）` : "", "| Bulbapedia:", b, "| PSA:", s, inTitle ? "" : "（PSA の表記に無い）");
  if (ok) { row[2] = e.en; changed.push(e.id); if (e.alt) alts[e.id] = e.alt; }
}
if (APPLY && changed.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  const f = path.join(__dirname, `${SET}-en-psa-changed-card-ids-2026-10-15.txt`);
  const prev = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
  fs.writeFileSync(f, [...new Set([...prev, ...changed])].join("\n") + "\n");
  fs.writeFileSync(ALT, JSON.stringify(Object.fromEntries(Object.entries(alts).sort()), null, 1) + "\n");
  rebuildCardKinds();
}
console.log(`${SET}: ${changed.length}行`);
