#!/usr/bin/env node
/**
 * ダウンロード済み画像をスキャンして src/imageIndex.json を生成します。
 * アプリはこのインデックスを見て「画像があるカードだけ」確実に表示します
 * （存在しないURLを叩いて失敗する、という無駄がなくなります）。
 *
 * 使い方: node scripts/build-image-index.mjs
 * ※ scrape-images.mjs を実行したあとに走らせてください。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLocalId } from "./filename-utils.mjs";

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
    else if (e.name.endsWith(".webp") || e.name.endsWith(".jpg") || e.name.endsWith(".png")) out.push(p);
  }
  return out;
}

async function main() {
  const files = await walk(CARDS_DIR);
  // キー "SET/local" -> 相対パス
  // .jpg（公式サイト）と .webp（TCGdex）が両方ある場合は .jpg を優先
  const index = {};
  for (const f of files) {
    const rel = path.relative(path.join(ROOT, "public"), f).split(path.sep).join("/");
    const parts = rel.split("/"); // cards, SERIE, SET, local.ext
    const set = parts[2];
    const ext = f.endsWith(".jpg") ? ".jpg" : f.endsWith(".png") ? ".png" : ".webp";
    const stem = parts[3].replace(/\.(webp|jpg|png)$/, "");
    const local = extractLocalId(stem, set);
    const key = `${set}/${local}`;
    // 優先度: .jpg（公式日本語）> .png（pcg-search日本語）> .webp（TCGdex英語）
    if (!index[key] || ext === ".jpg" || (ext === ".png" && !index[key].endsWith(".jpg"))) {
      index[key] = rel;
    }
  }
  await fs.writeFile(OUT, JSON.stringify(index), "utf-8");
  const jpgCount  = Object.values(index).filter(v => v.endsWith(".jpg")).length;
  const pngCount  = Object.values(index).filter(v => v.endsWith(".png")).length;
  const webpCount = Object.values(index).filter(v => v.endsWith(".webp")).length;
  console.log(`画像インデックス生成: ${Object.keys(index).length} 件 (jpg=${jpgCount}, png=${pngCount}, webp=${webpCount}) -> src/imageIndex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
