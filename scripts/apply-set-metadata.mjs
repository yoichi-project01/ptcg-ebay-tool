#!/usr/bin/env node
// cardData.json の弾情報に、根拠付きの修正と PSA 表記を反映する。
//   修正（ja / y）: scripts/set-data-fixes.json … 現在値が from のときだけ to に書き換える（to なら何もしない）
//   PSA 表記: scripts/set-psa-names.json … 各弾の psaName に入れる（en は変更しない）
// 使い方: node scripts/apply-set-metadata.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const read = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const { fixes } = read("set-data-fixes.json");
const psaNames = read("set-psa-names.json");
const dry = process.argv.includes("--dry-run");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const byCode = new Map(data.map((s) => [s.c, s]));
let fixed = 0, psaSet = 0, problems = 0;

for (const f of fixes) {
  const s = byCode.get(f.code);
  const cur = s?.[f.field] ?? "";
  if (!s) { console.error(`! 弾が無い: ${f.code}`); problems++; continue; }
  if (cur === f.to) continue;
  if (cur !== f.from) { console.error(`! ${f.code}.${f.field} が想定と違う（現在 ${JSON.stringify(cur)} / 想定 ${JSON.stringify(f.from)}）`); problems++; continue; }
  s[f.field] = f.to;
  console.log(`  修正 ${f.code}.${f.field}: ${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`);
  fixed++;
}

for (const [code, v] of Object.entries(psaNames)) {
  if (code.startsWith("_")) continue;
  const s = byCode.get(code);
  if (!s) { console.error(`! 弾が無い: ${code}`); problems++; continue; }
  if (s.psaName === v.psaName) continue;
  // キー順: en の直後に psaName を置く
  const entries = Object.entries(s).filter(([k]) => k !== "psaName");
  const i = entries.findIndex(([k]) => k === "en");
  entries.splice(i + 1, 0, ["psaName", v.psaName]);
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, Object.fromEntries(entries));
  psaSet++;
}

console.log(`修正: ${fixed} 件 / psaName: ${psaSet} 弾${dry ? "（dry-run）" : ""}${problems ? ` / 問題 ${problems} 件` : ""}`);
if (problems) process.exit(1);
if (!dry) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
