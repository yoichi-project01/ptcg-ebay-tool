#!/usr/bin/env node
/**
 * 既存セットの破損データ全件取り直しスクリプト
 *
 * 背景: cardData.json の一部セット（S4a/SI/S8b/S11a/SV6a/S10D/S5a/S6H/S7D）で、
 * 元のTCGdexベースのデータ生成時にトレーナーズ・エネルギーカードの区間が
 * 存在しないポケモン名で埋められる破損が見つかった（詳細はCLAUDE.md参照）。
 * official-card-cache.json / details.php との直接照合（"内部の名前重複パターン"
 * ではなく、外部の正解データとの突き合わせ）で全セットの1〜最大番号を検証済みの
 * truthデータ（scratchpad内、事前にfetchCardDetail経由で取得・保存したもの）を
 * 読み込み、cardData.json の該当セットの k 配列を丸ごと置き換える。
 *
 * 「部分的に正しいデータは、どこが正しいか分からないぶん危険」というユーザー方針により、
 * 破損範囲だけを部分修正するのではなく、検証済みtruthで1〜最大番号を丸ごと置き換える
 * （of は変更しない。totalsSeenInTruthが既存ofと一致することを事前に確認済み）。
 *
 * 使い方:
 *   node scripts/rebuild-corrupted-sets.mjs
 *
 * 前提: TRUTH_DIR 配下に {code}_truth.json（{ details: [...], failed: [...] }）が
 * 存在すること（scripts/full-verify-existing-sets.mjs 等で事前に生成）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sleep, downloadImage, validateAndBuildK } from "./scrape-missing-sets.mjs";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const TRUTH_DIR = "C:/Users/setoy/AppData/Local/Temp/claude/d--product-ptcg-ebay-tool/adea1581-0218-49d9-8c00-9fb9d1883ace/scratchpad";
const REPORT_PATH = path.join(__dirname, "rebuild-corrupted-sets-report.json");

const CONCURRENCY = 3;
const DELAY_MS = 800;

// SM2p は事前調査で破損なしと確認済みのため対象外（詳細はCLAUDE.md参照）
const TARGET_CODES = ["S4a", "SI", "S8b", "S11a", "SV6a", "S10D", "S5a", "S6H", "S7D"];

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const report = { generatedAt: new Date().toISOString(), sets: {} };

  for (const code of TARGET_CODES) {
    const existingSet = cardData.find((s) => s.c === code);
    if (!existingSet) {
      throw new Error(`[${code}] cardData.json に見つかりません（新規セット作成はこのスクリプトの対象外）。`);
    }

    const truthPath = path.join(TRUTH_DIR, `${code}_truth.json`);
    const truth = JSON.parse(await fs.readFile(truthPath, "utf-8"));

    // 検証済みtruthからk配列を構築（重複・欠番・レアリティ未知は例外を投げる。
    // scrape-missing-sets.mjsのvalidateAndBuildKをそのまま再利用）
    const { k: newK, total: truthTotal, byLocal } = validateAndBuildK(truth.details, code);

    if (truthTotal !== existingSet.of) {
      throw new Error(
        `[${code}] truthのtotal(${truthTotal})が既存のof(${existingSet.of})と一致しません。` +
        `安全のため中断します（ofは変更しない方針のため、原因を個別に確認してください）。`
      );
    }

    // 置き換え前の状態を記録（画像クリーンアップ用に「置き換え後は存在しなくなる
    // ファイル名」を特定するため、旧kから旧ファイル名一覧を作る）
    const oldK = existingSet.k;
    const oldSetTotal = computeSetTotal(oldK);
    const oldFileNames = new Set(
      oldK.map((kk) => buildFileName(kk[1], code, kk[0], kk[3] || "", oldSetTotal))
    );

    existingSet.k = newK;
    // of は変更しない（既存のまま）

    const removedCount = oldK.length;
    const addedCount = newK.length;

    console.log(`[${code}] k配列を置き換え: 旧${removedCount}枚 -> 新${addedCount}枚（of=${existingSet.of}は無変更）`);

    // 画像: 新しいk配列に基づく期待ファイル名一覧を作り、既存の実用画像が無ければダウンロード
    const newSetTotal = computeSetTotal(newK);
    const newFileNames = new Set();
    const sortedLocals = [...byLocal.keys()].sort((a, b) => a - b);

    let imgDownloaded = 0, imgSkipped = 0, imgFailed = 0;
    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < sortedLocals.length) {
        const n = sortedLocals[idx++];
        const d = byLocal.get(n);
        const localId = String(n).padStart(3, "0");
        const fname = buildFileName(d.jaName, code, localId, d.rarity, newSetTotal);
        newFileNames.add(fname);
        const dest = path.join(OUT_DIR, existingSet.sr, code, fname + ".jpg");
        if (await isUsableImage(dest)) { imgSkipped++; continue; }
        if (!d.cardThumbFile) { imgFailed++; continue; }
        const buf = await downloadImage(d.cardThumbFile, dest);
        if (buf) { await writeFileAtomic(dest, buf); imgDownloaded++; }
        else imgFailed++;
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    // 孤児画像の削除: 旧ファイル名のうち、新ファイル名一覧に含まれないもの
    // （名前・レアリティが変わって不要になった旧画像）を削除する。
    // 「既存エントリを削除してから追加する」というユーザー指示の画像版
    const dir = path.join(OUT_DIR, existingSet.sr, code);
    let orphansDeleted = 0;
    const orphanNames = [...oldFileNames].filter((f) => !newFileNames.has(f));
    for (const fname of orphanNames) {
      for (const ext of [".jpg", ".png", ".webp"]) {
        const p = path.join(dir, fname + ext);
        try {
          await fs.unlink(p);
          orphansDeleted++;
        } catch {}
      }
    }

    console.log(`[${code}] 画像: 取得${imgDownloaded} スキップ${imgSkipped} 失敗${imgFailed} / 孤児削除${orphansDeleted}`);

    report.sets[code] = {
      oldCount: removedCount, newCount: addedCount, of: existingSet.of,
      imgDownloaded, imgSkipped, imgFailed, orphansDeleted,
    };

    // 1セットごとに書き込み（クラッシュセーフ、既存スクリプトと同じ運用）
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[${code}] cardData.json を更新しました。\n`);
  }

  console.log("完了。詳細: scripts/rebuild-corrupted-sets-report.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
