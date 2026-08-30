import { describe, it, expect } from "vitest";
import { validateAndBuildK, parseCardDetailsFromHtml } from "./scrape-missing-sets.mjs";

// M2aで実際に発生した事故の再現テスト: 001〜193(total)が揃っていても、
// totalを超える範囲（シークレット領域）に欠番があれば検出できることを確認する。
// 修正前は「1〜total」しか検査しておらず、この種の欠落が書き込まれてしまっていた。
function buildDetail(local, total, jaName, rarity = "C") {
  return { local: String(local).padStart(3, "0"), total: String(total).padStart(3, "0"), jaName, rarity };
}

describe("validateAndBuildK", () => {
  it("accepts a clean set with no secrets", () => {
    const details = [1, 2, 3].map((n) => buildDetail(n, 3, `card${n}`));
    const { k, total } = validateAndBuildK(details, "TEST");
    expect(total).toBe(3);
    expect(k.map((c) => c[0])).toEqual(["001", "002", "003"]);
  });

  it("accepts secrets beyond total when the sequence is unbroken", () => {
    // 1〜193(total)に加えて194〜196のシークレットが連番で揃っている
    const details = [];
    for (let n = 1; n <= 193; n++) details.push(buildDetail(n, 193, `card${n}`));
    for (let n = 194; n <= 196; n++) details.push(buildDetail(n, 193, `secret${n}`));
    const { k, total } = validateAndBuildK(details, "TEST");
    expect(total).toBe(193);
    expect(k.length).toBe(196);
    expect(k[k.length - 1][0]).toBe("196");
  });

  it("detects a gap inside the secret range (M2a incident reproduction)", () => {
    // M2aの実例: total=193、secretは194〜250まで存在するはずが、通信エラーで
    // 222番のカード(1枚)だけ取得できず details に含まれない状態を再現する
    const details = [];
    for (let n = 1; n <= 250; n++) {
      if (n === 222) continue; // 222番の取得に失敗した想定
      details.push(buildDetail(n, 193, n <= 193 ? `card${n}` : `secret${n}`));
    }
    expect(() => validateAndBuildK(details, "M2a")).toThrow(/欠番があります/);
    expect(() => validateAndBuildK(details, "M2a")).toThrow(/222/);
  });

  it("still rejects a gap inside the 1..total range (pre-existing behavior)", () => {
    const details = [1, 2, 4, 5].map((n) => buildDetail(n, 5, `card${n}`));
    expect(() => validateAndBuildK(details, "TEST")).toThrow(/欠番があります/);
  });

  it("rejects duplicate numbers with different names", () => {
    const details = [buildDetail(1, 2, "A"), buildDetail(1, 2, "B"), buildDetail(2, 2, "C")];
    expect(() => validateAndBuildK(details, "TEST")).toThrow(/重複しています/);
  });

  it("dedupes duplicate numbers with the same name (dual-deck reprint pattern)", () => {
    const details = [buildDetail(1, 2, "A"), buildDetail(1, 2, "A"), buildDetail(2, 2, "B")];
    const { k } = validateAndBuildK(details, "TEST");
    expect(k.length).toBe(2);
  });

  it("rejects an unknown rarity code (rarity === null)", () => {
    const details = [{ local: "001", total: "001", jaName: "X", rarity: null }];
    expect(() => validateAndBuildK(details, "TEST")).toThrow(/レアリティコード/);
  });
});

// details.php のHTML解析テスト。LEGEND世代（フェーズ5）で、1ページに(上)(下)両方の
// 番号・レアリティが埋め込まれているカードが存在することが判明した（例:
// 「エンテイ&ライコウLEGEND」は063/080(上)と064/080(下)が同一ページに連続して出現する）。
// これを見落とすと下半分の番号がどこからも取得できない欠落になる（フェーズ5着手時に発覚）
describe("parseCardDetailsFromHtml", () => {
  const NORMAL_HTML = `
    <title>スピアー | ポケモンカードゲーム公式ホームページ</title>
    <img class="fit" src="/assets/images/card_images/large/L1-Bhg/025005_P_SUPIA.jpg" />
    <img src="/assets/images/card/regulation_logo_1/L1-Bhg.gif" class="img-regulation" alt="L1-Bhg" />
    &nbsp;003&nbsp;/&nbsp;070&nbsp;
    <img src="/assets/images/card/rarity/ic_rare_r.gif" width="24" />
  `;

  const LEGEND_HTML = `
    <title>エンテイ&amp;ライコウLEGEND | ポケモンカードゲーム公式ホームページ</title>
    <img class="fit" src="/assets/images/card_images/legend/L2-B/025693_P_ENTEIRAIKOULEGEND.gif" />
    <img src="/assets/images/card/regulation_logo_1/L2-B.gif" class="img-regulation" alt="L2-B" />
    &nbsp;063&nbsp;/&nbsp;080&nbsp;
    <img src="/assets/images/card/rarity/ic_rare_ss.gif" width="24" />
    &nbsp;&nbsp;(上)
    <br />
    <img src="/assets/images/card/regulation_logo_1/L2-B.gif" class="img-regulation" alt="L2-B" />
    &nbsp;064&nbsp;/&nbsp;080 &nbsp;
    <img src="/assets/images/card/rarity/ic_rare_ss.gif" width="24" />
    &nbsp;&nbsp;(下)
  `;

  it("returns a single record for a normal (non-LEGEND) card", () => {
    const result = parseCardDetailsFromHtml(NORMAL_HTML);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ local: "003", total: "070", jaName: "スピアー", rarity: "R" });
  });

  it("returns two records (upper and lower) for a LEGEND card page", () => {
    const result = parseCardDetailsFromHtml(LEGEND_HTML);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ local: "063", total: "080", jaName: "エンテイ&ライコウLEGEND", rarity: "LEGEND" });
    expect(result[1]).toMatchObject({ local: "064", total: "080", jaName: "エンテイ&ライコウLEGEND", rarity: "LEGEND" });
    // 上下で同じ画像（1ページに1枚しか無いため共有される）
    expect(result[0].cardThumbFile).toBe(result[1].cardThumbFile);
  });

  it("tolerates the stray space before the closing &nbsp; seen on some LEGEND pages", () => {
    // 064側は "080 &nbsp;"（totalの直後に半角スペース）という表記ゆれが実際に存在する
    const result = parseCardDetailsFromHtml(LEGEND_HTML);
    expect(result[1].total).toBe("080");
  });

  it("returns an empty array when no number is found", () => {
    const html = `<title>基本草エネルギー | ポケモンカードゲーム公式ホームページ</title>`;
    expect(parseCardDetailsFromHtml(html)).toEqual([]);
  });
});
