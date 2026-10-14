#!/usr/bin/env node
// TCGdex 英語版の全カード（名前・イラストレーター・種類・図鑑番号）のキャッシュを取り直す（2026-10-14〜）。
//   node scripts/refresh-tcgdex-en-cache.mjs
// fill-common-en.mjs（en-name-fix3/.cache）・fill-high-rarity-en.mjs（en-name-fix2/.cache）などが読む tcgdex-en-{Pokemon,Trainer,Energy}.json を、
// それらのスクリプトの loadEn と同じ GraphQL の問い合わせで作り直して両方に置く。英語版の新しい弾が出た後に使う。キャッシュは .gitignore 対象
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRS = ["en-name-fix2", "en-name-fix3"].map((d) => path.join(__dirname, d, ".cache"));
for (const cat of ["Pokemon", "Trainer", "Energy"]) {
  const all = [];
  const PER = 500; // 2000 件ずつだと途中で接続が切れることがある（2026-10-14）
  for (let p = 1; p < 200; p++) {
    const q = `{ cards(filters:{category:"${cat}"}, pagination:{page:${p}, itemsPerPage:${PER}}) { id name illustrator category trainerType energyType dexId } }`;
    let c = null;
    for (let i = 0; i < 5 && !c; i++) {
      try {
        const r = await fetch("https://api.tcgdex.net/v2/graphql", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        c = (await r.json()).data.cards;
      } catch (e) { console.log(`  ${cat} ページ ${p}: ${e.message}、待って取り直す`); await new Promise((res) => setTimeout(res, 5000 * (i + 1))); }
    }
    if (!c) throw new Error(`${cat} ページ ${p} を取れなかった（キャッシュは書き換えていない）`);
    all.push(...c);
    if (c.length < PER) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  for (const d of DIRS) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `tcgdex-en-${cat}.json`), JSON.stringify({ data: { cards: all } })); }
  console.log(cat, all.length);
}
