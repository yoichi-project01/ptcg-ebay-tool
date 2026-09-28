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
import { extractCardId, validateAndBuildK } from "./scrape-missing-sets.mjs";

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
// numberlessIds: 基本エネルギー以外で details.php に番号が無いと確認済みのカード。
//       「弾コード-型番」の識別子を付けられないため今回は除外する（未着手リストに記録。
//       details.php の cardID を使った識別子を付ける案は CLAUDE.md 参照）。
//       ここに無い番号なしカードが出た場合は従来どおり停止する
const TARGET_SETS = [
  {
    code: "SM-P", label: "SM-P", badge: "SMP", sr: "SM", sourceCacheKeys: ["SMP", "SMSMP"],
    // 勝利の勲章×24・ふしぎなアメ×3・チャンピオンズフェスティバル×3・殿堂の書・ハイパーボール・ハウ・マーマネ
    numberlessIds: [33300, 33301, 33302, 33404, 33405, 33467, 33855, 33856, 33857, 33975, 33976, 33977, 33978, 33979, 33980, 33981, 33982, 33983, 34205, 34209, 34210, 34211, 34382, 34535, 34536, 34537, 34846, 34847, 34848, 34853, 34854, 34855, 35389, 37179],
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

async function processSet(target, cache, cardData) {
  const { code } = target;
  if (cardData.some((s) => s.c === code)) {
    console.log(`[${code}] 既に cardData.json に存在するためスキップ`);
    return null;
  }
  const officialCards = target.sourceCacheKeys.flatMap((k) => cache.setMap[k] || []);
  const cardIds = [...new Set(officialCards.map((c) => extractCardId(c.cardThumbFile)).filter(Boolean))];
  const progress = await loadProgress(code);
  const pending = cardIds.filter((id) => !progress[id]);
  console.log(`[${code}] ${cardIds.length}枚（取得済み ${cardIds.length - pending.length}、残り ${pending.length}）`);

  // --- 1. details.php で1枚ずつ検証（同時接続1本） ---
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

  // --- 2. 検証 ---
  const entries = cardIds.map((id) => ({ cardId: id, ...progress[id] }));
  const missingProgress = entries.filter((e) => !e.jaName);
  if (missingProgress.length) throw new Error(`[${code}] 未取得のカードが残っています: ${missingProgress.map((e) => e.cardId).join(", ")}`);

  const excluded = entries.filter((e) => e.number === null && isBasicEnergy(e.jaName));
  const allowedNumberless = new Set((target.numberlessIds || []).map(String));
  const numberlessSkipped = entries.filter((e) => e.number === null && allowedNumberless.has(e.cardId));
  const noNumber = entries.filter((e) => e.number === null && !isBasicEnergy(e.jaName) && !allowedNumberless.has(e.cardId));
  if (noNumber.length) {
    throw new Error(`[${code}] 基本エネルギー以外で番号の無いカードがあります: ${noNumber.map((e) => `${e.cardId}:${e.jaName}`).join(", ")}`);
  }
  const numbered = entries.filter((e) => e.number !== null);
  const badLabel = numbered.filter((e) => e.label !== target.label || e.badge !== target.badge);
  if (badLabel.length) {
    throw new Error(`[${code}] 表記が想定（${target.badge} / ${target.label}）と異なるカードがあります: ${badLabel.map((e) => `${e.cardId}:${e.badge}/${e.label}`).join(", ")}`);
  }
  const withRarity = numbered.filter((e) => e.rarityCode);
  if (withRarity.length) {
    throw new Error(`[${code}] プロモにレアリティアイコンがあるカードがあります（要確認）: ${withRarity.map((e) => `${e.cardId}:${e.rarityCode}`).join(", ")}`);
  }
  // 重複（同名は同一カードの二重掲載として後勝ち、別名は例外）・欠番（1〜最大番号）を検証
  const details = numbered.map((e) => ({ local: e.number, total: "0", rarity: "", jaName: e.jaName, cardThumbFile: e.cardThumbFile, cardId: e.cardId }));
  const { k, byLocal } = validateAndBuildK(details, code);
  const dupSameName = details.length - byLocal.size;

  const newSet = { c: code, ja: "", en: "", sr: target.sr, of: 0, k };

  // --- 3. 画像（同時接続1本、取得済みはスキップ） ---
  const setTotal = computeSetTotal(k);
  let imgDownloaded = 0, imgSkipped = 0;
  const imgFailed = [];
  for (const [n, d] of [...byLocal.entries()].sort((a, b) => a[0] - b[0])) {
    const localId = String(n).padStart(3, "0");
    const dest = path.join(OUT_DIR, target.sr, code, buildFileName(d.jaName, code, localId, "", setTotal) + ".jpg");
    if (await isUsableImage(dest)) { imgSkipped++; continue; }
    const buf = d.cardThumbFile ? await politeFetch(API_BASE + d.cardThumbFile, true) : null;
    if (buf && buf.length > 1000) { await writeFileAtomic(dest, buf); imgDownloaded++; }
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

async function main() {
  const args = process.argv.slice(2);
  const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
  const targets = onlySet ? TARGET_SETS.filter((t) => t.code === onlySet) : TARGET_SETS;
  if (targets.length === 0) throw new Error(`TARGET_SETS に ${onlySet} がありません`);

  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
  for (const target of targets) {
    // 1弾ごとに読み直す（前の弾の書き込み結果を確実に反映するため）
    const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
    await processSet(target, cache, cardData);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
