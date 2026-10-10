// DP1〜5・DP（公式の一覧のキー）を、番号の無いプロモと同じ「X＋公式の cardID」の型番で新しい弾として取り込む（2026-10-10）。
//   node scripts/dp-x/build-dp-sets.mjs --set DP1            取り込む内容を dp-x/plan-{弾}.json に書く（cardData は変えない）
//   node scripts/dp-x/build-dp-sets.mjs --set DP1 --apply    画像を公式から取り、cardData.json に弾を足す（後で build-image-index.mjs --only <弾>）
// DP 世代のカードには弾の中の番号が無い（details.php の番号は DPBP# という種族ごとの通し番号で、同じ番号に別のカードがある）ため、
// 型番は details.php の cardID にする。details.php の結果は fetch-details.mjs が dp-x/details.json に保存したもの。
// 同じ弾に同じ名前のカードがあるときは、公式ページの情報で見分けて名前の後ろに括弧で付ける:
//   ・段階が「レベルアップ」（LV.X）のカード → 「（LV.X）」
//   ・それでも同じになるもの → ページの最後の収録商品のうち、ほかの同じ名前のカードに無いもの（「（構築ハーフデッキ「守りのトリデプス」）」等）
//   ・それでも同じになるもの → LV（「（LV.48）」）。それでも決まらなければ止まる
// レアリティは details.php のアイコン（c/u/r/s）だけ。アイコンが無いカードは空欄（推測で埋めない）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, writeFileAtomic } from "../filename-utils.mjs";
import { politeDelay, politeFetch } from "../scrape-promo-sets.mjs";
import { RARITY_CODE_MAP } from "../scrape-missing-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const SET = arg("--set");
const APPLY = process.argv.includes("--apply");
if (!SET) throw new Error("--set <弾> を指定してください");

const META = JSON.parse(fs.readFileSync(path.join(__dirname, "set-meta.json"), "utf8"));
const meta = META[SET];
if (!meta || !meta.ja || !meta.y || !meta.sr) throw new Error(`dp-x/set-meta.json に ${SET} の ja・y・sr がありません`);
const details = JSON.parse(fs.readFileSync(path.join(__dirname, "details.json"), "utf8"));
const scan = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "official-card-scan.json"), "utf8")).setMap;
const keyIds = (scan[meta.key ?? SET] || []).map((c) => String(parseInt(c.cardThumbFile.match(/\/(\d+)_/)[1], 10)));

// 収録商品（ページの最後の「ポケモンカードゲーム…」の行）。拡張パックを先に並べ、時空の創造の2つのコレクションは1つにまとめる（見分けの括弧に使う順）
const products = (x) => {
  const t = x.text; let i = t.indexOf("CLOSE") - 1; let out = [];
  while (i > 0 && /^ポケモンカードゲーム/.test(t[i])) { out.unshift(t[i].replace(/^ポケモンカードゲームDP\s*/, "").replace(/\s+/g, " ")); i--; }
  out = [...new Set(out.map((p) => p.replace(/^拡張パック「時空の創造 (ダイヤモンド|パール)コレクション」$/, "拡張パック「時空の創造」")))];
  return [...out.filter((p) => p.startsWith("拡張パック")), ...out.filter((p) => !p.startsWith("拡張パック"))];
};
const isLvX = (x) => x.text.includes("レベルアップ") && x.text[x.text.indexOf("LV.") + 1] === "X";
const level = (x) => { const i = x.text.indexOf("LV."); return i >= 0 ? x.text[i + 1] : ""; };

const cards = [];
for (const id of keyIds) {
  const x = details[id];
  if (!x) throw new Error(`details.json に cardID ${id} がありません（fetch-details.mjs を先に）`);
  if (x.badge !== SET) throw new Error(`印刷記号が ${SET} ではありません: ${id} ${x.badge}`);
  if (!x.name || !x.image) throw new Error(`名前か画像が無い: ${id}`);
  if (/^基本.+エネルギー$/.test(x.name)) continue;
  const rarity = x.rarityCode ? RARITY_CODE_MAP[x.rarityCode] : "";
  if (rarity === undefined) throw new Error(`知らないレアリティのアイコン: ${id} ${x.rarityCode}`);
  cards.push({ id, name: x.name, rarity, lvx: isLvX(x), lv: level(x), products: products(x), image: x.image, note: "" });
}

// ページの本文がまったく同じカード（画像の形式だけ jpg・gif と違う）は同じカードの別掲載として1行にまとめる（jpg を残す）
const sameText = new Map();
const dupListings = [];
for (const c of [...cards]) {
  // カードの本文（「進化」の欄より前。進化の欄はページによって有無が違う）と収録商品で比べる
  const t = details[c.id].text;
  const ev = t.indexOf("進化", t.indexOf("にげる"));
  const end = ev > 0 ? ev : t.findIndex((s, i) => i > 0 && /^ポケモンカードゲーム/.test(s));
  const sig = JSON.stringify([t.slice(0, end), c.products]);
  const o = sameText.get(sig);
  if (!o) { sameText.set(sig, c); continue; }
  const keep = /\.jpg$/.test(o.image) || !/\.jpg$/.test(c.image) ? o : c;
  const drop = keep === o ? c : o;
  cards.splice(cards.indexOf(drop), 1);
  sameText.set(sig, keep);
  dupListings.push({ kept: keep.id, dropped: drop.id, name: c.name, keptImage: keep.image, droppedImage: drop.image });
}

// 同じ名前のカードを見分ける
const groups = new Map();
for (const c of cards) { if (!groups.has(c.name)) groups.set(c.name, []); groups.get(c.name).push(c); }
for (const g of groups.values()) {
  if (g.length < 2) continue;
  for (const c of g) {
    const parts = [];
    const sameLvx = g.filter((o) => o.lvx === c.lvx);
    if (c.lvx && sameLvx.length < g.length) parts.push("LV.X");
    if (sameLvx.length > 1) {
      const uniq = c.products.filter((p) => sameLvx.every((o) => o === c || !o.products.includes(p)));
      if (uniq.length) parts.push(uniq[0]);
      else {
        const sameLv = sameLvx.filter((o) => o.lv === c.lv);
        if (sameLv.length === 1) parts.push(`LV.${c.lv}`);
      }
    }
    c.note = parts.join("・");
  }
  const names = g.map((c) => c.note);
  if (new Set(names).size !== g.length) throw new Error(`同じ名前のカードを見分けられません: ${g[0].name} ${g.map((c) => c.id + ":" + c.note).join(" ")}`);
}
for (const c of cards) c.ja = c.note ? `${c.name}（${c.note}）` : c.name;
cards.sort((a, b) => +a.id - +b.id);

const plan = { set: SET, key: meta.key ?? SET, at: new Date().toISOString(), count: cards.length, dupListings, cards: cards.map(({ id, name, ja, rarity, lvx, lv, products, image }) => ({ id: `${SET}-X${id}`, cardId: id, name, ja, rarity, lvx, lv, products, image })) };
fs.writeFileSync(path.join(__dirname, `plan-${SET}.json`), JSON.stringify(plan, null, 1) + "\n");
console.log(`${SET}: ${cards.length}枚（同じ名前で括弧を付けた ${cards.filter((c) => c.note).length}枚）`);
if (!APPLY) process.exit(0);

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
if (data.some((s) => s.c === meta.c)) throw new Error(`cardData に ${meta.c} が既にあります`);
const folder = `cards/${meta.sr}/${meta.c}`;
const k = [];
let fails = 0;
for (const c of cards) {
  const buf = await politeFetch(`https://www.pokemon-card.com${c.image}`, true);
  await politeDelay();
  if (!buf || buf.length < 1000) { if (++fails >= 3) throw new Error("画像の取得に3件続けて失敗しました"); throw new Error(`画像を取得できない: ${c.id}`); }
  fails = 0;
  const ext = buf[0] === 0x89 ? ".png" : buf[0] === 0x47 ? ".gif" : ".jpg";
  await writeFileAtomic(path.join(ROOT, "public", folder, buildFileName(c.ja, meta.c, `X${c.id}`, c.rarity, 0) + ext), buf);
  k.push([`X${c.id}`, c.ja, "", c.rarity]);
}
const set = { c: meta.c, ja: meta.ja, en: meta.en ?? "", sr: meta.sr, of: 0, y: meta.y, k };
if (meta.psaName) set.psaName = meta.psaName;
data.push(set);
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(path.join(__dirname, `${meta.c}-added-card-ids.txt`), k.map((r) => `${meta.c}-${r[0]}`).join("\n") + "\n");
console.log(`${meta.c}: ${k.length}枚を cardData に追加`);
