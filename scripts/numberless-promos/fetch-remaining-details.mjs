// 番号の無いプロモの残り（大会賞品以外）の details.php を1件ずつ取得して、名前・印刷記号・画像・本文を保存する（2026-10-09、読み取りだけ）。
//   node scripts/numberless-promos/fetch-remaining-details.mjs
// 対象は promo-progress/{弾}.json の番号が無いカードのうち、cardData に X の行が無く、基本エネルギーと MP1 のカード（M-P キーの 49587〜49609）を除いたもの。
// 結果は scripts/numberless-promos/remaining-details.json（再開可能。取得済みは飛ばす）。間隔・再試行は scrape-promo-sets.mjs の politeFetch。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { politeDelay, politeFetch } from "../scrape-promo-sets.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "remaining-details.json");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "cardData.json"), "utf8"));
const have = new Set(data.flatMap((s) => s.k.filter((k) => /^X\d+$/.test(k[0])).map((k) => k[0].slice(1))));
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const targets = [];
for (const f of fs.readdirSync(path.join(ROOT, "scripts", "promo-progress")).filter((f) => /^[A-Za-z]+-P\.json$/.test(f))) {
  const set = f.replace(".json", "");
  for (const [cid, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "promo-progress", f), "utf8")))) {
    if (!v || v.number || have.has(cid)) continue;
    const n = v.jaName || "";
    if (/^基本.*エネルギー$/.test(n) || /^.エネルギー$/.test(n)) continue;
    if (set === "M-P" && +cid >= 49587 && +cid <= 49609) continue; // MP1 のカード（MP1 として登録済み）
    targets.push({ set, cid, listName: n });
  }
}
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").split("\n").map((s) => s.trim()).filter(Boolean);
let fails = 0;
for (const t of targets) {
  if (out[t.cid]) continue;
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${t.cid}`);
  await politeDelay();
  if (!html) { if (++fails >= 3) throw new Error("連続3件失敗したため停止します"); continue; }
  fails = 0;
  const name = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "");
  const badge = (html.match(/<img[^>]*class="img-regulation"[^>]*alt="([^"]+)"/) || [])[1] ?? null;
  const hasNumber = /&nbsp;\d+&nbsp;\/&nbsp;/.test(html);
  const image = (html.match(/<img class="fit" src="([^"]+)"/) || [])[1] ?? null;
  const text = textOf(html);
  const i = text.findIndex((s) => /^イラスト/.test(s));
  out[t.cid] = { set: t.set, listName: t.listName, name, badge, hasNumber, image, tail: text.slice(Math.max(0, i), i + 12), text };
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(out, null, 1) + "\n"); fs.renameSync(OUT + ".tmp", OUT);
}
console.log("完了", Object.keys(out).length, "/", targets.length);
