#!/usr/bin/env node
/**
 * 最新の公式一覧（scripts/official-card-scan.json、rescan-official-list.mjs で生成）と
 * cardData.json を突き合わせ、欠けているカード（主にシークレットレア）と欠けている画像を補う。
 *
 * 手順:
 *   1. セットごとに「カード名ごとの枚数」を公式一覧と cardData で比べ、公式側が多いカード名の
 *      cardID と、cardData 側で画像が無いカードと同名の cardID を候補にする
 *      （全カードを取り直さず、details.php へのアクセスを必要最小限にするため）
 *   2. 候補だけ details.php で番号・名前・レアリティ・バッジを確かめる（同時接続1本・2〜3秒間隔、
 *      scripts/scan-progress/{セット}.json に1件ずつ保存し、再実行時は取得済みを飛ばす）
 *   3. 確かめた番号が cardData に無ければ行を追加、あって画像が無ければ画像を取得する。
 *      番号はあるが名前が食い違うものは変更せず一覧に出す（人が判断する）
 *
 * 使い方:
 *   node scripts/patch-from-scan.mjs --plan           # 通信せずに候補の件数だけ出す
 *   node scripts/patch-from-scan.mjs --fetch          # 候補の details.php を取得（再開可能）
 *   node scripts/patch-from-scan.mjs --apply --set S4 # 1セット分を cardData.json と画像に反映
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";
import { extractCardId, parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";
import { imageExt, politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const IMAGE_INDEX_PATH = path.join(ROOT, "src", "imageIndex.json");
const SCAN_PATH = path.join(__dirname, "official-card-scan.json");
const PROGRESS_DIR = path.join(__dirname, "scan-progress");
const REPORT_DIR = path.join(__dirname, "scan-patch-report");
const API_BASE = "https://www.pokemon-card.com";

// 公式サイトの画像フォルダ名（＝一覧のキー）が cardData の弾コードと一致しないもの。
// 取り込み時（scrape-bw-xy.mjs / scrape-missing-sets.mjs）の sourceCacheKeys と同じ対応
const EXTRA_SCAN_KEYS = {
  "XY6-B": ["XY6"],
  "XY7-B": ["XY7"],
  SMB: ["SM-XY"],
  MP1: ["M-P"],
};
// プロモは scrape-promo-sets.mjs で全件検証済みのため対象外
const SKIP_SETS = new Set(["S-P", "SV-P", "SM-P", "XY-P", "BW-P", "DP-P", "DPt-P", "L-P"]);

// 公式一覧の名前はアイコンを HTML で表す（details.php の <title> や cardData ではテキスト）
const MEGA_MARK = /<span class="pcg pcg-megamark"><\/span>/g;
const PRISM_STAR = /<span class="pcg pcg-prismstar"><\/span>/g;
export function normalizeName(s) {
  return (s || "")
    .replace(MEGA_MARK, "メガ")
    .replace(PRISM_STAR, " プリズムスター")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

const keyOf = (localId) => (/^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId);

async function loadJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); } catch { return fallback; }
}

// セットごとの details.php 取得候補を作る（通信なし）
export function planSet(set, scanEntries, imageIndex) {
  const count = (names) => names.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
  const dataCounts = count(set.k.map((r) => normalizeName(r[1])));
  const scanCounts = count(scanEntries.map((e) => normalizeName(e.jaName)));
  const missingImageNames = new Set(
    set.k.filter((r) => !imageIndex[`${set.c}/${keyOf(r[0])}`]).map((r) => normalizeName(r[1]))
  );
  const excessNames = new Set([...scanCounts].filter(([n, c]) => c > (dataCounts.get(n) || 0)).map(([n]) => n));
  const candidates = scanEntries.filter((e) => {
    const n = normalizeName(e.jaName);
    return excessNames.has(n) || missingImageNames.has(n);
  });
  return { candidates, excessNames: [...excessNames], missingImageCount: set.k.filter((r) => !imageIndex[`${set.c}/${keyOf(r[0])}`]).length };
}

function scanEntriesFor(set, scan) {
  const keys = [set.c, ...(EXTRA_SCAN_KEYS[set.c] || [])];
  return keys.flatMap((k) => scan.setMap[k] || []);
}

async function fetchDetail(cardId) {
  const html = await politeFetch(`${API_BASE}/card-search/details.php/card/${cardId}`);
  if (!html) return null;
  const badgeM = html.match(/class="img-regulation"\s+alt="([^"]*)"/);
  return { badge: badgeM ? badgeM[1] : null, cards: parseCardDetailsFromHtml(html) };
}

async function fetchSet(set, candidates) {
  const progressPath = path.join(PROGRESS_DIR, `${set.c}.json`);
  const progress = await loadJson(progressPath, {});
  let consecutiveFailures = 0;
  for (const e of candidates) {
    const cardId = extractCardId(e.cardThumbFile);
    if (progress[cardId]) continue;
    const d = await fetchDetail(cardId);
    if (!d) {
      if (++consecutiveFailures >= 3) throw new Error(`[${set.c}] 連続3件失敗したため停止します（再実行で続きから）`);
    } else {
      consecutiveFailures = 0;
      progress[cardId] = { ...d, cardThumbFile: e.cardThumbFile };
      await writeFileAtomic(progressPath, JSON.stringify(progress, null, 1));
    }
    await politeDelay();
  }
  return progress;
}

// 取得済みの details.php の結果を cardData の1セットに反映する
async function applySet(set, cardData, imageIndex, RARITY_CODE_MAP) {
  const progress = await loadJson(path.join(PROGRESS_DIR, `${set.c}.json`), null);
  if (!progress) throw new Error(`[${set.c}] scan-progress がありません。先に --fetch を実行してください`);
  const badges = new Set([set.c, set.codeAlias].filter(Boolean));
  const rows = new Map(set.k.map((r) => [keyOf(r[0]), r]));
  const report = { code: set.c, added: [], imageAdded: [], nameMismatch: [], otherBadge: [], noNumber: [] };
  const oldMax = Math.max(0, ...set.k.map((r) => parseInt(r[0], 10)).filter((n) => !isNaN(n)));

  const found = [];
  for (const [cardId, d] of Object.entries(progress)) {
    if (!badges.has(d.badge)) { report.otherBadge.push({ cardId, badge: d.badge }); continue; }
    if (d.cards.length === 0) { report.noNumber.push({ cardId }); continue; }
    for (const c of d.cards) found.push({ cardId, ...c, cardThumbFile: d.cardThumbFile });
  }

  const toAdd = new Map();
  for (const c of found) {
    const n = parseInt(c.local, 10);
    const rarity = c.rarity === "" ? "" : c.rarity;
    if (rarity === null) throw new Error(`[${set.c}] 未知のレアリティコードです: cardId ${c.cardId}`);
    const row = rows.get(String(n));
    if (row) {
      if (normalizeName(row[1]) !== normalizeName(c.jaName)) {
        report.nameMismatch.push({ id: `${set.c}-${row[0]}`, cardData: row[1], official: c.jaName, cardId: c.cardId });
      } else if (!imageIndex[`${set.c}/${n}`]) {
        report.imageAdded.push({ id: `${set.c}-${row[0]}`, row, cardThumbFile: c.cardThumbFile });
      }
      continue;
    }
    const prev = toAdd.get(n);
    if (prev && normalizeName(prev.jaName) !== normalizeName(c.jaName)) {
      throw new Error(`[${set.c}] 番号 ${n} に別名のカードが複数あります: ${prev.jaName} / ${c.jaName}`);
    }
    toAdd.set(n, { ...c, rarity });
  }

  const pad = (n) => String(n).padStart(3, "0");
  for (const [n, c] of [...toAdd].sort((a, b) => a[0] - b[0])) {
    const row = [pad(n), c.jaName, "", c.rarity];
    set.k.push(row);
    report.added.push({ id: `${set.c}-${row[0]}`, ja: c.jaName, rarity: c.rarity, n, beyondOldMax: n > oldMax, row, cardThumbFile: c.cardThumbFile });
  }
  set.k.sort((a, b) => (parseInt(a[0], 10) || 0) - (parseInt(b[0], 10) || 0));

  // 画像（新規追加分＋既存行で欠けていた分）
  const setTotal = computeSetTotal(set.k);
  const dir = path.join(ROOT, "public", "cards", set.sr, set.c);
  const imgFailed = [];
  for (const item of [...report.added, ...report.imageAdded]) {
    const [localId, jaName, , rarity] = item.row;
    const base = path.join(dir, buildFileName(jaName, set.c, localId, rarity, setTotal));
    if (await isUsableImage(base + ".jpg") || await isUsableImage(base + ".gif")) continue;
    const buf = await politeFetch(API_BASE + item.cardThumbFile, true);
    if (buf && buf.length > 1000) await writeFileAtomic(base + imageExt(buf), buf);
    else imgFailed.push(item.id);
    await politeDelay();
  }
  if (imgFailed.length) throw new Error(`[${set.c}] 画像の取得に失敗しました（cardData.json は未更新）: ${imgFailed.join(", ")}`);

  // 追加後も残る欠番（1〜最大番号）を記録
  const nums = new Set(set.k.map((r) => parseInt(r[0], 10)).filter((n) => !isNaN(n)));
  const newMax = Math.max(0, ...nums);
  report.remainingGaps = [];
  for (let n = 1; n <= newMax; n++) if (!nums.has(n)) report.remainingGaps.push(n);
  report.oldMax = oldMax;
  report.newMax = newMax;

  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const slim = (a) => a.map(({ row, cardThumbFile, ...rest }) => rest);
  await fs.writeFile(
    path.join(REPORT_DIR, `${set.c}.json`),
    JSON.stringify({ ...report, added: slim(report.added), imageAdded: slim(report.imageAdded) }, null, 2) + "\n"
  );
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
  const scanPath = args.includes("--scan") ? path.resolve(args[args.indexOf("--scan") + 1]) : SCAN_PATH;
  const scan = await loadJson(scanPath, null);
  if (!scan) throw new Error(`${scanPath} がありません。先に rescan-official-list.mjs を実行してください`);
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const imageIndex = JSON.parse(await fs.readFile(IMAGE_INDEX_PATH, "utf-8"));
  const sets = cardData.filter((s) => !SKIP_SETS.has(s.c) && (!onlySet || s.c === onlySet));

  if (args.includes("--plan") || args.includes("--fetch")) {
    let total = 0;
    for (const set of sets) {
      const entries = scanEntriesFor(set, scan);
      if (entries.length === 0) continue;
      const { candidates, excessNames, missingImageCount } = planSet(set, entries, imageIndex);
      if (candidates.length === 0) continue;
      total += candidates.length;
      console.log(`[${set.c}] 候補 ${candidates.length}（公式 ${entries.length} / cardData ${set.k.length}、画像なし ${missingImageCount}）` +
        (excessNames.length ? ` 公式側が多い名前: ${excessNames.slice(0, 5).join("・")}${excessNames.length > 5 ? " ほか" : ""}` : ""));
      if (args.includes("--fetch")) await fetchSet(set, candidates);
    }
    console.log(`候補の合計 ${total} 件`);
    return;
  }

  if (args.includes("--apply")) {
    if (!onlySet) throw new Error("--apply は --set で1セットずつ指定してください");
    const { RARITY_CODE_MAP } = await import("./scrape-missing-sets.mjs");
    const report = await applySet(sets[0], cardData, imageIndex, RARITY_CODE_MAP);
    console.log(JSON.stringify({
      code: report.code, oldMax: report.oldMax, newMax: report.newMax,
      added: report.added.map((a) => a.id), imageAdded: report.imageAdded.map((a) => a.id),
      nameMismatch: report.nameMismatch, otherBadge: report.otherBadge.length, noNumber: report.noNumber.length,
      remainingGaps: report.remainingGaps,
    }, null, 1));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
