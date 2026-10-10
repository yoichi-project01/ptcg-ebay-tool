// DPt1〜4 の LV.X の行の英語名を入れる（2026-10-10）。
//   node scripts/dp-x/fix-dpt-lvx-en.mjs [--apply]
// 入れる条件（3つとも）:
//   1. 公式 details.php（fetch-dpt-lvx.mjs で保存）の番号が行の番号と同じで、段階が「レベルアップ」・LV が X
//   2. Bulbapedia の日本版の一覧の名前が「日本語名から作った名前（fill-common-en.mjs の規則。decisions の rule 列）＋ " LV.X"」
//   3. TCGdex 英語版にその名前のカードがある
// 日本語名は変えない（DP-P と同じく、日本語のカード名に LV.X は付けない）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const APPLY = process.argv.includes("--apply");
const det = JSON.parse(fs.readFileSync(path.join(__dirname, "dpt-lvx-details.json"), "utf8"));
const enNames = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", ".cache", "tcgdex-en-Pokemon.json"), "utf8")).data.cards.map((c) => c.name.toLowerCase().replace(/[\s\-.]/g, "")));
const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const rows = [];
for (const [cid, x] of Object.entries(det)) {
  const [set, num] = [x.row.slice(0, x.row.lastIndexOf("-")), x.row.slice(x.row.lastIndexOf("-") + 1)];
  const dec = fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "decisions", `${set}-pokemon.tsv`), "utf8").split("\n").map((l) => l.split("\t"));
  const head = dec[0];
  const d = dec.find((f) => f[0] === x.row);
  const rule = d?.[head.indexOf("rule")] ?? "", bp = d?.[head.indexOf("bpName")] ?? "";
  const k = data.find((s) => s.c === set).k.find((r) => r[0] === num);
  const r = { id: x.row, cardId: cid, ja: k[1], before: k[2], rule, bpName: bp, officialNum: x.num, officialLvX: x.lvx, status: "" };
  if (k[2]) r.status = "すでに英語名がある";
  else if (!x.num.startsWith(num + "/")) r.status = `公式の番号が違う（${x.num}）`;
  else if (!x.lvx) r.status = "公式ページが LV.X ではない";
  else if (!rule || bp !== `${rule} LV.X`) r.status = "Bulbapedia の名前が規則の名前＋ LV.X ではない";
  else if (!enNames.has(bp.toLowerCase().replace(/[\s\-.]/g, ""))) r.status = "TCGdex 英語版に同じ名前のカードが無い";
  else { r.status = "入れる"; r.after = bp; if (APPLY) k[2] = bp; }
  rows.push(r);
}
if (APPLY) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(path.join(__dirname, "dpt-lvx-en.json"), JSON.stringify(rows, null, 1) + "\n");
for (const r of rows) console.log(r.id, r.ja, r.status, r.after ?? "");
