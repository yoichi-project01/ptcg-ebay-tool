// Item Specifics の Character を直す前後の例（2026-10-11）。OUT=… npx vitest run scripts/audit/character-examples.test.jsx で書き出す
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import { DEFAULT_FORM, applyCandidateToForm, buildItemSpecifics } from "../../src/App.jsx";
const IDS = ["SV2a-006", "PMCG5-043", "SV-P-161", "S4a-176", "S-P-128", "SV2a-161", "SV10-091", "XY10-B-077", "CP6-084", "SD-119", "SM5S-059",
  "XY2-079", "M1L-083", "S12a-145", "SV1a-070", "SV10-098", "PMCG1-091"];
test.skipIf(!process.env.OUT)("examples", () => {
  const out = {};
  for (const id of IDS) {
    const c = id.slice(0, id.lastIndexOf("-")), n = id.slice(id.lastIndexOf("-") + 1);
    const set = data.find((s) => s.c === c); const k = set.k.find((x) => x[0] === n);
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card: k });
    const sp = Object.fromEntries(buildItemSpecifics(f));
    out[id] = { ja: k[1], en: k[2], cardName: sp["Card Name"] ?? "", character: sp["Character"] ?? "（出力なし）" };
  }
  // 全行で Character がどう変わるか（件数）
  const counts = {};
  for (const set of data) for (const k of set.k) {
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card: k });
    const ch = Object.fromEntries(buildItemSpecifics(f))["Character"] ?? "";
    counts[`${set.c}-${k[0]}`] = ch;
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify({ examples: out, all: counts }, null, 1));
});
