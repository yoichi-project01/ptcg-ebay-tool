import { describe, expect, it } from "vitest";
import { normalizeName, planSet } from "./patch-from-scan.mjs";

describe("normalizeName", () => {
  it("公式一覧のアイコン HTML を cardData のテキスト表記に揃える", () => {
    expect(normalizeName('<span class="pcg pcg-megamark"></span>フシギバナEX')).toBe("メガフシギバナEX");
    expect(normalizeName('ダークライ<span class="pcg pcg-prismstar"></span>')).toBe("ダークライ プリズムスター");
    expect(normalizeName("レシラム&amp;リザードンGX")).toBe("レシラム&リザードンGX");
  });
});

describe("planSet", () => {
  const set = { c: "T1", k: [["001", "A", "", "C"], ["002", "B", "", "C"], ["003", "B", "", "C"]] };
  const entry = (id, name) => ({ jaName: name, cardThumbFile: `/x/T1/0${id}_P_X.jpg` });

  it("公式側が多いカード名と、画像が無いカードと同名のものだけを候補にする", () => {
    const scan = [entry(10001, "A"), entry(10002, "B"), entry(10003, "B"), entry(10004, "C")];
    const imageIndex = { "T1/1": "a", "T1/2": "b" }; // 003 だけ画像なし
    const { candidates, excessNames } = planSet(set, scan, imageIndex);
    expect(excessNames).toEqual(["C"]);
    // C（公式側が多い）と、画像なしの 003 と同名の B 2枚
    expect(candidates.map((e) => e.jaName)).toEqual(["B", "B", "C"]);
  });

  it("枚数も画像も揃っていれば候補なし", () => {
    const scan = [entry(10001, "A"), entry(10002, "B"), entry(10003, "B")];
    const imageIndex = { "T1/1": "a", "T1/2": "b", "T1/3": "c" };
    expect(planSet(set, scan, imageIndex).candidates).toEqual([]);
  });
});
