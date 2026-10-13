// 全カードの出品の出力（タイトル・説明文・Item Specifics・SKU・相場リンクの検索語・CSV の行）を書き出す（2026-10-14）。
// 直す前と後で実行して比べる:  OUT=before.json npx vitest run scripts/audit/output-snapshot.test.jsx
//                               node scripts/audit/compare-snapshots.mjs before.json after.json [出力.json]
import { test } from "vitest";
import fs from "node:fs";
import data from "../../src/cardData.json";
import {
  DEFAULT_FORM, applyCandidateToForm, buildSingleTitle, buildSingleDesc, buildItemSpecifics, buildSku,
  buildEbaySearchQuery, buildListingCsvRow,
} from "../../src/App.jsx";

test.skipIf(!process.env.OUT)("snapshot", () => {
  const out = {};
  for (const set of data) for (const card of set.k) {
    const f = applyCandidateToForm(DEFAULT_FORM, { set, card });
    const title = buildSingleTitle(f), desc = buildSingleDesc(f), sku = buildSku(f, "single");
    const csv = buildListingCsvRow({ f, title, desc, sku });
    delete csv.Description;
    out[`${set.c}-${card[0]}`] = {
      title, desc, sku,
      itemSpecifics: Object.fromEntries(buildItemSpecifics(f)),
      query: buildEbaySearchQuery(f, "single"),
      csv,
    };
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
});
