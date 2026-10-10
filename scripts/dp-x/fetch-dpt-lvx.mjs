// DPt1〜4 の、Bulbapedia の一覧で「〜 LV.X」になっている行の公式 details.php を取得して本文を保存する（2026-10-10、読み取りだけ）。
//   node scripts/dp-x/fetch-dpt-lvx.mjs     対象は dp-x/dpt-lvx-targets.json（行 → cardID）、結果は dp-x/dpt-lvx-details.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { politeDelay, politeFetch } from "../scrape-promo-sets.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "dpt-lvx-details.json");
const targets = JSON.parse(fs.readFileSync(path.join(__dirname, "dpt-lvx-targets.json"), "utf8"));
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").split("\n").map((s) => s.trim()).filter(Boolean);
for (const [row, ids] of Object.entries(targets)) for (const cid of ids) {
  if (out[cid]) continue;
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${cid}`);
  await politeDelay();
  if (!html) throw new Error(`取得できない: ${cid}`);
  const t = textOf(html);
  const name = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "");
  const num = (html.match(/&nbsp;(\d+)&nbsp;\/&nbsp;(\d+)/) || []).slice(1).join("/");
  out[cid] = { row, name, num, lvx: t.includes("レベルアップ") && t[t.indexOf("LV.") + 1] === "X", text: t };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
}
console.log("完了", Object.keys(out).length);
