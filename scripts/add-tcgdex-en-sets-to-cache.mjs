#!/usr/bin/env node
// TCGdex 英語版の弾を1枚ずつ（REST /v2/en/cards/{id}）取って、英語名のキャッシュ（tcgdex-en-*.json）に足す（2026-10-14〜）。
//   node scripts/add-tcgdex-en-sets-to-cache.mjs 30th 30th-c
// 新しい弾が TCGdex の弾の一覧（/v2/en/sets）にはあるのに、全カードの問い合わせ（GraphQL。refresh-tcgdex-en-cache.mjs）にまだ出てこないときに使う。
// 足すのは refresh-tcgdex-en-cache.mjs と同じ項目（id・name・illustrator・category・trainerType・energyType・dexId）。同じ id が既にあれば足さない
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRS = ["en-name-fix2", "en-name-fix3"].map((d) => path.join(__dirname, d, ".cache"));
const sets = process.argv.slice(2);
if (!sets.length) throw new Error("弾の id を指定してください（例 30th）");
const get = async (url) => {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) }); if (r.ok) return r.json(); if (r.status === 404) return null; throw new Error(`HTTP ${r.status}`); }
    catch (e) { await new Promise((res) => setTimeout(res, 3000 * (i + 1))); }
  }
  throw new Error(`取れなかった: ${url}`);
};
const add = { Pokemon: [], Trainer: [], Energy: [] };
for (const id of sets) {
  const s = await get(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(id)}`);
  console.log(id, s.name, s.cards.length);
  for (const c of s.cards) {
    const d = await get(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(c.id)}`);
    if (!d) continue;
    const rec = { id: d.id, name: d.name, illustrator: d.illustrator ?? null, category: d.category, trainerType: d.trainerType ?? null, energyType: d.energyType ?? null, dexId: d.dexId ?? null };
    if (add[d.category]) add[d.category].push(rec);
    await new Promise((res) => setTimeout(res, 300));
  }
}
for (const d of DIRS) {
  for (const [cat, recs] of Object.entries(add)) {
    const f = path.join(d, `tcgdex-en-${cat}.json`);
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const have = new Set(j.data.cards.map((c) => c.id));
    const n = recs.filter((r) => !have.has(r.id));
    j.data.cards.push(...n);
    fs.writeFileSync(f, JSON.stringify(j));
    if (d === DIRS[0]) console.log(cat, `+${n.length}`);
  }
}
