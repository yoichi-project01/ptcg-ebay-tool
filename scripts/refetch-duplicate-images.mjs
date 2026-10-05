#!/usr/bin/env node
/**
 * 同じ弾の別の番号と中身が同じになっている画像（scripts/image-dup-report/duplicate-images.tsv、
 * find-duplicate-images.mjs で作成）を、公式 details.php で番号を確かめてから取り直す（2026-10-05）。
 *
 * 旧 scrape-official-images.mjs はカード名で画像を探していたため、同じ名前の別番号（RR と SR・SAR・BWR など）に
 * 同じ絵柄を保存していた。ここでは名前での照合は使わず、details.php に表示される番号とその番号の画像パスだけを使う。
 *
 * 手順（1弾ずつ）:
 *   1. 一覧の弾ごとに、対象カードと同じ名前の公式カード（official-card-scan.json）の cardID を候補にする
 *   2. 候補の details.php を取得（同時接続1本・2〜3秒間隔、403・通信エラーは待って再試行、連続3件失敗で停止）。
 *      結果は scripts/scan-progress/{弾}.json に1件ずつ保存し、再実行時は取得済みを飛ばす（patch-from-scan.mjs と共通）
 *   3. 対象カードの番号の公式画像を scripts/scan-progress/staging/refetch/{弾}/ に取得（取得済みは飛ばす）
 *   4. 全件そろったら public/cards の画像を置き換える（ファイル名はそのまま。形式が変わる場合だけ拡張子を変える）
 *
 * 対象外: 旧裏面（PMCG。公式サイトに無く、画像は pcg-search.com 由来）・cardData に無い行（数字でない型番）・
 *         公式で番号が見つからないカード（店舗の情報で補完したシークレット等。一覧には画像の無いカードは出ない）
 *
 * 使い方:
 *   node scripts/refetch-duplicate-images.mjs --plan            # 通信せずに弾ごとの候補数を出す
 *   node scripts/refetch-duplicate-images.mjs --set SV11W       # 1弾を取り直す（再開可能）
 * 結果: scripts/image-dup-report/refetch/{弾}.json・{弾}-refetched-card-ids.txt
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isUsableImage, writeFileAtomic } from "./filename-utils.mjs";
import { extractCardId, parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";
import { imageExt, politeDelay, politeFetch } from "./scrape-promo-sets.mjs";
import { normalizeName } from "./patch-from-scan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_BASE = "https://www.pokemon-card.com";
const TSV = path.join(__dirname, "image-dup-report", "duplicate-images.tsv");
const OUT_DIR = path.join(__dirname, "image-dup-report", "refetch");
const PROGRESS_DIR = path.join(__dirname, "scan-progress");
const STAGE_DIR = path.join(PROGRESS_DIR, "staging", "refetch");
const EXTRA_SCAN_KEYS = { "XY6-B": ["XY6"], "XY7-B": ["XY7"], SMB: ["SM-XY"], MP1: ["M-P"] }; // patch-from-scan.mjs と同じ
const MAX_CONSECUTIVE_FAILURES = 3;

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const keyOf = (local) => (/^\d+$/.test(local) ? String(parseInt(local, 10)) : local);
const strip = (s) => normalizeName(s).replace(/[（(][^（()）]*[)）]$/, "").trim();
const sameCard = (a, b) => normalizeName(a) === normalizeName(b) || strip(a) === strip(b);
const loadJson = async (p, fb) => { try { return JSON.parse(await fs.readFile(p, "utf-8")); } catch { return fb; } };

/** 一覧（TSV）を弾ごとにまとめる。対象外（PMCG・cardData に無い行）は除く */
export function readTargets(tsv) {
  const bySet = new Map();
  const skipped = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [cardId, name, rarity, image, , , note] = line.split("\t");
    const i = cardId.lastIndexOf("-");
    const set = cardId.slice(0, i), local = cardId.slice(i + 1);
    if (/^PMCG/.test(set)) { skipped.push({ cardId, reason: "旧裏面（公式サイトに無い。画像は pcg-search.com 由来）" }); continue; }
    if (!/^\d+$/.test(local) || (note || "").startsWith("cardData に無い行")) { skipped.push({ cardId, reason: "cardData に無い行（数字でない型番）" }); continue; }
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set).push({ cardId, set, local, name, rarity, image });
  }
  return { bySet, skipped };
}

function candidatesFor(set, targets, scan) {
  const keys = [set, ...(EXTRA_SCAN_KEYS[set] || [])];
  const entries = keys.flatMap((k) => scan.setMap[k] || []);
  return entries.filter((e) => targets.some((t) => sameCard(e.jaName, t.name)));
}

async function fetchDetails(set, candidates) {
  const progressPath = path.join(PROGRESS_DIR, `${set}.json`);
  const progress = await loadJson(progressPath, {});
  let failures = 0, fetched = 0;
  for (const e of candidates) {
    const cardId = extractCardId(e.cardThumbFile);
    if (progress[cardId]) continue;
    const html = await politeFetch(`${API_BASE}/card-search/details.php/card/${cardId}`);
    if (!html) {
      if (++failures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`[${set}] details.php の取得が連続${MAX_CONSECUTIVE_FAILURES}件失敗したため停止します（再実行で続きから）`);
    } else {
      failures = 0; fetched++;
      const badgeM = html.match(/class="img-regulation"\s+alt="([^"]*)"/);
      progress[cardId] = { badge: badgeM ? badgeM[1] : null, cards: parseCardDetailsFromHtml(html), cardThumbFile: e.cardThumbFile };
      await writeFileAtomic(progressPath, JSON.stringify(progress, null, 1));
      if (fetched % 20 === 0) console.log(`  [${set}] details.php ${fetched}件取得`);
    }
    await politeDelay();
  }
  return progress;
}

async function refetchSet(set, targets, scan, cardData) {
  const setObj = cardData.find((s) => s.c === set);
  if (!setObj) throw new Error(`[${set}] cardData に弾がありません`);
  const badges = new Set([set, setObj.codeAlias].filter(Boolean));
  const candidates = candidatesFor(set, targets, scan);
  console.log(`[${set}] 対象 ${targets.length}枚・details.php の候補 ${candidates.length}件`);
  const progress = await fetchDetails(set, candidates);

  // 番号 → 公式のカード（この弾のバッジのものだけ）
  const official = new Map();
  for (const [cardId, d] of Object.entries(progress)) {
    if (!badges.has(d.badge)) continue;
    for (const c of d.cards || []) {
      const n = keyOf(c.local);
      const prev = official.get(n);
      const entry = { cardId, jaName: c.jaName, rarity: c.rarity, thumb: c.cardThumbFile || d.cardThumbFile };
      if (prev && !sameCard(prev.jaName, c.jaName)) throw new Error(`[${set}] 番号 ${n} に別名の公式カードが複数あります: ${prev.jaName} / ${c.jaName}`);
      if (!prev) official.set(n, entry);
    }
  }

  const result = { set, checkedAt: new Date().toISOString(), refetched: [], notFound: [], nameMismatch: [] };
  const stage = path.join(STAGE_DIR, set);
  await fs.mkdir(stage, { recursive: true });
  let imgFailures = 0;
  for (const t of targets) {
    const o = official.get(keyOf(t.local));
    if (!o) { result.notFound.push({ cardId: t.cardId, name: t.name, reason: "公式で番号が見つからない" }); continue; }
    if (!sameCard(o.jaName, t.name)) { result.nameMismatch.push({ cardId: t.cardId, cardData: t.name, official: o.jaName, officialCardId: o.cardId }); continue; }
    const p = path.join(stage, `${t.local}.img`);
    if (!(await isUsableImage(p))) {
      const buf = await politeFetch(API_BASE + o.thumb, true);
      if (!buf || buf.length <= 1000) {
        if (++imgFailures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`[${set}] 画像の取得が連続${MAX_CONSECUTIVE_FAILURES}件失敗したため停止します（再実行で続きから）`);
        await politeDelay();
        continue;
      }
      imgFailures = 0;
      await writeFileAtomic(p, buf);
      await politeDelay();
    }
    result.refetched.push({ ...t, officialCardId: o.cardId, officialRarity: o.rarity, thumb: o.thumb });
  }
  const missing = targets.length - result.refetched.length - result.notFound.length - result.nameMismatch.length;
  if (missing > 0) throw new Error(`[${set}] 画像を取得できなかったカードが ${missing}枚あります（再実行で続きから。public/cards は未変更）`);
  if (result.nameMismatch.length) throw new Error(`[${set}] cardData と公式で名前が違うカードがあります（public/cards は未変更）: ` +
    result.nameMismatch.map((m) => `${m.cardId} ${m.cardData}→${m.official}`).join(" / "));

  // 置き換え（ファイル名はそのまま。中身の形式が違えば拡張子だけ変える）
  for (const r of result.refetched) {
    const buf = await fs.readFile(path.join(stage, `${r.local}.img`));
    const oldPath = path.join(ROOT, "public", r.image);
    let old = null; try { old = await fs.readFile(oldPath); } catch {}
    const ext = imageExt(buf);
    const newPath = oldPath.replace(/\.(jpg|png|gif|webp)$/i, ext);
    r.changed = !old || !old.equals(buf);
    r.newImage = path.relative(path.join(ROOT, "public"), newPath).split(path.sep).join("/");
    if (r.changed || newPath !== oldPath) {
      await writeFileAtomic(newPath, buf);
      if (newPath !== oldPath) await fs.rm(oldPath, { force: true });
    }
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, `${set}.json`), JSON.stringify(result, null, 1) + "\n");
  await fs.writeFile(path.join(OUT_DIR, `${set}-refetched-card-ids.txt`), result.refetched.map((r) => r.cardId).join("\n") + (result.refetched.length ? "\n" : ""));
  const changed = result.refetched.filter((r) => r.changed).length;
  console.log(`[${set}] 取り直し ${result.refetched.length}枚（中身が変わった ${changed}枚・もともと正しかった ${result.refetched.length - changed}枚）・公式で番号が見つからない ${result.notFound.length}枚`);
  return result;
}

/**
 * 取り直した後の確認：この弾の画像索引の中で、別の番号とバイト一致する画像が残っていないか。
 * 意図した重複（LEGEND・V-UNION）と cardData に無い行は除く。公式サイトでも同じ画像（取り直した画像どうしが一致）は別に数える
 */
async function verifySet(set, cardData) {
  const crypto = await import("node:crypto");
  const ii = JSON.parse(await fs.readFile(path.join(ROOT, "src", "imageIndex.json"), "utf-8"));
  const setObj = cardData.find((s) => s.c === set);
  const rows = new Map(setObj.k.map((r) => [keyOf(r[0]), r]));
  const stage = path.join(STAGE_DIR, set);
  const groups = new Map();
  for (const [key, rel] of Object.entries(ii)) {
    const [s, n] = key.split("/");
    if (s !== set || !rows.has(n)) continue;
    if (/LEGEND$|V-UNION$/.test(rows.get(n)[1])) continue;
    const h = crypto.createHash("md5").update(await fs.readFile(path.join(ROOT, "public", rel))).digest("hex");
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(`${set}-${rows.get(n)[0]}`);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);
  // 取り直した画像（公式の画像）どうしが一致するもの＝公式サイトでも同じ画像
  const officialSame = [], remaining = [];
  for (const g of dups) {
    const bufs = await Promise.all(g.map((id) => fs.readFile(path.join(stage, `${id.slice(set.length + 1)}.img`)).catch(() => null)));
    if (bufs.every((b) => b) && bufs.every((b) => b.equals(bufs[0]))) officialSame.push(g); else remaining.push(g);
  }
  const p = path.join(OUT_DIR, `${set}.json`);
  const result = await loadJson(p, { set });
  result.verify = { checkedAt: new Date().toISOString(), remainingDuplicates: remaining, officialSameImage: officialSame };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(p, JSON.stringify(result, null, 1) + "\n");
  console.log(`[${set}] 確認：バイト一致の残り ${remaining.length}グループ${remaining.length ? "（" + remaining.map((g) => g.join("=")).join(" / ") + "）" : ""}・公式でも同じ画像 ${officialSame.length}グループ`);
  return remaining;
}

async function main() {
  const { bySet, skipped } = readTargets(await fs.readFile(TSV, "utf-8"));
  const scan = JSON.parse(await fs.readFile(path.join(__dirname, "official-card-scan.json"), "utf-8"));
  const cardData = JSON.parse(await fs.readFile(path.join(ROOT, "src", "cardData.json"), "utf-8"));
  if (process.argv.includes("--plan")) {
    let total = 0, cand = 0, cached = 0;
    for (const [set, targets] of bySet) {
      const progress = await loadJson(path.join(PROGRESS_DIR, `${set}.json`), {});
      const c = candidatesFor(set, targets, scan);
      const todo = c.filter((e) => !progress[extractCardId(e.cardThumbFile)]).length;
      console.log(`${set}\t対象 ${targets.length}\t候補 ${c.length}\t未取得 ${todo}`);
      total += targets.length; cand += c.length; cached += c.length - todo;
    }
    console.log(`合計：対象 ${total}枚・details.php の候補 ${cand}件（取得済み ${cached}件）・対象外 ${skipped.length}枚`);
    return;
  }
  const set = arg("--set");
  if (!set || !bySet.has(set)) throw new Error(`--set <弾> を指定してください（一覧にある弾: ${[...bySet.keys()].join(" ")}）`);
  if (process.argv.includes("--verify")) {
    const remaining = await verifySet(set, cardData);
    if (remaining.length) process.exit(2);
    return;
  }
  await refetchSet(set, bySet.get(set), scan, cardData);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
