// DP1〜5・EP08（型番 X＋cardID）の英語名を入れる（2026-10-11）。
//   node scripts/dp-x/fill-dp-en.mjs --set DP1            照合して dp-x/en-check/{弾}.tsv に書く（cardData は変えない）
//   node scripts/dp-x/fill-dp-en.mjs --set DP1 --apply    cardData.json に書き、根拠を dp-x/en/{弾}.tsv、card_id を dp-x/en/{弾}-changed-card-ids.txt に残す
// DP 世代は弾の中の番号が無いため、Bulbapedia の日本版の一覧（dp-x/bulbapedia-dp-2026-10-11.txt。弾ごとに拡張パックと同じマークのデッキの一覧を合わせたもの）に
// その名前があるかで照合する（番号での突き合わせはできない）。行の名前は公式 details.php の名前（plan-{弾}.json の name。同じ名前の見分けの括弧は外したもの）。
//   ・ポケモン: 日本語名から作った名前（PokeAPI の種族名の日本語→英語。アンノーン[X] は Unown X）が Bulbapedia の一覧にあれば入れる。
//     LV.X（公式ページの段階「レベルアップ」・LV X）は「名前 LV.X」が Bulbapedia の一覧にあり、TCGdex 英語版にも同じ名前のカードがあるときだけ。
//     規則で作れない名前（フォルム・ミノ・海など）は、Bulbapedia の一覧のポケモンのうち、TCGdex 英語版に同じ名前・同じイラストレーター・同じ図鑑番号のカードがあるものが
//     ちょうど1つのときだけ入れる。
//   ・トレーナーズ・エネルギー: Bulbapedia の一覧のトレーナーズ・エネルギーのうち、TCGdex 英語版に同じ名前・同じ種類・同じイラストレーターのカードがあるものが
//     ちょうど1つのときだけ入れる。イラストレーターと種類は公式 details.php の本文（details.json）から。
// 書く名前は Bulbapedia の書き方。すでに英語名がある行は変えない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const SET = arg("--set");
const APPLY = process.argv.includes("--apply");
if (!SET) throw new Error("--set <弾> を指定してください");

const norm = (s) => (s ?? "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const key = (s) => norm(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-–—.':]/g, "");
const illKey = (s) => norm(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");

// Bulbapedia の一覧（この弾の節だけ）
const bp = [];
let cur = null;
for (const l of fs.readFileSync(path.join(__dirname, "bulbapedia-dp-2026-10-11.txt"), "utf8").split(/\r?\n/)) {
  if (!l) continue;
  if (l.startsWith("## ")) { const [c, page, section] = l.slice(3).split("|"); cur = { c, page, section }; continue; }
  if (cur.c !== SET) continue;
  const [, name, type] = l.split("|");
  bp.push({ name: norm(name.replace(/ \[(Non )?Holofoil\]$/, "")), type, page: cur.page, section: cur.section });
}
if (!bp.length) throw new Error(`Bulbapedia の一覧に ${SET} の節がありません`);
const ENERGY_TYPES = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Colorless"]);
const bpPokemon = new Map(), bpOther = new Map();
for (const b of bp) (ENERGY_TYPES.has(b.type) ? bpPokemon : bpOther).set(key(b.name), b);

// 種族名（日本語→英語）
const species = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
function ruleName(name) {
  const n = name.normalize("NFKC").trim();
  if (J.has(n)) return J.get(n);
  const u = n.match(/^アンノーン\[([A-Z?!])\]$/);
  if (u) return `Unown ${u[1]}`;
  return "";
}

// TCGdex 英語版
const en = ["Pokemon", "Trainer", "Energy"].flatMap((c) => JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", ".cache", `tcgdex-en-${c}.json`), "utf8")).data.cards)
  .filter((c) => !/^(A\d|B\d|P-A)/.test(c.id));
const enByKey = new Map();
for (const c of en) { const k = key(c.name); if (!enByKey.has(k)) enByKey.set(k, []); enByKey.get(k).push(c); }

// TCGdex 英語版のカードの詳細（HP・ワザのダメージ・レアリティ）。dp-x/tcgdex-en-cards.json にためる
const TC_FILE = path.join(__dirname, "tcgdex-en-cards.json");
const tc = fs.existsSync(TC_FILE) ? JSON.parse(fs.readFileSync(TC_FILE, "utf8")) : {};
async function tcCard(id) {
  if (!(id in tc)) {
    const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    const j = r.ok ? await r.json() : null;
    tc[id] = j ? { name: j.name, hp: j.hp ?? null, rarity: j.rarity ?? "", stage: j.stage ?? "", damages: (j.attacks || []).map((a) => String(a.damage ?? "")).filter(Boolean) } : null;
    fs.writeFileSync(TC_FILE, JSON.stringify(tc, null, 1) + "\n");
  }
  return tc[id];
}
const dmgKey = (arr) => arr.map((s) => String(s).normalize("NFKC").replace(/\s+/g, "").replace(/x/g, "×")).sort().join(",");
// 公式ページの HP と、ワザのダメージ（「ワザ」から「弱点」までの数字だけの行）
function officialStats(t) {
  const hp = t[t.indexOf("HP") + 1];
  const a = t.indexOf("ワザ"), b = t.indexOf("弱点");
  const dm = a >= 0 ? t.slice(a + 1, b > a ? b : undefined).filter((s) => /^\d+[＋+×x]?$/.test(s.normalize("NFKC"))) : [];
  return { hp: hp && /^\d+$/.test(hp) ? +hp : null, damages: dmgKey(dm) };
}
async function statsMatch(t, ids, needLvx) {
  const o = officialStats(t);
  const ok = [];
  for (const id of ids) {
    const c = await tcCard(id);
    if (!c) continue;
    if (needLvx && !/LV\.X/.test(c.rarity) && c.stage !== "LEVEL-UP") continue;
    if (c.hp !== o.hp || dmgKey(c.damages) !== o.damages) continue;
    ok.push(id);
  }
  return ok;
}

const JNAME = JSON.parse(fs.readFileSync(path.join(__dirname, "bulbapedia-jname-2026-10-11.json"), "utf8")).map;
const details = JSON.parse(fs.readFileSync(path.join(__dirname, "details.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, `plan-${SET}.json`), "utf8"));
const planById = new Map(plan.cards.map((c) => [`X${c.cardId}`, c]));
const KIND = { グッズ: ["Trainer", "Item"], ポケモンのどうぐ: ["Trainer", "Tool"], ワザマシン: ["Trainer", "Technical Machine"], サポート: ["Trainer", "Supporter"], スタジアム: ["Trainer", "Stadium"], 特殊エネルギー: ["Energy", null] };

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const rows = [];
for (const k of set.k) {
  const p = planById.get(k[0]);
  if (!p) throw new Error(`plan-${SET}.json に ${k[0]} がありません`);
  const t = details[p.cardId].text;
  const ii = t.indexOf("イラストレーター");
  const ill = ii >= 0 ? t[ii + 1] : "";
  const isPokemon = t.some((s) => /^DPBP#/.test(s)) || ["たね", "1 進化", "2 進化", "レベルアップ"].includes(t[ii + 2]);
  const kindJa = isPokemon ? "ポケモン" : (t.slice(ii + 2, ii + 5).find((s) => KIND[s]) ?? "");
  const dex = (t.find((s) => /^No\.\d+/.test(s)) || "").match(/^No\.(\d+)/)?.[1] ?? "";
  const r = { id: `${SET}-${k[0]}`, ja: k[1], name: p.name, lvx: p.lvx, kind: kindJa, illustrator: ill, dex, rule: "", bp: "", tcgdex: "", status: "", en: "" };
  rows.push(r);
  if (k[2]) { r.status = "すでに英語名がある"; continue; }
  if (isPokemon) {
    const rn = ruleName(p.name);
    r.rule = rn;
    if (rn) {
      const want = p.lvx ? `${rn} LV.X` : rn;
      const b = bpPokemon.get(key(want));
      if (!b) { r.status = p.lvx ? "Bulbapedia の一覧に「名前 LV.X」が無い" : "Bulbapedia の一覧に規則の名前が無い"; continue; }
      r.bp = `${b.name}（${b.section}）`;
      if (p.lvx) {
        // TCGdex 英語版は DP 期の LV.X を「名前」だけで載せていることがある。同じ名前（LV.X 付き・無し）・同じイラストレーターで、
        // レアリティが LV.X（または段階 LEVEL-UP）で、HP・ワザのダメージが公式ページと同じカードがあること
        const ids = [...(enByKey.get(key(b.name)) || []), ...(enByKey.get(key(rn)) || [])].filter((c) => c.category === "Pokemon" && illKey(c.illustrator) === illKey(ill)).map((c) => c.id);
        const ok = await statsMatch(t, ids, true);
        if (!ok.length) { r.status = "TCGdex 英語版に同じ名前・イラストレーター・HP・ダメージの LV.X が無い"; continue; }
        r.tcgdex = ok.join(" ");
      }
      r.status = p.lvx ? "入れる（LV.X: 公式ページのレベルアップ・Bulbapedia の名前・TCGdex 英語版の LV.X〔同じイラストレーター・HP・ダメージ〕）" : "入れる（規則の名前と Bulbapedia が一致）";
      r.en = b.name;
      continue;
    }
    // 規則で作れない名前: Bulbapedia のポケモンのうち、TCGdex に同じ名前・イラストレーター・図鑑番号のカードがあるもの
    if (!ill) { r.status = "規則で作れない・イラストレーターが分からない"; continue; }
    const cands = [];
    for (const b of bpPokemon.values()) {
      if (/ LV\.X$/.test(b.name) !== !!p.lvx) continue;
      const hits = (enByKey.get(key(b.name)) || []).filter((c) => c.category === "Pokemon" && illKey(c.illustrator) === illKey(ill) && (!dex || String(c.dexId?.[0] ?? c.dexId ?? "") === String(+dex)));
      if (!hits.length) continue;
      // 同じイラストレーターの別のフォルム（海・ミノ・フォルム）を見分けるため、HP・ワザのダメージも公式ページと同じものだけ
      const ok = await statsMatch(t, hits.map((c) => c.id), !!p.lvx);
      if (ok.length) cands.push({ b, hits: hits.filter((c) => ok.includes(c.id)) });
    }
    if (cands.length !== 1) { r.status = cands.length ? `規則で作れない・候補が${cands.length}つ（${cands.map((c) => c.b.name).join("／")}）` : "規則で作れない・TCGdex 英語版に同じ名前・イラストレーター・図鑑番号のカードが無い"; continue; }
    r.bp = `${cands[0].b.name}（${cands[0].b.section}）`;
    r.tcgdex = cands[0].hits.map((c) => c.id).join(" ");
    r.status = "入れる（Bulbapedia と TCGdex 英語版で同じ名前・イラストレーター・図鑑番号・HP・ダメージ）";
    r.en = cands[0].b.name;
    continue;
  }
  const kd = KIND[kindJa];
  if (!kd) { r.status = `種類が分からない（${t[ii + 2]}）`; continue; }
  if (!ill) { r.status = "イラストレーターが分からない"; continue; }
  const cands = [];
  for (const b of bpOther.values()) {
    if (kd[0] === "Energy" ? b.type !== "Energy" : b.type === "Energy") continue;
    const hits = (enByKey.get(key(b.name)) || []).filter((c) => c.category === kd[0] && (!kd[1] || c.trainerType === kd[1]) && illKey(c.illustrator) === illKey(ill));
    if (hits.length) cands.push({ b, hits });
  }
  let how = "入れる（Bulbapedia と TCGdex 英語版で同じ名前・種類・イラストレーター）";
  if (cands.length > 1) {
    // 同じイラストレーターのトレーナーズが複数あるときは、Bulbapedia のカードのページの jname（日本語名）が行の日本語名と同じものに絞る
    const page = JNAME[p.name];
    const nameFromPage = page ? page.replace(/ \([^)]*\)$/, "") : "";
    const f = cands.filter((c) => nameFromPage && key(c.b.name) === key(nameFromPage));
    if (f.length === 1) { cands.splice(0, cands.length, f[0]); how = `入れる（Bulbapedia の一覧・カードのページ「${page}」の jname と、TCGdex 英語版で同じ名前・種類・イラストレーター）`; }
  }
  if (cands.length !== 1) { r.status = cands.length ? `候補が${cands.length}つ（${cands.map((c) => c.b.name).join("／")}）` : "Bulbapedia の一覧の名前で、TCGdex 英語版に同じ種類・イラストレーターのカードが無い"; continue; }
  r.bp = `${cands[0].b.name}（${cands[0].b.section}）`;
  r.tcgdex = cands[0].hits.map((c) => c.id).join(" ");
  r.status = how;
  r.en = cands[0].b.name;
}

const cols = ["id", "ja", "name", "lvx", "kind", "illustrator", "dex", "rule", "bp", "tcgdex", "status", "en"];
const tsv = [cols.join("\t"), ...rows.map((r) => cols.map((c) => String(r[c] ?? "")).join("\t"))].join("\n") + "\n";
const filled = rows.filter((r) => r.en);
if (APPLY) {
  for (const r of filled) set.k.find((k) => `${SET}-${k[0]}` === r.id)[2] = r.en;
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  rebuildCardKinds(); // カードの種類の一覧（src/cardKinds.json）を作り直す
  fs.mkdirSync(path.join(__dirname, "en"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "en", `${SET}.tsv`), tsv);
  fs.writeFileSync(path.join(__dirname, "en", `${SET}-changed-card-ids.txt`), filled.map((r) => r.id).join("\n") + (filled.length ? "\n" : ""));
} else {
  fs.mkdirSync(path.join(__dirname, "en-check"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "en-check", `${SET}.tsv`), tsv);
}
const reasons = {};
for (const r of rows) if (!r.en && r.status !== "すでに英語名がある") reasons[r.status.replace(/（.*$/, "")] = (reasons[r.status.replace(/（.*$/, "")] || 0) + 1;
console.log(JSON.stringify({ set: SET, rows: rows.length, filled: filled.length, blank: rows.length - filled.length, reasons }));
