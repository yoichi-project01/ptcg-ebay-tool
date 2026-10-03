#!/usr/bin/env node
// 公式以外の情報源で補完したシークレットの名前を、同じ弾にある同じカードの公式表記（cardData の既存行）にそろえる（2026-10-04）。
// 店舗・TCGdex は「アローラベトベトンGX」（公式は「アローラ ベトベトンGX」）、「ユニットエネルギー闘悪妖」（公式は「…闘悪フェアリー」）
// のように表記が違うことがある。空白・全角半角の違いだけなら自動で、それ以外は MANUAL に根拠付きで指定する。
// 使い方: node scripts/fix-secret-name-spelling.mjs --set SM3H
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const SRC = path.join(__dirname, "secret-sources");
// 弾-番号 → 公式表記（根拠: 同じ弾の通常版の公式名）
const MANUAL = { "SM6-110": { name: "ユニットエネルギー闘悪フェアリー", basis: "SM6-094（公式 details.php）の表記。ポケカくらぶも同じ表記" } };

const SET = process.argv[process.argv.indexOf("--set") + 1];
const key = (s) => s.normalize("NFKC").replace(/\s+/g, "");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const added = new Set(fs.readFileSync(path.join(SRC, `${SET}-added-card-ids.txt`), "utf8").split(/\r?\n/).filter(Boolean));
const official = set.k.filter((r) => !added.has(`${SET}-${r[0]}`));
const changes = [];
for (const r of set.k) {
  const id = `${SET}-${r[0]}`;
  if (!added.has(id)) continue;
  let to = null, basis = null;
  if (MANUAL[id]) ({ name: to, basis } = MANUAL[id]);
  else {
    const m = official.find((o) => o[1] !== r[1] && key(o[1]) === key(r[1]));
    if (m) { to = m[1]; basis = `${SET}-${m[0]}（公式 details.php）の表記`; }
  }
  if (to && to !== r[1]) { changes.push({ cardId: id, from: r[1], to, basis }); r[1] = to; }
}
if (!changes.length) { console.log(`${SET}: 変更なし`); process.exit(0); }
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
const rp = path.join(SRC, `${SET}.json`);
const report = JSON.parse(fs.readFileSync(rp, "utf8"));
for (const c of changes) {
  const x = report.results.find((y) => y.cardId === c.cardId);
  if (x) { x.add.ja = c.to; x.nameAdjusted = { from: c.from, to: c.to, basis: c.basis }; }
}
fs.writeFileSync(rp, JSON.stringify(report, null, 1) + "\n");
for (const c of changes) console.log(`${c.cardId}: ${c.from} → ${c.to}（${c.basis}）`);
