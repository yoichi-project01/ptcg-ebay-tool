#!/usr/bin/env node
/**
 * cardData.json の各セットについて、英語名の列が日本語名の列に対して数行ズレていないかを検査する。
 *
 * 過去に SVAL/SVAM/SVAW/SVHK/SVHM および SV4a の一部で、英語名の列全体が日本語名に対して
 * 数行ズレるという不整合が発生した（文法的に正しい英語カード名が別カードの名前として
 * 入ってしまうため、単語ベースの汚染検出では原理的に発見できない）。データを再取得した際に
 * 同じ事故が再発しうるため、検査を自動化して回帰テストに組み込む。
 *
 * アルゴリズム:
 *   1. 全セットを走査し、(日本語名, 英語名) の組み合わせが何セットにまたがって出現するかを集計する
 *   2. 2セット以上で出現する組み合わせのみを「正解ペア」として採用する（＝他セットへの再録により
 *      裏取りできるカード名のみを検査対象にする。1セットにしか出現しない固有名は裏取りできないため
 *      対象外とし、「単に珍しいカード名」を行ズレと誤検知しないようにする）
 *   3. 各セットについて、英語名の列を offset -4〜+4 でずらしながら正解ペアとの一致率を計算する
 *      （offset o は「日本語名 k[i] を英語名 k[i+o] と突き合わせる」ことを意味する）
 *   4. 以下のいずれかに該当するセットを「疑いあり」として報告する
 *      - offset!=0 の最良一致率が offset=0 の一致率を 0.3 以上上回る（行ズレの疑い）
 *      - offset=0 の一致率が 0.6 未満、かつ照合できた件数が8件以上（別種の不整合の疑い）
 *   5. 照合対象（valid comparisons）が5件未満のセットは統計的に無意味なため判定をスキップする
 *
 * 使い方: node scripts/check-row-alignment.mjs
 * exit code 0 = 疑いなし、1 = 疑いあり（詳細を標準出力に表示）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

const OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const MIN_COMPARISONS = 5;
const OFFSET_ADVANTAGE_THRESHOLD = 0.3;
const MISMATCH_RATE_THRESHOLD = 0.6;
const MISMATCH_MIN_COMPARISONS = 8;

// (ja, en) ペアが2セット以上にまたがって出現するものだけを正解ペアとして採用する。
// あわせて、正解ペアを持つ日本語名の集合（= 他セットへの再録で裏取りできるカード名）も返す
function buildTrustedPairs(cardData) {
  const setsByPair = new Map(); // "ja\nen" -> Set(setCode)
  for (const set of cardData) {
    for (const k of set.k) {
      const ja = k[1];
      const en = k[2];
      if (!ja || !en) continue;
      const pairKey = ja + "\n" + en;
      if (!setsByPair.has(pairKey)) setsByPair.set(pairKey, new Set());
      setsByPair.get(pairKey).add(set.c);
    }
  }
  const trustedPairs = new Set();
  const trustedJa = new Set();
  for (const [pairKey, sets] of setsByPair) {
    if (sets.size >= 2) {
      trustedPairs.add(pairKey);
      trustedJa.add(pairKey.slice(0, pairKey.indexOf("\n")));
    }
  }
  return { trustedPairs, trustedJa };
}

// 1セット分について、offsetごとの一致率と照合件数を計算する。
// 照合対象は「他セットにも出現する（=裏取りできる）日本語名」を持つカードのみに絞る
function matchRateForOffset(k, offset, { trustedPairs, trustedJa }) {
  let comparisons = 0;
  let matches = 0;
  for (let i = 0; i < k.length; i++) {
    const j = i + offset;
    if (j < 0 || j >= k.length) continue;
    const ja = k[i][1];
    const en = k[j][2];
    if (!ja || !en || !trustedJa.has(ja)) continue;
    comparisons++;
    if (trustedPairs.has(ja + "\n" + en)) matches++;
  }
  return { comparisons, matches, rate: comparisons > 0 ? matches / comparisons : 0 };
}

// cardData（cardData.jsonをJSON.parseしたもの）を検査し、疑いのあるセットの一覧を返す
export function analyzeCardData(cardData) {
  const trusted = buildTrustedPairs(cardData);
  const flagged = [];
  for (const set of cardData) {
    const byOffset = {};
    for (const offset of OFFSETS) byOffset[offset] = matchRateForOffset(set.k, offset, trusted);
    const zero = byOffset[0];
    if (zero.comparisons < MIN_COMPARISONS) continue;

    let bestNonZero = null;
    for (const offset of OFFSETS) {
      if (offset === 0) continue;
      const r = byOffset[offset];
      if (!bestNonZero || r.rate > bestNonZero.rate) bestNonZero = { offset, ...r };
    }

    const offsetShiftSuspected =
      bestNonZero && bestNonZero.rate - zero.rate >= OFFSET_ADVANTAGE_THRESHOLD;
    const otherMismatchSuspected =
      zero.rate < MISMATCH_RATE_THRESHOLD && zero.comparisons >= MISMATCH_MIN_COMPARISONS;

    if (offsetShiftSuspected || otherMismatchSuspected) {
      flagged.push({
        setCode: set.c,
        zeroRate: zero.rate,
        zeroComparisons: zero.comparisons,
        bestOffset: bestNonZero?.offset ?? null,
        bestOffsetRate: bestNonZero?.rate ?? null,
        offsetShiftSuspected,
        otherMismatchSuspected,
      });
    }
  }
  return flagged;
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const flagged = analyzeCardData(cardData);
  if (flagged.length === 0) {
    console.log("疑いのあるセットはありませんでした。");
    process.exit(0);
  }
  for (const f of flagged) {
    const reasons = [
      f.offsetShiftSuspected && `行ズレの疑い（offset=0の一致率${(f.zeroRate * 100).toFixed(0)}% → offset=${f.bestOffset}で${(f.bestOffsetRate * 100).toFixed(0)}%）`,
      f.otherMismatchSuspected && `一致率が低い（${(f.zeroRate * 100).toFixed(0)}%、照合${f.zeroComparisons}件）`,
    ].filter(Boolean).join(" / ");
    console.log(`${f.setCode}: ${reasons}`);
  }
  console.log(`\n${flagged.length}セットで疑いあり`);
  process.exit(1);
}

// process.argv[1]は呼び出し時の表記（相対/絶対どちらもありうる）のままなので、
// import.meta.urlと同じ形式（絶対file:// URL）に正規化してから比較する必要がある。
// 従来は `file://${process.argv[1]}` という文字列組み立てだったため、相対パスで
// 起動した場合（例: `node scripts/check-row-alignment.mjs`）に一致せずmain()が
// 無言でスキップされていた（このスクリプトが動いているように見えて実は何もしていない、
// という気づきにくい形の不具合だったため修正した）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
