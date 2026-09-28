import { describe, expect, it } from "vitest";
import { imageExt, parsePromoDetailFromHtml } from "./scrape-promo-sets.mjs";

describe("imageExt", () => {
  it("中身が GIF なら .gif、それ以外は .jpg", () => {
    expect(imageExt(Buffer.from("GIF89a..."))).toBe(".gif");
    expect(imageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(".jpg");
  });
});

// details.php の実際の表記（SMP cardId 33211, 2026-09-28取得）を最小限に再現したもの
const html = (numberPart) => `
<title>カビゴンGX | ポケモンカードゲーム公式ホームページ</title>
<img class="fit" src="/assets/images/card_images/large/SMP/033211_P_KABIGONGX.jpg"  alt="カビゴンGX" />
<div class="subtext Text-fjalla">
    <img src="/assets/images/card/regulation_logo_1/SMP.gif" class="img-regulation" alt="SMP" />
${numberPart}
</div>`;

describe("parsePromoDetailFromHtml", () => {
  it("「NNN / XX-P」形式の番号を読み取る", () => {
    const r = parsePromoDetailFromHtml(html("&nbsp;001&nbsp;/&nbsp;SM-P&nbsp;"));
    expect(r).toMatchObject({ jaName: "カビゴンGX", badge: "SMP", number: "001", label: "SM-P", rarityCode: null });
    expect(r.cardThumbFile).toBe("/assets/images/card_images/large/SMP/033211_P_KABIGONGX.jpg");
  });

  it("DPt-P のような小文字を含むラベルも読み取る", () => {
    expect(parsePromoDetailFromHtml(html("&nbsp;039&nbsp;/&nbsp;DPt-P&nbsp;")).label).toBe("DPt-P");
  });

  it("番号の無いカード（基本エネルギー等）は number=null", () => {
    expect(parsePromoDetailFromHtml(html("&nbsp;SM-P&nbsp;")).number).toBeNull();
  });

  it("通常セットの「NNN / NNN」はプロモ番号として扱わない", () => {
    expect(parsePromoDetailFromHtml(html("&nbsp;001&nbsp;/&nbsp;060&nbsp;")).number).toBeNull();
  });

  it("&amp; を含むカード名をデコードする", () => {
    const r = parsePromoDetailFromHtml(html("&nbsp;001&nbsp;/&nbsp;SM-P&nbsp;").replace("カビゴンGX |", "グズマ&amp;ハラ |"));
    expect(r.jaName).toBe("グズマ&ハラ");
  });
});
