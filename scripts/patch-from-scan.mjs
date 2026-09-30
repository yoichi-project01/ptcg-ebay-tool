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

// 末尾の括弧注記（例:「博士の研究（ナナカマド博士）」）は cardData 側にだけ付いていることがあり、
// 同じカードとして扱う（scrape-official-images.mjs の matchName と同じ既知パターン）
const sameCard = (a, b) => {
  const strip = (s) => normalizeName(s).replace(/[（(][^（()）]*[)）]$/, "").trim();
  return normalizeName(a) === normalizeName(b) || strip(a) === strip(b);
};

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
      if (!sameCard(row[1], c.jaName)) {
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

  // 既存行の名前が公式と食い違うセット（末尾が別カードで埋まっている S4a 型の破損）に
  // 行だけ足すと誤ったデータが残るため、何も書き込まずに停止する
  if (report.nameMismatch.length) {
    throw new Error(`[${set.c}] 既存行の名前が公式と食い違うため補完しません（${report.nameMismatch.length}件、例: ` +
      report.nameMismatch.slice(0, 3).map((m) => `${m.id} ${m.cardData}→${m.official}`).join(" / ") + "）");
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

// 既存行の名前が公式と食い違う（末尾が別カードで埋まっている S4a 型の破損）セットを、
// details.php で全件確かめた結果で作り直す。2026-08-31 に9セットで行った方式、
// 2026-09-28 の S-P/SV-P 作り直しと同じく、旧データと型番ごとに突き合わせて
// 名前・画像（ファイル内容のバイト比較）の変化を card_id で出力する
async function rebuildSet(set, scan, cardData, imageIndex) {
  const { validateAndBuildK } = await import("./scrape-missing-sets.mjs");
  const entries = scanEntriesFor(set, scan);
  const progress = await loadJson(path.join(PROGRESS_DIR, `${set.c}.json`), {});
  const notFetched = entries.map((e) => extractCardId(e.cardThumbFile)).filter((id) => !progress[id]);
  if (notFetched.length) throw new Error(`[${set.c}] 未取得のカードがあります（先に --full-fetch）: ${notFetched.length}件`);

  const badges = new Set([set.c, set.codeAlias].filter(Boolean));
  const details = [];
  for (const d of Object.values(progress)) {
    if (!badges.has(d.badge)) continue;
    for (const c of d.cards) details.push({ ...c, cardThumbFile: d.cardThumbFile });
  }
  // 重複（別名なら停止）・欠番（1〜最大番号）・未知のレアリティ・総数の不一致を検証
  const { k, total, byLocal } = validateAndBuildK(details, set.c);
  if (set.of && total !== set.of) throw new Error(`[${set.c}] 公式の総数 ${total} と cardData の of ${set.of} が一致しません`);

  // 旧データとの突き合わせ。括弧注記だけの違いは同じカードとして旧名を残す
  const oldByKey = new Map(set.k.map((r) => [keyOf(r[0]), r]));
  for (const row of k) {
    const old = oldByKey.get(keyOf(row[0]));
    if (old && sameCard(old[1], row[1])) row[1] = old[1];
  }
  const stageDir = path.join(PROGRESS_DIR, "staging", set.c);
  for (const [n, d] of [...byLocal].sort((a, b) => a[0] - b[0])) {
    const p = path.join(stageDir, `${String(n).padStart(3, "0")}.img`);
    if (await isUsableImage(p)) continue;
    const buf = await politeFetch(API_BASE + d.cardThumbFile, true);
    if (!buf || buf.length <= 1000) throw new Error(`[${set.c}] 画像の取得に失敗しました（再実行で続きから）: ${n}`);
    await writeFileAtomic(p, buf);
    await politeDelay();
  }

  const reportPath = path.join(REPORT_DIR, `${set.c}-rebuild.json`);
  let report = await loadJson(reportPath, null); // 途中で止まった後の再実行では最初の一覧を使う
  if (!report) {
    report = { code: set.c, nameChanged: [], imageReplaced: [], added: [], removed: [] };
    const newKeys = new Set(k.map((r) => keyOf(r[0])));
    for (const row of k) {
      const id = `${set.c}-${row[0]}`;
      const old = oldByKey.get(keyOf(row[0]));
      if (!old) { report.added.push({ id, ja: row[1], rarity: row[3] }); continue; }
      if (old[1] !== row[1]) report.nameChanged.push({ id, oldJa: old[1], newJa: row[1] });
      const rel = imageIndex[`${set.c}/${keyOf(row[0])}`];
      let oldBuf = null;
      if (rel) try { oldBuf = await fs.readFile(path.join(ROOT, "public", rel)); } catch {}
      const newBuf = await fs.readFile(path.join(stageDir, `${row[0]}.img`));
      if (!oldBuf || !oldBuf.equals(newBuf)) report.imageReplaced.push({ id, ja: row[1], hadImage: !!oldBuf });
    }
    for (const [key, row] of oldByKey) if (!newKeys.has(key)) report.removed.push({ id: `${set.c}-${row[0]}`, ja: row[1] });
    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }

  // 画像ディレクトリを入れ替える（新しいファイル名一覧に無い旧ファイルは削除）
  const setTotal = computeSetTotal(k);
  const dir = path.join(ROOT, "public", "cards", set.sr, set.c);
  const keep = new Set();
  for (const row of k) {
    const buf = await fs.readFile(path.join(stageDir, `${row[0]}.img`));
    const name = buildFileName(row[1], set.c, row[0], row[3], setTotal) + imageExt(buf);
    keep.add(name);
    await writeFileAtomic(path.join(dir, name), buf);
  }
  let orphansRemoved = 0;
  for (const f of await fs.readdir(dir)) if (!keep.has(f)) { await fs.unlink(path.join(dir, f)); orphansRemoved++; }

  set.k = k;
  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
  return {
    code: set.c, old: oldByKey.size, new: k.length, of: total, maxNumber: setTotal,
    nameChanged: report.nameChanged.length, imageReplaced: report.imageReplaced.length,
    added: report.added.length, removed: report.removed.length, orphansRemoved,
  };
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

  if (args.includes("--full-fetch")) {
    // 破損セットの作り直し用: 公式一覧のそのセットの全カードを details.php で確かめる
    if (!onlySet) throw new Error("--full-fetch は --set で1セットずつ指定してください");
    const entries = scanEntriesFor(sets[0], scan);
    console.log(`[${onlySet}] 全 ${entries.length} 件を確認`);
    await fetchSet(sets[0], entries);
    return;
  }

  if (args.includes("--rebuild")) {
    if (!onlySet) throw new Error("--rebuild は --set で1セットずつ指定してください");
    const summary = await rebuildSet(sets[0], scan, cardData, imageIndex);
    console.log(JSON.stringify(summary, null, 1));
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
