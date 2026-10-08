// 旧裏・neo・e・PCG の日本語名（k[1]）を、pcg-search.com とポケモンWiki の2つで同じ番号の名前が一致した行だけ直す（2026-10-08）。
//   node scripts/fix-old-ja-names.mjs --set PCG1            確認だけ（scripts/old-ja-check/fix-{弾}.json に書く）
//   node scripts/fix-old-ja-names.mjs --set PCG1 --apply    cardData.json・画像のファイル名・imageIndex.json・画像の SHA-256 の一覧に反映
// 情報源: scripts/old-ja-check/pcg-search-titles.json（カードページの title。番号「(075/082)」付き）、
//   pokemonwiki-names.json（PCG1〜9・E2〜E5 の番号付き一覧）、pokemonwiki-neo{1-4}.txt（neo の番号なしの一覧。並び順を番号とみなす。
//   並び順が pcg-search の番号順と一致することは調査で確認済み: scripts/old-ja-check/README.md）。
// 書く名前は pcg-search の名前そのまま。2つの情報源の比較では NFKC・空白・角かっこだけ同じとみなす（アンノーン[I] と アンノーンI）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName } from "./filename-utils.mjs";
import { renameHashPaths } from "./image-hashes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const CHK = path.join(__dirname, "old-ja-check");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const APPLY = process.argv.includes("--apply");
const ALLOWED = /^(neo[1-4]|E[1-5]|PCG[1-9]|VS1|web1)$/;
if (!ALLOWED.test(SET)) throw new Error(`2つ目の情報源が無い弾です: ${SET}`);

const pcg = JSON.parse(fs.readFileSync(path.join(CHK, "pcg-search-titles.json"), "utf8"));
const pwNum = JSON.parse(fs.readFileSync(path.join(CHK, "pokemonwiki-names.json"), "utf8"));
const pwName = (num) => {
  if (pwNum[SET]) return pwNum[SET].rows[num] ?? null;
  const s = fs.readFileSync(path.join(CHK, `pokemonwiki-${SET}.txt`), "utf8").replace(/\r/g, "");
  const names = [...s.matchAll(/\|-\n\|[^\n]*\n\|[^\n]*\n\|\s*([^\n]*)/g)].map((m) => {
    const x = m[1]; const a = x.match(/\[\[([^\]|]+)\|([^\]]+)\]\]/); if (a) return a[2].trim();
    const b = x.match(/\[\[([^\]]+)\]\]/); return (b ? b[1] : x).trim();
  });
  // neo2: ポケモンWiki は遺跡の石版2種（pcg-search の 054・055、画像も別）を1行にまとめているので、055 以降は1つ前の行を見る（2026-10-08）
  const n = parseInt(num, 10);
  if (SET === "neo2" && n >= 55) return names[n - 2] ?? null;
  return names[n - 1] ?? null;
};
const same = (a, b) => (a || "").normalize("NFKC").replace(/[\s\[\]]/g, "") === (b || "").normalize("NFKC").replace(/[\s\[\]]/g, "");
// ファイル名に使う形（filename-utils の sanitize と同じ）: buildFileName の名前部分だけを取り出す
const fileNamePart = (ja) => buildFileName(ja, "ZZ", "1", "").replace(/_ZZ-1$/, "");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
const rows = [], hashRenames = [];
for (const k of set.k) {
  if (!/^\d+$/.test(k[0])) continue;
  const p = pcg[`${SET}-${k[0]}`];
  const m = p?.title?.match(/^(.*?) \| .*?(?:\((\d+)\/(\d+)\))?$/);
  const pname = m?.[1]?.trim() ?? null, pnum = m?.[2] ?? null;
  const wname = pwName(k[0]);
  const r = { id: `${SET}-${k[0]}`, before: k[1], pcgSearch: pname, pokemonWiki: wname, after: "", status: "", image: "" };
  if (!pname) { r.status = "pcg-search に無い"; rows.push(r); continue; }
  if (pnum && pnum !== k[0].padStart(3, "0")) { r.status = `pcg-search の番号が違う（${pnum}）`; rows.push(r); continue; }
  if (k[1] === pname) continue; // すでに同じ
  if (!wname || !same(pname, wname)) { r.status = "2つの情報源が一致しない"; rows.push(r); continue; }
  r.after = pname; r.status = "直す";
  rows.push(r);
  if (!APPLY) continue;
  k[1] = pname;
  const key = `${SET}/${parseInt(k[0], 10)}`;
  const rel = index[key];
  if (rel) {
    const dir = rel.slice(0, rel.lastIndexOf("/") + 1), file = rel.slice(rel.lastIndexOf("/") + 1);
    const marker = `_${SET}-`, at = file.lastIndexOf(marker);
    if (at < 0) throw new Error(`画像のファイル名の形が想定と違います: ${rel}`);
    const newRel = dir + fileNamePart(pname) + file.slice(at);
    if (newRel !== rel) {
      if (fs.existsSync(path.join(ROOT, "public", newRel))) throw new Error(`変更先のファイルが既にあります: ${newRel}`);
      fs.renameSync(path.join(ROOT, "public", rel), path.join(ROOT, "public", newRel));
      index[key] = newRel; hashRenames.push({ key, to: newRel }); r.image = `${rel} → ${newRel}`;
    }
  }
}
const fixed = rows.filter((r) => r.status === "直す"), kept = rows.filter((r) => r.status !== "直す");
fs.writeFileSync(path.join(CHK, `fix-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, fixed: fixed.length, kept: kept.length, rows }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  renameHashPaths(hashRenames, index);
  fs.writeFileSync(path.join(CHK, `fix-${SET}-changed-card-ids.txt`), fixed.map((r) => r.id).join("\n") + (fixed.length ? "\n" : ""));
}
const reasons = {}; for (const r of kept) reasons[r.status] = (reasons[r.status] || 0) + 1;
console.log(JSON.stringify({ set: SET, fixed: fixed.length, imagesRenamed: hashRenames.length, kept: kept.length, reasons }));
