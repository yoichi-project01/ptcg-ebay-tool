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
    // .webp（TCGdex英語版）は除外。日本語カードの出品に英語アートワークを使わないため（CLAUDE.md参照）
    else if (e.name.endsWith(".jpg") || e.name.endsWith(".png")) out.push(p);
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
    const ext = f.endsWith(".jpg") ? ".jpg" : ".png";
    const stem = parts[3].replace(/\.(jpg|png)$/, "");
    const local = extractLocalId(stem, set);
    const n = parseInt(local, 10);
    const key = `${set}/${isNaN(n) ? local : n}`;
    // 優先度: .jpg（公式日本語）> .png（pcg-search日本語）
    if (!index[key] || ext === ".jpg") {
      index[key] = rel;
    }
  }
  await fs.writeFile(OUT, JSON.stringify(index), "utf-8");
  const jpgCount = Object.values(index).filter(v => v.endsWith(".jpg")).length;
  const pngCount = Object.values(index).filter(v => v.endsWith(".png")).length;
  console.log(`画像インデックス生成: ${Object.keys(index).length} 件 (jpg=${jpgCount}, png=${pngCount}) -> src/imageIndex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
