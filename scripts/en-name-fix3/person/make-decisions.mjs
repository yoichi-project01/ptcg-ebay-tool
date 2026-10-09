// 「ボスの指令」「博士の研究」の英語名を、英語版で人物の名前で区別している書き方（例 "Boss's Orders (Lysandre)"）にそろえるための判定（2026-10-10）。
//   node scripts/en-name-fix3/person/make-decisions.mjs   → decisions.json（行ごとの変更前・変更後・根拠）を作る。cardData は変えない（反映は apply.mjs）
// 入れる条件（ユーザー判断）: Bulbapedia と TCGdex 英語版で、カード名と人物が一致すること。
//  - TCGdex 英語版: 同じイラストレーターの "Name (Person)" のカードがあること（括弧付きの名前があるのは Giovanni・Lysandre・Magnolia・Juniper・Oak だけ。
//    Rowan・Cyrus・Ghetsis・Corbeau・Sada・Turo・Willow・Generations Start Deck の各博士の版は TCGdex では括弧なしの名前なので、括弧なしのまま）
//  - Bulbapedia: (a) カードのページのリリース情報で日本版の番号が英語版の番号と組になっている（例 Sword 067/060 ↔ Sword & Shield 201/202）→ その英語版のカードの TCGdex の名前、
//    または (b) カードのページの絵の一覧で、そのイラストレーターの版がその人物（例 "Professor Magnolia Regular print Illus. Yusuke Ohmura"）。
//    イラストレーターが2人以上の人物を描いている Hideki Ishikawa は、カードのページの説明で日本版の商品名が Juniper の版として挙がっているもの（Venusaur & Blastoise VMAX Starter Sets・
//    Charizard VMAX Starter Set 2・both High-Class Decks）だけ。
// イラストレーターは公式 details.php（en-name-fix3/illustrators.json・en-name-fix2/illustrators.json・tcgdex-ja.json）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", "..");
const rj = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const data = rj("src/cardData.json");
const A = rj("scripts/en-name-fix3/illustrators.json"), B = rj("scripts/en-name-fix2/illustrators.json"), T = rj("scripts/en-name-fix3/tcgdex-ja.json");
const ill = (id) => A[id]?.illustrator || B[id]?.illustrator || T[id]?.illustrator || "";
const tcg = rj("scripts/en-name-fix3/.cache/tcgdex-en-Trainer.json").data.cards;
const tcgById = new Map(tcg.map((c) => [c.id, c]));
const BP_PR = "Bulbapedia「Professor's Research (Sword & Shield 178)」";
const BP_BO = "Bulbapedia「Boss's Orders (Rebel Clash 154)」";
// (a) Bulbapedia のリリース情報で英語版と組になっている日本版の番号（2026-10-10 にブラウザで確認）
const PAIRS = {
  "S1W-059": "swsh1-178", "S1W-067": "swsh1-201", "S1W-071": "swsh1-209",
  "S8a-003": "cel25-23", "S8a-029": "cel25-24", "S8b-266": "swshp-SWSH152",
  "S2-092": "swsh2-154", "S2-106": "swsh2-189", "S2-112": "swsh2-200",
  "S8b-268": "swsh11tg-TG24",
};
// (b) Bulbapedia の絵の一覧で、そのイラストレーターが描いた版の人物が1人だけのもの
const GALLERY = {
  "博士の研究": { "Yusuke Ohmura": "Professor Magnolia", "KIYOTAKA OSHIYAMA": "Professor Oak", "Ken Sugimori": "Professor Oak" },
  "ボスの指令": { nagimiso: "Giovanni", "Ryuta Fuse": "Lysandre" },
};
const JUNIPER_DECKS = new Set(["SEF", "SEK", "SC2", "SGG", "SGI"]); // Bulbapedia の説明で Juniper の版として挙がっている日本版の商品
const NAME = { "博士の研究": "Professor's Research", "ボスの指令": "Boss's Orders" };
// 括弧なしで入れる行の Bulbapedia の一覧の行（以前の書き写しで <small>[人物]</small> 付きの行を読み落としていた。2026-10-10 にブラウザで確認）
const PLAIN_BP = new Map([
  ["SO-026", "Charizard VSTAR vs Rayquaza VMAX Special Deck Set (TCG) 026/030 Professor's Research [Professor Rowan]"],
  ["SO-028", "Charizard VSTAR vs Rayquaza VMAX Special Deck Set (TCG) 028/030 Boss's Orders [Cyrus]"],
  ["MEE-018", "Ex Starter Sets 2026 (TCG) ex Starter Set Eevee ex 018/019 Boss's Orders [Corbeau]"],
  ["MEZ-018", "Ex Starter Sets 2026 (TCG) ex Starter Set Zorua & Zoroark ex 018/019 Boss's Orders [Corbeau]"],
  ["MEM-016", "Ex Starter Sets 2026 (TCG) ex Starter Set Sprigatito & Meowscarada ex 016/017 Boss's Orders [Corbeau]"],
  ["MF-039", "30th Celebration Premium Deck Set Espeon & Umbreon (TCG) 039/040 Boss's Orders [Corbeau]"],
  ["SVOM-017", "Ex Starter Set Marnie's Morpeko & Grimmsnarl ex (TCG) 017/019 Professor's Research [Professor Magnolia]"],
  ["SVOM-018", "Ex Starter Set Marnie's Morpeko & Grimmsnarl ex (TCG) 018/019 Boss's Orders [Ghetsis]"],
]);
const out = [];
for (const s of data) for (const k of s.k) {
  if (!NAME[k[1]]) continue; // 日本語名に人物の注記がある行（ナナカマド博士・アカギ等）は英語版で括弧なしの名前なので対象外
  const id = `${s.c}-${k[0]}`, il = ill(id), base = NAME[k[1]];
  let person = null, basis = null, tcgCard = null;
  if (PAIRS[id]) {
    tcgCard = tcgById.get(PAIRS[id]) || null;
    basis = `${k[1] === "博士の研究" ? BP_PR : BP_BO} のリリース情報で日本版 ${id} と英語版 ${PAIRS[id]} が組`;
    if (!tcgCard) { out.push({ id, ja: k[1], before: k[2], after: k[2], illustrator: il, status: "空欄のまま", note: `${basis}。TCGdex 英語版に ${PAIRS[id]} が無い` }); continue; }
    if (il && tcgCard.illustrator && tcgCard.illustrator !== il) { out.push({ id, ja: k[1], before: k[2], after: k[2], illustrator: il, status: "変更なし", note: `イラストレーターが違う（TCGdex ${tcgCard.illustrator}）` }); continue; }
  } else {
    if (k[1] === "博士の研究" && il === "Hideki Ishikawa" && JUNIPER_DECKS.has(s.c)) { person = "Professor Juniper"; basis = `${BP_PR} の説明で ${s.c} の商品が Professor Juniper の版（Illus. Hideki Ishikawa）`; }
    else if (GALLERY[k[1]][il]) { person = GALLERY[k[1]][il]; basis = `${k[1] === "博士の研究" ? BP_PR : BP_BO} の絵の一覧で Illus. ${il} の版は ${person}`; }
    if (person) tcgCard = tcg.find((c) => c.name === `${base} (${person})` && c.illustrator === il) || null;
    if (!person || !tcgCard) {
      // 括弧付きの名前にならない行: TCGdex に同じイラストレーターの括弧なしの名前があり、Bulbapedia の一覧に同じ名前（[人物] 付き）があれば括弧なしで入れる（これまでの規則）
      const plain = il ? tcg.find((c) => c.name === base && c.illustrator === il) : null;
      if (!k[2] && plain && PLAIN_BP.has(id)) out.push({ id, ja: k[1], before: "", after: base, illustrator: il, status: "入れる（括弧なし）", note: `Bulbapedia の一覧 ${PLAIN_BP.get(id)}、TCGdex 英語版 ${plain.id}（${il}）` });
      else out.push({ id, ja: k[1], before: k[2], after: k[2], illustrator: il, status: k[2] ? "変更なし" : "空欄のまま", note: !il ? "イラストレーターが分からない" : person ? `TCGdex 英語版に ${base} (${person})（${il}）が無い` : "英語版で括弧なしの名前の版" });
      continue;
    }
  }
  const after = tcgCard.name;
  out.push({ id, ja: k[1], before: k[2], after, illustrator: il, status: after === k[2] ? "変更なし" : "入れる", note: `${basis}。TCGdex 英語版 ${tcgCard.id} "${tcgCard.name}"（${tcgCard.illustrator}）` });
}
fs.writeFileSync(path.join(__dirname, "decisions.json"), JSON.stringify(out, null, 1) + "\n");
const c = {}; for (const r of out) c[r.status] = (c[r.status] || 0) + 1;
console.log(c);
