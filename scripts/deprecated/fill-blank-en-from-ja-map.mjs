#!/usr/bin/env node
/**
 * !!! DEPRECATED — 実行しないこと（不採用）!!!
 *
 * 試したが不採用: 「クリーンに見える」cardData.json内の(ja,en)ペアを対応表の元データとして
 * 信頼したところ、その元データ自体に位置ズレによる誤ペアが混在していることが判明した
 * （例: "きずぐすり"（Potion）に対し、実際には"Pokégear 3.0"が入っていた。ともに正規の
 * 英語カード名であるため、インドネシア語検出などの言語ベースの汚染チェックでは検出できない）。
 * このスクリプトを実行すると、その種の誤ペアが対応表を介して他の空欄カードに伝播し、
 * 一見正しそうな英語名で埋まった大量の誤データを生成してしまう（実行時に2,018件を誤って
 * 補完し、直後に発覚して全て revert した）。
 *
 * 正しい英語名の復元には、cardData.json内の既存データを信頼するのではなく、外部の
 * 権威あるソース（公式英語カードリスト等）と突き合わせる必要がある。参考として残す。
 *
 * ------------------------------------------------------------------------
 * (以下、元の説明)
 * 英語名が空欄のカードを、同じ日本語名を持つ「英語名が正しく入っている」他のカードから
 * 補完する。同じ和名のトレーナー/エネルギーカードは別セットに再録されることが多く、
 * 一部のセットでは正しい英語名が既に入っているため、その値を横展開できる。
 *
 * 前提: blank-contaminated-en-names.mjs を先に実行し、汚染された英語名を
 *       空欄化してあること（そうしないと汚染が対応表に伝播する）。
 *
 * 日本語名が同じでも英語名の候補が複数（表記ゆれ・別カード）ある場合は自動補完せず、
 * scripts/fill-blank-en-report.json に候補一覧を出力するので目視で判断すること。
 *
 * 使い方: node scripts/fill-blank-en-from-ja-map.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const REPORT_PATH = path.join(__dirname, "fill-blank-en-report.json");

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));

  // 日本語名 -> 見つかった英語名の集合（表記ゆれを見るため Set で持つ）
  const jaToEn = new Map();
  for (const set of cardData) {
    for (const k of set.k) {
      const [, ja, en] = k;
      if (!ja || !en) continue;
      if (!jaToEn.has(ja)) jaToEn.set(ja, new Set());
      jaToEn.get(ja).add(en);
    }
  }

  let filled = 0;
  let stillBlankWithJa = 0;
  let stillBlankNoJa = 0;
  const ambiguous = [];
  const filledList = [];

  for (const set of cardData) {
    for (const k of set.k) {
      const [local, ja, en] = k;
      if (en) continue; // 既に値があるカードは対象外
      if (!ja) { stillBlankNoJa++; continue; }
      const candidates = jaToEn.get(ja);
      if (!candidates || candidates.size === 0) { stillBlankWithJa++; continue; }
      if (candidates.size === 1) {
        const value = [...candidates][0];
        k[2] = value;
        filled++;
        filledList.push(`${set.c}/${local}: "${ja}" -> "${value}"`);
      } else {
        ambiguous.push({ set: set.c, local, ja, candidates: [...candidates] });
      }
    }
  }

  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), filled: filledList, ambiguous }, null, 2),
    "utf-8"
  );

  console.log(`補完: ${filled}件`);
  console.log(`要確認（候補複数、自動補完せず）: ${ambiguous.length}件 -> scripts/fill-blank-en-report.json`);
  console.log(`空欄のまま（日本語名はあるが候補なし）: ${stillBlankWithJa}件`);
  console.log(`空欄のまま（日本語名も無い）: ${stillBlankNoJa}件`);
}

main().catch((e) => { console.error(e); process.exit(1); });
