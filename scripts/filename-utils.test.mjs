import { describe, it, expect } from "vitest";
import { buildFileName, extractLocalId, computeSetTotal } from "./filename-utils.mjs";

describe("buildFileName", () => {
  it("pads localId to match total digit count and uses full-width slash", () => {
    expect(buildFileName("フシギダネ", "SV1S", "001", "C", 198)).toBe(
      "フシギダネ_SV1S-001／198_C"
    );
  });

  it("omits the rarity suffix when rarity is empty", () => {
    expect(buildFileName("草のエネルギー", "PMCG1", "097", "", 102)).toBe(
      "草のエネルギー_PMCG1-097／102"
    );
  });

  it("leaves non-numeric localId untouched", () => {
    expect(buildFileName("ふしぎな飴", "PMCG1", "XY-1", "U", 102)).toBe(
      "ふしぎな飴_PMCG1-XY-1_U"
    );
  });

  it("strips characters that are illegal in Windows filenames", () => {
    expect(buildFileName('グズマ&ハラ"?', "S-P", "134", "", 0)).toBe(
      "グズマ&ハラ_S-P-134"
    );
  });

  it("falls back to raw localId when total is 0", () => {
    expect(buildFileName("ピカチュウ", "SV1S", "004", "C", 0)).toBe(
      "ピカチュウ_SV1S-004_C"
    );
  });
});

describe("extractLocalId", () => {
  it("recovers the localId from a stem built by buildFileName (with rarity)", () => {
    expect(extractLocalId("フシギダネ_SV1S-001／198_C", "SV1S")).toBe("001");
  });

  it("recovers the localId when there is no rarity suffix", () => {
    expect(extractLocalId("草のエネルギー_PMCG1-097／102", "PMCG1")).toBe("097");
  });

  it("falls back to treating the whole stem as the localId for legacy filenames", () => {
    expect(extractLocalId("042", "PMCG1")).toBe("042");
  });
});

describe("computeSetTotal", () => {
  it("returns the highest numeric localId in the set", () => {
    expect(
      computeSetTotal([
        ["001", "a", "a", "C"],
        ["010", "b", "b", "C"],
        ["005", "c", "c", "C"],
      ])
    ).toBe(10);
  });

  it("ignores non-numeric localIds", () => {
    expect(
      computeSetTotal([
        ["001", "a", "a", "C"],
        ["SV-P", "b", "b", ""],
      ])
    ).toBe(1);
  });

  it("returns 0 when there are no numeric localIds", () => {
    expect(computeSetTotal([["SV-P", "a", "a", ""]])).toBe(0);
  });
});
