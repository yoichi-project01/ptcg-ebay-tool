#!/usr/bin/env node
/**
 * 既存セットの「シークレット範囲丸ごと欠落」を補完するパッチスクリプト。
 *
 * 背景: cardData.json の一部の既存セット（このタスクより前から入っていたもの、
 * 主にTCGdex由来）は、公式の総数（of）までしか収録されておらず、公式サイトに
 * 実在するSR/SAR/UR/HR等のシークレットカード（totalを超える番号帯）が丸ごと
 * 欠落していることが2026-08-30の調査で判明した（S8bで90枚、他57セットで
 * 合計1,698枚）。scrape-missing-sets.mjs は「新規セットの追加」専用のため、
 * 「既存セットへの追加（=パッチ）」用に本スクリプトを新設した。
 *
 * ロジックはscrape-missing-sets.mjsの検証済み関数（parseCardDetailsFromHtml/
 * validateAndBuildK/fetchCardDetail/downloadImage/extractCardId/sleep）を
 * そのまま再利用し、新規ロジックは「既存セットとの差分だけを抽出して追記する」
 * 部分のみ。
 *
 * 絶対に守ること:
 *   - 既存カードのデータは一切変更しない（追記のみ）。git diff で確認すること
 *   - of（総数）フィールドは変更しない
 *   - 既存の番号と重複する番号が新規に見つかった場合、ja名が一致しない限り
 *     例外中断する（絶対にやってはいけないこと: 無検証データの上書き）
 *
 * 使い方:
 *   node scripts/patch-existing-sets.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";
import { sleep, extractCardId, fetchCardDetail, downloadImage } from "./scrape-missing-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");
const REPORT_PATH = path.join(__dirname, "patch-existing-sets-report.json");

const CONCURRENCY = 3;
const DELAY_MS = 800;
const MAX_FAILED_CARDS = 5;

// パッチ対象セット。SV-P/S-Pはプロモ（位置マッチング方式が必要）のため対象外、
// 別途保留リストで扱う。
//
// 2026-08-30、着手前に56セット全件を「先頭・中間・末尾サンプリング＋
// official-card-cache.json+details.phpとの名前突き合わせ」で事前チェックした
// （キーワードマッチではなく実データ突き合わせ。詳細はCLAUDE.md参照）。
// 結果、30セットで「既存のcardData.jsonの名前が実際の番号と食い違う」という
// 名前重複とは別種の破損（S4aで最初に発見: 156-190番がPokemonデータで
// 上書きされ、本来のトレーナーズ/エネルギーカードが消えていた）を検出した。
// 破損セット（SI/S10D/S10P/S10a/S10b/S11/S11a/S4/S4a/S5I/S5R/S5a/S6H/S6K/
// S6a/S7D/S7R/S8/S8a/S8b/SH/SV5M/SV6/SV6a/SVAL/SVAM/SVAW/SVC/SVEL/SVEM、
// 計30セット）は今回のバッチから除外し、破損の無い26セットのみ対象にした。
const TARGET_PATCHES = [
  // 基本エネルギー8種（cardId 42944-42951）は番号表記が無い汎用インサートのため除外。
  // なお251-258番（基本エネルギーSR、Web検索で実在確認済み）はofficial-card-cache.jsonの
  // スキャンからも本パッチ実行時のcardIdセットからも見つからず、別途cardId特定が必要
  // （未着手のまま記録。CLAUDE.md参照）
  { code: "S12a", excludeCardIds: [42944, 42945, 42946, 42947, 42948, 42949, 42950, 42951] },
  { code: "SV5K" },
  { code: "S9a" },
  { code: "SV4a" },
  // 基本エネルギー8種（scrape-missing-sets.mjsでSVI新規作成時と同じcardId）は
  // 番号表記が無い汎用インサートのため除外
  { code: "SVI", excludeCardIds: [45440, 45441, 45464, 45465, 45489, 45490, 45513, 45514] },
  { code: "SV10" },
  { code: "SV8" },
  { code: "SVHK" },
  { code: "SVHM" },
  // 基本エネルギー9種（フェーズ4新規作成時と同じcardId）は番号表記が無い汎用インサートのため除外
  { code: "CP4", excludeCardIds: [31997, 31998, 31999, 32000, 32001, 32002, 32003, 32004, 32005] },
  { code: "XYA" },
  { code: "XYB" },
  { code: "XYC" },
  { code: "XYD" },
  { code: "XYE" },
  { code: "XYH" },
  { code: "SM1p" },
  { code: "SM2p" },
  // 基本エネルギー9種（フェーズ2新規作成時と同じcardId）は番号表記が無い汎用インサートのため除外
  { code: "SMA", excludeCardIds: [33218, 33219, 33220, 33221, 33222, 33223, 33224, 33225, 33226] },
  { code: "SMD" },
  // 基本エネルギー6種（フェーズ2新規作成時と同じcardId）は番号表記が無い汎用インサートのため除外
  { code: "SML", excludeCardIds: [36493, 36494, 36516, 36517, 36539, 36540] },
  // 基本エネルギー8種（フェーズ3新規作成時と同じcardId）は番号表記が無い汎用インサートのため除外
  { code: "MC", excludeCardIds: [49459, 49460, 49461, 49462, 49463, 49464, 49465, 49466] },
  { code: "L2-Sb" },
  { code: "L2-Sh" },
  // 基本エネルギー7種（フェーズ6-3新規作成時と同じcardId）は番号表記が無い汎用インサートのため除外
  { code: "20th", excludeCardIds: [31728, 31729, 31730, 31731, 31732, 31733, 31734] },
  { code: "WCS23" },
];

// 末尾の説明的な括弧（例: "博士の研究（ナナカマド博士）" → "博士の研究"）を除いた比較用の名前。
// scrape-official-images.mjs の matchName() と同じロジック
function stripParenSuffix(jaName) {
  return jaName.replace(/[（(][^）)]*[）)]\s*$/, "").trim();
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  if (!(await exists(CACHE_PATH))) {
    throw new Error(`${CACHE_PATH} が見つかりません。`);
  }
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
  const setMap = cache.setMap;
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));

  const report = { generatedAt: new Date().toISOString(), sets: {} };
  let anyPatched = false;

  for (const target of TARGET_PATCHES) {
    const existingSet = cardData.find((s) => s.c === target.code);
    if (!existingSet) {
      throw new Error(`[${target.code}] cardData.jsonに存在しません（新規セットはscrape-missing-sets.mjsを使うこと）`);
    }
    const existingByLocal = new Map(existingSet.k.map((k) => [parseInt(k[0], 10), k]));

    const sourceKeys = target.sourceCacheKeys || [target.code];
    const officialCards = sourceKeys.flatMap((key) => setMap[key] || []);
    if (officialCards.length === 0) {
      throw new Error(`[${target.code}] official-card-cache.jsonに見つかりません（探索キー: ${sourceKeys.join(", ")}）`);
    }

    const excludeSet = new Set((target.excludeCardIds || []).map(String));
    const cacheJobs = officialCards
      .map((c) => ({ cardId: extractCardId(c.cardThumbFile), cardThumbFile: c.cardThumbFile }))
      .filter((j) => j.cardId && !excludeSet.has(j.cardId));
    const extraJobs = (target.extraCardIds || []).map((cardId) => ({ cardId: String(cardId), cardThumbFile: null }));
    const jobs = [...cacheJobs, ...extraJobs];

    console.log(`[${target.code}] 既存${existingSet.k.length}枚 / キャッシュ${jobs.length}枚を details.php で検証中...`);

    const details = [];
    const failed = [];
    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        const cardDetails = await fetchCardDetail(job.cardId);
        const cardThumbFile = job.cardThumbFile || cardDetails[0]?.cardThumbFile;
        if (cardDetails.length > 0 && cardThumbFile) {
          for (const d of cardDetails) details.push({ ...d, cardThumbFile });
        } else {
          failed.push(job.cardId);
        }
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    if (failed.length > MAX_FAILED_CARDS) {
      throw new Error(
        `[${target.code}] 番号取得に失敗したカード数(${failed.length})が上限(${MAX_FAILED_CARDS})を超えました。` +
        `パッチを適用せず中断します。失敗ID: [${failed.join(", ")}]`
      );
    }

    // 差分抽出: 番号ごとに集約し、既存に無い番号だけを新規追加候補にする。
    // 既存の番号と重複する場合、ja名が一致すればスキップ（同一カードの重複掲載）、
    // 食い違えば異常として例外中断する（絶対にやってはいけないこと: 無検証上書き）
    const byLocal = new Map();
    for (const d of details) {
      const n = parseInt(d.local, 10);
      if (byLocal.has(n)) {
        const prev = byLocal.get(n);
        if (prev.jaName === d.jaName) continue;
        throw new Error(`[${target.code}] 新規取得データ内で番号 ${d.local} が重複しています。既存: ${prev.jaName} / 新規: ${d.jaName}`);
      }
      if (d.rarity === null) {
        throw new Error(`[${target.code}] cardID未知のレアリティコードを検出しました: ${JSON.stringify(d)}`);
      }
      if (existingByLocal.has(n)) {
        const prevJa = existingByLocal.get(n)[1];
        // 末尾の括弧注記（例:「博士の研究（ナナカマド博士）」）だけが違う場合は既知の
        // 表記ゆれとして許容する（scrape-official-images.mjsのmatchName()と同じ理由:
        // 公式DB側はキャラクター注記なしで1本化されていることが多い）。
        // 既存データの方が情報量が多いため上書きはせず、そのまま維持する
        if (prevJa !== d.jaName && stripParenSuffix(prevJa) !== stripParenSuffix(d.jaName)) {
          throw new Error(`[${target.code}] 番号 ${d.local} が既存データと食い違います。既存: ${prevJa} / 新規: ${d.jaName}`);
        }
        continue; // 既存と同一内容（または表記ゆれのみ）なので追加不要
      }
      byLocal.set(n, d);
    }

    const newLocals = [...byLocal.keys()].sort((a, b) => a - b);
    if (newLocals.length === 0) {
      console.log(`[${target.code}] 新規に追加できる番号はありませんでした（既存データと完全一致）。`);
      report.sets[target.code] = { added: 0, cardFailed: failed.length };
      continue;
    }

    // 追加後のk配列を構築（既存 + 新規、番号順にソート）。既存要素は一切変更しない
    const newEntries = newLocals.map((n) => {
      const d = byLocal.get(n);
      return [String(n).padStart(3, "0"), d.jaName, "", d.rarity];
    });
    const mergedK = [...existingSet.k, ...newEntries].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));

    // ofフィールドは変更しない（ユーザー指示）
    existingSet.k = mergedK;
    anyPatched = true;

    console.log(`[${target.code}] 新規追加: ${newEntries.length}枚（of=${existingSet.of}は変更なし、失敗${failed.length}件）`);

    // 新規追加分のみ画像取得
    const setTotal = computeSetTotal(mergedK);
    let imgDownloaded = 0, imgSkipped = 0, imgFailed = 0;
    let idx2 = 0;
    const workers2 = Array.from({ length: CONCURRENCY }, async () => {
      while (idx2 < newLocals.length) {
        const n = newLocals[idx2++];
        const d = byLocal.get(n);
        const localId = String(n).padStart(3, "0");
        const dest = path.join(
          OUT_DIR, existingSet.sr, target.code,
          buildFileName(d.jaName, target.code, localId, d.rarity, setTotal) + ".jpg"
        );
        if (await isUsableImage(dest)) { imgSkipped++; continue; }
        const buf = await downloadImage(d.cardThumbFile, dest);
        if (buf) { await writeFileAtomic(dest, buf); imgDownloaded++; }
        else imgFailed++;
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers2);

    console.log(`[${target.code}] 画像: 取得${imgDownloaded} スキップ${imgSkipped} 失敗${imgFailed}`);
    report.sets[target.code] = {
      added: newEntries.length, cardFailed: failed.length, cardFailedIds: failed,
      imgDownloaded, imgSkipped, imgFailed,
    };

    // 1セットごとにcardData.jsonへ書き込む
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[${target.code}] cardData.json を更新しました。\n`);
  }

  if (!anyPatched) {
    console.log("\nパッチ対象はありませんでした。");
  }
  console.log("詳細: scripts/patch-existing-sets-report.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
