import { describe, it, expect } from "vitest";
import { buildSingleTitle, calcProfit, applyCandidateToForm, searchCards } from "./App.jsx";

const DEFAULT_F = {
  setNameJa: "", setNameEn: "", setCode: "",
  pokemonJa: "", pokemonEn: "", rarity: "", cardNo: "",
};

const baseCard = {
  pokemonEn: "Charizard ex",
  rarity: "SAR",
  cardNo: "201/165",
  setCode: "SV1S",
  setNameEn: "Scarlet ex",
  printVariant: "",
  printVariantNote: "",
  oldBack: false,
  graded: false,
  gradingCompany: "",
  grade: "",
  certNumber: "",
  condition: "NM",
};

describe("buildSingleTitle", () => {
  it("builds an ungraded title from the core fields", () => {
    expect(buildSingleTitle(baseCard)).toBe(
      "Charizard ex SAR 201/165 SV1S Scarlet ex Japanese Pokemon Card NM"
    );
  });

  it("omits fields that are empty instead of leaving gaps", () => {
    const title = buildSingleTitle({ ...baseCard, rarity: "", setNameEn: "" });
    expect(title).not.toContain("  ");
    expect(title).toBe("Charizard ex 201/165 SV1S Japanese Pokemon Card NM");
  });

  it("does not show 1st Edition wording for sets outside PMCG1-6", () => {
    const title = buildSingleTitle({ ...baseCard, printVariant: "1st Edition" });
    expect(title).not.toContain("1st Edition");
  });

  it("shows 1st Edition wording only for PMCG1-6", () => {
    const title = buildSingleTitle({
      ...baseCard,
      setCode: "PMCG1",
      printVariant: "1st Edition",
    });
    expect(title).toContain("1st Edition");
  });

  it("shows Old Back for PMCG1-6 when oldBack is set", () => {
    const title = buildSingleTitle({ ...baseCard, setCode: "PMCG1", oldBack: true });
    expect(title).toContain("Old Back");
  });

  it("also shows Old Back for neo/VS1/web1 even without 1st Edition eligibility", () => {
    for (const setCode of ["neo1", "VS1", "web1"]) {
      const title = buildSingleTitle({ ...baseCard, setCode, oldBack: true });
      expect(title).toContain("Old Back");
    }
  });

  it("does not show Old Back for sets outside the old-back era", () => {
    const title = buildSingleTitle({ ...baseCard, setCode: "SV1S", oldBack: true });
    expect(title).not.toContain("Old Back");
  });

  it("replaces the condition token with grading info when graded", () => {
    const title = buildSingleTitle({
      ...baseCard,
      graded: true,
      gradingCompany: "PSA",
      grade: "10",
    });
    expect(title).toContain("PSA 10 GEM MINT");
    expect(title).not.toContain(" NM");
  });
});

describe("calcProfit", () => {
  const base = {
    exchangeRate: "155",
    sellPriceUsd: "45",
    costJpy: "3000",
    extraCostJpy: "200",
    ebayFeePercent: "13.25",
    ebayFixedFeeUsd: "0.40",
    shippingCostUsd: "5",
  };

  it("returns null when required numeric fields are missing or zero", () => {
    expect(calcProfit({ ...base, sellPriceUsd: "" })).toBeNull();
    expect(calcProfit({ ...base, exchangeRate: "0" })).toBeNull();
  });

  it("computes cost, fee and profit from the listing fields", () => {
    const result = calcProfit(base);
    expect(result).not.toBeNull();
    // costUsd = (3000 + 200) / 155
    expect(result.costUsd).toBeCloseTo(20.645, 3);
    // feeUsd = 45 * 0.1325 + 0.40
    expect(result.feeUsd).toBeCloseTo(6.3625, 3);
    // profitUsd = 45 - feeUsd - shipping(5) - costUsd
    expect(result.profitUsd).toBeCloseTo(45 - 6.3625 - 5 - 20.645, 3);
  });

  it("treats missing optional costs as zero", () => {
    const result = calcProfit({
      exchangeRate: "150",
      sellPriceUsd: "10",
      costJpy: "",
      extraCostJpy: "",
      ebayFeePercent: "",
      ebayFixedFeeUsd: "",
      shippingCostUsd: "",
    });
    expect(result.costUsd).toBe(0);
    expect(result.feeUsd).toBe(0);
    expect(result.profitUsd).toBe(10);
  });
});

describe("applyCandidateToForm", () => {
  const withEnglishSet = { c: "SV1S", ja: "スカーレット", en: "Scarlet ex" };
  const withoutEnglishSet = { c: "S12a", ja: "テスト", en: "" };

  it("fills in the English name when the candidate has one", () => {
    const r = { set: withEnglishSet, card: ["004", "リザードン", "Charizard", "RR"] };
    const next = applyCandidateToForm(DEFAULT_F, r);
    expect(next.pokemonEn).toBe("Charizard");
    expect(next.setNameEn).toBe("Scarlet ex");
  });

  it("does not carry over the previous card's English name when the new one has none", () => {
    // 前のカードで英語名が入っている状態から始める
    const withStaleEnglish = { ...DEFAULT_F, pokemonEn: "Charizard", setNameEn: "Scarlet ex" };
    const r = { set: withoutEnglishSet, card: ["001", "テストポケモン", "", ""] };
    const next = applyCandidateToForm(withStaleEnglish, r);
    expect(next.pokemonEn).toBe("");
    expect(next.setNameEn).toBe("");
  });

  it("falls back to an empty rarity when the candidate's rarity is not a known option", () => {
    const r = { set: withEnglishSet, card: ["004", "リザードン", "Charizard", "ありえないレアリティ"] };
    const next = applyCandidateToForm(DEFAULT_F, r);
    expect(next.rarity).toBe("");
  });
});

describe("searchCards", () => {
  it("matches full-width rarity input (ＳＡＲ) the same as half-width (SAR)", () => {
    const fullWidth = searchCards("メガフシギバナex ＳＡＲ");
    const halfWidth = searchCards("メガフシギバナex SAR");
    expect(fullWidth.length).toBeGreaterThan(0);
    expect(fullWidth.map((r) => r.card[0])).toEqual(halfWidth.map((r) => r.card[0]));
  });

  it("matches full-width digits (ポリゴン２) and half-width digits (ポリゴン2) to the same cards", () => {
    const fullWidth = searchCards("ポリゴン２");
    const halfWidth = searchCards("ポリゴン2");
    expect(fullWidth.length).toBeGreaterThan(0);
    expect(fullWidth.map((r) => r.set.c + "/" + r.card[0]).sort()).toEqual(
      halfWidth.map((r) => r.set.c + "/" + r.card[0]).sort()
    );
  });

  it("returns nothing for a query shorter than any real match", () => {
    expect(searchCards("")).toEqual([]);
  });
});
