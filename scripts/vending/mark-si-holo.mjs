#!/usr/bin/env node
// サザンアイランド（SI99）のキラのカードの日本語名の末尾に「（ホロ）」を付ける（2026-10-15、ユーザーの指示。DP3 のディアルガ（ホロ）等と同じ形で、Finish に Holo が出る）。
//   node scripts/vending/mark-si-holo.mjs [--apply]
// キラかどうかは pcg-search のレアリティ欄の「-(キラ)」（pcg-search-vending-2026-10-15.json）。PSA のページタイトルでも -Holo（Mew・Togepi・Ledyba・Marill・Slowking。
// Vileplume は PSA のページが見つからない）。SI99 に同じ名前のキラでないカードは無いので「（ノーマル）」を付ける行は無い。画像のファイル名も付け替える
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName } from "../filename-utils.mjs";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const APPLY = process.argv.includes("--apply");
const ps = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "old-promos", "pcg-search-vending-2026-10-15.json"), "utf8"));
const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === "SI99");
const changed = [];
for (const k of set.k) {
  const p = ps[`1stmv${k[0].slice(1)}`];
  if (!p || p.listName !== k[1].replace(/（ホロ）$/, "")) throw new Error(`pcg-search のページと名前が合わない: ${k[0]} ${k[1]}`);
  if (!/キラ/.test(p.rarity) || /（ホロ）$/.test(k[1])) continue;
  if (set.k.some((o) => o !== k && o[1].replace(/（.*）$/, "") === k[1])) throw new Error(`同じ名前のカードがある: ${k[1]}`);
  const ext = path.extname(p.image);
  const dir = path.join(ROOT, "public", "cards", set.sr, set.c);
  const from = path.join(dir, buildFileName(k[1], set.c, k[0], k[3], 0) + ext);
  const ja = `${k[1]}（ホロ）`;
  const to = path.join(dir, buildFileName(ja, set.c, k[0], k[3], 0) + ext);
  console.log(`SI99-${k[0]}`, k[1], "→", ja);
  if (APPLY) { fs.renameSync(from, to); k[1] = ja; }
  changed.push(`SI99-${k[0]}`);
}
if (APPLY && changed.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  rebuildCardKinds();
  fs.writeFileSync(path.join(__dirname, "SI99-holo-card-ids-2026-10-15.txt"), changed.join("\n") + "\n");
}
console.log(`${changed.length}行`);
