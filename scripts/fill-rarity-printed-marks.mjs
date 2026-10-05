// scripts/rarity-fix/new-codes.json の行（公式の画像に印刷されたマークと遊々亭の表記が一致したもの）のレアリティを入れる（2026-10-06）。
//   node scripts/fill-rarity-printed-marks.mjs --set S10a     1弾分を cardData.json・画像のファイル名・imageIndex.json に反映
// 今のレアリティが空の行だけ書き換える（再実行しても変化なし）。変えた card_id は rarity-fix/printed-marks-changed-card-ids-{弾}.txt。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "rarity-fix", "new-codes.json"), "utf8")).rows.filter((r) => r.id.startsWith(SET + "-") && r.id.slice(SET.length + 1).match(/^\d+$/));
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
const changed = [];
for (const r of rows) {
  const row = set.k.find((k) => `${SET}-${k[0]}` === r.id);
  if (!row || row[1] !== r.ja) throw new Error(`cardData の行が想定と違います: ${r.id}`);
  if (row[3]) continue;
  row[3] = r.rarity;
  const key = `${SET}/${String(parseInt(row[0], 10))}`;
  const rel = index[key];
  const m = rel && rel.match(/^(.*_[^/]*-[^/_]+／\d+)(\.[a-z]+)$/i);
  if (m) {
    const newRel = `${m[1]}_${r.rarity}${m[2]}`;
    fs.renameSync(path.join(ROOT, "public", rel), path.join(ROOT, "public", newRel));
    index[key] = newRel;
  }
  changed.push(r.id);
}
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(INDEX, JSON.stringify(index));
fs.writeFileSync(path.join(__dirname, "rarity-fix", `printed-marks-changed-card-ids-${SET}.txt`), changed.join("\n") + (changed.length ? "\n" : ""));
console.log(`[${SET}] ${changed.length}件`);
