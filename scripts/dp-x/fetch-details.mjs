// DP1〜5・DP（公式の一覧のキー）のカードの details.php を1件ずつ取得し、名前・印刷記号・レアリティのアイコン・画像・本文を保存する（2026-10-10、読み取りだけ）。
//   node scripts/dp-x/fetch-details.mjs
// 結果は scripts/dp-x/details.json（再開可能）。間隔・再試行は scrape-promo-sets.mjs の politeFetch（1接続・2〜3秒）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { politeDelay, politeFetch } from "../scrape-promo-sets.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "details.json");
const KEYS = ["DP1", "DP2", "DP3", "DP4", "DP5", "DP"];
const sm = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "official-card-scan.json"), "utf8")).setMap;
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const targets = KEYS.flatMap((k) => (sm[k] || []).map((c) => ({ key: k, cid: String(parseInt(c.cardThumbFile.match(/\/(\d+)_/)[1], 10)), listName: c.jaName, thumb: c.cardThumbFile })));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").split("\n").map((s) => s.trim()).filter(Boolean);
let fails = 0;
for (const t of targets) {
  if (out[t.cid]) continue;
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${t.cid}`);
  await politeDelay();
  if (!html) { if (++fails >= 3) throw new Error("連続3件失敗したため停止します"); continue; }
  fails = 0;
  const name = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "");
  const badge = (html.match(/<img[^>]*class="img-regulation"[^>]*alt="([^"]+)"/) || [])[1] ?? null;
  const rarityCode = (html.match(/ic_rare_([a-z0-9_]+)\.gif/) || [])[1] ?? null;
  const image = (html.match(/<img class="fit" src="([^"]+)"/) || [])[1] ?? null;
  const regHtml = (html.match(/img-regulation[\s\S]{0,300}/) || [""])[0].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  out[t.cid] = { key: t.key, listName: t.listName, thumb: t.thumb, name, badge, rarityCode, image, regText: regHtml, text: textOf(html) };
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(out, null, 1) + "\n"); fs.renameSync(OUT + ".tmp", OUT);
}
console.log("完了", Object.keys(out).length, "/", targets.length);
