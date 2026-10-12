// Bulbapedia に番号付きの一覧が無い弾の英語名を、Bulbapedia のカードのページの日本語名（jname）と TCGdex 英語版で確かめて入れる（2026-10-12）。
//   node scripts/en-name-fix5/fill-by-jname.mjs --set SMB            照合して decisions/{弾}.tsv に書く（cardData は変えない）
//   node scripts/en-name-fix5/fill-by-jname.mjs --set SMB --apply    cardData.json に書く（{弾}-changed-card-ids.txt も残す）
// 入れる条件（すべて）:
//   1. Bulbapedia のカードのページで jname が行の日本語名とまったく同じもの（bulbapedia-jname-2026-10-12.txt、ブラウザで Bulbapedia の API から集め、ページの jname をそのまま比べた。SHA-256 をブラウザの値と照合済み）がある
//   2. そのページの英語名（ページ名の括弧の前）のうち、TCGdex 英語版に同じ名前・同じ種類（ポケモン／トレーナーズの種類／エネルギー）・同じイラストレーター
//      （公式 details.php の本文、en-name-fix3/illustrators.json）のカードがあるものが、ちょうど1つ
//   3. ポケモンで日本語名から作った名前（fill-common-en.mjs と同じ規則）があるときは、その名前と同じ
// 書く名前は Bulbapedia のページ名の書き方。基本エネルギー（カードにイラストレーターの記載が無い）は対象外。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const F3 = path.join(ROOT, "scripts", "en-name-fix3");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const SET = arg("--set");
const APPLY = process.argv.includes("--apply");
if (!SET) throw new Error("--set <弾> を指定してください");

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
if (!set) throw new Error(`弾がありません: ${SET}`);
const kinds = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "cardKinds.json"), "utf8"));
// 1行1つ: 日本語名|ページの英語名（ページ名の括弧の前）|種類（Pokemon/Trainer/Energy）。見つからなかった名前は「日本語名||」
const bp = {};
for (const l of fs.readFileSync(path.join(__dirname, "bulbapedia-jname-2026-10-12.txt"), "utf8").split(/\r?\n/)) {
  if (!l) continue;
  const [ja, name, cat] = l.split("|");
  (bp[ja] ??= []);
  if (name) bp[ja].push({ name, cat });
}
const ill = JSON.parse(fs.readFileSync(path.join(F3, "illustrators.json"), "utf8"));

// 規則の名前（fill-common-en.mjs と同じ）
const species = JSON.parse(fs.readFileSync(path.join(F3, "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const SUF = { VMAX: " VMAX", VSTAR: " VSTAR", "V-UNION": "-UNION", V: " V", ex: " ex", EX: "-EX", GX: "-GX", BREAK: " BREAK" };
const PRE = { アローラ: "Alolan ", ガラル: "Galarian ", ヒスイ: "Hisuian ", パルデア: "Paldean ", メガ: "M " };
function predict(name) {
  let n = name.normalize("NFKC").replace(/\s+/g, " ").trim(), suf = "", pre = "";
  for (const k of Object.keys(SUF)) if (n.endsWith(k) && n.length > k.length) {
    const b = n.slice(0, -k.length).trim();
    if (J.has(b) || Object.keys(PRE).some((p) => b.startsWith(p) && J.has(b.slice(p.length).trim()))) { suf = k; n = b; break; }
  }
  for (const p of Object.keys(PRE)) if (!J.has(n) && n.startsWith(p) && J.has(n.slice(p.length).trim())) { pre = p; n = n.slice(p.length).trim(); }
  if (!J.has(n)) return "";
  let e = J.get(n);
  if (pre === "メガ") e = (["SV", "M"].includes(set.sr) ? "Mega " : "M ") + e; else if (pre) e = PRE[pre] + e;
  return e + (suf === "V-UNION" ? " V-UNION" : suf ? SUF[suf] : "");
}

const norm = (s) => (s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/♢/g, "◇").replace(/\s+/g, " ").trim();
const key = (s) => { const n = norm(s); const tail = /\bex$/.test(n) ? "|ex" : /EX$/.test(n) ? "|EX" : ""; return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-–—.':]/g, "") + tail; };
const illKey = (s) => norm(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const sameIll = (a, b) => { const x = illKey(a), y = illKey(b); if (!x || !y) return false; return x === y || (Math.min(x.length, y.length) >= 8 && lev(x, y) <= 2); };

const isPocket = (id) => /^(A\d|B\d|P-A)/.test(id);
const en = ["Pokemon", "Trainer", "Energy"].flatMap((c) => JSON.parse(fs.readFileSync(path.join(F3, ".cache", `tcgdex-en-${c}.json`), "utf8")).data.cards).filter((c) => !isPocket(c.id));
const enByKey = new Map();
for (const c of en) { const k = key(c.name); if (!enByKey.has(k)) enByKey.set(k, []); enByKey.get(k).push(c); }

// TCGdex 英語版のカードの段階（LV.X の見分け用。.cache/stages.json に保存）
const STAGE_FILE = path.join(__dirname, ".cache", "stages.json");
const stageCache = fs.existsSync(STAGE_FILE) ? JSON.parse(fs.readFileSync(STAGE_FILE, "utf8")) : {};
async function stageOf(id) {
  if (!(id in stageCache)) {
    const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`TCGdex の取得に失敗: ${id} ${r.status}`);
    stageCache[id] = (await r.json()).stage ?? null;
    fs.mkdirSync(path.dirname(STAGE_FILE), { recursive: true });
    fs.writeFileSync(STAGE_FILE, JSON.stringify(stageCache, null, 1) + "\n");
  }
  return stageCache[id];
}

// 行の種類（cardKinds.json）と、TCGdex・Bulbapedia の種類が合うか
const catOf = (kind) => (kind === "Pokemon" ? "Pokemon" : kind === "Energy" ? "Energy" : "Trainer");
const tcgdexKindOk = (kind, c) => {
  if (c.category !== catOf(kind)) return false;
  if (catOf(kind) !== "Trainer" || kind === "Trainer") return true;
  const t = c.trainerType;
  if (kind === "Item" || kind === "Tool") return ["Item", "Tool", "Technical Machine"].includes(t); // SM 以前は どうぐ・グッズの区別が情報源で揃わない
  return t === kind;
};
const rows = [];
for (const k of set.k) {
  if (k[2]) continue;
  const id = `${SET}-${k[0]}`;
  const kind = kinds[id] || "Pokemon";
  const r = { id, ja: k[1], kind, illustrator: ill[id]?.illustrator || "", rule: kind === "Pokemon" ? predict(k[1]) : "", bpPages: "", candidates: "", status: "空欄", note: "", en: "" };
  rows.push(r);
  if (/^基本.+エネルギー$/.test(k[1])) { r.note = "基本エネルギー（イラストレーターの記載が無い）"; continue; }
  const pages = (bp[k[1]] || []).filter((p) => p.cat === catOf(kind));
  r.bpPages = pages.map((p) => p.name).join(" / ");
  if (!pages.length) { r.note = bp[k[1]] ? "Bulbapedia に同じ日本語名・同じ種類のカードのページが無い" : "Bulbapedia で引いていない"; continue; }
  if (!r.illustrator) { r.note = "イラストレーターが分からない"; continue; }
  const names = new Map();
  for (const p of pages) { const n = p.name; if (!names.has(key(n))) names.set(key(n), n); }
  const pass = [];
  for (const [kk, n] of names) {
    const hits = (enByKey.get(kk) || []).filter((c) => tcgdexKindOk(kind, c) && sameIll(c.illustrator, r.illustrator));
    if (hits.length) pass.push({ n, ids: hits.map((c) => c.id).join(" ") });
  }
  r.candidates = pass.map((p) => `${p.n} [${p.ids}]`).join(" / ");
  if (pass.length !== 1) { r.note = pass.length ? "候補が複数ある" : "TCGdex 英語版に同じ名前・種類・イラストレーターのカードが無い"; continue; }
  // DP 期の LV.X は TCGdex の名前に LV.X が付かない（段階が LEVEL-UP）。一致したカードの段階を確かめ、LV.X なら Bulbapedia の「〜 LV.X」の名前を使う
  if (kind === "Pokemon" && /^(dp|pl|pop|tk-dp|col)/.test(pass[0].ids.split(" ")[0])) {
    const stages = [];
    for (const cid of pass[0].ids.split(" ")) stages.push(await stageOf(cid));
    if (stages.some((s) => s === "LEVEL-UP")) {
      const lvx = `${pass[0].n} LV.X`;
      if (stages.every((s) => s === "LEVEL-UP") && pages.some((p) => key(p.name) === key(lvx))) { pass[0].n = lvx; r.rule = r.rule ? `${r.rule} LV.X` : ""; r.candidates += "（TCGdex の段階 LEVEL-UP → LV.X）"; }
      else { r.note = "LV.X かどうか決まらない（一致したカードの段階が混ざっている）"; continue; }
    }
  }
  if (r.rule && key(r.rule) !== key(pass[0].n)) { r.note = `日本語名から作った名前（${r.rule}）と違う`; continue; }
  r.status = "入れる"; r.en = pass[0].n;
  r.note = "Bulbapedia の jname と TCGdex 英語版（同じ名前・種類・イラストレーター）が一致" + (r.rule ? "・規則の名前とも一致" : "");
}

const cols = ["id", "ja", "kind", "illustrator", "rule", "bpPages", "candidates", "status", "note", "en"];
const tsv = [cols.join("\t"), ...rows.map((r) => cols.map((c) => String(r[c] ?? "").replace(/[\t\n]/g, " ")).join("\t"))].join("\n") + "\n";
const outDir = path.join(__dirname, APPLY ? "decisions" : "decisions-check");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${SET}.tsv`), tsv);
const fill = rows.filter((r) => r.status === "入れる");
const reasons = {};
for (const r of rows) if (r.status !== "入れる") reasons[r.note] = (reasons[r.note] || 0) + 1;
console.log(JSON.stringify({ set: SET, targets: rows.length, filled: fill.length, blank: rows.length - fill.length, reasons }));
if (APPLY && fill.length) {
  for (const r of fill) { const row = set.k.find((k) => `${SET}-${k[0]}` === r.id); if (row[2]) throw new Error(`英語名が既にあります: ${r.id}`); row[2] = r.en; }
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  rebuildCardKinds(); // カードの種類の一覧（src/cardKinds.json）を作り直す
  fs.writeFileSync(path.join(outDir, `${SET}-changed-card-ids.txt`), fill.map((r) => r.id).join("\n") + "\n");
}
