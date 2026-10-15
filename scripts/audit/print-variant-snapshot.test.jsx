// 印刷バリエーション（1st Edition・Unlimited）を選んだときの出品の出力を書き出す（2026-10-15）。
// output-snapshot.test.jsx は印刷バリエーションを選ばない形だけなので、1st Edition の直しの前後はこちらで比べる:
//   OUT=before.json npx vitest run scripts/audit/print-variant-snapshot.test.jsx
//   node scripts/audit/compare-snapshots.mjs before.json after.json [出力.json]
// 対象は PMCG1〜6・ADV1〜4・ADVex1 の全カード × 1st Edition／Unlimited、と未鑑定・PSA 10 の2通り
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import {
  DEFAULT_FORM, applyCandidateToForm, buildSingleTitle, buildSingleDesc, buildItemSpecifics, buildSku,
  buildEbaySearchQuery, buildListingCsvRow,
} from "../../src/App.jsx";

test.skipIf(!process.env.OUT)("print-variant snapshot", () => {
  const out = {};
  for (const set of data.filter((s) => /^(PMCG[1-6]|ADV[1-4]|ADVex1)$/.test(s.c))) for (const card of set.k) {
    for (const printVariant of ["1st Edition", "Unlimited"]) for (const graded of [false, true]) {
      const f = { ...applyCandidateToForm(DEFAULT_FORM, { set, card }), printVariant,
        ...(graded ? { graded: true, gradingCompany: "PSA", grade: "10", certNumber: "" } : {}) };
      const title = buildSingleTitle(f), desc = buildSingleDesc(f), sku = buildSku(f, "single");
      const csv = buildListingCsvRow({ f, title, desc, sku });
      delete csv.Description;
      out[`${set.c}-${card[0]}|${printVariant}|${graded ? "PSA10" : "raw"}`] = {
        title, desc, sku, itemSpecifics: Object.fromEntries(buildItemSpecifics(f)), query: buildEbaySearchQuery(f, "single"), csv,
      };
    }
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
});
