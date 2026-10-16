#!/usr/bin/env node
// ミラーの柄の版（モンスターボールミラー・マスターボールミラー等）を、元の行のすぐ後ろに別の行として足す（2026-10-12）。
//   node scripts/mirror-variants/add-mirror-variants.mjs --set SV2a|M2a|SV8a|S8a [--apply]
// 根拠は sources.json。型番は元の型番の末尾に版の印（"025-PB"、card_id は SV2a-025-PB）。日本語名に「（マスターボールミラー）」などを付け、
// 英語名・レアリティは元の行と同じ。画像は足さない（公式に版の画像が無い。元の行の画像も使わない。src/App.jsx の localImage）。
// 足した card_id は {弾}-added-card-ids.txt。既に足した行は飛ばす（再実行しても増えない）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");
const { codes } = JSON.parse(fs.readFileSync(path.join(__dirname, "sources.json"), "utf8"));

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const set = data.find((s) => s.c === SET);
if (!set) throw new Error(`弾がありません: ${SET}`);

// 番号 → 足す版の印
const plan = new Map();
if (SET === "SV2a") {
  for (const r of set.k) if (["C", "U", "R"].includes(r[3]) && /^\d+$/.test(r[0])) plan.set(r[0], ["PB", "MB"]);
} else if (SET === "M2a") {
  const BALL = { モンスター: "PB", クイック: "QB", ラブラブ: "LB", フレンド: "FB", ダーク: "DB", R: "R" };
  const wiki = JSON.parse(fs.readFileSync(path.join(__dirname, "M2a-pokemonwiki.json"), "utf8"));
  const bp = Object.fromEntries(fs.readFileSync(path.join(__dirname, "M2a-bulbapedia-2026-10-12.txt"), "utf8").trim().split(",")
    .map((x) => { const [n, b, e] = x.split(":"); return [n, { b, e }]; }));
  for (const w of wiki) {
    const b = bp[w.num];
    if (!BALL[w.ball] || !b || b.b !== BALL[w.ball] || b.e !== "EN") throw new Error(`ポケモンWiki と Bulbapedia が合わない: ${w.num} ${w.ball} ${JSON.stringify(b)}`);
    const row = set.k.find((r) => r[0] === w.num);
    const N = (s) => s.normalize("NFKC").replace(/\s/g, "");
    if (!row || N(row[1]) !== N(w.name) || row[3]) throw new Error(`cardData の行と合わない: ${w.num} ${w.name} ${row}`);
    plan.set(w.num, ["EN", BALL[w.ball]]);
  }
} else if (SET === "SV8a") {
  // 2026-10-15: モンスターボールミラーはレアリティ表記の無い全144行（ポケモン・トレーナーズ・エネルギー）、マスターボールミラーはそのうちポケモン101行（001〜135）。
  // 遊々亭の一覧（SV8a-yuyutei-2026-10-15.tsv）と1行ずつ番号・名前が合うことを確かめる。根拠と gamepedia との食い違いは sources.json
  const N = (s) => s.normalize("NFKC").replace(/\s/g, "");
  const yt = fs.readFileSync(path.join(__dirname, "SV8a-yuyutei-2026-10-15.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t"));
  for (const [num, code, name] of yt) {
    const row = set.k.find((r) => r[0] === num);
    if (!row || row[3] || N(row[1]) !== N(name)) throw new Error(`cardData の行と合わない: ${num} ${name} ${row}`);
    if (code === "MB" && Number(num) > 136) throw new Error(`ポケモン以外にマスターボールミラー: ${num}`);
    plan.set(num, [...(plan.get(num) ?? []), code]);
  }
  const blank = set.k.filter((r) => !r[3] && /^\d+$/.test(r[0]));
  if (blank.some((r) => !plan.get(r[0])?.includes("PB"))) throw new Error("モンスターボールミラーの無い行がある");
} else if (SET === "S8a") {
  // 2026-10-16: レアリティ表記の無い17行（001〜017）にミラー（MR。柄の名前の無い普通のミラー＝リバースホロ）。遊々亭の一覧（S8a-yuyutei-2026-10-16.tsv）と
  // 1行ずつ番号・名前が合うこと、レアリティ表記の無い行がすべて入っていることを確かめる。根拠は sources.json（Bulbapedia・遊々亭・PSA の Reverse Foil）
  const N = (s) => s.normalize("NFKC").replace(/\s/g, "").replace(/\(.*\)$/, "");
  const yt = fs.readFileSync(path.join(__dirname, "S8a-yuyutei-2026-10-16.tsv"), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t"));
  for (const [num, code, name] of yt) {
    const row = set.k.find((r) => r[0] === num);
    if (!row || row[3] || N(row[1]) !== N(name)) throw new Error(`cardData の行と合わない: ${num} ${name} ${row}`);
    plan.set(num, [code]);
  }
  const blank = set.k.filter((r) => !r[3] && /^\d+$/.test(r[0]));
  if (blank.length !== yt.length || blank.some((r) => !plan.has(r[0]))) throw new Error("レアリティ表記の無い行と遊々亭の件数が合わない");
} else throw new Error(`対象外の弾: ${SET}`);

const added = [];
const k = [];
const have = new Set(set.k.map((r) => r[0]));
for (const r of set.k) {
  k.push(r);
  if (/-[A-Z]+$/.test(r[0])) continue;
  for (const code of plan.get(r[0]) ?? []) {
    const local = `${r[0]}-${code}`;
    if (have.has(local)) continue;
    const row = [local, `${r[1]}（${codes[code].ja}）`, r[2], r[3]];
    k.push(row);
    added.push(`${SET}-${local}`);
  }
}
const cnt = {};
for (const id of added) { const c = id.split("-").pop(); cnt[c] = (cnt[c] || 0) + 1; }
console.log(`${SET}: 足す行 ${added.length}`, JSON.stringify(cnt), added.slice(0, 4).join(" "));
if (APPLY && added.length) {
  set.k = k;
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(path.join(__dirname, `${SET}-added-card-ids.txt`), added.join("\n") + "\n");
  rebuildCardKinds();
}
