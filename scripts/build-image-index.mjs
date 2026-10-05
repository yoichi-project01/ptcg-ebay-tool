#!/usr/bin/env node
/**
 * ダウンロード済み画像をスキャンして src/imageIndex.json を生成します。
 * アプリはこのインデックスを見て「画像があるカードだけ」確実に表示します
 * （存在しないURLを叩いて失敗する、という無駄がなくなります）。
 *
 * 使い方: node scripts/build-image-index.mjs
 * ※ npm run images（scrape-all.mjs）を実行したあとに走らせてください。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLocalId, MIN_IMAGE_BYTES } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "public", "cards");
const OUT = path.join(ROOT, "src", "imageIndex.json");

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    // .webp（TCGdex英語版）は除外。日本語カードの出品に英語アートワークを使わないため（CLAUDE.md参照）。
    // .gif は公式サイトが旧世代プロモ（DP-P/DPt-P/L-P 等）を GIF で配信しているため、元データのまま扱う
    else if (/\.(jpg|png|gif)$/.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  // --only S8a,S9 … 指定した弾のフォルダだけを読み直し、ほかの弾は既存のインデックスのまま残す。
  // public/cards には古い名前のファイルも残っているため（画像の復元でコピーした元ファイル等）、
  // 全体を作り直すと古いファイルを拾ってしまう。1つの弾を作り直した後などはこちらを使うこと
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null);
  const onlySets = onlyArg ? new Set(onlyArg.split(",").filter(Boolean)) : null;
  let prevIndex = {};
  try { prevIndex = JSON.parse(await fs.readFile(OUT, "utf-8")); } catch {}
  const files = await walk(CARDS_DIR);
  // キー "SET/local" -> 相対パス
  const index = {};
  if (onlySets) for (const [k, v] of Object.entries(prevIndex)) if (!onlySets.has(k.split("/")[0])) index[k] = v;
  for (const f of files) {
    if (onlySets && !onlySets.has(path.relative(CARDS_DIR, f).split(path.sep)[1])) continue;
    // .part（ダウンロード中の一時ファイル）や極小ファイル（壊れたダウンロード）は無視
    if (f.endsWith(".part")) continue;
    const stat = await fs.stat(f);
    if (stat.size < MIN_IMAGE_BYTES) continue;

    const rel = path.relative(path.join(ROOT, "public"), f).split(path.sep).join("/");
    const parts = rel.split("/"); // cards, SERIE, SET, local.ext
    const set = parts[2];
    const ext = path.extname(f);
    const stem = parts[3].replace(/\.(jpg|png|gif)$/, "");
    const local = extractLocalId(stem, set);
    const n = parseInt(local, 10);
    const key = `${set}/${isNaN(n) ? local : n}`;
    // 優先度: .jpg（公式日本語）> .png（pcg-search日本語）
    if (!index[key] || ext === ".jpg") {
      index[key] = rel;
    }
  }
  // public/cards は .gitignore 対象で PC ごとに中身が違う。画像を同期していない PC で実行すると
  // 大量のキーが消えたインデックスができてしまう（2026-09-30 に実際に発生）ため、件数が大きく減るときは止める
  if (!process.argv.includes("--force")) {
    const prevCount = Object.keys(prevIndex).length;
    const newCount = Object.keys(index).length;
    if (prevCount && newCount < prevCount * 0.98) {
      console.error(`中断: 画像インデックスが ${prevCount} 件 → ${newCount} 件に減ります。public/cards が他の PC と同期されているか確認してください（意図した削除なら --force）。`);
      process.exit(1);
    }
    // 全体の作り直しで既存キーの指す先が大量に変わる場合も止める（古い名前のファイルを拾っている可能性。2026-10-03 に発生）
    if (!onlySets) {
      const changed = Object.keys(prevIndex).filter((k) => index[k] && index[k] !== prevIndex[k]);
      if (prevCount && changed.length > prevCount * 0.02) {
        const bySet = {};
        for (const k of changed) bySet[k.split("/")[0]] = (bySet[k.split("/")[0]] || 0) + 1;
        console.error(`中断: 既存の ${changed.length} 件で画像の指す先が変わります（${Object.entries(bySet).slice(0, 10).map(([s, n]) => `${s}:${n}`).join(" ")} …）。古い名前のファイルを拾っている可能性があります。1つの弾だけ更新するなら --only <弾>（意図した変更なら --force）。`);
        process.exit(1);
      }
    }
  }
  // --only のときは既存のキーの並びを保つ（差分を対象の弾の行だけにする。新しいキーは後ろに足す）
  let out = index;
  if (onlySets) {
    out = {};
    for (const k of Object.keys(prevIndex)) if (k in index) out[k] = index[k];
    for (const k of Object.keys(index)) if (!(k in out)) out[k] = index[k];
  }
  await fs.writeFile(OUT, JSON.stringify(out), "utf-8");
  const jpgCount = Object.values(index).filter(v => v.endsWith(".jpg")).length;
  const pngCount = Object.values(index).filter(v => v.endsWith(".png")).length;
  const gifCount = Object.values(index).filter(v => v.endsWith(".gif")).length;
  console.log(`画像インデックス生成: ${Object.keys(index).length} 件 (jpg=${jpgCount}, png=${pngCount}, gif=${gifCount}) -> src/imageIndex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
