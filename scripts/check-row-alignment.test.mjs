import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCardData } from "./check-row-alignment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARD_DATA_PATH = path.join(__dirname, "..", "src", "cardData.json");

describe("analyzeCardData against the real cardData.json", () => {
  it("reports no suspected sets in the current data", () => {
    const cardData = JSON.parse(fs.readFileSync(CARD_DATA_PATH, "utf-8"));
    expect(analyzeCardData(cardData)).toEqual([]);
  });
});

// 複数セットに再録される定番のトレーナー/エネルギーカード名を模した合成データ。
// setA/setB/setC が「正解ペア」の裏付けを提供し、setShifted で英語名の列を+2行ズラした
// ケースを検出できるかを確認する
function buildSyntheticCardData() {
  const reprintedTrainers = [
    ["ポケモンいれかえ", "Switch"],
    ["ハイパーボール", "Ultra Ball"],
    ["ふしぎなアメ", "Rare Candy"],
    ["ボスの指令", "Boss's Orders"],
    ["ネストボール", "Nest Ball"],
    ["けが人の手当て", "First Aid"],
    ["エネルギー回収", "Energy Retrieval"],
    ["forbidden-shift-victim-1", "Correct Name One"],
    ["forbidden-shift-victim-2", "Correct Name Two"],
  ];
  const makeSet = (code, translate) => ({
    c: code,
    ja: code,
    en: code,
    sr: "TEST",
    of: reprintedTrainers.length,
    k: reprintedTrainers.map(([ja, en], i) => [
      String(i + 1).padStart(3, "0"),
      ja,
      translate(en, i),
      "U",
    ]),
  });
  const identity = (en) => en;
  return [
    makeSet("SETA", identity),
    makeSet("SETB", identity),
    makeSet("SETC", identity),
  ];
}

describe("analyzeCardData detects an intentionally shifted set", () => {
  it("passes on synthetic data with no shift", () => {
    const cardData = buildSyntheticCardData();
    expect(analyzeCardData(cardData)).toEqual([]);
  });

  it("flags a set whose English name column is shifted by 2 rows", () => {
    const cardData = buildSyntheticCardData();
    const shifted = cardData[2];
    const ens = shifted.k.map((k) => k[2]);
    const rotated = ens.slice(-2).concat(ens.slice(0, -2)); // 2行分ずらす（末尾を先頭へ）
    shifted.k = shifted.k.map((k, i) => [k[0], k[1], rotated[i], k[3]]);

    const flagged = analyzeCardData(cardData);
    const setCodes = flagged.map((f) => f.setCode);
    expect(setCodes).toContain("SETC");
    const setCFlag = flagged.find((f) => f.setCode === "SETC");
    expect(setCFlag.offsetShiftSuspected).toBe(true);
  });
});
