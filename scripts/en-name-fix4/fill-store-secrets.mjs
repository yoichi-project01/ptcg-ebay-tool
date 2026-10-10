#!/usr/bin/env node
// 店舗の情報で補完した HR・UR（scripts/secret-sources/*added-card-ids.txt、公式サイトに無くイラストレーターが分からない）の英語名を入れる（2026-10-10）。
//   node scripts/en-name-fix4/fill-store-secrets.mjs [--set <弾>] [--apply]   根拠は decisions.tsv、変更は changed.tsv に追記
// 1つ目の情報源: Bulbapedia の日本版の一覧の同じ番号の英語名（en-name-fix2/decisions.tsv の bpName。分母が弾の総数と一致する節から書き写したもの）。
// 2つ目の情報源（どちらか）:
//   ポケモン: 日本語名から作った名前（PokeAPI の種族名＋地方名・メガ・ex/V/VMAX/VSTAR/GX/EX 等。fill-common-en.mjs と同じ規則）が Bulbapedia の名前と同じ
//   ポケモンで規則で作れない名前は、同じ日本語名のほかの行の英語名が1つだけで Bulbapedia の名前と同じとき
//   トレーナーズ・エネルギー: 同じ日本語名のほかの行（公式で確かめた行・これまでに2つの情報源で入れた行）の英語名が1つだけで Bulbapedia の名前と同じ、
//     かつ TCGdex 英語版に同じ名前・同じ種類（Supporter/Item/Tool/Stadium/Energy）のカードがある
// イラストレーターは使わない（店舗の情報で足したカードは公式・TCGdex にイラストレーターが無い）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const APPLY = process.argv.includes("--apply"), ONLY = arg("--set");
const raw = fs.readFileSync(DATA, "utf8"); const data = JSON.parse(raw);
const store = new Set();
for (const f of fs.readdirSync(path.join(ROOT, "scripts", "secret-sources")).filter((f) => /added-card-ids\.txt$/.test(f)))
  for (const l of fs.readFileSync(path.join(ROOT, "scripts", "secret-sources", f), "utf8").split(/\r?\n/)) if (l.trim()) store.add(l.trim());
const dec = new Map(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix2", "decisions.tsv"), "utf8").split(/\r?\n/).slice(1).map((l) => l.split("\t")).map((r) => [r[0], r]));
const species = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species;
const J = new Map(species.map((s) => [s.ja.normalize("NFKC"), s.en.replace(/’/g, "'")]));
const SUF = [["V-UNION", " V-UNION"], ["VMAX", " VMAX"], ["VSTAR", " VSTAR"], ["V", " V"], ["ex", " ex"], ["EX", "-EX"], ["GX", "-GX"], ["BREAK", " BREAK"]];
const PRE = { アローラ: "Alolan ", ガラル: "Galarian ", ヒスイ: "Hisuian ", パルデア: "Paldean ", かがやく: "Radiant ", ひかる: "Shining " };
function predict(ja, sr) {
  let n = ja.normalize("NFKC").replace(/\s+/g, " ").trim(), suf = "", pre = "";
  for (const [k, v] of SUF) if (n.endsWith(k) && n.length > k.length) { suf = v; n = n.slice(0, -k.length).trim(); break; }
  for (const p of [...Object.keys(PRE), "メガ"]) if (!J.has(n) && n.startsWith(p) && J.has(n.slice(p.length).trim())) { pre = p; n = n.slice(p.length).trim(); break; }
  if (!J.has(n)) return null;
  const head = pre === "メガ" ? (["SV", "M"].includes(sr) ? "Mega " : "M ") : pre ? PRE[pre] : "";
  return head + J.get(n) + suf;
}
const key = (s) => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-–.':]/g, "");
// 同じ日本語名のほかの行の英語名（店舗の情報で足した行は除く）
const jaEn = new Map();
for (const s of data) for (const k of s.k) if (k[2] && !store.has(`${s.c}-${k[0]}`)) { const m = jaEn.get(k[1]) || new Set(); m.add(k[2]); jaEn.set(k[1], m); }
const tcg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", ".cache", "tcgdex-en-Trainer.json"), "utf8")).data.cards
  .concat(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", ".cache", "tcgdex-en-Energy.json"), "utf8")).data.cards);
const TYPE = { Supporter: ["Supporter"], Item: ["Item", "Tool"], "Pokémon Tool": ["Tool"], Stadium: ["Stadium"], Energy: [] };
const rows = [], lines = [];
for (const s of data) {
  if (ONLY && s.c !== ONLY) continue;
  for (const k of s.k) {
    const id = `${s.c}-${k[0]}`;
    if (k[2] || !store.has(id)) continue;
    const d = dec.get(id), bp = d?.[5] || "", bpType = d?.[6] || "";
    let after = "", note = "";
    if (!bp) note = "Bulbapedia の一覧に無い";
    else if (!(bpType in TYPE)) {
      const p = predict(k[1], s.sr);
      if (p && key(p) === key(bp)) { after = bp; note = `ポケモン: Bulbapedia「${bp}」と日本語名から作った名前「${p}」が一致`; }
      else {
        // 規則で作れない名前（れんげき〜・こくば〜 等）は、同じ日本語名のほかの行の英語名が1つだけで Bulbapedia と同じなら入れる
        const others = [...(jaEn.get(k[1]) || [])];
        if (!p && others.length === 1 && key(others[0]) === key(bp)) { after = bp; note = `ポケモン: Bulbapedia「${bp}」と同じ日本語名のほかの行の英語名「${others[0]}」が一致`; }
        else note = p ? `日本語名から作った名前「${p}」と Bulbapedia「${bp}」が違う` : `日本語名から名前を作れない（ほかの行の英語名 ${others.length} 通り）`;
      }
    } else {
      const others = [...(jaEn.get(k[1]) || [])];
      const okT = bpType === "Energy" ? tcg.some((c) => c.category === "Energy" && key(c.name) === key(bp)) : tcg.some((c) => key(c.name) === key(bp) && TYPE[bpType].includes(c.trainerType));
      if (others.length === 1 && key(others[0]) === key(bp) && okT) { after = bp; note = `トレーナーズ: Bulbapedia「${bp}」・同じ日本語名のほかの行の英語名「${others[0]}」・TCGdex 英語版に同じ名前の ${bpType}`; }
      else note = others.length !== 1 ? `同じ日本語名のほかの行の英語名が ${others.length} 通り（${others.join(" / ")}）` : key(others[0]) !== key(bp) ? `ほかの行の英語名「${others[0]}」と Bulbapedia「${bp}」が違う` : `TCGdex 英語版に同じ名前の ${bpType} が無い`;
    }
    rows.push([id, k[1], k[3], bp, bpType, after || "", after ? "入れる" : "空欄のまま", note].join("\t"));
    if (after && APPLY) { k[2] = after; lines.push([id, k[1], "", after, note].join("\t")); }
  }
}
const out = path.join(__dirname, ONLY ? `decisions-${ONLY}.tsv` : "decisions.tsv");
fs.writeFileSync(out, ["id\tja\trarity\tbpName\tbpType\ten\tstatus\tnote", ...rows].join("\n") + "\n");
if (APPLY && lines.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  const T = path.join(__dirname, "changed.tsv"); if (!fs.existsSync(T)) fs.writeFileSync(T, "card_id\tja\tbefore\tafter\tbasis\n");
  fs.appendFileSync(T, lines.map((l) => l + "\n").join(""));
}
const c = {}; for (const r of rows) { const st = r.split("\t")[6]; c[st] = (c[st] || 0) + 1; }
console.log(ONLY || "all", JSON.stringify(c));
