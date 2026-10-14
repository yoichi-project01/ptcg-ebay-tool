#!/usr/bin/env node
// S8a-P-015 の日本語名を、カードに印刷されているとおり「サーナイトex δ-デルタ種」に直す（2026-10-14、レビューの C5）。
//   node scripts/fix-s8ap-015-ja.mjs [--apply]
// 根拠: 公式の画像（/assets/images/card_images/large/S8a-P/050767_P_SANAITOEX.jpg）のカード名の欄に「サーナイトex δ-デルタ種」と印刷されている。
// 公式サイトのカード名（details.php・一覧）は「サーナイトex」で δ が無い。英語名 Gardevoir ex δ（Bulbapedia）と合う。
// 旧裏〜PCG の δ の書き方（PCG6-050「サーナイトδ-デルタ種」など）にそろえた。画像のファイル名・画像の対応表・SHA-256 の一覧のパスも合わせる（中身は変えない）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "./filename-utils.mjs";
import { renameHashPaths } from "./image-hashes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const SET = "S8a-P", LOCAL = "015", FROM = "サーナイトex", TO = "サーナイトex δ-デルタ種";

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const set = data.find((s) => s.c === SET);
const row = set.k.find((r) => r[0] === LOCAL);
if (row[1] === TO) { console.log("直し済み"); process.exit(0); }
if (row[1] !== FROM) throw new Error(`想定と違う名前: ${row[1]}`);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const key = `${SET}/${parseInt(LOCAL, 10)}`;
const oldRel = index[key];
const ext = path.extname(oldRel);
const newRel = path.posix.join(path.posix.dirname(oldRel), buildFileName(TO, SET, LOCAL, row[3], computeSetTotal(set.k)) + ext);
console.log(`${SET}-${LOCAL}: ${FROM} → ${TO}\n  画像 ${oldRel} → ${newRel}`);
if (!process.argv.includes("--apply")) process.exit(0);
fs.renameSync(path.join(ROOT, "public", oldRel), path.join(ROOT, "public", newRel));
row[1] = TO;
index[key] = newRel;
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
fs.writeFileSync(INDEX, JSON.stringify(index));
renameHashPaths([{ key, to: newRel }], index); // SHA-256 を照合してからパスを書き換える
console.log("直した");
