// 公式 details.php にレアリティのアイコンが無いカードに、公式以外の情報源で2つ以上一致したレアリティを入れる（2026-10-06）。
//   node scripts/fill-rarity-from-sources.mjs            判定だけ（何も変えない）
//   node scripts/fill-rarity-from-sources.mjs --apply [--set SV7]   cardData.json・画像のファイル名・imageIndex.json に反映（--set で1弾だけ）
// 入力: scripts/rarity-fix/second-sources.json（TCGdex 日本語版・遊々亭・ポケカくらぶの表記と URL）
// 各情報源の表記をアプリのレアリティのコードに読み替える（読み替えられない表記は一致に数えない）:
//   遊々亭: レアリティ欄の値（「-」はマーク無し）／ポケカくらぶ: 名前の注記「（ACE SPEC）」→ ACE／TCGdex: "ACE SPEC Rare" → ACE、"Radiant Rare" → K、"Triple Rare" → RRR
// 2つ以上が同じコードを示し、そのコードが src/App.jsx の RARITIES にあるものだけ入れる。RARITIES に無いコード（K 等）は保留して一覧に出す。
// 結果は scripts/rarity-fix/second-sources-result.json、変えた card_id は second-sources-changed-card-ids.txt。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const OUT = path.join(__dirname, "rarity-fix");
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.includes("--set") ? process.argv[process.argv.indexOf("--set") + 1] : null; // 1弾だけ反映するとき

const app = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
const RARITIES = new Set(JSON.parse(app.match(/const RARITIES = (\[[^\]]*\])/)[1].replace(/'/g, '"')));
const TCGDEX = { "ACE SPEC Rare": "ACE", "Radiant Rare": "K", "Triple Rare": "RRR" };
const src = JSON.parse(fs.readFileSync(path.join(OUT, "second-sources.json"), "utf8")).cards;

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const results = [];
for (const [id, s] of Object.entries(src)) {
  if (ONLY && id.slice(0, id.lastIndexOf("-")) !== ONLY) continue;
  const votes = {};
  const yt = [...new Set(s.yuyutei.entries.map((e) => e.split(" ")[0]).filter((r) => r && r !== "-"))];
  if (yt.length === 1) votes.yuyutei = yt[0];
  const pk = [...new Set(s.pokeca.entries.map((e) => (/ACE SPEC/.test(e) ? "ACE" : null)).filter(Boolean))];
  if (pk.length === 1) votes.pokeca = pk[0];
  if (TCGDEX[s.tcgdex.rarity]) votes.tcgdex = TCGDEX[s.tcgdex.rarity];
  const count = Object.values(votes).reduce((m, r) => (m[r] = (m[r] ?? 0) + 1, m), {});
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  let status, rarity = null;
  if (!top || top[1] < 2) status = "2つ以上の情報源で一致しない（入れない）";
  else if (Object.keys(count).length > 1) status = "情報源で食い違う（入れない）";
  else if (!RARITIES.has(top[0])) status = `一致したが ${top[0]} はアプリのレアリティの選択肢に無い（保留）`;
  else { status = "入れる"; rarity = top[0]; }
  results.push({ id, ja: s.ja, votes, status, rarity });
}

const changed = [];
if (APPLY) {
  for (const r of results.filter((x) => x.status === "入れる")) {
    const set = data.find((x) => x.c === r.id.slice(0, r.id.lastIndexOf("-")));
    const row = set.k.find((k) => `${set.c}-${k[0]}` === r.id);
    if (row && row[1] === r.ja && row[3] === r.rarity) continue; // 入れ済み
    if (!row || row[1] !== r.ja || row[3]) throw new Error(`cardData の行が想定と違います: ${r.id}`);
    row[3] = r.rarity;
    const key = `${set.c}/${String(parseInt(row[0], 10))}`;
    const rel = index[key];
    const m = rel && rel.match(/^(.*_[^/]*-[^/_]+／\d+)(\.[a-z]+)$/i);
    if (m) {
      const newRel = `${m[1]}_${r.rarity}${m[2]}`;
      fs.renameSync(path.join(ROOT, "public", rel), path.join(ROOT, "public", newRel));
      index[key] = newRel;
    }
    changed.push(r.id);
  }
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  fs.writeFileSync(path.join(OUT, ONLY ? `second-sources-result-${ONLY}.json` : "second-sources-result.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  fs.writeFileSync(path.join(OUT, ONLY ? `second-sources-changed-card-ids-${ONLY}.txt` : "second-sources-changed-card-ids.txt"), changed.join("\n") + (changed.length ? "\n" : ""));
}
const by = results.reduce((m, r) => ((m[r.status] ??= []).push(r.id), m), {});
for (const [k, v] of Object.entries(by)) console.log(`${k}: ${v.length}件 ${v.join(" ")}`);
if (APPLY) console.log(`${changed.length}件にレアリティを入れました`);
