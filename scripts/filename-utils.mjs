/**
 * カード画像ファイル名のビルド・解析ユーティリティ
 *
 * 形式: {jaName}_{setCode}-{localId}／{total}_{rarity}.ext
 * 例:   フシギダネ_SV1S-001／198_C.jpg
 *       サンドリュー_PMCG5-043／96_C.png
 *       草のエネルギー_PMCG1-097／102.png  (レアリティなし)
 *
 * ※ Windows ではファイル名に / が使えないため全角スラッシュ ／ (U+FF0F) を使用
 */

import fs from "node:fs/promises";
import path from "node:path";

function sanitize(str) {
  return (str || "").replace(/[/\\:*?"<>|]/g, "");
}

// このサイズ未満のファイルは壊れたダウンロード（HTMLエラーページ等）とみなす。
// build-image-index.mjs の集計対象条件と、各スクレイパのスキップ判定を同じ基準に揃えるための定数
export const MIN_IMAGE_BYTES = 500;

// destPath に「使える画像」が既に存在するかどうかを判定する。
// 存在するだけでなく実用サイズ以上であることまで確認するので、
// 壊れたファイルが「存在する」という理由だけで永久にスキップされるのを防ぐ
export async function isUsableImage(destPath) {
  try {
    const st = await fs.stat(destPath);
    return st.isFile() && st.size >= MIN_IMAGE_BYTES;
  } catch {
    return false;
  }
}

// 一時ファイルに書いてから rename することで、途中終了しても壊れた画像が
// 本来のファイル名で残らないようにする（同一ファイルシステム内のrenameはアトミック）
export async function writeFileAtomic(destPath, buf) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.${process.pid}.part`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, destPath);
}

/**
 * カード情報からファイル名のステム（拡張子なし）を生成する
 * @param {string} jaName  日本語カード名
 * @param {string} setCode セットコード (例: "SV1S")
 * @param {string} localId ローカルID (例: "001")
 * @param {string} rarity  レアリティ (例: "C", "RR", "" など)
 * @param {number} total   セット総枚数。0 の場合は localId をそのまま使用
 * @returns {string} ファイル名ステム
 */
export function buildFileName(jaName, setCode, localId, rarity, total = 0) {
  const name = sanitize(jaName);
  let localPart;
  if (total > 0) {
    const n = parseInt(localId, 10);
    if (!isNaN(n)) {
      const totalStr = String(total);
      const digits = totalStr.length;
      const padded = String(n).padStart(digits, "0");
      localPart = `${padded}／${totalStr}`; // 全角スラッシュ (Windows 互換)
    } else {
      localPart = localId; // 非数値は変換しない
    }
  } else {
    localPart = localId;
  }
  const base = `${name}_${setCode}-${localPart}`;
  return rarity ? `${base}_${rarity}` : base;
}

/**
 * ファイル名ステムから localId を抽出する
 * @param {string} stem     拡張子なしファイル名
 * @param {string} setCode  セットコード
 * @returns {string} localId (例: "001")
 */
export function extractLocalId(stem, setCode) {
  const marker = `_${setCode}-`;
  const idx = stem.lastIndexOf(marker);
  if (idx < 0) {
    // 旧形式: ステム自体が localId
    return stem;
  }
  const after = stem.slice(idx + marker.length);
  // ／ (全角スラッシュ U+FF0F) または _ を終端として localId を切り出す
  const end = after.search(/[／_]/);
  return end >= 0 ? after.slice(0, end) : after;
}

/**
 * セットのカード配列からセット総枚数（最大数値 localId）を計算する
 * @param {Array} cards  cardData.k の配列 [[localId, jaName, enName, rarity], ...]
 * @returns {number} 最大数値 localId (0 なら数値カードなし)
 */
export function computeSetTotal(cards) {
  let max = 0;
  for (const card of cards) {
    const n = parseInt(card[0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}
