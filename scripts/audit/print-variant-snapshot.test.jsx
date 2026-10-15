// 印刷バリエーション（1st Edition・Unlimited）を選んだときの出品の出力を書き出す（2026-10-15）。
// output-snapshot.test.jsx は印刷バリエーションを選ばない形だけなので、1st Edition の直しの前後はこちらで比べる:
//   OUT=before.json npx vitest run scripts/audit/print-variant-snapshot.test.jsx
//   node scripts/audit/compare-snapshots.mjs before.json after.json [出力.json]
// 対象は 1st Edition を選べる弾（と 2026-10-15 まで選べた PMCG1〜6）の全カード × 1st Edition／Unlimited、と未鑑定・PSA 10 の2通り
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import {
  DEFAULT_FORM, applyCandidateToForm, buildSingleTitle, buildSingleDesc, buildItemSpecifics, buildSku,
  buildEbaySearchQuery, buildListingCsvRow,
} from "../../src/App.jsx";

const SETS = /^(PMCG[1-6]|VS1|web1|E[1-5]|ADV[1-4]|ADVex1|PCG[1-9]|DP[1-5]|DPt[1-4]-B|L1-B(hg|ss)|L[23]-B|LL|BW1-B[bw]|BW2-B|BW3-B[hp]|BW4-B|BW5-Br[nz]|BW6-B[cf]|BW7-B|BW8-Br[fn]|BW9-B|XY1-B[xy]|XY[234]|XY5-B[gt]|XY[679]-B|XY8-B[br]|XY10-B|XY11-B[br]|CP[1-6])$/;

test.skipIf(!process.env.OUT)("print-variant snapshot", () => {
  const out = {};
  for (const set of data.filter((s) => SETS.test(s.c))) for (const card of set.k) {
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
