#!/usr/bin/env node
// 公式一覧の再取得による補完・作り直し（2026-09-29〜10-01）の結果を集計し、card_id の一覧を出力する。
// 起点（作業開始前のコミット）と現在の cardData.json / imageIndex.json を比べる。
// 画像の差し替え（パスは同じで中身が変わったもの）は index の比較では分からないため、
// 作り直しレポート（scan-patch-report/*-rebuild.json の imageReplaced）も合わせて使う。
//
// 出力: scripts/scan-patch-report/{added,changed,removed}-card-ids.txt と summary.json
// 使い方: node scripts/summarize-scan-patch.mjs [起点コミット]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = path.join(ROOT, "scripts", "scan-patch-report");
const BASE = process.argv[2] || "034e2d6";

const gitJson = (p) => JSON.parse(execFileSync("git", ["show", `${BASE}:${p}`], { cwd: ROOT, maxBuffer: 1 << 30 }).toString());
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const baseData = gitJson("src/cardData.json");
const headData = readJson("src/cardData.json");
const baseIndex = gitJson("src/imageIndex.json");
const headIndex = readJson("src/imageIndex.json");

const imageKey = (code, local) => (/^\d+$/.test(local) ? `${code}/${parseInt(local, 10)}` : `${code}/${local}`);

// 作り直しレポートから「既存画像の中身を差し替えた」card_id を集める
const replacedByReport = new Set();
for (const f of fs.readdirSync(REPORT_DIR)) {
  if (!f.endsWith("-rebuild.json")) continue;
  const r = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), "utf8"));
  for (const x of r.imageReplaced || []) if (x.hadImage) replacedByReport.add(x.id);
}

const baseSets = new Map(baseData.map((s) => [s.c, s]));
const headSets = new Map(headData.map((s) => [s.c, s]));
const added = [], changed = [], removed = [];
const perSet = [];

for (const code of new Set([...baseSets.keys(), ...headSets.keys()])) {
  const b = new Map((baseSets.get(code)?.k || []).map((r) => [r[0], r]));
  const h = new Map((headSets.get(code)?.k || []).map((r) => [r[0], r]));
  const st = { code, added: 0, removed: 0, nameChanged: 0, rarityChanged: 0, imageAdded: 0, imageReplaced: 0, changed: 0,
    ofBefore: baseSets.get(code)?.of ?? null, ofAfter: headSets.get(code)?.of ?? null };

  for (const [local, row] of h) {
    const id = `${code}-${local}`;
    const key = imageKey(code, local);
    const hadImg = key in baseIndex, hasImg = key in headIndex;
    const old = b.get(local);
    if (!old) {
      added.push(id); st.added++;
      if (hasImg) st.imageAdded++;
      continue;
    }
    let isChanged = false;
    if (old[1] !== row[1]) { st.nameChanged++; isChanged = true; }
    if ((old[3] || "") !== (row[3] || "")) { st.rarityChanged++; isChanged = true; }
    if (!hadImg && hasImg) { st.imageAdded++; isChanged = true; }
    else if (hadImg && hasImg && (baseIndex[key] !== headIndex[key] || replacedByReport.has(id))) { st.imageReplaced++; isChanged = true; }
    if (isChanged) { changed.push(id); st.changed++; }
  }
  for (const local of b.keys()) if (!h.has(local)) { removed.push(`${code}-${local}`); st.removed++; }

  if (st.added || st.removed || st.changed || st.ofBefore !== st.ofAfter) perSet.push(st);
}

perSet.sort((a, b) => a.code.localeCompare(b.code));
fs.writeFileSync(path.join(REPORT_DIR, "added-card-ids.txt"), added.join("\n") + "\n");
fs.writeFileSync(path.join(REPORT_DIR, "changed-card-ids.txt"), changed.join("\n") + "\n");
fs.writeFileSync(path.join(REPORT_DIR, "removed-card-ids.txt"), removed.join("\n") + "\n");
const total = perSet.reduce((t, s) => { for (const k of ["added", "removed", "changed", "nameChanged", "rarityChanged", "imageAdded", "imageReplaced"]) t[k] = (t[k] || 0) + s[k]; return t; }, {});
fs.writeFileSync(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ base: BASE, total, sets: perSet }, null, 1) + "\n");

console.log("set\tadded\tremoved\tchanged(name/rarity/imgAdd/imgRepl)\tof");
for (const s of perSet) console.log(`${s.code}\t${s.added}\t${s.removed}\t${s.changed} (${s.nameChanged}/${s.rarityChanged}/${s.imageAdded}/${s.imageReplaced})\t${s.ofBefore === s.ofAfter ? "" : `${s.ofBefore}→${s.ofAfter}`}`);
console.log(`合計: セット${perSet.length} / 追加${total.added} / 削除${total.removed} / 変更${total.changed}（名前${total.nameChanged}・レアリティ${total.rarityChanged}・画像補完${total.imageAdded}・画像差し替え${total.imageReplaced}）`);
