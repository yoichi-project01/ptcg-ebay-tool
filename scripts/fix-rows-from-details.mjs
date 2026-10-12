#!/usr/bin/env node
/**
 * 公式 details.php で全件確かめた結果（scripts/scan-progress/{弾}.json、patch-from-scan.mjs --full-fetch で取得）で、
 * cardData の行の名前・レアリティと画像を直す（2026-10-12、SVB の並び・SVD-139・SVF-038）。
 * rebuild（patch-from-scan.mjs --rebuild）と違い、行を作り直さずに食い違う行だけを直す（英語名など、ほかの列を残すため）。
 *
 *   node scripts/fix-rows-from-details.mjs --set SVB [--check-images] [--apply]
 *
 * - 番号ごとに公式の名前と比べ、違う行は名前・レアリティを公式の値にし、画像を公式から取り直す。
 *   名前が変わった行の英語名は空にする（別のカードの英語名が残らないように。英語名は別に確かめて入れる）。
 * - --check-images: 名前が同じ行も、画像を公式の画像とバイト単位で比べ、違えば取り直す。
 * - 公式に番号が無い行・cardData に無い番号は止まる（人が確かめる）。
 * - 画像の対応表・SHA-256 の一覧は、最後に build-image-index.mjs --only <弾> で更新する。
 * 結果は scripts/scan-patch-report/{弾}-fix-rows.json（変更前→変更後）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal, writeFileAtomic } from "./filename-utils.mjs";
import { parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";
import { imageExt, politeDelay, politeFetch } from "./scrape-promo-sets.mjs";
import { normalizeName } from "./patch-from-scan.mjs";
import { rebuildCardKinds } from "./card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");
const CHECK_IMAGES = args.includes("--check-images");

const data = JSON.parse(await fs.readFile(DATA, "utf8"));
const index = JSON.parse(await fs.readFile(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
if (!set) throw new Error(`弾がありません: ${SET}`);
const PROGRESS = path.join(__dirname, "scan-progress", `${SET}.json`);
const progress = JSON.parse(await fs.readFile(PROGRESS, "utf8").catch(() => "{}"));
// --cardIds 43841,…: その cardID だけ details.php で確かめ、その番号の行だけ直す（全件を取得しない）
const ONLY_IDS = args.includes("--cardIds") ? args[args.indexOf("--cardIds") + 1].split(",") : null;
if (ONLY_IDS) {
  for (const cid of ONLY_IDS) {
    if (progress[cid]) continue;
    const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${cid}`);
    await politeDelay();
    if (!html) throw new Error(`details.php の取得に失敗: ${cid}`);
    const cards = parseCardDetailsFromHtml(html);
    progress[cid] = { badge: html.match(/class="img-regulation"\s+alt="([^"]*)"/)?.[1] ?? null, cards, cardThumbFile: cards[0]?.cardThumbFile };
    await writeFileAtomic(PROGRESS, JSON.stringify(progress, null, 1));
  }
}
const badges = new Set([set.c, set.codeAlias].filter(Boolean));
const official = new Map();
for (const [cid, d] of Object.entries(progress)) {
  if (!badges.has(d.badge)) continue;
  if (ONLY_IDS && !ONLY_IDS.includes(cid)) continue;
  for (const c of d.cards) {
    const n = parseInt(c.local, 10);
    if (official.has(n) && normalizeName(official.get(n).jaName) !== normalizeName(c.jaName))
      throw new Error(`番号 ${n} に別名のカードが複数: ${official.get(n).jaName} / ${c.jaName}`);
    if (!official.has(n)) official.set(n, { ...c, cardId: cid, cardThumbFile: d.cardThumbFile });
  }
}
const nums = set.k.map((r) => parseInt(r[0], 10));
const missing = ONLY_IDS ? [] : nums.filter((n) => !official.has(n));
const extra = [...official.keys()].filter((n) => !nums.includes(n));
if (missing.length || extra.length) throw new Error(`公式と番号が合わない: cardData のみ ${missing} / 公式のみ ${extra}`);

const changes = [];
const dir = path.join(ROOT, "public", "cards", set.sr, set.c);
const total = computeSetTotal(set.k);
for (const row of set.k) {
  const n = parseInt(row[0], 10);
  const o = official.get(n);
  if (!o) continue; // --cardIds で対象にしていない番号
  // parseCardDetailsFromHtml は RARITY_CODE_MAP で変換済み（未知のコードは null）
  if (o.rarity === null) throw new Error(`未知のレアリティ: ${SET}-${row[0]}`);
  const rarity = o.rarity || "";
  const nameDiff = normalizeName(row[1]).replace(/[（(][^）)]*[）)]$/, "") !== normalizeName(o.jaName).replace(/[（(][^）)]*[）)]$/, "");
  const rarDiff = (row[3] || "") !== rarity;
  let imgDiff = nameDiff;
  let buf = null;
  if (nameDiff || CHECK_IMAGES) {
    buf = await politeFetch("https://www.pokemon-card.com" + o.cardThumbFile, true);
    await politeDelay();
    if (!buf || buf.length < 1000) throw new Error(`画像の取得に失敗: ${SET}-${row[0]}`);
    const rel = index[`${SET}/${n}`];
    let old = null;
    if (rel) try { old = await fs.readFile(path.join(ROOT, "public", rel)); } catch {}
    imgDiff = !old || !old.equals(buf);
  }
  if (!nameDiff && !rarDiff && !imgDiff) continue;
  const before = [...row];
  const after = [row[0], nameDiff ? o.jaName : row[1], nameDiff ? "" : row[2], rarDiff ? rarity : row[3]];
  changes.push({ id: `${SET}-${row[0]}`, before, after, nameChanged: nameDiff, rarityChanged: rarDiff, imageReplaced: imgDiff, cardId: o.cardId, image: o.cardThumbFile });
  if (APPLY) {
    if (imgDiff || nameDiff || rarDiff) {
      const rel = index[`${SET}/${n}`];
      const name = buildFileName(after[1], SET, after[0], after[3], total) + imageExt(buf ?? await fs.readFile(path.join(ROOT, "public", rel)));
      const data2 = buf ?? await fs.readFile(path.join(ROOT, "public", rel));
      if (rel && path.basename(rel) !== name) await fs.unlink(path.join(ROOT, "public", rel)).catch(() => {});
      await writeFileAtomic(path.join(dir, name), data2);
    }
    row.splice(0, 4, ...after);
  }
}
console.log(JSON.stringify(changes.map((c) => ({ id: c.id, before: c.before.slice(1).join("/"), after: c.after.slice(1).join("/"), image: c.imageReplaced })), null, 1));
if (APPLY && changes.length) {
  await fs.writeFile(DATA, JSON.stringify(data, null, 2) + "\n");
  await fs.mkdir(path.join(__dirname, "scan-patch-report"), { recursive: true });
  await fs.writeFile(path.join(__dirname, "scan-patch-report", `${SET}-fix-rows.json`), JSON.stringify({ code: SET, date: "2026-10-12", changes }, null, 1) + "\n");
  execFileSync(process.execPath, [path.join(__dirname, "build-image-index.mjs"), "--only", SET], { stdio: "inherit" });
  rebuildCardKinds();
}
