#!/usr/bin/env node
// BW（BW1〜BW9・SC・EBB）と LEGEND（L1-Bhg・L1-Bss・L2-B・L3-B）のシークレット（弾の枚数を超える番号の SR・UR 等）を足す（2026-10-18、ユーザーの指示）。
//   node scripts/bw-secrets/add-bw-secrets.mjs            照合だけ（cardData は変えない）。結果を bw-secrets/result-2026-10-18.json に書く
//   node scripts/bw-secrets/add-bw-secrets.mjs --apply    cardData.json に足し、足した card_id・保留の一覧を書き、cardKinds.json を作り直す
//
// 公式のカード検索に BW のシークレットは載っていない（official-card-scan.json で BW9-B は 76枚、cardID は 028673〜028748 で途切れなく並び、間に空きが無い）。
// CLAUDE.md の決まり「公式に無いものは、公式以外の2つ以上で番号と名前が一致したものだけ」に従い、次の照合で決める:
//   情報源1: Bulbapedia の日本版の一覧（bulbapedia-2026-10-18.tsv。ブラウザで wikitext から取り出し SHA-256 e290433b… をブラウザの値と照合）
//   情報源2: 遊々亭の販売・買取の一覧の画像の説明文「番号/総数 レアリティ 名前」（yuyutei-2026-10-18.tsv。HTML の SHA-256 は yuyutei-sources-2026-10-18.tsv）
//   情報源3: ポケカくらぶの弾別の一覧の型番・名前（third-2026-10-18.tsv。BW1W は型番の番号が +100。HTML は pokeca-sources-2026-10-18.tsv）
// 番号と名前が2つ以上の情報源で一致し、どの情報源とも名前・レアリティ（日本版の印。EBB・LEGEND は無し）が食い違わないものだけ足す。
// 名前の照合: ポケモンは日本語名から作った規則の名前（種族名＋EX、ブラック/ホワイトキュレム）が Bulbapedia の名前と同じこと。
//   トレーナーズ等は、同じ弾の本編に同じ日本語名のカードがあり、その英語名（cardData）が Bulbapedia の名前と同じこと（照合にだけ使い、英語名には入れない）。
// 行は [番号, 日本語名（遊々亭の表記）, 英語名, レアリティ]。英語名はポケモンだけ規則の名前（Bulbapedia と一致したもの）を入れ、トレーナーズは空欄
//   （トレーナーズの英語名は TCGdex 英語版の同じ名前・種類・イラストレーターで確かめる決まりだが、公式に無いのでイラストレーターが分からない）。
// 画像は足さない（店舗の画像は使わない）。弾の枚数（of）は変えない。遊々亭の「(ミラー)」の版は足さない（別の作業）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const APPLY = process.argv.includes("--apply");
const DAY = "2026-10-18";

const tsv = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split(/\r?\n/).map((l) => l.split("\t")) : [];
const bp = tsv(path.join(__dirname, `bulbapedia-${DAY}.tsv`)).map(([set, num, en, type, rarity]) => ({ set, num, en, type, rarity: rarity ?? "" }));
const yy = tsv(path.join(__dirname, `yuyutei-${DAY}.tsv`)).slice(1).map(([set, num, rarity, name, kind]) => ({ set, num, rarity: rarity ?? "", name, kind }));
const third = tsv(path.join(__dirname, `third-${DAY}.tsv`)).slice(1).map(([set, num, rarity, name, source]) => ({ set, num, rarity: rarity ?? "", name, source }));

const species = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const NFKC = (s) => (s ?? "").normalize("NFKC").replace(/\s+/g, "");
// 店舗の注記（(ミラー)・[…]・【…】）を外した日本語名
const baseJa = (s) => (s ?? "").normalize("NFKC").replace(/^(\s*【[^】]*】)+/, "").replace(/(\s*([（(][^（()）]*[)）]|\[[^\]]*\]))+\s*$/, "").trim();
const key = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// ポケモンの規則の名前（種族名・種族名EX・ブラック/ホワイト キュレム）
function ruleEn(ja) {
  let n = NFKC(ja), suf = "", pre = "";
  if (/EX$/.test(n) && J.has(n.slice(0, -2).replace(/^(ブラック|ホワイト)/, ""))) { suf = "-EX"; n = n.slice(0, -2); }
  const m = n.match(/^(ブラック|ホワイト)(キュレム)$/);
  if (m) { pre = m[1] === "ブラック" ? "Black " : "White "; n = m[2]; }
  return J.has(n) ? pre + J.get(n) + suf : "";
}

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const added = [], held = [], evidence = [];
for (const b of bp) {
  const set = data.find((s) => s.c === b.set);
  if (!set) throw new Error(`弾が無い: ${b.set}`);
  const id = `${b.set}-${b.num}`;
  if (set.k.some((r) => r[0] === b.num)) { held.push({ id, bulbapedia: b.en, reason: "cardData に同じ番号がもう有る" }); continue; }
  // 遊々亭・3つ目の一覧の、その番号の名前（ミラーの版は除く）
  const cands = [
    ...yy.filter((y) => y.set === b.set && y.num === b.num && !/\(ミラー\)$/.test(y.name)).map((y) => ({ src: `遊々亭（${y.kind === "buy" ? "買取" : "販売"}）`, name: baseJa(y.name), rarity: y.rarity })),
    ...third.filter((t) => t.set === b.set && t.num === b.num).map((t) => ({ src: t.source, name: baseJa(t.name), rarity: t.rarity })),
  ];
  // 店ごとにまとめる（遊々亭の販売・買取は同じ店）。同じ店の中で名前・レアリティが食い違えば保留
  const srcGroups = new Map();
  for (const c of cands) { const g = c.src.startsWith("遊々亭") ? "遊々亭" : "ポケカくらぶ"; if (!srcGroups.has(g)) srcGroups.set(g, c); else if (NFKC(srcGroups.get(g).name) !== NFKC(c.name) || (srcGroups.get(g).rarity || c.rarity) && srcGroups.get(g).rarity !== c.rarity) srcGroups.set(g, { ...srcGroups.get(g), conflict: `${srcGroups.get(g).name}・${c.name}` }); }
  const shops = [...srcGroups.entries()];
  const reasonBase = { id, bulbapedia: b.en, rarity: b.rarity };
  if (!shops.length) { held.push({ ...reasonBase, reason: "遊々亭・ポケカくらぶの一覧に無い（Bulbapedia だけ）" }); continue; }
  const conflict = shops.find(([, c]) => c.conflict);
  if (conflict) { held.push({ ...reasonBase, reason: `${conflict[0]} の一覧でその番号に2つの名前（${conflict[1].conflict}）` }); continue; }
  const jaNames = [...new Set(shops.map(([, c]) => NFKC(c.name)))];
  if (jaNames.length > 1) { held.push({ ...reasonBase, reason: `店の一覧で名前が食い違う: ${shops.map(([g, c]) => `${g} ${c.name}`).join(" / ")}` }); continue; }
  // レアリティ: 印のある情報源はすべて Bulbapedia と同じであること（印の無い店の行は数えない。EBB・LEGEND はどこも印なし）
  const badRar = shops.filter(([, c]) => (c.rarity || b.rarity) && c.rarity !== b.rarity && !(c.rarity === "" && b.rarity));
  if (badRar.length) { held.push({ ...reasonBase, reason: `レアリティが食い違う: Bulbapedia ${b.rarity || "なし"} / ${shops.map(([g, c]) => `${g} ${c.rarity || "なし"}`).join(" / ")}` }); continue; }
  const ja = shops[0][1].name;
  // 名前の一致を数える: 日本語名の店（遊々亭・ポケカくらぶ）どうしは日本語名で、Bulbapedia とはポケモンは規則の名前、トレーナーズは同じ弾の本編の同じ名前のカードの英語名で比べる
  const agree = shops.map(([g]) => g);
  const rule = ruleEn(ja);
  let how = "", en = "";
  if (rule) {
    if (key(rule) !== key(b.en)) { held.push({ ...reasonBase, ja, reason: `Bulbapedia と名前が食い違う（規則の名前 ${rule}）` }); continue; }
    agree.push("Bulbapedia"); how = `規則の名前 ${rule} が Bulbapedia と一致`; en = b.en;
  } else {
    const main = set.k.filter((r) => /^\d+$/.test(r[0]) && +r[0] <= set.of && NFKC(baseJa(r[1])) === NFKC(ja));
    const ens = [...new Set(main.map((r) => r[2]).filter(Boolean))];
    if (ens.length === 1 && key(ens[0]) === key(b.en)) { agree.push("Bulbapedia"); how = `同じ弾の本編の ${main.map((r) => r[0]).join("・")}（${ens[0]}）と同じ名前で Bulbapedia と一致`; }
    else if (ens.length === 1) { held.push({ ...reasonBase, ja, reason: `Bulbapedia と名前が食い違う（同じ弾の本編の同じ名前のカードの英語名 ${ens[0]}）` }); continue; }
    else how = "トレーナーズ等で Bulbapedia の英語名と日本語名を照らし合わせられない（店の一覧どうしの一致で数える）";
  }
  if (agree.length < 2) { held.push({ ...reasonBase, ja, reason: `番号と名前が一致した情報源が1つだけ（${agree.join("・")}）。${how}` }); continue; }
  added.push({ set: b.set, row: [b.num, ja, en, b.rarity], id });
  evidence.push({ id, ja, en, rarity: b.rarity, bulbapedia: `${b.en}（${b.type}・${b.rarity || "レアリティなし"}）`, agree, how });
}
// 弾ごとの件数
const perSet = {};
for (const b of bp) { perSet[b.set] ??= { 本来: 0, 足した: 0, 保留: 0 }; perSet[b.set].本来++; }
for (const a of added) perSet[a.set].足した++;
for (const h of held) perSet[h.id.replace(/-\d+$/, "")].保留++;
console.table(perSet);
for (const h of held) console.log("保留", h.id, h.bulbapedia, "|", h.reason);
fs.writeFileSync(path.join(__dirname, `result-${DAY}.json`), JSON.stringify({ perSet, added: evidence, held }, null, 1) + "\n");
if (!APPLY) process.exit(0);

for (const a of added) {
  const set = data.find((s) => s.c === a.set);
  set.k.push(a.row);
  set.k.sort((x, y) => (+x[0] || 0) - (+y[0] || 0) || String(x[0]).localeCompare(String(y[0])));
}
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(path.join(__dirname, `added-card-ids-${DAY}.txt`), added.map((a) => a.id).join("\n") + "\n");
fs.writeFileSync(path.join(__dirname, `held-${DAY}.tsv`), ["card_id\tBulbapedia の名前\t揃わなかった理由", ...held.map((h) => [h.id, h.bulbapedia, h.reason].join("\t"))].join("\n") + "\n");
rebuildCardKinds();
console.log(`足した ${added.length}・保留 ${held.length}`);
