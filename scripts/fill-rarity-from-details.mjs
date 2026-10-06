// レアリティが空の行に、公式 details.php のレアリティを入れる（2026-10-05）。
//   node scripts/fill-rarity-from-details.mjs                 全弾を照合して件数を出すだけ（何も変えない）
//   node scripts/fill-rarity-from-details.mjs --set SV1S --apply   1弾分を cardData.json・画像のファイル名・imageIndex.json に反映
//
// 入れる条件（すべて満たすものだけ。推測で埋めない）:
//   - scripts/scan-progress/{弾}.json（details.php の結果。fetch-rarity-details.mjs・patch-from-scan.mjs で取得）に、
//     同じ番号・同じ日本語名（末尾の括弧注記の違いは同じカードとみなす）のカードがある
//   - そのカードにレアリティのアイコンがあり、既知のコード（scrape-missing-sets.mjs の RARITY_CODE_MAP）に変換できる
//   - 同じ番号・同じ名前のカードが複数あるとき（リバースホロの別掲載など）は、レアリティがすべて同じ
// アイコンが無いカード（基本エネルギー・構築済みデッキ・プロモ・ハイクラスパックの通常カード等、カードにマークが無いもの）は空欄のまま。
// 画像のファイル名もレアリティ付きの規則（{名前}_{弾}-{番号}／{総数}_{レアリティ}.ext）に直し、imageIndex.json の指す先を合わせる。
// 根拠は scripts/rarity-fix/{弾}.json、変えた card_id は {弾}-changed-card-ids.txt。
import fs from "node:fs";
import { renameHashPaths } from "./image-hashes.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./patch-from-scan.mjs";
import { RARITY_CODE_MAP } from "./scrape-missing-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const OUT = path.join(__dirname, "rarity-fix");
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY = arg("--set");
const APPLY = process.argv.includes("--apply");
if (APPLY && !ONLY) throw new Error("--apply は --set で1弾ずつ指定してください");

const strip = (s) => normalizeName(s).replace(/[（(][^（()）]*[)）]$/, "").trim();
const sameCard = (a, b) => normalizeName(a) === normalizeName(b) || strip(a) === strip(b);
const keyOf = (n) => (/^\d+$/.test(n) ? String(parseInt(n, 10)) : n);

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
fs.mkdirSync(OUT, { recursive: true });

function judge(set) {
  const p = path.join(__dirname, "scan-progress", `${set.c}.json`);
  const progress = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  const byNum = new Map();
  for (const [cardId, v] of Object.entries(progress)) {
    (v.cards || []).forEach((c, i) => {
      const code = v.rarityCodes ? v.rarityCodes[i] ?? null : null;
      const k = keyOf(c.local);
      if (!byNum.has(k)) byNum.set(k, []);
      byNum.get(k).push({ cardId, jaName: c.jaName, rarity: c.rarity, code, badge: v.badge });
    });
  }
  const rows = [];
  for (const row of set.k) {
    if (row[3]) continue;
    const cands = (byNum.get(keyOf(row[0])) || []).filter((e) => sameCard(e.jaName, row[1]));
    const rars = [...new Set(cands.map((e) => e.rarity))];
    let status, rarity = null;
    if (!byNum.has(keyOf(row[0]))) status = "details.php 未取得";
    else if (!cands.length) status = "同じ番号のカードの名前が違う（変えない）";
    else if (rars.length > 1) status = "同じカードでレアリティが食い違う（変えない）";
    else if (rars[0] === null) status = "未知のレアリティコード（変えない）";
    else if (rars[0] === "") status = "アイコンなし（マークの無いカード）";
    else { status = "入れる"; rarity = rars[0]; }
    rows.push({ id: `${set.c}-${row[0]}`, ja: row[1], status, rarity, details: cands.map((e) => ({ cardId: e.cardId, jaName: e.jaName, rarity: e.rarity, badge: e.badge })) });
  }
  return rows;
}

const summary = {};
for (const set of data) {
  if (ONLY && set.c !== ONLY) continue;
  if (!set.k.some((r) => !r[3])) continue;
  const rows = judge(set);
  const count = rows.reduce((m, r) => (m[r.status] = (m[r.status] ?? 0) + 1, m), {});
  summary[set.c] = count;
  if (!APPLY) continue;

  const fill = rows.filter((r) => r.status === "入れる");
  const renamed = [];
  for (const r of fill) {
    const row = set.k.find((x) => `${set.c}-${x[0]}` === r.id);
    row[3] = r.rarity;
    // 画像のファイル名にレアリティを付ける（{名前}_{弾}-{番号}／{総数}.ext → …／{総数}_{レアリティ}.ext）
    const key = `${set.c}/${keyOf(row[0])}`;
    const rel = index[key];
    if (!rel) continue;
    const m = rel.match(/^(.*_[^/]*-[^/_]+／\d+)(\.[a-z]+)$/i);
    if (!m) { r.imageNote = `ファイル名を変えていない（規則に合わない: ${rel}）`; continue; }
    const newRel = `${m[1]}_${r.rarity}${m[2]}`;
    const from = path.join(ROOT, "public", rel), to = path.join(ROOT, "public", newRel);
    if (!fs.existsSync(from)) throw new Error(`画像がありません: ${rel}`);
    if (fs.existsSync(to)) throw new Error(`変更先に同じ名前の画像があります: ${newRel}`);
    fs.renameSync(from, to);
    index[key] = newRel;
    renamed.push({ id: r.id, key, from: rel, to: newRel });
  }
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  renameHashPaths(renamed, index); // 画像の SHA-256 の一覧のパスも合わせる（中身は照合する）
  fs.writeFileSync(path.join(OUT, `${set.c}.json`), JSON.stringify({ at: new Date().toISOString(), set: set.c, count, renamed, rows }, null, 1));
  fs.writeFileSync(path.join(OUT, `${set.c}-changed-card-ids.txt`), fill.map((r) => r.id).join("\n") + (fill.length ? "\n" : ""));
  console.log(`[${set.c}] ${fill.length}件にレアリティを入れました（画像のファイル名を直した ${renamed.length}件）`);
}
if (!APPLY) {
  for (const [c, n] of Object.entries(summary)) console.log(`${c}\t${JSON.stringify(n)}`);
  fs.writeFileSync(path.join(OUT, "plan-check.json"), JSON.stringify(summary, null, 1));
}
