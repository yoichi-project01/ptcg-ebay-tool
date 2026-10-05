// 以前の作り直しで「公式ページなし」とした欠番（scrape-promo-sets.mjs の allowedGaps）に、公式の一覧（official-card-scan.json）の
// 別のキー（画像フォルダが BW・XY などの、cardData に無いキー）に入ったカードが紛れていないかを確かめる（2026-10-05）。
// 欠番の前後の番号の cardID の範囲にある候補を details.php で1件ずつ取得し、番号の表記（"221 / SV-P" 等）を見る。基本エネルギーは除く。
//   node scripts/check-promo-gaps.mjs     結果は scripts/promo-progress/gap-check.json（取得済みは飛ばす）・標準出力
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePromoDetailFromHtml, politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const scan = JSON.parse(await fs.readFile(path.join(__dirname, "official-card-scan.json"), "utf8")).setMap;
const cardData = JSON.parse(await fs.readFile(path.join(ROOT, "src", "cardData.json"), "utf8"));
const codes = new Set(cardData.map((s) => s.c));
const OUT = path.join(__dirname, "promo-progress", "gap-check.json");
const GAPS = {
  "S-P": [60, 61, 62, 63, 64, 65, 66, 67, 134, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 222, 233, 303, 329, 330, 331, 332, 333, 334, 335, 336],
  "SV-P": [37, 38, 39, 40, 41, 42, 43, 44, 221, 223, 224, 225, 226, 227, 228, 229, 230, 231],
  "XY-P": [127, 128, 129, 189, 217, 267],
  "BW-P": [25, 26, 27, 28, 29, 30, 31],
  // M-P は新しく追加する弾。details.php の結果（promo-progress/M-P.json）の欠番
  "M-P": [52, 77, 78, 79, 80, 81, 82, 83, 84, ...Array.from({ length: 30 }, (_, i) => 101 + i)],
};
const idOf = (c) => { const m = (c.cardThumbFile || "").match(/\/(\d+)_/); return m ? Number(m[1]) : null; };
const done = JSON.parse(await fs.readFile(OUT, "utf8").catch(() => "{}"));
const candidates = new Map();
for (const [code, gaps] of Object.entries(GAPS)) {
  const pr = JSON.parse(await fs.readFile(path.join(__dirname, "promo-progress", `${code}.json`), "utf8"));
  const byNum = new Map(Object.entries(pr).filter(([, v]) => v.number).map(([id, v]) => [Number(v.number), Number(id)]));
  const nums = [...byNum.keys()].sort((a, b) => a - b);
  const runs = [];
  for (const g of gaps) { const r = runs.at(-1); if (r && r[1] === g - 1) r[1] = g; else runs.push([g, g]); }
  for (const [a, b] of runs) {
    const lo = byNum.get(Math.max(...nums.filter((n) => n < a))), hi = byNum.get(Math.min(...nums.filter((n) => n > b)));
    const [L, H] = [Math.min(lo, hi), Math.max(lo, hi)];
    for (const [key, list] of Object.entries(scan)) {
      if (codes.has(key) && key !== "BW" && key !== "XY") continue;
      for (const e of list) {
        const id = idOf(e);
        if (!(id > L && id < H) || pr[id] || /_E_KIHON/.test(e.cardThumbFile)) continue;
        candidates.set(id, { key, gap: `${code} ${a}-${b}` });
      }
    }
  }
}
console.log(`候補 ${candidates.size}件（取得済み ${[...candidates.keys()].filter((id) => done[id]).length}）`);
for (const [id, c] of candidates) {
  if (done[id]) continue;
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${id}`);
  const p = html ? parsePromoDetailFromHtml(html) : null;
  done[id] = { ...c, ...(p ?? { error: "取得できない" }) };
  await fs.writeFile(OUT, JSON.stringify(done, null, 1));
  await politeDelay();
}
const hits = Object.entries(done).filter(([, v]) => v.label);
console.log(`プロモの番号があったもの ${hits.length}件`);
for (const [id, v] of hits) console.log(`  ${v.gap}: cardID ${id}（キー ${v.key}）→ ${v.number} / ${v.label} ${v.jaName} [${v.badge}]`);
const others = Object.entries(done).filter(([, v]) => !v.label);
console.log(`プロモの番号が無いもの ${others.length}件（バッジの内訳: ${JSON.stringify(others.reduce((m, [, v]) => (m[v.badge ?? v.error] = (m[v.badge ?? v.error] ?? 0) + 1, m), {}))}）`);
