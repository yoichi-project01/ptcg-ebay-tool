#!/usr/bin/env node
// 取り込みのときに details.php の結果を残していなかった基本エネルギー（SM12a 202〜210・WCP 103〜108）の公式ページを取り直す（2026-10-14、C6）。
//   node scripts/en-name-fix6/fetch-energy-details.mjs
// 結果は official-details-2026-10-14.json（cardID → 記号・番号・名前）。1接続・2〜3秒間隔。cardID は公式一覧（official-card-scan.json）の SM12a・WCP キーの基本エネルギー
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCardDetail, sleep } from "../scrape-missing-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "official-details-2026-10-14.json");
const IDS = { SM12a: [37470, 37471, 37472, 37473, 37474, 37475, 37476, 37477, 37478], WCP: [4102, 4103, 4104, 4105, 4106, 4107] };
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
for (const [set, ids] of Object.entries(IDS)) {
  for (const id of ids) {
    if (out[id]) continue;
    const cards = await fetchCardDetail(id);
    out[id] = { set, cards: cards.map(({ local, total, jaName }) => ({ local, total, jaName })) };
    console.log(set, id, JSON.stringify(out[id].cards));
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
    await sleep(2000 + Math.random() * 1000);
  }
}
