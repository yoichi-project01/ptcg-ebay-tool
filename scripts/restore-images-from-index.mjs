#!/usr/bin/env node
// Git に入っている src/imageIndex.json（正しい対応表）どおりに public/cards をそろえる。
// imageIndex.json は作り直さない（build-image-index.mjs は実行しない）。
//
// 1. 対応表のファイルが無いとき、同じフォルダに同じ番号の画像が別の名前であり、
//    中身が同じカードと言える場合は、対応表の名前でコピーする（元のファイルは残す）。
//    同じカードと言えるのは、作り直しで画像が差し替わっていない、かつ
//    名前が表記ゆれ（全角半角・空白）だけの違いか、番号で取得した pcg-search の画像（PMCG）の場合。
// 2. 残りは公式サイトから取り直す。画像の URL は details.php の取得結果
//    （scripts/scan-progress / promo-progress）から引き、無いセットは公式一覧のカードIDから
//    details.php を開いて番号を確かめる（結果は scan-progress に保存し、再実行時は飛ばす）。
//    同時接続1本・2〜3秒間隔、403 等は待ってから再試行し、続けて失敗したら止まる。
// 3. --verify: 対応表の全件にファイルがあるか（大きさ・画像形式）を確認する。
//
// 使い方: node scripts/restore-images-from-index.mjs [--dry-run] [--verify]
// 取り直せなかったものは scripts/restore-images-report.json に card_id と理由を出す。
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractLocalId, MIN_IMAGE_BYTES, writeFileAtomic } from "./filename-utils.mjs";
import { politeFetch, politeDelay } from "./scrape-promo-sets.mjs";
import { extractCardId, parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";
import { normalizeName } from "./patch-from-scan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const API_BASE = "https://www.pokemon-card.com";
const PCG_SEARCH = "https://pcg-search.com";
const REPORT_PATH = path.join(__dirname, "restore-images-report.json");
const SCAN_PROGRESS = path.join(__dirname, "scan-progress");
const PROMO_PROGRESS = path.join(__dirname, "promo-progress");
const MAX_CONSECUTIVE_FAILURES = 3;
const EXTRA_SCAN_KEYS = { "XY6-B": ["XY6"], "XY7-B": ["XY7"], SMB: ["SM-XY"], MP1: ["M-P"] };
// pcg-search.com の画像（番号で取得）。CLAUDE.md「画像ソースと URL パターン」参照
const PCG_SEARCH_URL = {
  neo4: (n) => `/img/neo/neo4${String(n).padStart(3, "0")}.png`,
};

const args = new Set(process.argv.slice(2));
const git = (a) => execFileSync("git", a, { cwd: ROOT, maxBuffer: 1 << 30 }).toString();
const readJson = (p, fb) => { try { return JSON.parse(fsSync.readFileSync(p, "utf-8")); } catch { return fb; } };

const index = JSON.parse(git(["show", "HEAD:src/imageIndex.json"]));
const cardData = JSON.parse(fsSync.readFileSync(path.join(ROOT, "src", "cardData.json"), "utf-8"));
const numKey = (local) => (/^\d+$/.test(local) ? String(parseInt(local, 10)) : local);
const rowByKey = new Map();
for (const s of cardData) for (const r of s.k) rowByKey.set(`${s.c}/${numKey(r[0])}`, r);

const MAGIC = { jpg: [0xff, 0xd8], png: [0x89, 0x50], gif: [0x47, 0x49] };
const extOf = (p) => p.split(".").pop().toLowerCase();
// 旧世代の画像には拡張子 .jpg で中身が GIF のものがある（ブラウザは中身で判断して表示する）ため、
// 拡張子に関係なく jpg/png/gif のいずれかであればよいとする
const magicOk = (buf) => Object.values(MAGIC).some((m) => m.every((b, i) => buf[i] === b));
function fileOk(rel) {
  const abs = path.join(PUBLIC, rel);
  try {
    if (fsSync.statSync(abs).size < MIN_IMAGE_BYTES) return false;
    const fd = fsSync.openSync(abs, "r"); const buf = Buffer.alloc(4); fsSync.readSync(fd, buf, 0, 4, 0); fsSync.closeSync(fd);
    return magicOk(buf);
  } catch { return false; }
}

// 作り直しで画像が差し替わった card_id（S-P/SV-P と scan-patch-report の作り直し）
const replaced = new Set();
const idToKey = (id) => { const m = id.match(/^(.*)-([^-]+)$/); return `${m[1]}/${numKey(m[2])}`; };
for (const c of ["S-P", "SV-P"]) for (const x of readJson(path.join(__dirname, "promo-rebuild-report", `${c}.json`), {}).imageReplaced || []) replaced.add(idToKey(x.id));
for (const f of fsSync.readdirSync(path.join(__dirname, "scan-patch-report")).filter((f) => f.endsWith("-rebuild.json")))
  for (const x of readJson(path.join(__dirname, "scan-patch-report", f), {}).imageReplaced || []) replaced.add(idToKey(x.id));

const cardIdOf = (key) => { const [set, n] = key.split("/"); return `${set}-${/^\d+$/.test(n) ? n.padStart(3, "0") : n}`; };
const looseName = (s) => normalizeName(s).replace(/\s+/g, "");

// ---- 1. コピー ----
function copyCandidate(key, rel) {
  if (replaced.has(key)) return null;
  const set = key.split("/")[0];
  const dir = path.dirname(rel);
  let files;
  try { files = fsSync.readdirSync(path.join(PUBLIC, dir)); } catch { return null; }
  const n = key.split("/")[1];
  const want = path.basename(rel).split("_")[0];
  for (const f of files) {
    if (extOf(f) !== extOf(rel)) continue;
    const local = extractLocalId(f.replace(/\.(jpg|png|gif)$/, ""), set);
    if (numKey(local) !== n) continue;
    if (!fileOk(path.join(dir, f))) continue;
    const have = f.split("_")[0];
    if (looseName(have) === looseName(want) || /^PMCG\d$/.test(set)) return path.join(dir, f);
  }
  return null;
}

// ---- 2. 画像 URL の手がかり ----
function loadSources() {
  const src = new Map(); // key -> { url, jaName }
  for (const f of fsSync.readdirSync(SCAN_PROGRESS).filter((f) => f.endsWith(".json"))) {
    const set = f.replace(/\.json$/, "");
    for (const v of Object.values(readJson(path.join(SCAN_PROGRESS, f), {})))
      for (const c of v?.cards || []) if (/^\d+$/.test(c.local)) src.set(`${set}/${numKey(c.local)}`, { url: API_BASE + (c.cardThumbFile || v.cardThumbFile), jaName: c.jaName });
  }
  for (const f of fsSync.readdirSync(PROMO_PROGRESS).filter((f) => f.endsWith(".json"))) {
    const set = f.replace(/\.json$/, "");
    for (const v of Object.values(readJson(path.join(PROMO_PROGRESS, f), {})))
      if (v?.number && v.cardThumbFile) src.set(`${set}/${numKey(v.number)}`, { url: API_BASE + v.cardThumbFile, jaName: v.jaName });
  }
  return src;
}

class StopError extends Error {}
let consecutiveFailures = 0;
function noteResult(ok, what) {
  if (ok) { consecutiveFailures = 0; return; }
  if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new StopError(`連続${MAX_CONSECUTIVE_FAILURES}件失敗したため停止します（${what}）。再実行で続きから再開します`);
}

// details.php で番号を確かめる（セットの必要な番号がそろったらそのセットは打ち切る）
async function resolveBySetDetails(set, neededKeys, src) {
  const scan = readJson(path.join(__dirname, "official-card-scan.json"), { setMap: {} });
  const entries = [set, ...(EXTRA_SCAN_KEYS[set] || [])].flatMap((k) => scan.setMap[k] || []);
  const progressPath = path.join(SCAN_PROGRESS, `${set}.json`);
  const progress = readJson(progressPath, {});
  const pending = () => neededKeys.filter((k) => !src.has(k));
  for (const e of entries) {
    if (!pending().length) break;
    const cardId = extractCardId(e.cardThumbFile);
    if (!cardId || progress[cardId]) continue;
    const html = await politeFetch(`${API_BASE}/card-search/details.php/card/${cardId}`);
    noteResult(!!html, `details.php ${cardId}`);
    if (html) {
      const badgeM = html.match(/class="img-regulation"\s+alt="([^"]*)"/);
      progress[cardId] = { badge: badgeM ? badgeM[1] : null, cards: parseCardDetailsFromHtml(html), cardThumbFile: e.cardThumbFile };
      await writeFileAtomic(progressPath, JSON.stringify(progress, null, 1));
      for (const c of progress[cardId].cards) if (/^\d+$/.test(c.local)) src.set(`${set}/${numKey(c.local)}`, { url: API_BASE + (c.cardThumbFile || e.cardThumbFile), jaName: c.jaName });
    }
    await politeDelay();
  }
}

async function main() {
  const entries = Object.entries(index);
  if (args.has("--verify")) {
    const bad = entries.filter(([, rel]) => !fileOk(rel));
    console.log(`確認: 対応表 ${entries.length} 件中 ファイルあり ${entries.length - bad.length} 件 / 無し・壊れ ${bad.length} 件`);
    for (const [key, rel] of bad.slice(0, 50)) console.log(`  ${cardIdOf(key)}  ${rel}`);
    process.exit(bad.length ? 1 : 0);
  }
  const dry = args.has("--dry-run");
  const report = readJson(REPORT_PATH, { failed: {} });
  const saveReport = () => writeFileAtomic(REPORT_PATH, JSON.stringify(report, null, 1));

  // 1. コピー
  let copied = 0;
  const toFetch = [];
  for (const [key, rel] of entries) {
    if (fileOk(rel)) continue;
    const from = copyCandidate(key, rel);
    if (from) {
      if (!dry) await fs.copyFile(path.join(PUBLIC, from), path.join(PUBLIC, rel), fsSync.constants.COPYFILE_EXCL).catch((e) => { if (e.code !== "EEXIST") throw e; });
      copied++;
    } else toFetch.push([key, rel]);
  }
  console.log(`コピー: ${copied} 件${dry ? "（dry-run）" : ""} / 取り直し対象: ${toFetch.length} 件`);

  // 2. URL がそろっていないセットは details.php で番号を確かめる
  const src = loadSources();
  const unresolved = toFetch.filter(([key]) => !src.has(key) && !PCG_SEARCH_URL[key.split("/")[0]]);
  const bySet = new Map();
  for (const [key] of unresolved) { const s = key.split("/")[0]; bySet.set(s, [...(bySet.get(s) || []), key]); }
  console.log(`画像URLの確認が必要: ${unresolved.length} 件（${bySet.size} セット）`);
  if (dry) { console.log([...bySet].map(([s, k]) => `${s}:${k.length}`).join(" ")); return; }

  try {
    for (const [set, keys] of bySet) {
      console.log(`== details.php で番号を確認: ${set}（${keys.length} 件）`);
      await resolveBySetDetails(set, keys, src);
    }

    // 3. ダウンロード
    let done = 0, i = 0;
    for (const [key, rel] of toFetch) {
      i++;
      if (fileOk(rel)) continue;
      const id = cardIdOf(key);
      const set = key.split("/")[0];
      const row = rowByKey.get(key);
      let url, jaName;
      if (PCG_SEARCH_URL[set]) { url = PCG_SEARCH + PCG_SEARCH_URL[set](key.split("/")[1]); jaName = row?.[1]; }
      else if (src.has(key)) ({ url, jaName } = src.get(key));
      else { report.failed[id] = { rel, reason: "公式一覧・details.php にこの番号のカードが見つからない" }; await saveReport(); continue; }
      if (row && looseName(jaName).replace(/[（(][^（()）]*[)）]$/, "") !== looseName(row[1]).replace(/[（(][^（()）]*[)）]$/, "")) {
        report.failed[id] = { rel, reason: `名前が一致しない（公式: ${jaName} / cardData: ${row[1]}）` }; await saveReport(); continue;
      }
      const buf = await politeFetch(url, true);
      noteResult(!!buf, `画像 ${id}`);
      if (!buf) { report.failed[id] = { rel, url, reason: "ダウンロード失敗（再試行を使い切った / 404）" }; await saveReport(); await politeDelay(); continue; }
      if (buf.length < MIN_IMAGE_BYTES || !magicOk(buf)) {
        report.failed[id] = { rel, url, reason: `画像ではない（${buf.subarray(0, 3).toString("latin1")}…, ${buf.length}バイト）` };
        await saveReport(); await politeDelay(); continue;
      }
      await writeFileAtomic(path.join(PUBLIC, rel), buf);
      delete report.failed[id];
      done++;
      if (done % 50 === 0) { console.log(`  取得 ${done} 件（${i}/${toFetch.length}）`); await saveReport(); }
      await politeDelay();
    }
    await saveReport();
    console.log(`取得: ${done} 件 / 取り直せなかった: ${Object.keys(report.failed).length} 件 → ${path.relative(ROOT, REPORT_PATH)}`);
  } catch (e) {
    await saveReport();
    if (e instanceof StopError) { console.error(e.message); process.exit(2); }
    throw e;
  }
}

main().catch((e) => { console.error("エラー:", e); process.exit(1); });
