// ホロ版・ノーマル版を分けたカード（DP3・DP4）のタイトルと Item Specifics を直す前後で比べる例（2026-10-12）。
//   OUT=… npx vitest run scripts/audit/holo-finish-examples.test.jsx で書き出す
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import { DEFAULT_FORM, applyCandidateToForm, buildItemSpecifics, buildSingleTitle } from "../../src/App.jsx";
const IDS = ["DP3-X3119", "DP3-X3120", "DP3-X3121", "DP3-X3122", "DP4-X10502", "DP4-X10503", "DP4-X10505", "DP4-X10506",
  // ほかのカードは変わらないことの確認用
  "DP3-X3143", "SV2a-201", "SM-P-001", "PMCG1-004"];
test.skipIf(!process.env.OUT)("examples", () => {
  const out = {};
  for (const id of IDS) {
    const c = id.slice(0, id.lastIndexOf("-")), n = id.slice(id.lastIndexOf("-") + 1);
    const set = data.find((s) => s.c === c); const k = set.k.find((x) => x[0] === n);
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card: k });
    out[id] = { ja: k[1], title: buildSingleTitle(f), itemSpecifics: Object.fromEntries(buildItemSpecifics(f)) };
  }
  // 全行のタイトルと Item Specifics（変わった行を数えるため）
  const all = {};
  for (const set of data) for (const k of set.k) {
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card: k });
    all[`${set.c}-${k[0]}`] = buildSingleTitle(f) + " || " + JSON.stringify(buildItemSpecifics(f));
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify({ examples: out, all }, null, 1));
});
