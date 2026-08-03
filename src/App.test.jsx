import { describe, it, expect } from "vitest";
import {
  buildSingleTitle, buildModernTitle, buildVintageTitle, calcProfit, applyCandidateToForm, searchCards,
  buildItemSpecifics, buildConditionGuide, buildSku,
  computeRecommendedPrice, roundUpToPsychologicalPrice,
  buildListingCsvRow, buildListingCsv, normalizeBase,
} from "./App.jsx";

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
  it("builds an ungraded title from the core fields, dropping the least important elements to fit 80 chars", () => {
    // SV1S(スカーレットex)の実データはsetNameEn="Scarlet ex"のため、シリーズ名
    // "Scarlet & Violet"と組み合わせると"Scarlet & Violet Scarlet ex"となり、
    // 年号・Holo・レアリティフルスペルまで全部載せると80文字を超える。
    // 優先度の低いものから落とされ、最終的に必須要素（優先度1〜8）だけが残ることを確認する
    expect(buildSingleTitle(baseCard)).toBe(
      "Charizard ex SAR 201/165 Japanese SV1S Pokemon Card NM"
    );
  });

  it("omits fields that are empty instead of leaving gaps", () => {
    const title = buildSingleTitle({ ...baseCard, rarity: "", setNameEn: "" });
    expect(title).not.toContain("  ");
    // レアリティが空なのでHolo/レアリティフルスペルは元から出ない。setNameEnも空だが
    // 発売年(2023)はcardData.jsonのSV1Sから引けるため、80文字に収まる範囲で残る
    expect(title).toBe("Charizard ex 201/165 Japanese SV1S Pokemon Card NM 2023");
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

  it("shows No Rarity only for PMCG1 (1996 Base Set first print)", () => {
    const onBase = buildSingleTitle({ ...baseCard, setCode: "PMCG1", printVariant: "No Rarity" });
    expect(onBase).toContain("No Rarity");

    const onJungle = buildSingleTitle({ ...baseCard, setCode: "PMCG2", printVariant: "No Rarity" });
    expect(onJungle).not.toContain("No Rarity");
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

// SV2a(ポケモンカード151) リザードンex SAR 201/165 — setNameEnに"Pokemon"を含む
// 実データ。シリーズ英語名との組み合わせ時に"Pokemon"の重複が起きないことを確認する
const modernCard = {
  pokemonEn: "Charizard ex", rarity: "SAR", cardNo: "201/165", setCode: "SV2a",
  setNameEn: "Pokemon 151", condition: "NM",
  graded: false, gradingCompany: "", grade: "", certNumber: "",
};

describe("buildModernTitle", () => {
  it("fits within 80 chars for an ungraded SAR card with every optional element available", () => {
    const title = buildModernTitle(modernCard);
    expect(title.length).toBeLessThanOrEqual(80);
    // 80文字にちょうど収まる範囲まではセット英語名・発売年を残す（Holo/フルスペルのみ削る）
    expect(title).toContain("Scarlet & Violet 151");
    expect(title).toContain("2023");
  });

  it("places the grading info first for a graded card", () => {
    const graded = { ...modernCard, graded: true, gradingCompany: "PSA", grade: "10" };
    const title = buildModernTitle(graded);
    expect(title.startsWith("PSA 10 GEM MINT")).toBe(true);
  });

  it("never outputs the word Pokemon twice", () => {
    const title = buildModernTitle(modernCard);
    const occurrences = (title.match(/pokemon/gi) || []).length;
    expect(occurrences).toBe(1);
  });

  it("keeps every priority-1-through-8 element even for an extremely long card name", () => {
    const longCard = { ...modernCard, pokemonEn: "A".repeat(60), setNameEn: "B".repeat(40) };
    const title = buildModernTitle(longCard);
    expect(title).toContain("A".repeat(60));
    expect(title).toContain("SAR");
    expect(title).toContain("201/165");
    expect(title).toContain("Japanese");
    expect(title).toContain("SV2a");
    expect(title).toContain("Pokemon Card");
    expect(title).toContain("NM");
  });

  it("does not throw and simply omits the year for a set with no known release year", () => {
    const noYearSet = { ...modernCard, setCode: "S-P" }; // TCGdexに存在しないためy無し
    expect(() => buildModernTitle(noYearSet)).not.toThrow();
    expect(buildModernTitle(noYearSet)).not.toContain("undefined");
  });

  it("respects a custom maxLength option, dropping all optional elements when it's tight", () => {
    const title = buildModernTitle(modernCard, { maxLength: 40 });
    expect(title).not.toContain("2023");
    expect(title).not.toContain("Scarlet & Violet");
    // 優先度1〜8の必須要素は40文字を超えていても残る
    expect(title).toContain("Charizard ex");
    expect(title).toContain("201/165");
  });
});

// PMCG1(拡張パック/Base Set) リザードン No.006 — 旧裏・No Rarity・鑑定なしの実データ寄りの例
const vintageCard = {
  pokemonEn: "Charizard", rarity: "R", cardNo: "006/102", setCode: "PMCG1",
  setNameEn: "Base Set", condition: "NM", printVariant: "No Rarity", printVariantNote: "",
  graded: false, gradingCompany: "", grade: "", certNumber: "", oldBack: true,
};

describe("buildVintageTitle", () => {
  it("includes No Rarity in the title", () => {
    expect(buildVintageTitle(vintageCard)).toContain("No Rarity");
  });

  it("formats the card number as No.006 instead of 006/102", () => {
    const title = buildVintageTitle(vintageCard);
    expect(title).toContain("No.006");
    expect(title).not.toContain("006/102");
  });

  it("places the release year ahead of the rarity word, so it survives 80-char trimming first", () => {
    // カード名を長くして詰めさせ、削除可能な2要素(状態・レアリティ語)のうち
    // 先に落ちるのがどちらでも、発売年(1996)は非削除可要素なので必ず残ることを確認する
    const long = { ...vintageCard, pokemonEn: "A".repeat(40) };
    const title = buildVintageTitle(long);
    expect(title).toContain("1996");
  });

  it("does not use the modern full rarity spelling (e.g. Special Art Rare)", () => {
    const title = buildVintageTitle(vintageCard);
    expect(title).not.toContain("Special Art Rare");
    expect(title).not.toContain("Rare Holo"); // ホロ有無はデータに無いため推測で付与しない
  });

  it("places the grading info first for a graded card", () => {
    const graded = { ...vintageCard, graded: true, gradingCompany: "PSA", grade: "1" };
    const title = buildVintageTitle(graded);
    expect(title.startsWith("PSA 1 PR")).toBe(true);
  });

  it("does not affect modern (non-old-back) title generation", () => {
    const modernTitle = buildSingleTitle({
      pokemonEn: "Charizard ex", rarity: "SAR", cardNo: "201/165", setCode: "SV1S",
      setNameEn: "Scarlet ex", condition: "NM",
      graded: false, gradingCompany: "", grade: "", certNumber: "",
      printVariant: "", printVariantNote: "", oldBack: false,
    });
    expect(modernTitle).not.toContain("No.");
    expect(modernTitle).not.toContain("Old Back");
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

  it("falls back to the set's enAlias when there is no official English set name (e.g. old-back sets)", () => {
    const oldBackSet = { c: "PMCG1", ja: "拡張パック", en: "", enAlias: "Base Set" };
    const r = { set: oldBackSet, card: ["006", "リザードン", "Charizard", "R"] };
    const next = applyCandidateToForm(DEFAULT_F, r);
    expect(next.setNameEn).toBe("Base Set");
  });

  it("prefers the official English set name over enAlias when both are present", () => {
    const r = { set: { ...withEnglishSet, enAlias: "Should Not Be Used" }, card: ["004", "リザードン", "Charizard", "RR"] };
    const next = applyCandidateToForm(DEFAULT_F, r);
    expect(next.setNameEn).toBe("Scarlet ex");
  });

  it("falls back to an empty rarity when the candidate's rarity is not a known option", () => {
    const r = { set: withEnglishSet, card: ["004", "リザードン", "Charizard", "ありえないレアリティ"] };
    const next = applyCandidateToForm(DEFAULT_F, r);
    expect(next.rarity).toBe("");
  });

  it("resets per-listing fields (condition, grading, price) from the previous card", () => {
    const prevListing = {
      ...DEFAULT_F,
      condition: "LP",
      conditionNotes: "Small scratch on back edge",
      graded: true, gradingCompany: "PSA", grade: "10", certNumber: "12345678",
      costJpy: "5000", extraCostJpy: "300", sellPriceUsd: "80",
    };
    const r = { set: withEnglishSet, card: ["004", "リザードン", "Charizard", "RR"] };
    const next = applyCandidateToForm(prevListing, r);
    expect(next.condition).toBe("NM");
    expect(next.conditionNotes).toBe("");
    expect(next.graded).toBe(false);
    expect(next.gradingCompany).toBe("");
    expect(next.grade).toBe("");
    expect(next.certNumber).toBe("");
    expect(next.costJpy).toBe("");
    expect(next.extraCostJpy).toBe("");
    expect(next.sellPriceUsd).toBe("");
  });

  it("keeps operational fields (shipFrom, exchangeRate) that stay the same across listings", () => {
    const prevListing = { ...DEFAULT_F, shipFrom: "Tokyo, Japan", exchangeRate: "150" };
    const r = { set: withEnglishSet, card: ["004", "リザードン", "Charizard", "RR"] };
    const next = applyCandidateToForm(prevListing, r);
    expect(next.shipFrom).toBe("Tokyo, Japan");
    expect(next.exchangeRate).toBe("150");
  });

  it("keeps the previous condition/grading/price when carryOverCondition is set", () => {
    const prevListing = {
      ...DEFAULT_F,
      condition: "LP", graded: true, gradingCompany: "PSA", grade: "10", sellPriceUsd: "80",
    };
    const r = { set: withEnglishSet, card: ["004", "リザードン", "Charizard", "RR"] };
    const next = applyCandidateToForm(prevListing, r, { carryOverCondition: true });
    expect(next.condition).toBe("LP");
    expect(next.graded).toBe(true);
    expect(next.gradingCompany).toBe("PSA");
    expect(next.grade).toBe("10");
    expect(next.sellPriceUsd).toBe("80");
    // 識別情報（カード名・レアリティ等）は carryOverCondition でも必ず新しいカードのものに更新される
    expect(next.pokemonEn).toBe("Charizard");
  });
});

describe("normalizeBase", () => {
  it("treats curly and straight apostrophes as the same string", () => {
    expect(normalizeBase("Farfetch'd")).toBe(normalizeBase("Farfetch’d"));
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

// SV1S/014 ギャラドスex (Gyarados ex, RR) — 実データにある2023年発売のセット
const gyaradosCard = {
  pokemonJa: "ギャラドスex", pokemonEn: "Gyarados ex", rarity: "RR", cardNo: "014/078",
  setCode: "SV1S", setNameJa: "スカーレットex", setNameEn: "Scarlet ex",
  condition: "NM", conditionNotes: "",
  graded: false, gradingCompany: "", grade: "", certNumber: "",
  printVariant: "", printVariantNote: "", oldBack: false,
};

describe("buildItemSpecifics", () => {
  it("builds the core specifics from an ungraded listing, using the set's release year", () => {
    const pairs = buildItemSpecifics(gyaradosCard);
    const map = Object.fromEntries(pairs);
    expect(map["Card Name"]).toBe("Gyarados ex");
    expect(map["Character"]).toBe("Gyarados");
    expect(map["Set"]).toBe("Scarlet ex");
    expect(map["Card Number"]).toBe("014/078");
    expect(map["Rarity"]).toBe("Double Rare"); // RR -> Double Rare
    expect(map["Language"]).toBe("Japanese");
    expect(map["Manufacturer"]).toBe("The Pokémon Company");
    expect(map["Graded"]).toBe("No");
    expect(map["Card Condition"]).toBe("Near Mint or Better");
    expect(map["Year Manufactured"]).toBe("2023");
    expect(map["Professional Grader"]).toBeUndefined();
  });

  it("switches to grading fields and omits Card Condition when graded", () => {
    const graded = { ...gyaradosCard, graded: true, gradingCompany: "PSA", grade: "10", certNumber: "12345678" };
    const map = Object.fromEntries(buildItemSpecifics(graded));
    expect(map["Graded"]).toBe("Yes");
    expect(map["Professional Grader"]).toBe("PSA");
    expect(map["Grade"]).toBe("10");
    expect(map["Certification Number"]).toBe("12345678");
    expect(map["Card Condition"]).toBeUndefined();
  });

  it("omits Year Manufactured when the set has no known release year", () => {
    const noYearSet = { ...gyaradosCard, setCode: "S-P" }; // TCGdexに存在しないためy無し
    const map = Object.fromEntries(buildItemSpecifics(noYearSet));
    expect(map["Year Manufactured"]).toBeUndefined();
  });

  it("includes Old Back / 1st Edition in Features only for eligible sets", () => {
    const oldBackCard = { ...gyaradosCard, setCode: "PMCG1", oldBack: true, printVariant: "1st Edition" };
    const map = Object.fromEntries(buildItemSpecifics(oldBackCard));
    expect(map["Features"]).toBe("Old Back, 1st Edition");

    const notEligible = { ...gyaradosCard, oldBack: true, printVariant: "1st Edition" }; // SV1Sは対象外
    const map2 = Object.fromEntries(buildItemSpecifics(notEligible));
    expect(map2["Features"]).toBeUndefined();
  });

  it("includes No Rarity in Features only for PMCG1, not other PMCG sets", () => {
    const baseSet = { ...gyaradosCard, setCode: "PMCG1", printVariant: "No Rarity" };
    expect(Object.fromEntries(buildItemSpecifics(baseSet))["Features"]).toBe("No Rarity");

    const jungle = { ...gyaradosCard, setCode: "PMCG2", printVariant: "No Rarity" };
    expect(Object.fromEntries(buildItemSpecifics(jungle))["Features"]).toBeUndefined();
  });

  it("marks old-back sets as Vintage but not modern sets", () => {
    const oldBack = { ...gyaradosCard, setCode: "PMCG1" };
    expect(Object.fromEntries(buildItemSpecifics(oldBack))["Vintage"]).toBe("Yes");

    const modern = { ...gyaradosCard, setCode: "SV1S" };
    expect(Object.fromEntries(buildItemSpecifics(modern))["Vintage"]).toBeUndefined();
  });

  it("drops empty fields instead of outputting blank values", () => {
    const noEnglish = { ...gyaradosCard, pokemonEn: "", setNameEn: "" };
    const map = Object.fromEntries(buildItemSpecifics(noEnglish));
    expect(map["Card Name"]).toBeUndefined();
    expect(map["Character"]).toBeUndefined();
    expect(map["Set"]).toBeUndefined();
  });
});

describe("buildConditionGuide", () => {
  it("guides to Ungraded + the matching descriptor for an ungraded card", () => {
    expect(buildConditionGuide(gyaradosCard)).toContain("Ungraded");
    expect(buildConditionGuide(gyaradosCard)).toContain("Near Mint or Better");
  });

  it("guides to Graded + grader/grade for a graded card", () => {
    const graded = { ...gyaradosCard, graded: true, gradingCompany: "PSA", grade: "10" };
    const guide = buildConditionGuide(graded);
    expect(guide).toContain("Graded");
    expect(guide).toContain("PSA");
    expect(guide).toContain("10");
  });
});

describe("buildSku", () => {
  it("builds a SKU from set code, local id and condition", () => {
    expect(buildSku(gyaradosCard, "single")).toBe("SV1S-014-NM");
  });

  it("uses grading company+grade instead of condition when graded", () => {
    const graded = { ...gyaradosCard, graded: true, gradingCompany: "PSA", grade: "10" };
    expect(buildSku(graded, "single")).toBe("SV1S-014-PSA10");
  });

  it("appends 1ST only for PMCG1-6 with 1st Edition selected", () => {
    const firstEd = { ...gyaradosCard, setCode: "PMCG1", cardNo: "004/102", printVariant: "1st Edition" };
    expect(buildSku(firstEd, "single")).toBe("PMCG1-004-NM-1ST");
  });

  it("appends NR only for PMCG1 with No Rarity selected", () => {
    const noRarity = { ...gyaradosCard, setCode: "PMCG1", cardNo: "004/102", printVariant: "No Rarity" };
    expect(buildSku(noRarity, "single")).toBe("PMCG1-004-NM-NR");

    const notEligible = { ...gyaradosCard, setCode: "PMCG2", cardNo: "004/102", printVariant: "No Rarity" };
    expect(buildSku(notEligible, "single")).not.toContain("NR");
  });

  it("builds a pack-mode SKU from set code and product type", () => {
    const pack = { setCode: "SV2a", productType: "box" };
    expect(buildSku(pack, "pack")).toBe("SV2A-BOX");
  });
});

describe("computeRecommendedPrice / roundUpToPsychologicalPrice", () => {
  const base = {
    exchangeRate: "155", costJpy: "3000", extraCostJpy: "200",
    ebayFeePercent: "13.25", ebayFixedFeeUsd: "0.40", shippingCostUsd: "5",
  };

  it("solves for the minimum sell price that hits the target margin", () => {
    const sell = computeRecommendedPrice(base, "30");
    expect(sell).not.toBeNull();
    // profit at that price should be ~30% of the price
    const feeUsd = sell * 0.1325 + 0.4;
    const costUsd = 3200 / 155;
    const profit = sell - feeUsd - 5 - costUsd;
    expect(profit / sell).toBeCloseTo(0.3, 5);
  });

  it("returns null when fee% + target margin leaves no room (>= 100%)", () => {
    expect(computeRecommendedPrice(base, "90")).toBeNull();
  });

  it("returns null without a valid exchange rate", () => {
    expect(computeRecommendedPrice({ ...base, exchangeRate: "0" }, "30")).toBeNull();
  });

  it("rounds up to the nearest X.99 without ever undershooting the input", () => {
    expect(roundUpToPsychologicalPrice(37.42)).toBe(37.99);
    expect(roundUpToPsychologicalPrice(38.0)).toBe(38.99);
    expect(roundUpToPsychologicalPrice(37.99)).toBe(37.99);
  });
});

describe("buildListingCsvRow / buildListingCsv", () => {
  const entry = {
    mode: "single",
    f: { ...gyaradosCard, sellPriceUsd: "45", quantity: "2", bestOfferEnabled: true, picUrl: "" },
    title: "Gyarados ex RR 014/078 SV1S Japanese Pokemon Card NM",
    desc: "Thank you for checking out my listing!",
    sku: "SV1S-014-NM",
  };

  it("maps the item specifics into C: columns and core fields into their own columns", () => {
    const row = buildListingCsvRow(entry);
    expect(row.Action).toBe("Add");
    expect(row.CustomLabel).toBe("SV1S-014-NM");
    expect(row.Title).toBe(entry.title);
    expect(row.StartPrice).toBe("45");
    expect(row.Quantity).toBe("2");
    expect(row.BestOfferEnabled).toBe("1");
    expect(row["C:Card Name"]).toBe("Gyarados ex");
    expect(row["C:Rarity"]).toBe("Double Rare");
    expect(row["C:Year Manufactured"]).toBe("2023");
    expect(row.ConditionID).not.toBe("");
  });

  it("uses the graded ConditionID when the card is graded", () => {
    const gradedEntry = { ...entry, f: { ...entry.f, graded: true, gradingCompany: "PSA", grade: "10" } };
    const row = buildListingCsvRow(gradedEntry);
    expect(row.ConditionID).not.toBe(buildListingCsvRow(entry).ConditionID);
  });

  it("produces a header row plus one row per queue entry, comma-joined", () => {
    const csv = buildListingCsv([entry, entry]);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0].replace(/^﻿/, "").split(",")[0]).toBe("Action");
  });

  it("prefixes the CSV with a UTF-8 BOM so Excel doesn't mangle the encoding", () => {
    const csv = buildListingCsv([entry]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("converts newlines in the description to <br> and escapes HTML for the CSV Description column", () => {
    const withNewlines = { ...entry, desc: "Line one\nLine two <tag> & more" };
    const row = buildListingCsvRow(withNewlines);
    expect(row.Description).toBe("Line one<br>Line two &lt;tag&gt; &amp; more");
  });

  it("includes Format/Duration and the ungraded Condition Descriptor value ID", () => {
    const row = buildListingCsvRow(entry);
    expect(row.Format).toBe("FixedPrice");
    expect(row.Duration).toBe("GTC");
    expect(row["CD:Card Condition - (ID: 40001)"]).toBe("400010"); // NM
  });

  it("leaves the ungraded Condition Descriptor blank for graded cards", () => {
    const gradedEntry = { ...entry, f: { ...entry.f, graded: true, gradingCompany: "PSA", grade: "10" } };
    const row = buildListingCsvRow(gradedEntry);
    expect(row["CD:Card Condition - (ID: 40001)"]).toBe("");
  });

  it("quotes values that contain commas or quotes", () => {
    const withComma = { ...entry, desc: 'Line with, a comma and "quotes"' };
    const row = buildListingCsvRow(withComma);
    const csv = buildListingCsv([withComma]);
    expect(csv).toContain('"Line with, a comma and ""quotes"""');
  });
});
