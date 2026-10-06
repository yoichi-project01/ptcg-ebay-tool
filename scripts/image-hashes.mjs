#!/usr/bin/env node
/**
 * public/cards の画像の SHA-256 の一覧（scripts/image-hashes.tsv）を作り、今のファイルと照合する（2026-10-06）。
 * 保存媒体やコピーでのビット化け（2026-10-06 に PMCG1-006・E4-087 で1ビットの反転を発見）を見つけるため。
 * JPG は中身にチェックサムを持たないので、画素が読めても化けは分からない。この一覧で検出する。
 *
 *   node scripts/image-hashes.mjs --verify              一覧と今のファイルを比べる（中身が変わった・ファイルが無い・一覧に無いキーを報告。あれば終了コード 1）
 *   node scripts/image-hashes.mjs --build [--force]     一覧を作り直す（既にあるときは --force。今のファイルが正しいと確かめたときだけ使う）
 *   node scripts/image-hashes.mjs --update --set A,B    画像を取り直した弾の行を計算し直す（--keys SV2a/198,PMCG1/6 でキー単位も可）
 *
 * 列: card_id（cardData の弾-番号。行が無いキーは空）・key（画像の対応表のキー）・path・sha256・bytes。
 * 照合はキーごとに、画像の対応表（src/imageIndex.json）が今指しているファイルで行う（ファイル名の変更だけなら中身が同じなので一致する）。
 *
 * 一覧の更新は build-image-index.mjs（--only の弾はすべて計算し直し、全体の作り直しは新しいキー・パスが変わったキーだけ）と、
 * ファイル名だけを変えるスクリプト（fill-rarity-*.mjs、renameHashPaths）から自動で行う。
 * 全体の作り直しで既存のキーを計算し直さないのは、化けたファイルの値で一覧を上書きしないため。
 * 同じパスのまま画像を置き換えたとき（pcg-search から取り直した等）は --update --set で反映する。
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const HASHES_PATH = path.join(__dirname, "image-hashes.tsv");
const INDEX_PATH = path.join(ROOT, "src", "imageIndex.json");
const DATA_PATH = path.join(ROOT, "src", "cardData.json");
const HEADER = ["card_id", "key", "path", "sha256", "bytes"];

export function sha256File(rel) {
  const buf = fs.readFileSync(path.join(ROOT, "public", rel));
  return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

export function loadHashes() {
  const m = new Map();
  if (!fs.existsSync(HASHES_PATH)) return null;
  const lines = fs.readFileSync(HASHES_PATH, "utf8").split(/\r?\n/).filter(Boolean);
  for (const l of lines.slice(1)) {
    const [card_id, key, p, sha256, bytes] = l.split("\t");
    m.set(key, { card_id, key, path: p, sha256, bytes: Number(bytes) });
  }
  return m;
}

function cardIdOf() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const map = new Map();
  for (const s of data) for (const r of s.k) map.set(`${s.c}/${/^\d+$/.test(r[0]) ? parseInt(r[0], 10) : r[0]}`, `${s.c}-${r[0]}`);
  return map;
}

// 一覧を書き出す。並びは画像の対応表のキーの順（差分を変わった行だけにする）
export function saveHashes(hashes, index) {
  const ids = cardIdOf();
  const rows = [HEADER.join("\t")];
  for (const key of Object.keys(index)) {
    const h = hashes.get(key);
    if (!h) continue;
    rows.push([ids.get(key) ?? "", key, h.path, h.sha256, h.bytes].join("\t"));
  }
  fs.writeFileSync(HASHES_PATH, rows.join("\n") + "\n");
}

/**
 * 画像の対応表を書き換えた後に一覧を合わせる（build-image-index.mjs から呼ぶ）。
 * rehashSets の弾は全キーを計算し直す。それ以外は、新しいキーとパスが変わったキーだけ計算し、対応表から消えたキーは一覧からも消す。
 */
export function syncHashesWithIndex(index, { rehashSets = null } = {}) {
  const hashes = loadHashes();
  if (!hashes) return { skipped: "一覧がまだ無い（node scripts/image-hashes.mjs --build で作る）" };
  let added = 0, rehashed = 0, removed = 0;
  for (const key of [...hashes.keys()]) if (!(key in index)) { hashes.delete(key); removed++; }
  for (const [key, rel] of Object.entries(index)) {
    const h = hashes.get(key);
    const all = rehashSets && rehashSets.has(key.split("/")[0]);
    if (h && h.path === rel && !all) continue;
    const { sha256, bytes } = sha256File(rel);
    if (h) rehashed++; else added++;
    hashes.set(key, { key, path: rel, sha256, bytes });
  }
  saveHashes(hashes, index);
  return { added, rehashed, removed };
}

/**
 * ファイル名だけを変えたとき（レアリティ付きの名前への変更など）に一覧のパスを書き換える。中身は変わらないはずなので、
 * SHA-256 は計算し直さずに照合し、違えば例外にする（名前の変更の前から化けていたファイルを一覧に入れないため）。
 */
export function renameHashPaths(renamed, index) {
  const hashes = loadHashes();
  if (!hashes) return;
  for (const { key, to } of renamed) {
    const h = hashes.get(key);
    if (!h) continue;
    const { sha256 } = sha256File(to);
    if (sha256 !== h.sha256) throw new Error(`画像の中身が一覧と違います（名前の変更の前から変わっていた可能性）: ${key} ${to}`);
    h.path = to;
  }
  saveHashes(hashes, index);
}

function verify() {
  const hashes = loadHashes();
  if (!hashes) throw new Error("一覧がありません。先に --build");
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const changed = [], missing = [], unlisted = [], moved = [], gone = [];
  for (const [key, rel] of Object.entries(index)) {
    const h = hashes.get(key);
    if (!h) { unlisted.push(`${key}\t${rel}`); continue; }
    if (!fs.existsSync(path.join(ROOT, "public", rel))) { missing.push(`${key}\t${rel}`); continue; }
    const { sha256, bytes } = sha256File(rel);
    if (sha256 !== h.sha256) changed.push(`${h.card_id || key}\t${rel}\t一覧 ${h.sha256.slice(0, 12)}… ${h.bytes}B → 今 ${sha256.slice(0, 12)}… ${bytes}B`);
    else if (h.path !== rel) moved.push(`${key}\t${h.path} → ${rel}`);
  }
  for (const key of hashes.keys()) if (!(key in index)) gone.push(key);
  const show = (label, a) => { console.log(`${label}: ${a.length}件`); for (const x of a.slice(0, 50)) console.log("  " + x); if (a.length > 50) console.log(`  …ほか ${a.length - 50}件`); };
  console.log(`照合 ${Object.keys(index).length}件`);
  show("中身が変わった", changed);
  show("ファイルが無い", missing);
  show("一覧に無いキー", unlisted);
  show("一覧にあるが画像の対応表に無いキー", gone);
  if (moved.length) show("パスだけ変わった（中身は同じ）", moved);
  if (changed.length || missing.length) process.exit(1);
}

function build(force) {
  if (fs.existsSync(HASHES_PATH) && !force) throw new Error("一覧が既にあります。作り直すなら --force（今のファイルが正しいと確かめたときだけ）");
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const hashes = new Map();
  for (const [key, rel] of Object.entries(index)) hashes.set(key, { key, path: rel, ...sha256File(rel) });
  saveHashes(hashes, index);
  console.log(`一覧を作成: ${hashes.size}件 -> ${path.relative(ROOT, HASHES_PATH)}`);
}

function update(args) {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const hashes = loadHashes();
  if (!hashes) throw new Error("一覧がありません。先に --build");
  const arg = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const sets = arg("--set") ? new Set(arg("--set").split(",")) : null;
  const keys = arg("--keys") ? new Set(arg("--keys").split(",")) : null;
  if (!sets && !keys) throw new Error("--set か --keys を指定してください");
  const changed = [];
  for (const [key, rel] of Object.entries(index)) {
    if (!(sets?.has(key.split("/")[0]) || keys?.has(key))) continue;
    const h = hashes.get(key);
    const now = { key, path: rel, ...sha256File(rel) };
    if (!h || h.sha256 !== now.sha256 || h.path !== rel) changed.push(`${key}\t${rel}${h && h.sha256 !== now.sha256 ? "\t中身が変わった" : ""}`);
    hashes.set(key, now);
  }
  saveHashes(hashes, index);
  console.log(`一覧を更新: ${changed.length}件`);
  for (const x of changed) console.log("  " + x);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--verify")) verify();
  else if (args.includes("--build")) build(args.includes("--force"));
  else if (args.includes("--update")) update(args);
  else console.log("使い方: --verify | --build [--force] | --update --set A,B | --update --keys K1,K2");
}
