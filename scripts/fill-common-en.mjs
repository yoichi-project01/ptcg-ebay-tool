#!/usr/bin/env node
// 英語名が空の高レア以外のカードに、2つの情報源で一致した英語名だけを入れる（2026-10-07）。
//   node scripts/fill-common-en.mjs --set M4                 照合して scripts/en-name-fix3/decisions-check/M4.tsv に書く（cardData は変えない）
//   node scripts/fill-common-en.mjs --set M4 --apply         cardData.json に書き、根拠を decisions/{弾}.tsv・summary.json、{弾}-changed-card-ids.txt に残す
//   node scripts/fill-common-en.mjs --set M4 --kind pokemon  ポケモンだけ（既定）。--kind trainer はトレーナーズ・エネルギー
//
// ポケモン（--kind pokemon）:
//   1. 日本語名から英語名を作る: 種族名（species-ja-en.json、PokeAPI の日本語名・英語名）＋前（アローラ・ガラル・ヒスイ・パルデア・メガ）
//      ＋末尾（ex・V・VMAX・VSTAR・GX・EX・BREAK）。既存の英語名 5,743件（種族名そのまま 4,475・前後つき 1,268）で全件一致を確かめた規則。
//   2. Bulbapedia の日本版の弾の一覧（bulbapedia/*.txt）の同じ番号の英語名と一致したら入れる（書く名前は Bulbapedia の表記）。
//   3. 規則で作れない名前（「〜の」が付く・わるい〜・δ・フォルム名など）や 1 と 2 が食い違う行は、TCGdex 英語版で確かめる:
//      Bulbapedia の名前のカードが英語版にあり、同じ種類（ポケモン）・同じイラストレーター（日本語版のイラストレーターは
//      TCGdex 日本語版、無ければ公式 details.php）で、図鑑番号が分かれば一致すること。確かめられなければ空欄のまま。
// トレーナーズ・エネルギー（--kind trainer）: 高レア（fill-high-rarity-en.mjs）と同じ。Bulbapedia の名前のカードが TCGdex 英語版にあり、
//   同じ種類（サポート・グッズ・どうぐ・スタジアム／エネルギー）・同じイラストレーターであること。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts", "en-name-fix3");
const DATA = path.join(ROOT, "src", "cardData.json");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const SET = arg("--set");
const KIND = arg("--kind") || "pokemon";
const APPLY = process.argv.includes("--apply");
if (!SET) throw new Error("--set で弾を指定してください");

const HIGH = new Set(["SAR", "SR", "HR", "UR", "AR", "CSR", "CHR", "BWR", "MUR", "K", "A", "H", "PR", "ACE", "SSR", "S", "TR", "MA", "RRR", "LEGEND"]);
const raw = readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
if (!set) throw new Error(`弾がありません: ${SET}`);

// --- 種族名 ---
const species = JSON.parse(readFileSync(path.join(DIR, "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const DEX = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.id]));
const SUF = { VMAX: " VMAX", VSTAR: " VSTAR", V: " V", ex: " ex", EX: "-EX", GX: "-GX", BREAK: " BREAK" };
const PRE = { アローラ: "Alolan ", ガラル: "Galarian ", ヒスイ: "Hisuian ", パルデア: "Paldean ", メガ: "M " };
function parsePokemon(name) {
  let n = name.normalize("NFKC").replace(/\s+/g, " ").trim(), suf = "", pre = "";
  for (const k of Object.keys(SUF)) if (n.endsWith(k) && n.length > k.length) {
    const b = n.slice(0, -k.length).trim();
    if (J.has(b) || Object.keys(PRE).some((p) => b.startsWith(p) && J.has(b.slice(p.length).trim()))) { suf = k; n = b; break; }
  }
  for (const p of Object.keys(PRE)) if (!J.has(n) && n.startsWith(p) && J.has(n.slice(p.length).trim())) { pre = p; n = n.slice(p.length).trim(); }
  return J.has(n) ? { species: n, pre, suf, dex: DEX.get(n) } : null;
}
function predict(name, sr) {
  const p = parsePokemon(name);
  if (!p) return "";
  let e = J.get(p.species);
  if (p.pre === "メガ") e = (["SV", "M"].includes(sr) ? "Mega " : "M ") + e; else if (p.pre) e = PRE[p.pre] + e;
  return e + (p.suf ? SUF[p.suf] : "");
}
// ポケモンらしい名前か（規則で作れなくても、末尾が種族名なら「〜の」付きなどのポケモン）
const isPokemonName = (name) => {
  const n = name.normalize("NFKC").replace(/\s+/g, "").replace(/(VMAX|VSTAR|V-UNION|V|ex|EX|GX|BREAK|LV\.X|δ|☆|◇)$/, "");
  return [...J.keys()].some((k) => k.length >= 2 && n.endsWith(k.replace(/\s+/g, "")));
};

// --- 比較用のキー ---
const norm = (s) => (s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/♢/g, "◇").replace(/\s+/g, " ").trim();
const key = (s) => { const n = norm(s); const tail = /\bex$/.test(n) ? "|ex" : /EX$/.test(n) ? "|EX" : ""; return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-–—.':]/g, "") + tail; };
const illKey = (s) => norm(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const sameIll = (a, b) => { const x = illKey(a), y = illKey(b); if (!x || !y) return false; return x === y || (Math.min(x.length, y.length) >= 8 && lev(x, y) <= 2); };

// --- Bulbapedia ---
const bp = new Map();
let bpMeta = null;
for (const f of readdirSync(path.join(DIR, "bulbapedia")).filter((f) => f.endsWith(".txt"))) {
  let cur = null, meta = null;
  for (const l of readFileSync(path.join(DIR, "bulbapedia", f), "utf8").split(/\r?\n/)) {
    if (!l) continue;
    if (l.startsWith("## ")) { const [c, page, section, den] = l.slice(3).split("|"); cur = c; meta = { page, section, den, file: f }; if (c === SET) bpMeta = meta; continue; }
    const [num, name, type] = l.split("|");
    bp.set(`${cur}-${num}`, { name: norm(name), type, ...meta });
  }
}

// Bulbapedia の一覧は日本版の節を使う（同じ名前の英語版の節を拾わないよう、番号の分母が弾の総数と一致することを確かめる）
if (bpMeta && set.of > 0) {
  const dens = bpMeta.den.replace(/^den=/, "").split(",").filter(Boolean);
  if (!dens.includes(String(set.of).padStart(3, "0"))) throw new Error(`Bulbapedia の一覧の分母（${bpMeta.den}）が弾の総数 ${set.of} と一致しません: ${SET}`);
}

// --- TCGdex 英語版（.cache、無ければ取得） ---
const isPocket = (id) => /^(A\d|B\d|P-A)/.test(id);
async function loadEn(cat) {
  const f = path.join(DIR, ".cache", `tcgdex-en-${cat}.json`);
  if (!existsSync(f)) {
    mkdirSync(path.dirname(f), { recursive: true });
    const all = [];
    for (let p = 1; p < 50; p++) {
      const q = `{ cards(filters:{category:"${cat}"}, pagination:{page:${p}, itemsPerPage:2000}) { id name illustrator category trainerType energyType dexId } }`;
      const r = await fetch("https://api.tcgdex.net/v2/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(120000) });
      const c = (await r.json()).data.cards;
      all.push(...c);
      if (c.length < 2000) break;
    }
    writeFileSync(f, JSON.stringify({ data: { cards: all } }));
  }
  return JSON.parse(readFileSync(f, "utf8")).data.cards;
}
const en = (await Promise.all(["Pokemon", "Trainer", "Energy"].map(loadEn))).flat().filter((c) => !isPocket(c.id));
const enByKey = new Map();
for (const c of en) { const k = key(c.name); if (!enByKey.has(k)) enByKey.set(k, []); enByKey.get(k).push(c); }

// --- 日本語版のイラストレーター・種類（TCGdex 日本語版。キャッシュ tcgdex-ja.json）・公式 details.php（illustrators.json） ---
const JA_FILE = path.join(DIR, "tcgdex-ja.json");
const tja = existsSync(JA_FILE) ? JSON.parse(readFileSync(JA_FILE, "utf8")) : {};
const ILL_FILE = path.join(DIR, "illustrators.json");
const ill = existsSync(ILL_FILE) ? JSON.parse(readFileSync(ILL_FILE, "utf8")) : {};
async function jaInfo(id) {
  if (!(id in tja)) {
    let j = null;
    for (let i = 0; i < 3 && j === null; i++) {
      try { const r = await fetch(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30000) }); j = r.ok ? await r.json() : r.status === 404 ? false : null; } catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
    tja[id] = j ? { name: j.name, illustrator: j.illustrator ?? null, category: j.category ?? null, trainerType: j.trainerType ?? null, dexId: j.dexId ?? null } : null;
  }
  const t = tja[id];
  const d = ill[id]?.illustrator;
  return { illustrator: t?.illustrator || d || null, illSrc: t?.illustrator ? "TCGdex日本語版" : d ? "公式details.php" : "", category: t?.category ?? null, trainerType: t?.trainerType ?? null, dexId: t?.dexId ?? null };
}

const TRAINER_OF = { Supporter: "Supporter", Item: "Item", "Pokémon Tool": "Tool", Stadium: "Stadium", "Technical Machine": "Technical Machine" };
const ENERGY_TYPES = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon", "Colorless"]);

const rows = [];
for (const k of set.k) {
  if (k[2]) continue;
  if (HIGH.has(k[3]) || (set.of && parseInt(k[0], 10) > set.of)) continue;
  const id = `${SET}-${k[0]}`;
  const b = bp.get(id);
  // ポケモンかどうか: Bulbapedia の種類（ポケモンのタイプ）があればそれで決め、無ければ日本語名で決める
  const pk = b ? ENERGY_TYPES.has(b.type) && !/エネルギー$/.test(k[1]) : isPokemonName(k[1]) || !!parsePokemon(k[1]);
  if ((KIND === "pokemon") !== pk) continue;
  const r = { id, ja: k[1], rarity: k[3], rule: "", bpName: b?.name ?? "", bpType: b?.type ?? "", illustrator: "", illSrc: "", tcgdexIds: "", status: "空欄", note: "", en: "" };
  rows.push(r);
  if (!b) { r.note = "Bulbapedia の一覧に無い"; continue; }
  if (KIND === "pokemon") {
    if (!ENERGY_TYPES.has(b.type)) { r.note = `Bulbapedia の種類がポケモンでない（${b.type}）`; continue; }
    r.rule = predict(k[1], set.sr);
    if (r.rule && key(r.rule) === key(b.name)) { r.status = "入れる"; r.note = "規則と Bulbapedia が一致"; r.en = b.name; continue; }
    // 規則で作れない・食い違う → TCGdex 英語版で確かめる
    const ji = await jaInfo(id);
    r.illustrator = ji.illustrator ?? ""; r.illSrc = ji.illSrc;
    if (!ji.illustrator) { r.note = (r.rule ? "規則と Bulbapedia が食い違う・" : "規則で作れない・") + "イラストレーターが分からない"; continue; }
    const p = parsePokemon(k[1]);
    const dex = ji.dexId?.length ? ji.dexId : p?.dex ? [p.dex] : null;
    const match = (name) => (enByKey.get(key(name)) || []).filter((c) => c.category === "Pokemon" && sameIll(c.illustrator, ji.illustrator) && (!dex || !c.dexId?.length || c.dexId.some((d) => dex.includes(d))));
    const m = match(b.name);
    if (m.length) { r.tcgdexIds = m.map((c) => c.id).join(" "); r.status = "入れる"; r.note = (r.rule ? "規則と食い違うが" : "規則で作れないが") + " TCGdex 英語版で同じ名前・イラストレーターを確認"; r.en = b.name; continue; }
    // 規則と Bulbapedia が食い違うとき、規則の名前のカードが英語版に同じイラストレーターであれば規則の名前を入れる（Bulbapedia の誤字。例 MA-003 Fezandipti ex）
    const mr = r.rule ? match(r.rule) : [];
    if (mr.length) { r.tcgdexIds = mr.map((c) => c.id).join(" "); r.status = "入れる"; r.note = "Bulbapedia と食い違うが、規則の名前を TCGdex 英語版で同じ名前・イラストレーターを確認"; r.en = r.rule; continue; }
    r.note = (r.rule ? "規則と Bulbapedia が食い違う・" : "規則で作れない・") + ((enByKey.get(key(b.name)) || []).some((c) => c.category === "Pokemon") ? "英語版の同じ名前のカードとイラストレーターが違う" : "英語版に同じ名前のポケモンが無い");
  } else {
    const ji = await jaInfo(id);
    r.illustrator = ji.illustrator ?? ""; r.illSrc = ji.illSrc;
    const isEnergy = /Energy/.test(b.type) || ENERGY_TYPES.has(b.type) && /エネルギー/.test(k[1]);
    const tt = TRAINER_OF[b.type] ?? null;
    if (!isEnergy && !tt && b.type !== "Trainer") { r.note = `Bulbapedia の種類が分からない（${b.type}）`; continue; }
    // SM 世代以前の Bulbapedia はポケモンのどうぐも「Item」と書く（当時どうぐはグッズの一種）ので、Item は TCGdex の Item・Tool の両方と照合する
    const sameType = (t) => !tt || t === tt || (tt === "Item" && t === "Tool");
    // ユニットエネルギー: Bulbapedia・英語版のカードは「Unit Energy GRW」、TCGdex は「Unit Energy GrassFireWater」と書く
    // 「Heat R Energy」（Bulbapedia はカードのエネルギー記号を文字で書く）も TCGdex では「Heat Fire Energy」
    const UNIT = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal", Y: "Fairy", C: "Colorless", N: "Dragon" };
    const lookName = b.name.replace(/^Unit Energy ([GRWLPFDMY]{3})$/, (_, s) => "Unit Energy " + [...s].map((x) => UNIT[x]).join(""))
      .replace(/^(.+) ([GRWLPFDMYC]) Energy$/, (_, a, x) => `${a} ${UNIT[x]} Energy`)
      .replace(/^Fairy Charm ([GRWLPFDMYN])$/, (_, x) => `Fairy Charm ${UNIT[x]}`)
      // フレア団ギア: Bulbapedia は名前だけ、TCGdex 英語版は「Battle Compressor Team Flare Gear」の形
      .replace(/$/, /（フレア団ハイパーギア）$/.test(k[1]) ? " Team Flare Hyper Gear" : /（フレア団ギア）$/.test(k[1]) ? " Team Flare Gear" : "");
    const cands = (enByKey.get(key(lookName)) || []).filter((c) => (isEnergy ? c.category === "Energy" : c.category === "Trainer" && sameType(c.trainerType)));
    if (!cands.length) { r.note = "英語版に同じ名前・種類のカードが無い"; continue; }
    if (ji.category && ji.category !== (isEnergy ? "Energy" : "Trainer")) { r.note = `TCGdex 日本語版の種類が違う（${ji.category}）`; continue; }
    if (!ji.illustrator) {
      // 特殊エネルギー（カードにイラストレーターの記載が無い）は、Bulbapedia と TCGdex 英語版で同じ名前のエネルギーがあれば入れる（2026-10-07 ユーザー判断）
      if (isEnergy && !/^基本/.test(k[1]) && !/^Basic /.test(b.name)) {
        r.tcgdexIds = cands.map((c) => c.id).join(" "); r.status = "入れる"; r.note = "特殊エネルギー: Bulbapedia と TCGdex 英語版で同じ名前のエネルギーを確認（イラストレーターの記載なし）"; r.en = b.name; continue;
      }
      r.note = "イラストレーターが分からない"; continue;
    }
    const m = cands.filter((c) => sameIll(c.illustrator, ji.illustrator));
    r.tcgdexIds = m.map((c) => c.id).join(" ");
    if (m.length) { r.status = "入れる"; r.note = "Bulbapedia と TCGdex 英語版（同じ名前・種類・イラストレーター）が一致"; r.en = b.name; }
    else r.note = "英語版の同じ名前のカードとイラストレーターが違う";
  }
}
writeFileSync(JA_FILE, JSON.stringify(tja, null, 0) + "\n");

const COLS = ["id", "ja", "rarity", "rule", "bpName", "bpType", "illustrator", "illSrc", "tcgdexIds", "status", "note", "en"];
const tsv = [COLS.join("\t"), ...rows.map((r) => COLS.map((c) => r[c]).join("\t"))].join("\n") + "\n";
const fill = rows.filter((r) => r.status === "入れる");
const reasons = {};
for (const r of rows.filter((r) => r.status !== "入れる")) reasons[r.note] = (reasons[r.note] || 0) + 1;
const result = { set: SET, kind: KIND, bulbapedia: bpMeta, targets: rows.length, filled: fill.length, filledByRule: fill.filter((r) => r.note === "規則と Bulbapedia が一致").length, blank: rows.length - fill.length, blankReasons: reasons };
console.log(JSON.stringify(result));

if (!APPLY) {
  mkdirSync(path.join(DIR, "decisions-check"), { recursive: true });
  writeFileSync(path.join(DIR, "decisions-check", `${SET}-${KIND}.tsv`), tsv);
} else {
  for (const r of fill) { const row = set.k.find((k) => `${SET}-${k[0]}` === r.id); if (row[2]) throw new Error(`英語名が既にあります: ${r.id}`); row[2] = r.en; }
  writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  // 2回目以降の実行（前回空欄だった行をあとから入れる等）では、前回の根拠に追記・更新する
  mkdirSync(path.join(DIR, "decisions"), { recursive: true });
  const DEC = path.join(DIR, "decisions", `${SET}-${KIND}.tsv`);
  const merged = new Map();
  if (existsSync(DEC)) for (const l of readFileSync(DEC, "utf8").split(/\r?\n/).slice(1).filter(Boolean)) { const v = l.split("\t"); merged.set(v[0], Object.fromEntries(COLS.map((c, i) => [c, v[i] ?? ""]))); }
  for (const r of rows) merged.set(r.id, r);
  const all = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  writeFileSync(DEC, [COLS.join("\t"), ...all.map((r) => COLS.map((c) => r[c]).join("\t"))].join("\n") + "\n");
  const IDS = path.join(DIR, "decisions", `${SET}-${KIND}-changed-card-ids.txt`);
  const ids = new Set(existsSync(IDS) ? readFileSync(IDS, "utf8").split(/\r?\n/).filter(Boolean) : []);
  for (const r of fill) ids.add(r.id);
  writeFileSync(IDS, [...ids].join("\n") + (ids.size ? "\n" : ""));
  const allFill = all.filter((r) => r.status === "入れる");
  const allReasons = {};
  for (const r of all.filter((r) => r.status !== "入れる")) allReasons[r.note] = (allReasons[r.note] || 0) + 1;
  const SUM = path.join(DIR, "summary.json");
  const sum = existsSync(SUM) ? JSON.parse(readFileSync(SUM, "utf8")) : {};
  sum[`${SET}-${KIND}`] = { ...result, targets: all.length, filled: allFill.length, filledByRule: allFill.filter((r) => r.note === "規則と Bulbapedia が一致").length, blank: all.length - allFill.length, blankReasons: allReasons };
  writeFileSync(SUM, JSON.stringify(sum, null, 1) + "\n");
}
