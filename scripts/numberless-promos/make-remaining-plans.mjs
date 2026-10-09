// remaining-details.json（details.php の本文）から、番号の無いプロモの残りの計画ファイルをカード名ごとに作る（2026-10-09）。
//   node scripts/numberless-promos/make-remaining-plans.mjs
// 見分け方: details.php の本文の「CLOSE」の直前の行（配布のイベント名・賞・デザインコンテストの部門）。計画の eventDetails はこの行そのもので、
// add-numberless-promos.mjs が取得し直したページの本文と照合する。日本語名は「名前（配布の説明）」で、説明はこの行から「ポケモンカードゲーム」・括弧を除いたもの
// （複数のイベントで配られたカードは最初のイベント＋「ほか」）。本文が同じカードは公式の画像に印刷された文字・絵で見分けた（下の PRINTED、2026-10-09 に目で確認）。
// 番号があるカード（XY-P ともだちてちょう）は対象外。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const det = JSON.parse(fs.readFileSync(path.join(__dirname, "remaining-details.json"), "utf8"));
const PRINTED = {
  33300: "ほんきをだすバトル 優勝", 33301: "ほんきをだすバトル 2位", 33302: "ほんきをだすバトル 3位", // 絵の下に印刷された順位
  33318: "ボールを蹴る絵", 33319: "スタジアムでジャンプする絵", // 絵の違い（本文は同じ）
};
const SLUG = (s) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const clean = (s) => {
  let x = s.replace(/&amp;/g, "&").replace(/[（(](\d{4})\/(\d{1,2})[）)]/g, " $1年$2月").replace(/[」｣](?=の)/g, "").replace(/[「」｢｣]/g, " ").replace(/ポケモンカードゲーム(DP)?/g, "").replace(/[／/]/g, " ").replace(/[\s　]+/g, " ").trim();
  if (x.includes("、")) x = x.split("、")[0].trim() + " ほか";
  return x;
};
const groups = {};
for (const [cid, v] of Object.entries(det)) {
  if (v.hasNumber) continue;
  const i = v.text.indexOf("CLOSE");
  const dist = v.text[i - 1];
  const illustrator = v.text[v.text.indexOf("イラストレーター") + 1];
  const g = (groups[`${v.set}\t${v.name}\t${v.badge}`] ??= []);
  g.push({ cardId: cid, name: v.name, eventDetails: dist, illustrator, ...(PRINTED[cid] ? { printed: PRINTED[cid] } : {}), note: [clean(dist), PRINTED[cid]].filter(Boolean).join(" ") });
}
const made = [];
for (const [k, cards] of Object.entries(groups)) {
  const [set, name, badge] = k.split("\t");
  cards.sort((a, b) => a.cardId - b.cardId);
  // 配布の説明が同じカード（イラストコンテストの入賞作品など）はイラストレーターで見分ける（本文のイラストレーターの欄）
  const sameNote = cards.map((c) => cards.filter((x) => x.note === c.note).length > 1);
  cards.forEach((c, i) => {
    c.ja = `${name}（${c.note}${sameNote[i] ? " " + c.illustrator : ""}）`;
    if (!sameNote[i]) delete c.illustrator;
  });
  for (const c of cards) delete c.note;
  const ja = cards.map((c) => c.ja);
  if (new Set(ja).size !== ja.length) throw new Error(`日本語名が重なる: ${set} ${name}`);
  const file = path.join(__dirname, `${set}-${SLUG(name)}.json`);
  if (fs.existsSync(file)) throw new Error(`計画ファイルが既にある: ${file}`);
  fs.writeFileSync(file, JSON.stringify({ set, name, badge, note: "番号の無いプロモ（大会賞品以外）。型番は X＋公式 details.php の cardID。見分け方は details.php の本文の最後の配布の説明（eventDetails）。printed があるカードは本文が同じで、公式の画像の印刷・絵で見分けた（2026-10-09）。", cards }, null, 1) + "\n");
  made.push(path.basename(file));
}
fs.writeFileSync(path.join(__dirname, "remaining-plans.txt"), made.join("\n") + "\n");
console.log(made.length, "件の計画ファイル");
