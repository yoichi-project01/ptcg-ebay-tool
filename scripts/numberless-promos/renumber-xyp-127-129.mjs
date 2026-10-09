#!/usr/bin/env node
// XY-P の番号の無いプロモとして追加した3枚を、カードに印刷された番号の型番に変える（2026-10-09）。
//   node scripts/numberless-promos/renumber-xyp-127-129.mjs [--apply]
//   XY-P-X31066 バシャーモEX → XY-P-127、XY-P-X31067 ケムッソ → XY-P-128、XY-P-X31068 ジラーチ → XY-P-129
// 根拠: 公式の画像（details.php の画像）に 127/XY-P・128/XY-P・129/XY-P と印刷されている（目で確認）。Bulbapedia「XY-P Promotional cards (TCG)」も
//   127〜129/XY-P で、配布の説明（レックウザメガバトルのメガパック・プロモーションカードパック 2015年5月・2016年11月）が公式の本文と一致。
//   details.php のページに番号が表示されないだけ（そのため番号の無いプロモとして扱っていた。XY-P の欠番 127〜129 はこの3枚）。
// 日本語名は番号付きのプロモと同じく details.php の名前だけにする（配布の説明の括弧注記は外す）。英語名はそのまま。
// 画像はファイル名と対応表のキーだけ変え、中身は変えない（SHA-256 が変わらないことを確かめる）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "../filename-utils.mjs";
import { loadHashes, saveHashes, sha256File } from "../image-hashes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const APPLY = process.argv.includes("--apply");
export const RENUMBER = [
  { from: "X31066", to: "127", cardId: 31066, ja: "バシャーモEX", printed: "127/XY-P" },
  { from: "X31067", to: "128", cardId: 31067, ja: "ケムッソ", printed: "128/XY-P" },
  { from: "X31068", to: "129", cardId: 31068, ja: "ジラーチ", printed: "129/XY-P" },
];
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const hashes = loadHashes();
const set = data.find((s) => s.c === "XY-P");
const total = computeSetTotal(set.k);
const progress = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "promo-progress", "XY-P.json"), "utf8"));
const rows = [];
for (const r of RENUMBER) {
  const k = set.k.find((x) => x[0] === r.from);
  if (!k) throw new Error(`行がありません: XY-P-${r.from}`);
  if (set.k.some((x) => x[0] === r.to)) throw new Error(`型番が既にあります: XY-P-${r.to}`);
  if (progress[r.cardId]?.jaName !== r.ja || progress[r.cardId]?.number !== null) throw new Error(`details.php の結果が想定と違います: ${r.cardId}`);
  if (!k[1].startsWith(r.ja + "（")) throw new Error(`日本語名が想定と違います: ${k[1]}`);
  const oldKey = `XY-P/${r.from}`, newKey = `XY-P/${parseInt(r.to, 10)}`;
  const oldRel = index[oldKey];
  const ext = path.extname(oldRel);
  const newRel = `${oldRel.slice(0, oldRel.lastIndexOf("/") + 1)}${buildFileName(r.ja, "XY-P", r.to, k[3], total)}${ext}`;
  const h = hashes.get(oldKey);
  if (!h || sha256File(oldRel).sha256 !== h.sha256) throw new Error(`画像の中身が一覧と違います: ${oldKey}`);
  if (newKey in index || fs.existsSync(path.join(ROOT, "public", newRel))) throw new Error(`変更先が既にあります: ${newKey} ${newRel}`);
  rows.push({ before: `XY-P-${r.from}`, after: `XY-P-${r.to}`, cardId: r.cardId, jaBefore: k[1], jaAfter: r.ja, en: k[2], printed: r.printed, imageBefore: oldRel, imageAfter: newRel, sha256: h.sha256 });
  if (!APPLY) continue;
  k[0] = r.to; k[1] = r.ja;
  fs.renameSync(path.join(ROOT, "public", oldRel), path.join(ROOT, "public", newRel));
  if (sha256File(newRel).sha256 !== h.sha256) throw new Error(`名前を変えた後の画像の中身が違います: ${newRel}`);
  delete index[oldKey]; index[newKey] = newRel;
  hashes.delete(oldKey); hashes.set(newKey, { ...h, key: newKey, path: newRel });
}
if (APPLY) {
  // 番号付きの行は番号順、型番 X の行はその後ろ（追加した順）に並べる
  const num = set.k.filter((x) => /^\d+$/.test(x[0])).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  set.k = [...num, ...set.k.filter((x) => !/^\d+$/.test(x[0]))];
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  saveHashes(hashes, index);
  fs.writeFileSync(path.join(__dirname, "..", "promo-progress", "XY-P-renumbered-2026-10-09.json"), JSON.stringify({ note: "番号の無いプロモとして追加した3枚を、カードに印刷された番号の型番に変えた", rows }, null, 1) + "\n");
  fs.writeFileSync(path.join(__dirname, "..", "promo-progress", "XY-P-renumbered-card-ids-2026-10-09.tsv"), "before\tafter\n" + rows.map((r) => `${r.before}\t${r.after}`).join("\n") + "\n");
}
console.log(JSON.stringify(rows.map((r) => `${r.before} → ${r.after} ${r.jaAfter} / ${r.en} : ${r.imageAfter}`), null, 1));
