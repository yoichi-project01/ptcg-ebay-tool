#!/usr/bin/env node
// 英語名が空の基本エネルギーに、公式ページのエネルギーの種類から決まった英語名を入れる（2026-10-14、レビューの C6）。
//   node scripts/fill-basic-energy-en.mjs [--apply]
// 入れる条件: 同じ弾・同じ番号（型番 X のカードは同じ cardID）の公式 details.php の結果（取り込みのときに保存したもの）のカード名が、
// 行の日本語名と同じ「基本〇エネルギー」であること。種類はその名前から決める（草→Grass Energy …）。公式の結果が見つからない行
// （店舗の情報で足した UR など）は空欄のまま。根拠は en-name-fix6/basic-energy.tsv、変えた card_id は en-name-fix6/basic-energy-changed-card-ids.txt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "./card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const OUT = path.join(__dirname, "en-name-fix6");
const APPLY = process.argv.includes("--apply");
const TYPE_EN = { 草: "Grass", 炎: "Fire", 水: "Water", 雷: "Lightning", 超: "Psychic", 闘: "Fighting", 悪: "Darkness", 鋼: "Metal", フェアリー: "Fairy" };
const RE = /^基本(草|炎|水|雷|超|闘|悪|鋼|フェアリー)エネルギー$/;
const N = (s) => (s || "").normalize("NFKC").replace(/\s+/g, "");
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// 公式 details.php の結果: キー「記号/番号」と「cardID」→ { jaName, source }
const byNum = new Map(), byId = new Map();
const add = (keys, cardId, jaName, source) => {
  const rec = { jaName, source, cardId };
  for (const k of keys) { if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(rec); }
  if (cardId) byId.set(String(cardId), rec);
};
const num = (x) => (/^\d+$/.test(x || "") ? String(parseInt(x, 10)) : null);
for (const dir of ["scan-progress"]) {
  for (const f of fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith(".json"))) {
    const j = readJson(path.join(__dirname, dir, f)) ?? {};
    for (const [cid, v] of Object.entries(j.details ?? j)) {
      if (!v || typeof v !== "object") continue;
      for (const c of v.cards ?? []) if (num(c.local)) add([`${f.replace(/\.json$/, "")}/${num(c.local)}`, v.badge && `${v.badge}/${num(c.local)}`].filter(Boolean), cid, c.jaName, `${dir}/${f}`);
    }
  }
}
// details.php に番号が無いが、カードの画像に番号が印刷されていると確かめたプロモ（scrape-promo-sets.mjs の printedNumbers。CL2023 の基本エネルギー等）
const printed = {};
for (const m of fs.readFileSync(path.join(__dirname, "scrape-promo-sets.mjs"), "utf8").matchAll(/printedNumbers:\s*\{([^}]*)\}/g)) for (const p of m[1].matchAll(/(\d+):\s*"(\d+)"/g)) printed[p[1]] = p[2];
for (const f of fs.readdirSync(path.join(__dirname, "promo-progress")).filter((f) => f.endsWith(".json") && f !== "gap-check.json")) {
  const j = readJson(path.join(__dirname, "promo-progress", f)) ?? {};
  for (const [cid, v] of Object.entries(j)) {
    if (!v || typeof v !== "object" || !v.jaName) continue;
    const n = num(v.number) ?? num(printed[cid]);
    add(n ? [`${f.replace(/\.json$/, "")}/${n}`] : [], cid, v.jaName, `promo-progress/${f}${printed[cid] ? "（printedNumbers）" : ""}`);
  }
}
// 2026-10-14 に取り直した SM12a・WCP の基本エネルギー（en-name-fix6/fetch-energy-details.mjs）
for (const [cid, v] of Object.entries(readJson(path.join(__dirname, "en-name-fix6", "official-details-2026-10-14.json")) ?? {})) {
  for (const c of v.cards ?? []) if (num(c.local)) add([`${v.set}/${num(c.local)}`], cid, c.jaName, "en-name-fix6/official-details-2026-10-14.json");
}
const nc = readJson(path.join(__dirname, "new-cards", "details.json")) ?? {};
for (const [cid, v] of Object.entries(nc)) for (const e of v.entries ?? []) if (num(e.local)) add([`${v.key}/${num(e.local)}`, `${v.badge}/${num(e.local)}`], cid, v.jaName, "new-cards/details.json");
for (const [cid, v] of Object.entries(readJson(path.join(__dirname, "dp-x", "details.json")) ?? {})) if (v?.jaName) byId.set(String(cid), { jaName: v.jaName, source: "dp-x/details.json", cardId: cid });

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const rows = [["card_id", "ja", "en", "status", "source"]];
const changed = [];
for (const s of data) {
  for (const k of s.k) {
    if (k[2] || !RE.test(N(k[1]))) continue;
    const id = `${s.c}-${k[0]}`;
    let recs = [];
    const x = /^X(\d+)$/.exec(k[0]);
    if (x) { const r = byId.get(x[1]); if (r) recs = [r]; }
    else if (num(k[0])) recs = [s.c, s.codeAlias].filter(Boolean).flatMap((c) => byNum.get(`${c}/${num(k[0])}`) ?? []);
    const hit = recs.find((r) => N(r.jaName) === N(k[1]));
    if (!hit) { rows.push([id, k[1], "", "空欄のまま", recs.length ? `公式の結果の名前が違う（${recs.map((r) => r.jaName).join("・")}）` : "公式の結果が見つからない"]); continue; }
    const en = `${TYPE_EN[RE.exec(N(k[1]))[1]]} Energy`;
    rows.push([id, k[1], en, "入れる", `${hit.source} cardID ${hit.cardId}「${hit.jaName}」`]);
    changed.push(id);
    if (APPLY) k[2] = en;
  }
}
const cnt = rows.slice(1).reduce((a, r) => ((a[r[3]] = (a[r[3]] || 0) + 1), a), {});
console.log(cnt);
for (const r of rows.slice(1).filter((r) => r[3] !== "入れる")) console.log("  " + r.join("\t"));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, APPLY ? "basic-energy.tsv" : "basic-energy-check.tsv"), rows.map((r) => r.join("\t")).join("\n") + "\n");
if (APPLY && changed.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "basic-energy-changed-card-ids.txt"), changed.join("\n") + "\n");
  rebuildCardKinds();
}
