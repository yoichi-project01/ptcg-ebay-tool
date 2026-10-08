// PMCG5・PMCG6 の日本語名（k[1]）を、画像の中身で pcg-search.com のカードと結び付けて直す（2026-10-08）。
//   node scripts/fix-pmcg-ja-names.mjs --set PMCG5 [--apply]
// PMCG はカードに番号が無く、cardData の並びは pcg-search の並びと違うため、番号では対応づけられない。そこで:
//   1. 行の画像（image-hashes.tsv の SHA-256）が pcg-search のカードの画像（scripts/old-ja-check/pmcg-site.json、fetch-pmcg.mjs で取得）と
//      バイト単位で同じ → その行はそのカード（pcg-search の名前）と結び付ける。一致するカードがちょうど1枚のときだけ。
//   2. 結び付いたカードの名前が、今の名前と同じポケモン・トレーナーズ（持ち主の「〜の」を除いた残りが一致）であること。
//      画像が別のカードになっている行（PMCG1・PMCG4 の多く、PMCG5 のトレーナーズの一部）はここで外れる。
//   3. ポケモンWiki の一覧（scripts/old-ja-check/pokemonwiki-pmcg.json、LV.xx を除く）にその名前があること。
//      PMCG5・PMCG6 の cardData はポケモンWiki と同じ並びなので、同じ位置の名前と一致すれば通す。位置が違うときは、
//      画像を他の行と共有していない行に限り、一覧のどこかにあれば通す（画像を共有する行は、同じ名前の別のカードを取り違えるおそれがあるため位置の一致が必要）。
// 書く名前は pcg-search の名前。画像のファイル名・imageIndex.json・image-hashes.tsv のパスも合わせる。根拠は scripts/old-ja-check/fix-{弾}.json。
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
if (!process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!/^PMCG[56]$/.test(SET)) throw new Error(`対象外の弾です: ${SET}`);
const APPLY = process.argv.includes("--apply");

const site = JSON.parse(fs.readFileSync(path.join(CHK, "pmcg-site.json"), "utf8"));
const wiki = JSON.parse(fs.readFileSync(path.join(CHK, "pokemonwiki-pmcg.json"), "utf8"))[SET].names;
const shaOf = new Map(fs.readFileSync(path.join(__dirname, "image-hashes.tsv"), "utf8").split(/\r?\n/).slice(1).map((l) => l.split("\t")).map((a) => [a[1], a[3]]));
const bySha = new Map();
for (const [k, v] of Object.entries(site)) if (v.sha && k.startsWith(SET + "-")) (bySha.get(v.sha) || bySha.set(v.sha, []).get(v.sha)).push(k);
const norm = (s) => (s || "").normalize("NFKC").replace(/[\s\[\]・]/g, "").replace(/LV\.?\d+$/, "");
const body = (s) => norm(s).replace(/^.*の/, ""); // 持ち主の「〜の」を除いた残り
const fileNamePart = (ja) => buildFileName(ja, "ZZ", "1", "").replace(/_ZZ-1$/, "");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
const linked = set.k.map((k) => { const sha = shaOf.get(`${SET}/${parseInt(k[0], 10)}`); return sha ? bySha.get(sha) || [] : null; });
const uses = new Map();
for (const l of linked) if (l?.length === 1) uses.set(l[0], (uses.get(l[0]) || 0) + 1);
const rows = [], hashRenames = [];
set.k.forEach((k, i) => {
  const l = linked[i];
  const r = { id: `${SET}-${k[0]}`, before: k[1], image: null, pcgSearch: null, sharedImage: false, pokemonWikiAtRow: wiki[parseInt(k[0], 10) - 1] ?? null, after: "", status: "", imageFile: "" };
  rows.push(r);
  if (!l) { r.status = "画像なし"; return; }
  if (l.length !== 1) { r.status = l.length ? "画像が pcg-search の複数のカードと同じ" : "画像が pcg-search のどのカードとも一致しない"; return; }
  r.image = l[0]; r.pcgSearch = site[l[0]].title.split(" | ")[0].trim(); r.sharedImage = uses.get(l[0]) > 1;
  if (norm(r.pcgSearch) === norm(k[1])) { r.status = "すでに同じ"; return; }
  if (body(r.pcgSearch) !== body(k[1])) { r.status = "画像が別のカード（画像のカードの名前と今の名前が違う）"; return; }
  const atRow = norm(r.pokemonWikiAtRow) === norm(r.pcgSearch);
  const inList = wiki.some((w) => norm(w) === norm(r.pcgSearch));
  if (!atRow && (r.sharedImage || !inList)) { r.status = r.sharedImage ? "画像を他の行と共有し、ポケモンWiki の同じ位置の名前と違う" : "ポケモンWiki に無い"; return; }
  r.after = r.pcgSearch; r.status = atRow ? "直す（ポケモンWiki の同じ位置と一致）" : "直す（ポケモンWiki の一覧にある）";
  if (!APPLY) return;
  k[1] = r.after;
  const key = `${SET}/${parseInt(k[0], 10)}`, rel = index[key];
  const dir = rel.slice(0, rel.lastIndexOf("/") + 1), file = rel.slice(rel.lastIndexOf("/") + 1), at = file.lastIndexOf(`_${SET}-`);
  if (at < 0) throw new Error(`画像のファイル名の形が想定と違います: ${rel}`);
  const newRel = dir + fileNamePart(r.after) + file.slice(at);
  if (newRel !== rel) {
    const from = path.join(ROOT, "public", rel), to = path.join(ROOT, "public", newRel);
    // 途中で止まった前回の実行で移し済み（元が無く移し先がある）なら対応表だけ合わせる。大文字小文字だけの違い（r団→R団）は Windows では同じファイルに見える
    const moved = !fs.existsSync(from) && fs.existsSync(to);
    if (!moved && fs.existsSync(to) && newRel.toLowerCase() !== rel.toLowerCase()) throw new Error(`変更先のファイルが既にあります: ${newRel}`);
    if (!moved) fs.renameSync(from, to);
    index[key] = newRel; hashRenames.push({ key, to: newRel }); r.imageFile = `${rel} → ${newRel}`;
  }
});
const fixed = rows.filter((r) => r.status.startsWith("直す"));
const reasons = {}; for (const r of rows) reasons[r.status] = (reasons[r.status] || 0) + 1;
fs.writeFileSync(path.join(CHK, `fix-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, fixed: fixed.length, reasons, rows }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  renameHashPaths(hashRenames, index);
  fs.writeFileSync(path.join(CHK, `fix-${SET}-changed-card-ids.txt`), fixed.map((r) => r.id).join("\n") + (fixed.length ? "\n" : ""));
}
console.log(JSON.stringify({ set: SET, fixed: fixed.length, imagesRenamed: hashRenames.length, reasons }));
