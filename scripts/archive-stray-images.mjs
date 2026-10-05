// public/cards のうち、画像の対応表（src/imageIndex.json）に載っていない画像ファイル（古い名前のまま残ったもの）を調べ、
// 退避用フォルダ（public/cards の外、Git 管理外）へ元のフォルダ構成のまま移す。削除はしない。
//
//   node scripts/archive-stray-images.mjs                 一覧と件数を出すだけ（何も動かさない）。報告は ../ptcg-ebay-tool-stray-images/report/ に書く
//   node scripts/archive-stray-images.mjs --move          報告の一覧のファイルを退避用フォルダへ移す（--dest で変更可。既定は ../ptcg-ebay-tool-stray-images/<日付>）
//   node scripts/archive-stray-images.mjs --verify        imageIndex.json の全件にファイルがあるか・同じ card_id の画像が1つだけかを確かめる
//   node scripts/archive-stray-images.mjs --restore <退避先> [--only <弾,弾>] [--dry-run]
//                                                          退避先の moved.json の一覧を public/cards へ戻す（同名のファイルがあれば飛ばす）。
//                                                          戻した後は build-image-index.mjs --only <弾> で対応表に入れるか判断する（戻すだけでは対応表は変わらない）
//
// 「対応表のどのファイルとも中身が違うもの」は、ファイルの中身（SHA-1）が対応表のどのファイルとも一致しないもの（別のカードの画像の可能性がある）。
// 同じ card_id（弾フォルダ＋ファイル名の「_<弾コード>-」の後ろの型番）の判定は filename の規則（カイトリレーダーの scripts/lib/cardImageFiles.ts と同じ）。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUB = path.join(ROOT, "public");
const CARDS = path.join(PUB, "cards");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
// 報告は Git 管理外（リポジトリの外の退避用フォルダの report/）に書く
const ARCHIVE_BASE = path.join(ROOT, "..", "ptcg-ebay-tool-stray-images");
const OUT = path.join(ARCHIVE_BASE, "report");
const EXT = /\.(jpe?g|png|gif|webp)$/i;
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (abs) => path.relative(PUB, abs).split(path.sep).join("/"); // "cards/SV/SV8a/xxx.jpg"（imageIndex.json の値と同じ形）
const sha1 = (abs) => createHash("sha1").update(readFileSync(abs)).digest("hex");
/** 親フォルダ名を弾コードとし、ファイル名の最後の "_<弾コード>-" の後ろを型番とする（数字だけなら数値に） */
function keyOf(relPath) {
  const parts = relPath.split("/"), file = parts.at(-1), set = parts.at(-2);
  const i = file.lastIndexOf(`_${set}-`);
  if (i < 0) return null;
  const local = file.slice(i + set.length + 2).replace(EXT, "").split(/[／_]/)[0];
  if (!local) return null;
  return `${set}/${/^\d+$/.test(local) ? String(parseInt(local, 10)) : local}`;
}

function survey() {
  const index = JSON.parse(readFileSync(INDEX, "utf8"));
  const indexed = new Set(Object.values(index));
  const files = walk(CARDS).map(rel);
  const stray = files.filter((f) => !indexed.has(f));
  const missing = [...indexed].filter((f) => !existsSync(path.join(PUB, f)));
  // 中身の比較：対応表のファイルのハッシュ → パス
  const hashToIndexed = new Map();
  for (const f of indexed) if (existsSync(path.join(PUB, f))) { const h = sha1(path.join(PUB, f)); if (!hashToIndexed.has(h)) hashToIndexed.set(h, f); }
  const keyToIndexed = new Map(Object.entries(index).map(([k, v]) => [v, k]));
  // cardData.json にあるカード（card_id のキー → 日本語名）。対応表に無いキーの画像が、データにあるカードのものかを見る
  const cardData = JSON.parse(readFileSync(path.join(ROOT, "src", "cardData.json"), "utf8"));
  const inData = new Map();
  for (const set of cardData) for (const [num, ja] of set.k) inData.set(`${set.c}/${/^\d+$/.test(num) ? String(parseInt(num, 10)) : num}`, ja);
  const indexByKey = new Map(Object.entries(index));
  const rows = stray.map((f) => {
    const h = sha1(path.join(PUB, f));
    const same = hashToIndexed.get(h) ?? null;
    const key = keyOf(f);
    const set = f.split("/").at(-2);
    const indexedForKey = key ? indexByKey.get(key) ?? null : null;
    // 分類：same_content＝対応表のどれかと中身が同じ（重複）／old_number＝同じ card_id に対応表の別の中身の画像がある（番号の振り直し等で残った別のカードの画像の可能性）／
    //       unindexed_in_data＝対応表に同じ card_id が無く、cardData にそのカードがある（CLAUDE.md「画像なしの81行」：確かめていないので索引に入れていない）／
    //       unindexed_not_in_data＝対応表にも cardData にも無い（削除した行の画像）
    const category = same ? "same_content" : indexedForKey ? "old_number" : key && inData.has(key) ? "unindexed_in_data" : "unindexed_not_in_data";
    return { file: f, set, key, category, cardName: key ? inData.get(key) ?? null : null, sameAs: same, sameAsKey: same ? keyToIndexed.get(same) : null, indexedForKey, bytes: statSync(path.join(PUB, f)).size };
  });
  return { indexCount: Object.keys(index).length, fileCount: files.length, rows, missing };
}

function report() {
  const { indexCount, fileCount, rows, missing } = survey();
  mkdirSync(OUT, { recursive: true });
  const diff = rows.filter((r) => !r.sameAs);
  const bySet = (list) => { const m = new Map(); for (const r of list) m.set(r.set, (m.get(r.set) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const csv = (list) => ["file,set,card_key,category,card_name_in_data,same_content_as,same_content_key,indexed_file_for_same_key,bytes",
    ...list.map((r) => [r.file, r.set, r.key ?? "", r.category, r.cardName ?? "", r.sameAs ?? "", r.sameAsKey ?? "", r.indexedForKey ?? "", r.bytes].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
  writeFileSync(path.join(OUT, "stray-all.csv"), "﻿" + csv(rows));
  writeFileSync(path.join(OUT, "stray-different-content.csv"), "﻿" + csv(diff));
  writeFileSync(path.join(OUT, "stray.json"), JSON.stringify({ at: new Date().toISOString(), indexCount, fileCount, missing, rows }, null, 1));
  console.log(`画像ファイル ${fileCount}件・imageIndex.json ${indexCount}件・対応表にあるのにファイルが無い ${missing.length}件`);
  console.log(`対応表に載っていないファイル：${rows.length}件（うち対応表のどれかと中身が同じ ${rows.length - diff.length}件・どれとも中身が違う ${diff.length}件）`);
  const cats = ["same_content", "old_number", "unindexed_in_data", "unindexed_not_in_data"];
  console.log("分類：" + cats.map((c) => `${c} ${rows.filter((r) => r.category === c).length}`).join("・"));
  for (const c of cats.slice(1)) console.log(`  ${c} の弾ごと：` + bySet(rows.filter((r) => r.category === c)).map(([s, n]) => `${s} ${n}`).join("、"));
  console.log(`  同じ card_id の対応表の画像がある ${rows.filter((r) => r.indexedForKey).length}件・無い ${rows.filter((r) => !r.indexedForKey).length}件（規則に合わない名前 ${rows.filter((r) => !r.key).length}件）`);
  console.log("弾ごと（すべて）：" + bySet(rows).map(([s, n]) => `${s} ${n}`).join("、"));
  console.log("弾ごと（中身が違う）：" + bySet(diff).map(([s, n]) => `${s} ${n}`).join("、"));
  console.log(`一覧：${path.relative(ROOT, OUT)}/stray-all.csv・stray-different-content.csv・stray.json`);
}

function move() {
  const listFile = path.join(OUT, "stray.json");
  if (!existsSync(listFile)) { console.error("先に一覧を作ってください（node scripts/archive-stray-images.mjs）"); process.exit(1); }
  const { rows } = JSON.parse(readFileSync(listFile, "utf8"));
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.resolve(arg("--dest") ?? path.join(ROOT, "..", "ptcg-ebay-tool-stray-images", stamp));
  if (dest.startsWith(CARDS)) { console.error("退避先は public/cards の外にしてください"); process.exit(1); }
  let moved = 0; const skipped = [];
  for (const r of rows) {
    const from = path.join(PUB, r.file);
    if (!existsSync(from)) { skipped.push(r.file); continue; }
    const to = path.join(dest, r.file); // dest/cards/<シリーズ>/<弾>/<ファイル>（元のフォルダ構成のまま）
    mkdirSync(path.dirname(to), { recursive: true });
    if (existsSync(to)) { skipped.push(r.file); continue; }
    renameSync(from, to); moved++;
  }
  writeFileSync(path.join(dest, "moved.json"), JSON.stringify({ at: new Date().toISOString(), from: path.relative(ROOT, CARDS), moved, skipped, rows }, null, 1));
  console.log(`${moved}件を ${dest} に移しました（見つからない・移し先に同名があり飛ばした ${skipped.length}件）。一覧：${path.join(dest, "moved.json")}`);
}

function verify() {
  const index = JSON.parse(readFileSync(INDEX, "utf8"));
  const missing = Object.entries(index).filter(([, v]) => !existsSync(path.join(PUB, v)));
  const byKey = new Map();
  for (const f of walk(CARDS).map(rel)) { const k = keyOf(f); if (!k) continue; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(f); }
  const multi = [...byKey].filter(([, fs]) => fs.length > 1);
  const indexed = new Set(Object.values(index));
  const stray = walk(CARDS).map(rel).filter((f) => !indexed.has(f));
  console.log(`imageIndex.json ${Object.keys(index).length}件のうちファイルが無い ${missing.length}件`);
  console.log(`同じ card_id の画像が2つ以上：${multi.length}件${multi.length ? "（例 " + multi.slice(0, 5).map(([k, fs]) => `${k}: ${fs.length}枚`).join("、") + "）" : ""}`);
  console.log(`対応表に載っていないファイル：${stray.length}件`);
  if (missing.length) console.log("ファイルが無い例：" + missing.slice(0, 10).map(([k, v]) => `${k} → ${v}`).join("、"));
  process.exit(missing.length || multi.length || stray.length ? 1 : 0);
}

function restore() {
  const src = arg("--restore");
  if (!src || !existsSync(path.join(src, "moved.json"))) { console.error("--restore <退避先フォルダ>（moved.json のあるフォルダ）を指定してください"); process.exit(1); }
  const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
  const dry = process.argv.includes("--dry-run");
  const { rows } = JSON.parse(readFileSync(path.join(src, "moved.json"), "utf8"));
  let restored = 0; const skipped = [];
  for (const r of rows) {
    if (only && !only.has(r.set)) continue;
    const from = path.join(src, r.file), to = path.join(PUB, r.file);
    if (!existsSync(from) || existsSync(to)) { skipped.push(r.file); continue; }
    if (!dry) { mkdirSync(path.dirname(to), { recursive: true }); renameSync(from, to); }
    restored++;
  }
  console.log(`${dry ? "（試しに）" : ""}${restored}件を public/cards に戻しました（退避先に無い・戻し先に同名があり飛ばした ${skipped.length}件）`);
}

if (process.argv.includes("--move")) move();
else if (process.argv.includes("--restore")) restore();
else if (process.argv.includes("--verify")) verify();
else report();
