// DP-P の LV.X カード9行の英語名を「〜 LV.X」に直す（2026-10-08）。
// 以前 fill-common-en.mjs の「規則の名前でも TCGdex を確かめる」で、TCGdex 英語版が DP 期の LV.X を "Lucario" と名付けているため LV.X 抜けで入っていた。
// 直す条件（すべて満たすときだけ）: Bulbapedia の名前が「今の英語名 + " LV.X"」、以前一致した TCGdex 英語版のカードが stage LEVEL-UP か rarity に LV.X、
// 公式 details.php の段階が「レベルアップ」。node scripts/fix-lvx-en.mjs [--apply]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const DATA = path.join(ROOT, "src", "cardData.json");
const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
const dec = fs.readFileSync(path.join(ROOT, "scripts/en-name-fix3/decisions/DP-P-pokemon.tsv"), "utf8").split(/\r?\n/).slice(1).map((l) => l.split("\t"));
const promo = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/promo-progress/DP-P.json"), "utf8"));
const NUMS = ["004", "058", "071", "075", "076", "078", "092", "105", "107"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); };
const set = d.find((s) => s.c === "DP-P");
const out = [];
for (const n of NUMS) {
  const id = `DP-P-${n}`;
  const k = set.k.find((x) => x[0] === n);
  const row = dec.filter((x) => x[0] === id).pop();
  const bp = row[4], en = k[2], tcg = row[8].split(" ").filter(Boolean);
  const r = { id, ja: k[1], before: en, bpName: bp, tcgdex: [], official: "", after: "", ok: false, note: "" };
  out.push(r);
  if (bp !== `${en} LV.X`) { r.note = "Bulbapedia の名前が「今の英語名 + LV.X」でない"; continue; }
  for (const t of tcg) { const j = JSON.parse(await get(`https://api.tcgdex.net/v2/en/cards/${t}`)); r.tcgdex.push(`${t}:${j.name}/${j.stage}/${j.rarity}`); await sleep(1000); }
  const tcgOk = r.tcgdex.some((x) => /LEVEL-UP|LV\.X/.test(x));
  const cid = Object.entries(promo).find(([, v]) => v?.number === n)?.[0];
  const html = await get(`https://www.pokemon-card.com/card-search/details.php/card/${cid}`); await sleep(2500);
  r.official = `${cid}:${(html.match(/<span class="type">([^<]*)<\/span>/) || [])[1] ?? ""}`;
  const offOk = /レベルアップ/.test(r.official);
  if (!tcgOk || !offOk) { r.note = `確認できない（TCGdex ${tcgOk} / 公式 ${offOk}）`; continue; }
  r.ok = true; r.after = bp; r.note = "Bulbapedia・TCGdex 英語版（同じカードが LEVEL-UP）・公式（段階 レベルアップ）が一致";
  if (APPLY) k[2] = bp;
}
console.table(out.map((r) => ({ id: r.id, before: r.before, after: r.after, ok: r.ok, tcgdex: r.tcgdex.join(" "), official: r.official, note: r.note })));
const dir = path.join(ROOT, "scripts/en-name-fix3");
if (APPLY) {
  const raw = fs.readFileSync(DATA, "utf8");
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(dir, "lvx-fix-2026-10-08.json"), JSON.stringify(out, null, 1) + "\n");
  fs.writeFileSync(path.join(dir, "lvx-fix-changed-card-ids.txt"), out.filter((r) => r.ok).map((r) => r.id).join("\n") + "\n");
}
