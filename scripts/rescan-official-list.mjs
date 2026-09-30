#!/usr/bin/env node
/**
 * 公式サイトの全カード一覧（resultAPI.php）を取り直し、official-card-cache.json と同じ形式で
 * scripts/official-card-scan.json に保存する（既存の official-card-cache.json は上書きしない）。
 *
 * 既存キャッシュ（2026-07-04生成）は BREAK / LEGEND / シークレットレアの一部を取りこぼして
 * いたため、最新の一覧と突き合わせて欠けを見つけるのに使う。
 *
 * アクセスは scrape-promo-sets.mjs と同じく同時接続1本・2〜3秒間隔。途中で止まっても
 * 取得済みページは scripts/official-card-scan.partial.json に残り、再実行で続きから再開する。
 *
 * 使い方: node scripts/rescan-official-list.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCardId } from "./scrape-missing-sets.mjs";
import { politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "official-card-scan.json");
const PARTIAL_PATH = path.join(__dirname, "official-card-scan.partial.json");
const API_URL = "https://www.pokemon-card.com/card-search/resultAPI.php";

// sortBy=old（古い順）で取得する。sortBy=new だとスキャン中に新カードが追加された場合に
// ページがずれて取りこぼしが起きうるため
const pageUrl = (page) => `${API_URL}?regulation_sidebar_form=all&page=${page}&sortBy=old`;

async function fetchPage(page) {
  const text = await politeFetch(pageUrl(page));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  let partial = { pages: {} };
  try { partial = JSON.parse(await fs.readFile(PARTIAL_PATH, "utf-8")); } catch {}

  const first = partial.pages[1] ? null : await fetchPage(1);
  if (first) { partial.pages[1] = first.cardList; partial.maxPage = first.maxPage; partial.hitCnt = first.hitCnt; }
  const { maxPage, hitCnt } = partial;
  console.log(`総カード数 ${hitCnt}、ページ数 ${maxPage}`);

  for (let page = 2; page <= maxPage; page++) {
    if (partial.pages[page]) continue;
    await politeDelay();
    const data = await fetchPage(page);
    if (!data) throw new Error(`ページ ${page} の取得に失敗しました。再実行すると続きから再開します`);
    partial.pages[page] = data.cardList;
    if (page % 25 === 0) {
      await fs.writeFile(PARTIAL_PATH, JSON.stringify(partial));
      console.log(`  ${page}/${maxPage}`);
    }
  }
  await fs.writeFile(PARTIAL_PATH, JSON.stringify(partial));

  // official-card-cache.json と同じ形式（画像フォルダ名＝setCode ごとの一覧）に組み直す
  const setMap = {};
  const seen = new Set();
  for (let page = 1; page <= maxPage; page++) {
    for (const c of partial.pages[page]) {
      const id = extractCardId(c.cardThumbFile);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const setCode = c.cardThumbFile.split("/").at(-2);
      (setMap[setCode] ??= []).push({ jaName: c.cardNameViewText, cardThumbFile: c.cardThumbFile });
    }
  }
  const total = Object.values(setMap).flat().length;
  console.log(`一意のカード ${total} 件（hitCnt ${hitCnt}）`);
  await fs.writeFile(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), hitCnt, setMap }, null, 1));
  await fs.unlink(PARTIAL_PATH);
}

main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
