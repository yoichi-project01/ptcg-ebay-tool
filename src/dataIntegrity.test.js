// cardData.json・imageIndex.json・cardKinds.json の全体の整合性と、全カードの出品の出力の決まりごと（2026-10-14）。
// データを足したり直したりしたときの事故（番号の重なり・対応表の指す先の無い画像・80文字超のタイトル・SKU の重なり）を検出する
import { describe, it, expect } from "vitest";
import CARD_DATA from "./cardData.json";
import IMAGE_INDEX from "./imageIndex.json";
import CARD_KINDS from "./cardKinds.json";
import { DEFAULT_FORM, applyCandidateToForm, buildSingleTitle, buildSku, buildItemSpecifics } from "./App.jsx";

const rows = CARD_DATA.flatMap((set) => set.k.map((card) => ({ set, card })));

describe("cardData.json の形", () => {
  it("弾コードが重ならない", () => {
    const codes = CARD_DATA.map((s) => s.c);
    expect(codes.length).toBe(new Set(codes).size);
  });
  it("行は [型番, 日本語名, 英語名, レアリティ] の4つの文字列", () => {
    const bad = rows.filter(({ card }) => card.length !== 4 || card.some((v) => typeof v !== "string")).map(({ set, card }) => `${set.c}-${card[0]}`);
    expect(bad).toEqual([]);
  });
  it("同じ弾の中で型番が重ならない（数字の型番は数値として比べる）", () => {
    const dup = [];
    for (const set of CARD_DATA) {
      const seen = new Set();
      for (const [local] of set.k) {
        const key = /^\d+$/.test(local) ? String(parseInt(local, 10)) : local;
        if (seen.has(key)) dup.push(`${set.c}-${local}`);
        seen.add(key);
      }
    }
    expect(dup).toEqual([]);
  });
  it("日本語名が空の行が無い", () => {
    expect(rows.filter(({ card }) => !card[1].trim()).map(({ set, card }) => `${set.c}-${card[0]}`)).toEqual([]);
  });
  it("英語名・日本語名の前後に空白が無い", () => {
    expect(rows.filter(({ card }) => card[1] !== card[1].trim() || card[2] !== card[2].trim()).map(({ set, card }) => `${set.c}-${card[0]}`)).toEqual([]);
  });
});

describe("画像の対応表・カードの種類の一覧の指す先", () => {
  const rowKeys = new Set();
  for (const set of CARD_DATA) for (const [local] of set.k) rowKeys.add(`${set.c}/${/^\d+$/.test(local) ? parseInt(local, 10) : local}`);
  it("imageIndex.json のキーはすべて cardData の行にある", () => {
    expect(Object.keys(IMAGE_INDEX).filter((k) => !rowKeys.has(k))).toEqual([]);
  });
  it("cardKinds.json のキーはすべて cardData の行にある", () => {
    const ids = new Set(rows.map(({ set, card }) => `${set.c}-${card[0]}`));
    expect(Object.keys(CARD_KINDS).filter((k) => !ids.has(k))).toEqual([]);
  });
});

describe("全カードの出品の出力", () => {
  const forms = rows.map((r) => ({ id: `${r.set.c}-${r.card[0]}`, f: applyCandidateToForm(DEFAULT_FORM, r) }));
  // 落とせる要素をすべて落としても80文字を超える既知の44件（2026-10-14 の点検。直し方の案は docs/review-2026-10-14.md の A1）。
  // 直したらこの一覧を空にする。これ以外のカードが80文字を超えたら失敗する
  const KNOWN_OVER_80 = new Set(("PMCG6-003 PMCG6-004 PMCG6-012 PMCG6-013 PMCG6-020 PMCG6-021 PMCG6-025 PMCG6-029 PMCG6-037 PMCG6-040 PMCG6-069 PMCG6-088 " +
    "SV2a-154-PB SV2a-154-MB SV2a-155-PB SV2a-155-MB SV2a-156-MB SV2a-157-PB SV2a-157-MB SV2a-161-PB SV2a-161-MB SV2a-162-PB SV2a-162-MB " +
    "S1W-067 S1W-071 M2a-015-EN M2a-015-R M2a-016-R M2a-034-R M2a-061-R M2a-062-R M2a-079-R M2a-082-R M2a-083-R M2a-099-R M2a-100-R " +
    "M2a-102-R M2a-103-R M2a-104-R DPt1-B-082 DPt1-B-083 DPt1-B-088 DPt2-B-076 DPt2-B-077").split(" "));
  it("タイトルが80文字以内（既知の例外を除く）", () => {
    expect(forms.filter(({ id, f }) => !KNOWN_OVER_80.has(id) && buildSingleTitle(f).length > 80).map(({ id }) => id)).toEqual([]);
  });
  it("SKU が行ごとに違う（同じ状態のとき）", () => {
    const seen = new Map(), dup = [];
    for (const { id, f } of forms) {
      const sku = buildSku(f, "single");
      if (seen.has(sku)) dup.push(`${seen.get(sku)} ${id} → ${sku}`);
      else seen.set(sku, id);
    }
    expect(dup).toEqual([]);
  });
  it("Item Specifics に空の値が無い", () => {
    expect(forms.filter(({ f }) => buildItemSpecifics(f).some(([, v]) => !String(v).trim())).map(({ id }) => id)).toEqual([]);
  });
});

describe("検索で弾の別名を使える（2026-10-14）", () => {
  it("旧裏の英語通称（enAlias）で引ける", async () => {
    const { searchCards } = await import("./App.jsx");
    expect(searchCards("Base Set Charizard").some((r) => r.set.c === "PMCG1" && r.card[2] === "Charizard")).toBe(true);
  });
  it("25件目があれば limit で分かる", async () => {
    const { searchCards } = await import("./App.jsx");
    expect(searchCards("ピカチュウ", 25).length).toBe(25);
    expect(searchCards("ピカチュウ").length).toBe(24);
  });
});
