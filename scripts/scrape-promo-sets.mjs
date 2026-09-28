#!/usr/bin/env node
/**
 * 番号付きプロモ（SM-P / XY-P / BW-P / DP-P / DPt-P / L-P 等）のカードデータ・画像取得
 *
 * 背景: フェーズ6-2では「プロモは無番号」と判定していたが、これは誤りだった。
 * details.php にはプロモでも "001 / SM-P" の形で番号が表示されており、既存の
 * parseCardDetailsFromHtml（scrape-missing-sets.mjs）が "NNN / NNN"（数字/数字）しか
 * 想定していなかったため拾えていなかった（2026-09-28判明）。
 *
 * 方式は scrape-missing-sets.mjs と同じ（official-card-cache.json で cardID 一覧 →
 * details.php で1枚ずつ番号・日本語名を検証）。検証ロジック validateAndBuildK は
 * そのまま再利用する。旧 scrape-promo-images.mjs の「並び順での位置マッチング」は
 * 番号を検証しないため使わない（SV-Pで11件の名前ずれが見つかっている）。
 *
 * アクセス方針（2026-08-29 に HTTP 403 ブロックを受けた反省から）:
 *   - 同時接続1本、1リクエストごとに 2〜3 秒待つ
 *   - 403 / 通信エラー時は待機時間を広げて再試行し、連続して失敗したら停止する
 *   - details.php の結果は1件ごとに進捗ファイルへ保存し、再実行時は取得済みを飛ばす
 *
 * 使い方:
 *   node scripts/scrape-promo-sets.mjs --set SM-P
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";
import { extractCardId, RARITY_CODE_MAP, validateAndBuildK } from "./scrape-missing-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");
const PROGRESS_DIR = path.join(__dirname, "promo-progress");

const API_BASE = "https://www.pokemon-card.com";
const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 3000;
const FETCH_TIMEOUT_MS = 20000;
// 1リクエストあたりの再試行時の待機（403/通信エラー時）。段階的に広げる
const BACKOFF_MS = [30000, 90000, 300000];
// 再試行を使い切って失敗したカードが連続でこの件数に達したら停止する
const MAX_CONSECUTIVE_FAILURES = 3;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

// code: cardData.json 上の弾コード（別プロジェクトの識別子「弾コード-型番」に合わせ、
//       既存の S-P / SV-P と同じハイフン付き表記にする）
// label: details.php に表示される番号の分母側の文字列（"001 / SM-P" の "SM-P"）
// badge: img-regulation の alt 属性
// sourceCacheKeys: official-card-cache.json 上のキー。SMSMP（1枚）は details.php で
//       badge=SMP・"325 / SM-P" と確認済みで、SM-P の一部として扱う
// 番号なしのカード（大会賞品・基本エネルギー等）は「弾コード-型番」の識別子を付けられない
// ため自動で除外し、実行結果（excludedNumberless）に一覧を出す（未着手リストに記録。
// details.php の cardID を使った識別子を付ける案は CLAUDE.md 参照）。
// extraCardIds: official-card-cache.json のスキャンから漏れていたカード。欠番の前後の
//       cardID 範囲でキャッシュに無い ID を details.php で1件ずつ確認して見つけたもの
// allowedGaps: 同じ確認で、公式サイトにカードページ自体が無いと分かった番号
//       （該当 cardID は「カード検索」トップに戻される）。これ以外の欠番は停止する
const TARGET_SETS = [
  { code: "SM-P", label: "SM-P", badge: "SMP", sr: "SM", sourceCacheKeys: ["SMP", "SMSMP"] },
  // XY-P キー（14枚）はバッジが "XYP" で、XYP キーと同じ弾の一部（2026-08-30 のサンプルで確認）
  {
    code: "XY-P", label: "XY-P", badge: "XYP", sr: "XY", sourceCacheKeys: ["XYP", "XY-P"],
    // 050 日本代表のピカチュウ、181/216/225/238 の BREAK カード
    extraCardIds: [30478, 31583, 31650, 32136, 32124],
    allowedGaps: [127, 128, 129, 189, 217, 267],
  },
  { code: "BW-P", label: "BW-P", badge: "BWP", sr: "BW", sourceCacheKeys: ["BWP"], allowedGaps: [25, 26, 27, 28, 29, 30, 31] },
  { code: "DP-P", label: "DP-P", badge: "DPP", sr: "DP", sourceCacheKeys: ["DPP"] },
  { code: "DPt-P", label: "DPt-P", badge: "DPtP", sr: "DPt", sourceCacheKeys: ["DPtP"] },
  { code: "L-P", label: "L-P", badge: "LP", sr: "L", sourceCacheKeys: ["LP"] },
];

// 既存の S-P / SV-P（旧 scrape-promo-images.mjs の位置マッチングで作られた）を
// details.php の結果で1件ずつ突き合わせて作り直す対象
// 公式サイトで検証できない旧データ（欠番位置・数字でない型番）は削除する（2026-09-28 ユーザー判断）。
// allowRarity: details.php にレアリティアイコンがあるプロモ（S-P 341〜349・SV-P 183 の再録系）は
//       RARITY_CODE_MAP で変換して登録する（2026-09-28 ユーザー判断）
const REBUILD_SETS = [
  {
    code: "S-P", label: "S-P", badge: "S-P", sr: "S", sourceCacheKeys: ["S-P"], allowRarity: true,
    allowedGaps: [60, 61, 62, 63, 64, 65, 66, 67, 134, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 222, 233, 303, 329, 330, 331, 332, 333, 334, 335, 336],
  },
  {
    code: "SV-P", label: "SV-P", badge: "SV-P", sr: "SV", sourceCacheKeys: ["SV-P"], allowRarity: true,
    allowedGaps: [37, 38, 39, 40, 41, 42, 43, 44, 221, 223, 224, 225, 226, 227, 228, 229, 230, 231],
  },
];

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const politeDelay = () => sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// details.php の HTML からプロモの番号・日本語名・画像パス・バッジを抽出する純粋関数。
// 戻り値の number は番号が無い場合（基本エネルギーの汎用インサート等）に null
export function parsePromoDetailFromHtml(html) {
  const titleM = html.match(/<title>([^<]*)<\/title>/);
  const rawName = titleM ? titleM[1].replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ\s*$/, "").trim() : "";
  if (!rawName) return null;
  const badgeM = html.match(/class="img-regulation"\s+alt="([^"]*)"/);
  const numM = html.match(/img-regulation"[^>]*\/>\s*&nbsp;(\d+)&nbsp;\/&nbsp;([A-Za-z]+-P)\s*&nbsp;/);
  const rarM = html.match(/ic_rare_([a-z0-9_]+)\.gif/);
  const imgM = html.match(/<img class="fit" src="([^"]+)"/);
  return {
    jaName: decodeHtmlEntities(rawName),
    badge: badgeM ? badgeM[1] : null,
    number: numM ? numM[1] : null,
    label: numM ? numM[2] : null,
    rarityCode: rarM ? rarM[1] : null,
    cardThumbFile: imgM ? imgM[1] : null,
  };
}

// 403 / 5xx / 通信エラー時は BACKOFF_MS に従って待ってから再試行する。
// 404 は再試行しても変わらないので即失敗
async function politeFetch(url, asBuffer = false) {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    let reason;
    try {
      const r = await fetch(url, {
        headers: { ...HEADERS, Referer: API_BASE + "/" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (r.ok) return asBuffer ? Buffer.from(await r.arrayBuffer()) : await r.text();
      if (r.status === 404) return null;
      reason = `HTTP ${r.status}`;
    } catch (e) {
      reason = e.name === "TimeoutError" ? "timeout" : e.message;
    }
    if (attempt < BACKOFF_MS.length) {
      console.warn(`  ! ${reason}: ${url} → ${BACKOFF_MS[attempt] / 1000}秒待って再試行`);
      await sleep(BACKOFF_MS[attempt]);
    } else {
      console.warn(`  ! ${reason}: ${url} → 再試行を使い切りました`);
    }
  }
  return null;
}

async function loadProgress(code) {
  try {
    return JSON.parse(await fs.readFile(path.join(PROGRESS_DIR, `${code}.json`), "utf-8"));
  } catch {
    return {};
  }
}

async function saveProgress(code, progress) {
  await writeFileAtomic(path.join(PROGRESS_DIR, `${code}.json`), JSON.stringify(progress, null, 1));
}

// 基本エネルギーだけは番号なしを正常として除外する。それ以外の番号なしは異常扱い
const isBasicEnergy = (name) => /^基本.+エネルギー$/.test(name);

// 公式サイトは旧世代プロモ（DP-P/DPt-P/L-P 等）を GIF で配信しているため、
// 保存時の拡張子は URL ではなく中身から決める（中身を変換せず元データのまま保存する）
export const imageExt = (buf) => (buf.subarray(0, 3).toString("latin1") === "GIF" ? ".gif" : ".jpg");

// details.php の結果を進捗ファイルに集めるだけで、検証・書き込みはしない（--details-only）
async function fetchDetails(code, cardIds) {
  const progress = await loadProgress(code);
  const pending = cardIds.filter((id) => !progress[id]);
  console.log(`[${code}] ${cardIds.length}枚（取得済み ${cardIds.length - pending.length}、残り ${pending.length}）`);
  let consecutiveFailures = 0;
  for (const [i, cardId] of pending.entries()) {
    const html = await politeFetch(`${API_BASE}/card-search/details.php/card/${cardId}`);
    const parsed = html ? parsePromoDetailFromHtml(html) : null;
    if (!parsed) {
      consecutiveFailures++;
      console.warn(`  ! cardId ${cardId} の取得に失敗（連続 ${consecutiveFailures}）`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(`[${code}] 連続 ${consecutiveFailures} 件失敗したため停止します。取得済み分は保存済みで、再実行すると続きから再開します`);
      }
    } else {
      consecutiveFailures = 0;
      progress[cardId] = parsed;
      await saveProgress(code, progress);
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${pending.length}`);
    await politeDelay();
  }
  return progress;
}

export function cacheCardIds(target, cache) {
  const officialCards = target.sourceCacheKeys.flatMap((k) => cache.setMap[k] || []);
  const ids = officialCards.map((c) => extractCardId(c.cardThumbFile)).filter(Boolean);
  return [...new Set([...ids, ...(target.extraCardIds || []).map(String)])];
}

async function processSet(target, cache, cardData) {
  const { code } = target;
  if (cardData.some((s) => s.c === code)) {
    console.log(`[${code}] 既に cardData.json に存在するためスキップ`);
    return null;
  }
  // --- 1. details.php で1枚ずつ検証（同時接続1本） ---
  const cardIds = cacheCardIds(target, cache);
  const progress = await fetchDetails(code, cardIds);

  // --- 2. 検証 ---
  const { k, byLocal, excluded, numberlessSkipped, dupSameName } = validatePromo(target, cardIds, progress);
  const newSet = { c: code, ja: "", en: "", sr: target.sr, of: 0, k };

  // --- 3. 画像（同時接続1本、取得済みはスキップ） ---
  const setTotal = computeSetTotal(k);
  let imgDownloaded = 0, imgSkipped = 0;
  const imgFailed = [];
  for (const [n, d] of [...byLocal.entries()].sort((a, b) => a[0] - b[0])) {
    const localId = String(n).padStart(3, "0");
    const destBase = path.join(OUT_DIR, target.sr, code, buildFileName(d.jaName, code, localId, "", setTotal));
    if (await isUsableImage(destBase + ".jpg") || await isUsableImage(destBase + ".gif")) { imgSkipped++; continue; }
    const buf = d.cardThumbFile ? await politeFetch(API_BASE + d.cardThumbFile, true) : null;
    if (buf && buf.length > 1000) { await writeFileAtomic(destBase + imageExt(buf), buf); imgDownloaded++; }
    else imgFailed.push(localId);
    await politeDelay();
    if (imgFailed.length >= MAX_CONSECUTIVE_FAILURES && imgDownloaded === 0) {
      throw new Error(`[${code}] 画像取得が続けて失敗したため停止します（cardData.json は未更新）`);
    }
  }
  if (imgFailed.length) {
    throw new Error(`[${code}] 画像の取得に失敗した番号があります（cardData.json は未更新。再実行で続きから）: ${imgFailed.join(", ")}`);
  }

  cardData.push(newSet);
  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
  const summary = {
    code, cacheCards: cardIds.length, cards: k.length, maxNumber: setTotal,
    excludedBasicEnergy: excluded.length, excludedNumberless: numberlessSkipped.length, dupSameName, imgDownloaded, imgSkipped,
  };
  console.log(`[${code}] 完了`, summary);
  return summary;
}

// details.php の結果（進捗ファイル）を検証し、cardData.json の k 配列を組み立てる。
// 想定外（未取得・バッジ/表記違い・レアリティあり・別名の番号重複・未確認の欠番）が
// あれば例外を投げる。番号なしのカードは除外し、一覧を返す
function validatePromo(target, cardIds, progress) {
  const { code } = target;
  const entries = cardIds.map((id) => ({ cardId: id, ...progress[id] }));
  const missingProgress = entries.filter((e) => !e.jaName);
  if (missingProgress.length) throw new Error(`[${code}] 未取得のカードが残っています: ${missingProgress.map((e) => e.cardId).join(", ")}`);

  const excluded = entries.filter((e) => e.number === null && isBasicEnergy(e.jaName));
  const numberlessSkipped = entries.filter((e) => e.number === null && !isBasicEnergy(e.jaName));
  const numbered = entries.filter((e) => e.number !== null);
  const badLabel = numbered.filter((e) => e.label !== target.label || e.badge !== target.badge);
  if (badLabel.length) {
    throw new Error(`[${code}] 表記が想定（${target.badge} / ${target.label}）と異なるカードがあります: ${badLabel.map((e) => `${e.cardId}:${e.badge}/${e.label}`).join(", ")}`);
  }
  const withRarity = numbered.filter((e) => e.rarityCode);
  if (withRarity.length && !target.allowRarity) {
    throw new Error(`[${code}] プロモにレアリティアイコンがあるカードがあります（要確認）: ${withRarity.map((e) => `${e.cardId}:${e.rarityCode}`).join(", ")}`);
  }
  // 重複（同名は同一カードの二重掲載として後勝ち、別名は例外）・欠番（1〜最大番号）を検証
  // 未知のレアリティコードは null になり、validateAndBuildK が例外を投げる
  const rarityOf = (e) => (e.rarityCode ? (RARITY_CODE_MAP[e.rarityCode] ?? null) : "");
  const details = numbered.map((e) => ({ local: e.number, total: "0", rarity: rarityOf(e), jaName: e.jaName, cardThumbFile: e.cardThumbFile, cardId: e.cardId }));
  const { k, byLocal } = validateAndBuildK(details, code, { allowedGaps: target.allowedGaps });
  return { k, byLocal, excluded, numberlessSkipped, dupSameName: details.length - byLocal.size };
}

const REPORT_DIR = path.join(__dirname, "promo-rebuild-report");
const STAGING_DIR = path.join(PROGRESS_DIR, "staging");
const cardIdOf = (code, localId) => `${code}-${localId}`;

// 既存セット（S-P / SV-P）を details.php の結果で作り直す。
// 1. 新しい k を検証して組み立てる
// 2. 新しい画像をステージング領域に取得（再開可能）
// 3. 旧データと型番ごとに突き合わせ、名前・画像（ファイル内容）の変化を一覧にする
// 4. k を置き換え、画像ディレクトリを新しいファイル群に入れ替える（孤児画像は削除）
async function rebuildSet(target, cache, cardData, imageIndex) {
  const { code } = target;
  const set = cardData.find((s) => s.c === code);
  if (!set) throw new Error(`[${code}] cardData.json にセットがありません`);

  const cardIds = cacheCardIds(target, cache);
  const progress = await fetchDetails(code, cardIds);
  const { k, byLocal, excluded, numberlessSkipped, dupSameName } = validatePromo(target, cardIds, progress);

  // 新画像をステージング（取得済みはスキップ）
  const stageDir = path.join(STAGING_DIR, code);
  let staged = 0;
  const imgFailed = [];
  for (const [n, d] of [...byLocal.entries()].sort((a, b) => a[0] - b[0])) {
    const localId = String(n).padStart(3, "0");
    const stagePath = path.join(stageDir, `${localId}.jpg`);
    if (await isUsableImage(stagePath)) continue;
    const buf = d.cardThumbFile ? await politeFetch(API_BASE + d.cardThumbFile, true) : null;
    if (buf && buf.length > 1000) { await writeFileAtomic(stagePath, buf); staged++; }
    else imgFailed.push(localId);
    await politeDelay();
  }
  if (imgFailed.length) {
    throw new Error(`[${code}] 画像の取得に失敗した番号があります（cardData.json は未更新。再実行で続きから）: ${imgFailed.join(", ")}`);
  }

  // 旧データとの突き合わせ（型番は数値化して比較。"064" と "64" を同一視）
  const keyOf = (localId) => (/^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId);
  const oldByKey = new Map(set.k.map((row) => [keyOf(row[0]), row]));
  const newByKey = new Map(k.map((row) => [keyOf(row[0]), row]));
  const readOldImage = async (row) => {
    const rel = imageIndex[`${code}/${keyOf(row[0])}`] || imageIndex[`${code}/${row[0]}`];
    if (!rel) return null;
    try { return await fs.readFile(path.join(ROOT, "public", rel)); } catch { return null; }
  };
  // 画像入れ替えの途中で止まった後の再実行では旧画像が既に消えているため、
  // 最初に作った一覧をそのまま使う（上書きしない）
  const reportPath = path.join(REPORT_DIR, `${code}.json`);
  let report = null;
  try { report = JSON.parse(await fs.readFile(reportPath, "utf-8")); } catch {}
  if (!report) report = await diffAgainstOld();
  async function diffAgainstOld() {
  const report = { code, nameChanged: [], imageReplaced: [], added: [], removed: [] };
  for (const [key, row] of newByKey) {
    const id = cardIdOf(code, row[0]);
    const old = oldByKey.get(key);
    if (!old) { report.added.push({ id, ja: row[1] }); continue; }
    if (old[1] !== row[1]) report.nameChanged.push({ id, oldJa: old[1], newJa: row[1] });
    const oldBuf = await readOldImage(old);
    const newBuf = await fs.readFile(path.join(stageDir, `${row[0]}.jpg`));
    if (!oldBuf || !oldBuf.equals(newBuf)) report.imageReplaced.push({ id, ja: row[1], hadImage: !!oldBuf });
  }
  for (const [key, row] of oldByKey) {
    if (!newByKey.has(key)) report.removed.push({ id: cardIdOf(code, row[0]), ja: row[1] });
  }
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
  const changedIds = [...new Set([...report.nameChanged, ...report.imageReplaced].map((r) => r.id))];
  const writeIds = (suffix, ids) => fs.writeFile(path.join(REPORT_DIR, `${code}-${suffix}.txt`), ids.join("\n") + (ids.length ? "\n" : ""), "utf-8");
  await writeIds("changed-card-ids", changedIds);
  await writeIds("added-card-ids", report.added.map((r) => r.id));
  await writeIds("removed-card-ids", report.removed.map((r) => r.id));
  return report;
  }

  // 画像ディレクトリを入れ替える: 新ファイルを書き、新ファイル名一覧に無い旧ファイルを削除
  const setTotal = computeSetTotal(k);
  const setDir = path.join(OUT_DIR, target.sr, code);
  const keep = new Set();
  for (const row of k) {
    const buf = await fs.readFile(path.join(stageDir, `${row[0]}.jpg`));
    const name = buildFileName(row[1], code, row[0], row[3], setTotal) + imageExt(buf);
    keep.add(name);
    await writeFileAtomic(path.join(setDir, name), buf);
  }
  let orphansRemoved = 0;
  for (const f of await fs.readdir(setDir)) {
    if (!keep.has(f)) { await fs.unlink(path.join(setDir, f)); orphansRemoved++; }
  }

  set.k = k;
  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");

  const summary = {
    code, cacheCards: cardIds.length, oldCards: oldByKey.size, cards: k.length, maxNumber: setTotal,
    excludedBasicEnergy: excluded.length, excludedNumberless: numberlessSkipped.length, dupSameName,
    nameChanged: report.nameChanged.length, imageReplaced: report.imageReplaced.length,
    added: report.added.length, removed: report.removed.length, staged, orphansRemoved,
  };
  console.log(`[${code}] 作り直し完了`, summary);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
  const targets = onlySet ? TARGET_SETS.filter((t) => t.code === onlySet) : TARGET_SETS;

  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
  if (args.includes("--details-only")) {
    // 検証・書き込みの前に、全対象の details.php の結果を先に集める
    const all = onlySet ? [...TARGET_SETS, ...REBUILD_SETS].filter((t) => t.code === onlySet) : [...TARGET_SETS, ...REBUILD_SETS];
    for (const target of all) await fetchDetails(target.code, cacheCardIds(target, cache));
    return;
  }
  if (args.includes("--rebuild")) {
    const rebuildTargets = onlySet ? REBUILD_SETS.filter((t) => t.code === onlySet) : REBUILD_SETS;
    if (rebuildTargets.length === 0) throw new Error(`REBUILD_SETS に ${onlySet} がありません`);
    for (const target of rebuildTargets) {
      const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
      const imageIndex = JSON.parse(await fs.readFile(path.join(ROOT, "src", "imageIndex.json"), "utf-8"));
      await rebuildSet(target, cache, cardData, imageIndex);
    }
    return;
  }
  if (targets.length === 0) throw new Error(`TARGET_SETS に ${onlySet} がありません`);
  for (const target of targets) {
    // 1弾ごとに読み直す（前の弾の書き込み結果を確実に反映するため）
    const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
    await processSet(target, cache, cardData);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
