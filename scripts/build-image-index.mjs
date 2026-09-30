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
  const files = await walk(CARDS_DIR);
  // キー "SET/local" -> 相対パス
  const index = {};
  for (const f of files) {
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
    let prevCount = 0;
    try { prevCount = Object.keys(JSON.parse(await fs.readFile(OUT, "utf-8"))).length; } catch {}
    const newCount = Object.keys(index).length;
    if (prevCount && newCount < prevCount * 0.98) {
      console.error(`中断: 画像インデックスが ${prevCount} 件 → ${newCount} 件に減ります。public/cards が他の PC と同期されているか確認してください（意図した削除なら --force）。`);
      process.exit(1);
    }
  }
  await fs.writeFile(OUT, JSON.stringify(index), "utf-8");
  const jpgCount = Object.values(index).filter(v => v.endsWith(".jpg")).length;
  const pngCount = Object.values(index).filter(v => v.endsWith(".png")).length;
  const gifCount = Object.values(index).filter(v => v.endsWith(".gif")).length;
  console.log(`画像インデックス生成: ${Object.keys(index).length} 件 (jpg=${jpgCount}, png=${pngCount}, gif=${gifCount}) -> src/imageIndex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
