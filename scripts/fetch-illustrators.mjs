// 英語名の補完（2026-10-06）のために、対象カードのイラストレーターを公式 details.php から集める（cardData は変えない）。
//   node scripts/fetch-illustrators.mjs <targets.json> [出力先]   結果は scripts/en-name-fix2/illustrators.json（出力先を指定しなければ。取得済みは飛ばす。再開可能）
// targets.json は [{id, set, num, ja, cardIds}]。cardIds が無い行は、最新の公式一覧（official-card-scan.json）の同じ弾のキーから同じ名前のカードを探す。
// details.php の番号（"NNN / NNN" または "NNN / XX-P"）が行の番号と一致したものだけ使う。同時接続1本・2〜3秒間隔（scrape-promo-sets.mjs の politeFetch）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./filename-utils.mjs";
import { normalizeName } from "./patch-from-scan.mjs";
import { politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, "en-name-fix2", "illustrators.json");
const targets = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const scan = JSON.parse(fs.readFileSync(path.join(__dirname, "official-card-scan.json"), "utf8")).setMap;
const progress = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const idOf = (e) => String(parseInt(e.cardThumbFile.match(/\/(\d+)_/)[1], 10));
let fails = 0;
for (const t of targets) {
  if (progress[t.id]) continue;
  let ids = t.cardIds || [];
  if (!ids.length) ids = (scan[t.set] || []).filter((e) => normalizeName(e.jaName ?? e.cardNameViewText) === normalizeName(t.ja)).map(idOf);
  const found = { tried: [], illustrator: null, cardId: null };
  for (const id of ids) {
    const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${id}`);
    await politeDelay();
    if (!html) { if (++fails >= 3) throw new Error("連続3件失敗したため停止します（再実行で続きから）"); continue; }
    fails = 0;
    const nums = [...html.matchAll(/&nbsp;(\d+)&nbsp;\/&nbsp;[A-Za-z0-9-]+\s*&nbsp;/g)].map((m) => parseInt(m[1], 10));
    const ill = (html.match(/illust=([^"&]+)"/) || [])[1];
    found.tried.push({ cardId: id, nums, illustrator: ill ? decodeURIComponent(ill.replace(/\+/g, " ")) : null });
    if (nums.includes(parseInt(t.num, 10)) && ill) { found.illustrator = decodeURIComponent(ill.replace(/\+/g, " ")); found.cardId = id; break; }
  }
  progress[t.id] = found;
  await writeFileAtomic(OUT, JSON.stringify(progress, null, 1));
}
console.log("完了", Object.values(progress).filter((x) => x.illustrator).length, "/", Object.keys(progress).length);
