#!/usr/bin/env node
// cardData の数字でない型番の行（SVHK-FIG・SVB-DAR など）を削除する（2026-10-05、ユーザー判断）。
// 公式 details.php の番号で確かめられない行で、名前の無いものや、別の番号のカードと同じ画像になっているもの
// （SVHK-FIG すごいつりざお＝SVHK-023 など）が含まれていた。画像の対応表の該当キーも外す（画像ファイルは残す）。
// 出力: scripts/scan-patch-report/nonnumeric-removed.json・nonnumeric-removed-card-ids.txt
// 使い方: node scripts/remove-nonnumeric-rows.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const OUT = path.join(ROOT, "scripts", "scan-patch-report");
const dry = process.argv.includes("--dry-run");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const removed = [];
for (const s of data) {
  const keep = [];
  for (const r of s.k) {
    // 番号の無いプロモの型番（X＋公式の cardID、add-numberless-promos.mjs）は公式で確かめた行なので残す（2026-10-06）
    if (/^\d+$/.test(r[0]) || /^X\d+$/.test(r[0])) { keep.push(r); continue; }
    const key = `${s.c}/${r[0]}`;
    removed.push({ cardId: `${s.c}-${r[0]}`, ja: r[1], rarity: r[3] || "", image: index[key] || null });
    delete index[key];
  }
  s.k = keep;
}
console.log(`削除する行 ${removed.length}件（画像の対応表から外すキー ${removed.filter((r) => r.image).length}件）`);
for (const r of removed) console.log(`  ${r.cardId}\t${r.ja || "（名前なし）"}${r.image ? "\t" + r.image : ""}`);
if (dry) process.exit(0);
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(INDEX, JSON.stringify(index));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "nonnumeric-removed.json"), JSON.stringify({ removedAt: new Date().toISOString().slice(0, 10), reason: "数字でない型番の行。公式 details.php の番号で確かめられないため削除（ユーザー判断）", removed }, null, 1) + "\n");
fs.writeFileSync(path.join(OUT, "nonnumeric-removed-card-ids.txt"), removed.map((r) => r.cardId).join("\n") + "\n");
