// SMB・SMF・SMG の再録カード（印刷されている記号が「XY」のカード、49枚）の画像を、公式のカード検索から取り直す（2026-10-06）。
//   node scripts/refetch-xy-reprint-images.mjs --set SMB        取得して public/cards に保存（画像の対応表は変えない。--only で別に更新する）
// cardID は取り込んだときに公式の番号で確かめたもの（SMB は公式一覧の SM-XY キー、SMF・SMG は scrape-missing-sets.mjs の extraCardIds）。
// details.php で番号・名前をもう一度確かめ（cardData の行と一致したものだけ）、その details.php に載っている画像を取る。
// 退避してある古い画像は使わない。同時接続1本・2〜3秒間隔（scrape-promo-sets.mjs の politeFetch）。
// 取得後は node scripts/build-image-index.mjs --only <弾> で画像の対応表と SHA-256 の一覧（image-hashes.tsv）を合わせる。
// 結果は scripts/xy-reprint-refetch/{弾}.json、取り直した card_id は {弾}-refetched-card-ids.txt。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";
import { parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";
import { normalizeName } from "./patch-from-scan.mjs";
import { politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "xy-reprint-refetch");
const SET = process.argv.includes("--set") ? process.argv[process.argv.indexOf("--set") + 1] : null;
const CARD_IDS = {
  SMB: Array.from({ length: 12 }, (_, i) => 33199 + i), // 公式一覧 SM-XY キー（033199 はかせのてがみ 〜 033210 ミステリーエネルギー）
  SMF: [34527, 34528, 34529, 34530, 34531, 34532, 34533, 34534],
  SMG: Array.from({ length: 29 }, (_, i) => 34637 + i),
};
if (!CARD_IDS[SET]) throw new Error("--set SMB|SMF|SMG を指定してください");

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "cardData.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "imageIndex.json"), "utf8"));
const set = data.find((s) => s.c === SET);
const total = computeSetTotal(set.k);
const folder = path.dirname(Object.entries(index).find(([k]) => k.startsWith(SET + "/"))[1]); // 例 cards/SM/SMB
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let fails = 0;
for (const cardId of CARD_IDS[SET]) {
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${cardId}`);
  await politeDelay();
  if (!html) { if (++fails >= 3) throw new Error("連続3件失敗したため停止します"); results.push({ cardId, status: "details.php を取得できない" }); continue; }
  fails = 0;
  const [d] = parseCardDetailsFromHtml(html);
  const badge = (html.match(/<img[^>]*class="img-regulation"[^>]*alt="([^"]+)"/) || [])[1] ?? null;
  if (!d || !d.cardThumbFile) { results.push({ cardId, badge, status: "番号か画像が無い" }); continue; }
  const row = set.k.find((k) => parseInt(k[0], 10) === parseInt(d.local, 10));
  const r = { cardId, badge, local: d.local, total: d.total, jaName: d.jaName, image: d.cardThumbFile, id: row ? `${SET}-${row[0]}` : null };
  if (!row) { results.push({ ...r, status: "cardData に同じ番号の行が無い" }); continue; }
  if (normalizeName(row[1]) !== normalizeName(d.jaName)) { results.push({ ...r, status: `名前が違う（cardData ${row[1]}）` }); continue; }
  if (index[`${SET}/${parseInt(row[0], 10)}`]) { results.push({ ...r, status: "画像の対応表に既にある（変えない）" }); continue; }
  const buf = await politeFetch(`https://www.pokemon-card.com${d.cardThumbFile}`, true);
  await politeDelay();
  if (!buf || buf.length < 1000) { results.push({ ...r, status: "画像を取得できない" }); continue; }
  const ext = buf[0] === 0x89 ? ".png" : buf[0] === 0x47 ? ".gif" : ".jpg";
  const rel = path.posix.join(folder, buildFileName(row[1], SET, row[0], row[3], total) + ext);
  const dest = path.join(ROOT, "public", rel);
  if (await isUsableImage(dest)) { results.push({ ...r, file: rel, status: "同じ名前のファイルが既にある（変えない）" }); continue; }
  await writeFileAtomic(dest, buf);
  results.push({ ...r, file: rel, bytes: buf.length, status: "取得" });
}
const got = results.filter((x) => x.status === "取得");
fs.writeFileSync(path.join(OUT, `${SET}.json`), JSON.stringify({ at: new Date().toISOString(), set: SET, results }, null, 1));
fs.writeFileSync(path.join(OUT, `${SET}-refetched-card-ids.txt`), got.map((x) => x.id).join("\n") + (got.length ? "\n" : ""));
for (const x of results) if (x.status !== "取得") console.log(x.cardId, x.status, x.local ?? "", x.jaName ?? "");
console.log(`[${SET}] ${got.length}/${CARD_IDS[SET].length}件を取得`);
