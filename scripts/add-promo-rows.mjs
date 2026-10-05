// 既存のプロモの弾（SV-P 等）に、details.php で確かめた行だけを足す（2026-10-05）。既存の行・画像は変えない。
// scrape-promo-sets.mjs の --rebuild は画像をステージングから入れ直すため、取り直した画像を古い画像に戻してしまう。そのため足すだけの処理を分けた。
//   node scripts/add-promo-rows.mjs --set SV-P
// 1. scrape-promo-sets.mjs の REBUILD_SETS の設定（extraCardIds・allowedGaps）で details.php の結果を集め、弾全体を validatePromo で検証する
// 2. 既存の行が検証結果と1件でも違えば止める（番号・日本語名・レアリティ）
// 3. 検証結果にあって既存に無い行を足し、その画像を公式から取得する（同時接続1本・2〜3秒間隔）
// 4. 足した card_id を scripts/promo-progress/{弾}-added-card-ids-<日付>.txt に書く
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";
import { cacheCardIds, fetchDetails, imageExt, politeDelay, politeFetch, REBUILD_SETS, validatePromo } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const code = process.argv[process.argv.indexOf("--set") + 1];
const target = REBUILD_SETS.find((t) => t.code === code);
if (!target) throw new Error(`REBUILD_SETS に ${code} がありません`);

const cache = JSON.parse(await fs.readFile(path.join(__dirname, "official-card-cache.json"), "utf8"));
const raw = await fs.readFile(DATA, "utf8");
const cardData = JSON.parse(raw);
const set = cardData.find((s) => s.c === code);
const cardIds = cacheCardIds(target, cache);
const progress = await fetchDetails(code, cardIds);
const { k, byLocal } = validatePromo(target, cardIds, progress);

const key = (n) => String(parseInt(n, 10));
const newByKey = new Map(k.map((r) => [key(r[0]), r]));
const diff = set.k.filter((r) => { const n = newByKey.get(key(r[0])); return !n || n[0] !== r[0] || n[1] !== r[1] || (n[3] ?? "") !== (r[3] ?? ""); });
if (diff.length) throw new Error(`[${code}] 既存の行が details.php の結果と違います（足さずに止めます）: ${diff.map((r) => r.join("/")).join(", ")}`);
const oldKeys = new Set(set.k.map((r) => key(r[0])));
const added = k.filter((r) => !oldKeys.has(key(r[0])));
console.log(`[${code}] 既存 ${set.k.length}行はすべて一致。足す行 ${added.length}: ${added.map((r) => `${r[0]} ${r[1]}`).join("、")}`);

const total = computeSetTotal(k);
if (total !== computeSetTotal(set.k)) throw new Error(`[${code}] 最大番号が変わるため既存の画像のファイル名と合わなくなります（${computeSetTotal(set.k)}→${total}）`);
for (const r of added) {
  const d = byLocal.get(parseInt(r[0], 10));
  const base = path.join(ROOT, "public", "cards", target.sr, code, buildFileName(r[1], code, r[0], r[3], total));
  if (await isUsableImage(base + ".jpg") || await isUsableImage(base + ".gif")) continue;
  const buf = d.cardThumbFile ? await politeFetch("https://www.pokemon-card.com" + d.cardThumbFile, true) : null;
  if (!buf || buf.length <= 1000) throw new Error(`[${code}] ${r[0]} の画像を取得できません（cardData.json は未更新。再実行で続きから）`);
  await writeFileAtomic(base + imageExt(buf), buf);
  await politeDelay();
}
set.k = [...set.k, ...added].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
await fs.writeFile(DATA, JSON.stringify(cardData, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
const stamp = new Date().toISOString().slice(0, 10);
await fs.writeFile(path.join(__dirname, "promo-progress", `${code}-added-card-ids-${stamp}.txt`), added.map((r) => `${code}-${r[0]}`).join("\n") + "\n");
console.log(`[${code}] ${added.length}行を足しました`);
