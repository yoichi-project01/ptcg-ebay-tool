// レアリティが空の行のために、公式 details.php の結果を scripts/scan-progress/{弾}.json に集める（2026-10-05）。
// cardData は変えない。反映は fill-rarity-from-details.mjs。
//   node scripts/fetch-rarity-details.mjs      scripts/rarity-fix/fetch-plan.json の cardID を取得（取得済みは飛ばす。再開可能）
// fetch-plan.json は、レアリティのマークがある弾（details.php の結果か見本 sample-icons.json で確認）の空の行について、
// 前後の番号が分かっている cardID にはさまれた範囲の未取得の cardID（範囲が無ければ弾全体）。
// 同時接続1本・2〜3秒間隔、403・通信エラーは待って再試行、連続3件失敗で停止（scrape-promo-sets.mjs の politeFetch）。
// 未知のレアリティコードも分かるよう、アイコンのコード（rarityCodes）をそのまま残す。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./filename-utils.mjs";
import { parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";
import { politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await fs.readFile(path.join(__dirname, "rarity-fix", "fetch-plan.json"), "utf8"));
const scan = JSON.parse(await fs.readFile(path.join(__dirname, "official-card-scan.json"), "utf8")).setMap;
for (const [code, ids] of Object.entries(plan)) {
  const p = path.join(__dirname, "scan-progress", `${code}.json`);
  const progress = JSON.parse(await fs.readFile(p, "utf8").catch(() => "{}"));
  const thumb = new Map((scan[code] || []).map((e) => [parseInt(e.cardThumbFile.match(/\/(\d+)_/)[1], 10), e.cardThumbFile]));
  const todo = ids.filter((id) => !progress[id]);
  if (!todo.length) continue;
  console.log(`[${code}] ${todo.length}件`);
  let fails = 0;
  for (const id of todo) {
    const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${id}`);
    if (!html) {
      if (++fails >= 3) throw new Error(`[${code}] 連続3件失敗したため停止します（再実行で続きから）`);
    } else {
      fails = 0;
      const badge = (html.match(/class="img-regulation"\s+alt="([^"]*)"/) || [])[1] ?? null;
      const rarityCodes = [...html.matchAll(/ic_rare_([a-z0-9_]+)\.gif/g)].map((m) => m[1]);
      progress[id] = { badge, cards: parseCardDetailsFromHtml(html), rarityCodes, cardThumbFile: thumb.get(id) ?? null };
      await writeFileAtomic(p, JSON.stringify(progress, null, 1));
    }
    await politeDelay();
  }
}
console.log("完了");
