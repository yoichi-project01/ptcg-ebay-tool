// 1st Edition を選んだときの全カードの出力（タイトル・SKU・検索語・Item Specifics）を書き出す（2026-10-15、FIRST_EDITION_SET_RE を cardData の fe に替えたときの確かめ用）
//   OUT=before.json npx vitest run scripts/audit/fe-snapshot.test.jsx
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import { DEFAULT_FORM, applyCandidateToForm, buildSingleTitle, buildSku, buildEbaySearchQuery, buildItemSpecifics } from "../../src/App.jsx";
test.skipIf(!process.env.OUT)("fe snapshot", () => {
  const out = {};
  for (const set of data) for (const card of set.k) {
    for (const pv of ["1st Edition", "Unlimited"]) {
      const f = { ...applyCandidateToForm(DEFAULT_FORM, { set, card }), printVariant: pv };
      out[`${set.c}-${card[0]}|${pv}`] = [buildSingleTitle(f), buildSku(f, "single"), buildEbaySearchQuery(f, "single"), JSON.stringify(buildItemSpecifics(f))].join("\n");
    }
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
});
