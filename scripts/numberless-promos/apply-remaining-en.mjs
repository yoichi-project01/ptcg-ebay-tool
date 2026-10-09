#!/usr/bin/env node
// 番号の無いプロモの残り（大会賞品以外、2026-10-09 に追加した136枚）の英語名を、2つの情報源の一致で入れる（2026-10-09）。
//   node scripts/numberless-promos/apply-remaining-en.mjs --set DP-P            照合して remaining-en-{弾}-check.tsv に書く（cardData は変えない）
//   node scripts/numberless-promos/apply-remaining-en.mjs --set DP-P --apply    cardData.json に書き、remaining-en-{弾}.tsv・remaining-en-{弾}-changed-card-ids.txt を残す
// 1つ目の情報源: Bulbapedia の「Unnumbered Promotional cards (TCG)」の Japanese の節・「10th Movie Commemoration Set (TCG)」・SV-P の一覧
//   （ブラウザで wikitext から取り出した、cardID ごとの行。en-bulbapedia-2026-10.txt、SHA-256 をブラウザの値と照合済み
//   ffa614de9fa27cdb0d118e0c1d2be9912cb0c6c0a9ea7495feb7a96d81c08597）。行と cardID の対応は配布の説明・年・種類で決めた。
//   下の BP は各行から読んだ英語名・種類で、スクリプトはその名前が行に書かれていることを確かめる。
// 2つ目の情報源（これまでと同じ確かめ方。fill-common-en.mjs と同じ）:
//   ポケモン: 日本語名から作った名前（種族名＋メガ→M・EX→-EX）が Bulbapedia と一致。作れない・食い違うときは TCGdex 英語版に
//     同じ名前・同じイラストレーター（公式 details.php の本文の欄）のポケモンがあること。
//   トレーナーズ: TCGdex 英語版に同じ名前・同じ種類（サポート・グッズ・スタジアム）・同じイラストレーターのカードがあること。
//   特殊エネルギー（イラストレーターの記載なし）: TCGdex 英語版に同じ名前のエネルギーがあること（2026-10-07 のユーザー判断と同じ）。
// TCGdex だけ・Bulbapedia だけで確かめられるものは入れない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const FIX3 = path.join(ROOT, "scripts", "en-name-fix3");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const SET = arg("--set");
const APPLY = process.argv.includes("--apply");
if (!SET) throw new Error("--set で弾を指定してください");

// cardID → [Bulbapedia の英語名, Bulbapedia の種類]
const BP = {
  5000: ["Striking Back Mewtwo", "Psychic"], 5001: ["Explosive Birth Lugia", "Colorless"], 5002: ["Crystal Tower's Entei", "Fire"],
  5003: ["Timeless Celebi", "Grass"], 5004: ["Alto Mare's Latias", "Colorless"], 5005: ["Alto Mare's Latios", "Colorless"],
  5006: ["Seven Nights Jirachi", "Metal"], 5007: ["Visitor Deoxys", "Psychic"], 5008: ["Wave-Guiding Hero Lucario", "Fighting"],
  5009: ["Tree of Beginning's Mew", "Psychic"], 5010: ["Prince of the Sea Manaphy", "Water"],
  7000: ["Championship Arena", "Stadium"], 7002: ["Darkness Energy", "Energy"], 7003: ["Metal Energy", "Energy"],
  7004: ["Darkness Energy", "Energy"], 7005: ["Metal Energy", "Energy"], 7006: ["Bebe's Search", "Supporter"],
  7007: ["Time-Space Distortion", "Trainer"], 7008: ["Mysterious Pearl", "Trainer"], 7009: ["Miracle Diamond", "Trainer"],
  7010: ["Skull Fossil", "Trainer"], 7011: ["Armor Fossil", "Trainer"], 7013: ["Champion's League", "Stadium"],
  7014: ["Tropical Wind", "Trainer"], 20514: ["Tropical Wind", "Trainer"],
  7015: ["Pokémon Pal City", "Stadium"], 7016: ["Pokémon Pal City", "Stadium"], 7017: ["Pokémon Pal City", "Stadium"],
  7018: ["Pokémon Pal City", "Stadium"], 7019: ["Pokémon Pal City", "Stadium"], 7020: ["Pokémon Pal City", "Stadium"],
  7021: ["Pokémon Pal City", "Stadium"], 7022: ["Roseanne's Research", "Supporter"], 7023: ["Touch Exchange!", "Trainer"],
  7024: ["Professor Oak's Visit", "Supporter"], 18504: ["Cynthia's Feelings", "Supporter"], 18505: ["Buck's Training", "Supporter"],
  20026: ["Luxury Ball", "Trainer"],
  24332: ["Spiky-eared Pichu", "Lightning"], 24333: ["Spiky-eared Pichu", "Lightning"], 24334: ["Spiky-eared Pichu", "Lightning"],
  24343: ["Spiky-eared Pichu", "Lightning"], 24346: ["Spiky-eared Pichu", "Lightning"], 24347: ["Spiky-eared Pichu", "Lightning"],
  24335: ["Arceus", "Colorless"], 24337: ["Arceus", "Colorless"], 24339: ["Arceus", "Colorless"], 24341: ["Arceus", "Colorless"],
  24344: ["Arceus", "Colorless"], 24348: ["Arceus", "Colorless"], 24350: ["Arceus", "Colorless"], 24351: ["Tropical Wind", "Trainer"],
  26199: ["Illusion's Zorua", "Darkness"], 26201: ["Illusion's Zorua", "Darkness"], 26202: ["Illusion's Zorua", "Darkness"],
  26203: ["Illusion's Zorua", "Darkness"], 26206: ["Illusion's Zorua", "Darkness"], 26208: ["Illusion's Zorua", "Darkness"],
  26209: ["Illusion's Zorua", "Darkness"], 26200: ["Illusion's Zoroark", "Darkness"], 26204: ["Illusion's Zoroark", "Darkness"],
  26205: ["Illusion's Zoroark", "Darkness"], 26207: ["Illusion's Zoroark", "Darkness"], 26210: ["Illusion's Zoroark", "Darkness"],
  26211: ["Tropical Tidal Wave", "Item"],
  27759: ["Heavy Ball", "Item"], 27760: ["Level Ball", "Item"], 28080: ["Enhanced Hammer", "Item"], 28081: ["Max Potion", "Item"],
  28636: ["Tropical Beach", "Stadium"], 28907: ["Tropical Beach", "Stadium"], 28650: ["Team Plasma Badge", "Item"],
  30166: ["Team Flare Grunt", "Supporter"], 30227: ["Muscle Band", "Item"], 30228: ["Tierno", "Supporter"], 32205: ["Tierno", "Supporter"],
  30365: ["Protection Cube", "Item"], 30369: ["Blacksmith", "Supporter"], 30372: ["Greninja", "Darkness"],
  30587: ["Pokémon Card Gym Medal", "Item"], 30588: ["Palace Book", "Item"], 30657: ["Absol-EX", "Darkness"], 30658: ["M Absol-EX", "Darkness"],
  30659: ["Robo Substitute", "Item"], 30803: ["Pikachu", "Lightning"],
  31295: ["Pikachu", "Lightning"], 31296: ["Pikachu", "Lightning"], 31297: ["Pikachu", "Lightning"], 31298: ["Pikachu", "Lightning"],
  31299: ["Pikachu", "Lightning"], 31300: ["Pikachu", "Lightning"], 32011: ["Pikachu", "Lightning"], 32361: ["Pikachu", "Lightning"],
  31080: ["M Swampert-EX", "Water"], 31082: ["Mega Turbo", "Item"], 31291: ["Goomy", "Dragon"], 31292: ["Sableye", "Darkness"],
  31293: ["Gourgeist", "Psychic"], 31294: ["Mudkip", "Water"], 31467: ["Gyarados", "Water"], 31569: ["Bronzong", "Metal"],
  31571: ["Double Dragon Energy", "Energy"], 32324: ["Double Dragon Energy", "Energy"], 31575: ["Max Potion", "Item"],
  32142: ["M Garchomp-EX", "Dragon"], 32143: ["Garchomp Spirit Link", "Item"], 32144: ["Fighting Fury Belt", "Item"],
  32148: ["Psyduck", "Water"], 32197: ["Shauna", "Supporter"], 32198: ["Trevor", "Supporter"], 32199: ["Potion", "Item"],
  32200: ["Red Card", "Item"], 32201: ["Max Revive", "Item"], 32202: ["Switch", "Item"], 32203: ["Pokémon Catcher", "Item"],
  32204: ["Professor Sycamore", "Supporter"], 32326: ["Absol", "Darkness"], 32357: ["Teammates", "Supporter"],
  32358: ["Magikarp", "Water"], 32359: ["Mewtwo-EX", "Psychic"], 32360: ["Mew", "Psychic"],
  33318: ["Pitch's Pikachu", "Lightning"], 33319: ["Pitch's Pikachu", "Lightning"],
  33300: ["Rare Candy", "Item"], 33301: ["Rare Candy", "Item"], 33302: ["Rare Candy", "Item"], 34382: ["Palace Book", "Item"],
  34853: ["Ultra Ball", "Item"], 34854: ["Hau", "Supporter"], 34855: ["Sophocles", "Supporter"],
  44243: ["Paradise Resort", "Stadium"], 46228: ["Paradise Resort", "Stadium"], 48261: ["Paradise Resort", "Stadium"],
};
// Bulbapedia の行（cardID → 行）。一覧に無い cardID（31066 バシャーモEX・31067 ケムッソ・31068 ジラーチ）は「0」の行
const lines = new Map(fs.readFileSync(path.join(__dirname, "en-bulbapedia-2026-10.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.split(" ")[0], l]));
const bpLineHas = (cid, name) => {
  const l = lines.get(String(cid)) ?? "";
  // 行の中の書き方: M Absol-EX は {{Mega}}[[M Absol-EX ...]]、Absol-EX は [[Absol-EX ...]]、Darkness Energy は {{OBP|Darkness Energy|Special}}
  return l.includes(name);
};

// --- 比較用（fill-common-en.mjs と同じ） ---
const norm = (s) => (s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const key = (s) => { const n = norm(s); const tail = /\bex$/.test(n) ? "|ex" : /EX$/.test(n) ? "|EX" : ""; return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-–—.':!]/g, "") + tail; };
const illKey = (s) => norm(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const sameIll = (a, b) => { const x = illKey(a), y = illKey(b); if (!x || !y) return false; return x === y || (Math.min(x.length, y.length) >= 8 && lev(x, y) <= 2); };

// --- 種族名の規則（fill-common-en.mjs と同じ） ---
const species = JSON.parse(fs.readFileSync(path.join(FIX3, "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const SUF = { VMAX: " VMAX", VSTAR: " VSTAR", V: " V", ex: " ex", EX: "-EX", GX: "-GX", BREAK: " BREAK" };
const PRE = { アローラ: "Alolan ", ガラル: "Galarian ", ヒスイ: "Hisuian ", パルデア: "Paldean ", メガ: "M " };
function predict(name, sr) {
  let n = name.normalize("NFKC").replace(/\s+/g, " ").trim(), suf = "", pre = "";
  for (const k of Object.keys(SUF)) if (n.endsWith(k) && n.length > k.length) {
    const b = n.slice(0, -k.length).trim();
    if (J.has(b) || Object.keys(PRE).some((p) => b.startsWith(p) && J.has(b.slice(p.length).trim()))) { suf = k; n = b; break; }
  }
  for (const p of Object.keys(PRE)) if (!J.has(n) && n.startsWith(p) && J.has(n.slice(p.length).trim())) { pre = p; n = n.slice(p.length).trim(); }
  if (!J.has(n)) return "";
  let e = J.get(n);
  if (pre === "メガ") e = (["SV", "M"].includes(sr) ? "Mega " : "M ") + e; else if (pre) e = PRE[pre] + e;
  return e + (suf ? SUF[suf] : "");
}

// --- TCGdex 英語版 ---
const en = [];
for (const t of ["Pokemon", "Trainer", "Energy"]) en.push(...JSON.parse(fs.readFileSync(path.join(FIX3, ".cache", `tcgdex-en-${t}.json`), "utf8")).data.cards.filter((c) => !/^(A\d|B\d|P-A)/.test(c.id)));
const enByKey = new Map();
for (const c of en) (enByKey.get(key(c.name)) || enByKey.set(key(c.name), []).get(key(c.name))).push(c);

// --- 公式 details.php の本文（種類・イラストレーター） ---
const det = JSON.parse(fs.readFileSync(path.join(__dirname, "remaining-details.json"), "utf8"));
// 種類はイラストレーターの欄の直後の4項目（DP 期のポケモンは「たね」「LV.」「100」「HP」の順。化石のグッズは「HP」「50」「グッズ」の順なので、種類の語を先に見る。効果文の中の語は数えない）
const KINDS = { サポート: "Supporter", スタジアム: "Stadium", ポケモンのどうぐ: "Tool", グッズ: "Item", トレーナー: "Trainer", 特殊エネルギー: "Energy" };
const jaKind = (text) => {
  const i = text.indexOf("イラストレーター");
  const head = i >= 0 ? text.slice(i + 2, i + 6) : text;
  for (const t of head) if (KINDS[t]) return KINDS[t];
  return head.includes("HP") ? "Pokemon" : null;
};

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
const plans = fs.readFileSync(path.join(__dirname, "remaining-plans.txt"), "utf8").split(/\r?\n/).filter(Boolean)
  .map((f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"))).filter((p) => p.set === SET);
if (!plans.length) throw new Error(`計画ファイルがありません: ${SET}`);
const rows = [];
for (const plan of plans) for (const c of plan.cards) {
  const row = set.k.find((k) => k[0] === `X${c.cardId}`);
  if (!row) throw new Error(`行がありません: ${SET}-X${c.cardId}`);
  const d = det[c.cardId];
  const text = d.text;
  const ill = text[text.indexOf("イラストレーター") + 1] ?? "";
  const kind = jaKind(text);
  const [bpName, bpType] = BP[c.cardId] ?? ["", ""];
  const r = { id: `${SET}-X${c.cardId}`, ja: row[1], kind: kind ?? "", illustrator: text.includes("イラストレーター") ? ill : "", bpName, bpType, rule: "", tcgdexIds: "", status: "空欄", note: "", en: "" };
  rows.push(r);
  if (row[2]) { r.status = "既にある"; r.note = row[2]; continue; }
  if (!bpName) { r.note = "Bulbapedia の一覧に無い"; continue; }
  if (!bpLineHas(c.cardId, bpName)) throw new Error(`Bulbapedia の行に名前がありません: ${c.cardId} ${bpName}`);
  if (kind === "Pokemon") {
    r.rule = predict(plan.name, set.sr);
    if (r.rule && key(r.rule) === key(bpName)) { r.status = "入れる"; r.note = "規則と Bulbapedia が一致"; r.en = bpName; continue; }
    if (!r.illustrator) { r.note = (r.rule ? "規則と Bulbapedia が食い違う・" : "規則で作れない・") + "イラストレーターが分からない"; continue; }
    const same = (enByKey.get(key(bpName)) || []).filter((x) => x.category === "Pokemon");
    const m = same.filter((x) => sameIll(x.illustrator, r.illustrator));
    if (m.length) { r.tcgdexIds = m.map((x) => x.id).join(" "); r.status = "入れる"; r.note = (r.rule ? "規則と食い違うが" : "規則で作れないが") + " TCGdex 英語版で同じ名前・イラストレーターを確認"; r.en = bpName; continue; }
    r.note = (r.rule ? "規則と Bulbapedia が食い違う・" : "規則で作れない・") + (same.length ? "英語版の同じ名前のカードとイラストレーターが違う" : "英語版に同じ名前のポケモンが無い");
    continue;
  }
  if (!kind) { r.note = "公式の本文から種類が分からない"; continue; }
  if (kind === "Energy") {
    if (bpType !== "Energy") { r.note = `Bulbapedia の種類が違う（${bpType}）`; continue; }
    const cands = (enByKey.get(key(bpName)) || []).filter((x) => x.category === "Energy");
    if (!cands.length) { r.note = "英語版に同じ名前のエネルギーが無い"; continue; }
    if (r.illustrator) {
      const m = cands.filter((x) => sameIll(x.illustrator, r.illustrator));
      if (!m.length) { r.note = "英語版の同じ名前のカードとイラストレーターが違う"; continue; }
      r.tcgdexIds = m.map((x) => x.id).join(" "); r.status = "入れる"; r.note = "Bulbapedia と TCGdex 英語版（同じ名前・種類・イラストレーター）が一致"; r.en = bpName; continue;
    }
    r.tcgdexIds = cands.map((x) => x.id).join(" "); r.status = "入れる"; r.note = "特殊エネルギー: Bulbapedia と TCGdex 英語版で同じ名前のエネルギーを確認（イラストレーターの記載なし）"; r.en = bpName; continue;
  }
  // トレーナーズ: 公式の種類と Bulbapedia の種類が合うこと（DP 期は Bulbapedia も公式も「トレーナー」のことがある）
  const okType = bpType === "Trainer" || kind === "Trainer" || bpType === kind || (bpType === "Item" && kind === "Tool");
  if (!okType) { r.note = `公式の種類（${kind}）と Bulbapedia の種類（${bpType}）が違う`; continue; }
  const want = kind === "Trainer" ? (bpType === "Trainer" ? null : bpType) : kind;
  const sameType = (t) => !want || t === want || (want === "Item" && t === "Tool") || (want === "Tool" && t === "Item");
  const cands = (enByKey.get(key(bpName)) || []).filter((x) => x.category === "Trainer" && sameType(x.trainerType));
  if (!cands.length) { r.note = "英語版に同じ名前・種類のカードが無い"; continue; }
  if (!r.illustrator) { r.note = "イラストレーターが分からない"; continue; }
  const m = cands.filter((x) => sameIll(x.illustrator, r.illustrator));
  r.tcgdexIds = m.map((x) => x.id).join(" ");
  if (m.length) { r.status = "入れる"; r.note = "Bulbapedia と TCGdex 英語版（同じ名前・種類・イラストレーター）が一致"; r.en = bpName; }
  else r.note = "英語版の同じ名前のカードとイラストレーターが違う";
}
const COLS = ["id", "ja", "kind", "illustrator", "bpName", "bpType", "rule", "tcgdexIds", "status", "note", "en"];
const tsv = [COLS.join("\t"), ...rows.map((r) => COLS.map((c) => String(r[c]).replace(/[\t\n]/g, " ")).join("\t"))].join("\n") + "\n";
fs.writeFileSync(path.join(__dirname, `remaining-en-${SET}${APPLY ? "" : "-check"}.tsv`), tsv);
const fill = rows.filter((r) => r.status === "入れる");
if (APPLY) {
  for (const r of fill) set.k.find((k) => `${SET}-${k[0]}` === r.id)[2] = r.en;
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(__dirname, `remaining-en-${SET}-changed-card-ids.txt`), fill.map((r) => r.id).join("\n") + (fill.length ? "\n" : ""));
}
const reasons = {}; for (const r of rows) if (r.status !== "入れる") reasons[r.note] = (reasons[r.note] || 0) + 1;
console.log(JSON.stringify({ set: SET, targets: rows.length, fill: fill.length, reasons }));
