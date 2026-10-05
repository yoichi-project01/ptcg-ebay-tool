// scripts/en-name-check/affected.tsv（英語版に同じ名前のカードが無い英語名）の行の英語名（k[2]）を空欄にする（2026-10-05）。
// 出品時に「英語名なし」の警告が出るようにするつなぎ。cardData の英語名が affected.tsv の値と同じときだけ書き換える（再実行しても変化なし）。
//   node scripts/blank-en-not-in-english.mjs [--dry-run]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "src", "cardData.json");
const rows = readFileSync(path.join(ROOT, "scripts", "en-name-check", "affected.tsv"), "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [id, set, ja, en] = l.split("\t"); return { id, set, num: id.slice(set.length + 1), ja, en }; });
const raw = readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const bySet = new Map(data.map((s) => [s.c, s]));
let changed = 0; const skipped = [];
for (const r of rows) {
  const k = bySet.get(r.set)?.k.find((x) => x[0] === r.num);
  if (!k || k[1] !== r.ja || k[2] !== r.en) { skipped.push(r.id); continue; }
  k[2] = ""; changed++;
}
if (!process.argv.includes("--dry-run")) writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
console.log(`${changed}件の英語名を空欄にしました（対象外 ${skipped.length}件${skipped.length ? ": " + skipped.join(", ") : ""}）`);
