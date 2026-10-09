// SR・MA の英語の表記を変える前後の出品文の例（2026-10-10）。npx vitest run scripts/audit/rarity-label-examples.test.jsx で例を書き出す
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import { DEFAULT_FORM, applyCandidateToForm, buildSingleTitle, buildItemSpecifics } from "../../src/App.jsx";
const IDS = ["SV2a-195", "SV1S-091", "S12a-247", "SM12a-201", "XY3-101", "M2a-224", "M2a-226"];
test.skipIf(!process.env.OUT)("examples", () => {
  const out = [];
  for (const id of IDS) {
    const c = id.slice(0, id.lastIndexOf("-")), n = id.slice(id.lastIndexOf("-") + 1);
    const set = data.find((s) => s.c === c); const k = set.k.find((x) => x[0] === n);
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card: k });
    const sp = buildItemSpecifics(f);
    out.push({ id, title: buildSingleTitle(f), rarity: (Array.isArray(sp) ? sp : Object.entries(sp)).map((x) => (Array.isArray(x) ? x : [x.name ?? x.label, x.value])).filter(([k]) => /Rarity/i.test(k)) });
  }
  // SR・MA の全行で、タイトルにフルスペルが入る行の数と例
  const all = { SR: { rows: 0, withFull: 0, ex: [] }, MA: { rows: 0, withFull: 0, ex: [] } };
  for (const set of data) for (const k of set.k) {
    if (!all[k[3]]) continue;
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card: k });
    const t = buildSingleTitle(f); const a = all[k[3]]; a.rows++;
    if (/(Special|Super) Rare|Mega Attack Rare/.test(t)) { a.withFull++; if (a.ex.length < 3) a.ex.push(`${set.c}-${k[0]}: ${t}`); }
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify({ examples: out, all }, null, 1));
});
