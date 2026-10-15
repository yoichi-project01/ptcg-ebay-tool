#!/usr/bin/env node
// 同じ名前で保留にした番号の無い古いプロモ（PMCG-P・neo-P・ADV/PCG の Y）を、カードの中身で1枚に決められるか調べる（2026-10-15、ユーザーの指示）。
//   node scripts/old-promos/resolve-same-name.mjs        → same-name-decisions-2026-10-15.tsv
// 旧裏の PMCG で HP とレアリティの印で見分けたのと同じ考え方で、名前と並び順では結び付けない:
//   1. pcg-search のカードのページのカードの部分（種類・HP・ワザ／特殊能力の名前とダメージ・illus./Photo.）
//   2. ポケモンWiki の番号の無いプロモの表で同じ名前の行がリンクしているカードのページ（HP・ワザ・特殊能力・イラスト担当／別イラスト担当・備考の入手法の行）
//   3. Bulbapedia の番号の無いプロモの一覧（年・jname・英語名）
//   pcg-search のカードに合うポケモンWiki のページが1つだけで、そのページに合う pcg-search のカードもそれ1枚だけで、ページの入手法が1つだけ（配り方が1通り）で、
//   Bulbapedia にもその年・その名前の行が1つだけのときに「決まる」とする。それ以外は保留（理由を書く）。
// ポケモンWiki のページは scripts/pcg-search-cache/pokemonwiki/（.gitignore 対象）に置き、取得は1接続・2〜3秒間隔。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, "..", "pcg-search-cache", "pokemonwiki");
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = (s) => (s ?? "").normalize("NFKC").replace(/[\s_＿]/g, "").replace(/[!！]/g, "!").replace(/[?？]/g, "?");

// pcg-search のカードの部分
function psCard(page) {
  const t = fs.readFileSync(path.join(__dirname, "..", "pcg-search-cache", "promo", `${page}.html`), "utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const s = t.replace(/<[^>]+>/g, "|").replace(/\|[\s|]*\|/g, "|").replace(/\s+/g, " ");
  const i = s.indexOf("お気に入り削除|"), j = s.indexOf("|収録", i);
  const block = s.slice(i + 8, j);
  const parts = block.split("|").map((x) => x.trim()).filter(Boolean);
  const hp = (block.match(/HP:(\d+)/) || [])[1] ?? "";
  const credit = (block.match(/(?:illus|Photo)\.([^|]*)/) || [])[1]?.trim() ?? "";
  const ability = (block.match(/【特殊能力】\s*([^ |]+)/) || [])[1] ?? "";
  // ワザ名は「にげる」より後の、説明文（「。」で終わる）・特殊能力・クレジットでない部分（「でんきショック 20」はダメージを外す）
  const k = parts.indexOf("にげる");
  const attacks = (k < 0 ? [] : parts.slice(k + 1)).filter((p) => !/。/.test(p) && p.length <= 25 &&!/^【/.test(p) && !/^(illus|Photo)\./.test(p) && !/^[-\d×+\s]+$/.test(p))
    .map((p) => p.replace(/\s+\d+[+×-]?$/, ""));
  return { hp, credit, ability, attacks, kind: parts[0] ?? "", block };
}
// ポケモンWiki
const wiki = fs.readFileSync(path.join(__dirname, "pokemonwiki-promo-2026-10-15.wikitext"), "utf8").replace(/\r\n/g, "\n");
const sec = wiki.slice(wiki.indexOf("=== コレクションナンバーなし"), wiki.indexOf("=== P,T,J"));
const pwRows = sec.split(/\n\|-/).slice(1).map((r) => r.trim().split("\n")[0].replace(/^\|/, "").split("||").map((c) => c.trim())).filter((c) => c.length >= 4)
  .map((c) => { const m = c[2].match(/\[\[([^|\]]*)(?:\|([^\]]*))?\]\]/); return { date: c[0], target: m?.[1] ?? "", name: (m?.[2] ?? m?.[1] ?? c[2]).replace(/LV\.\d+$/, ""), how: c[3] }; });
async function pwPage(title) {
  const f = path.join(CACHE, encodeURIComponent(title) + ".wikitext");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const u = "https://wiki.pokemonwiki.com/w/index.php?title=" + encodeURIComponent(title.replace(/ /g, "_")) + "&action=raw";
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } });
  const t = r.ok ? await r.text() : "";
  fs.writeFileSync(f, t);
  await sleep(2000 + Math.random() * 1000);
  return t;
}
function parsePw(t) {
  const g = (k) => (t.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n]*)`)) || [])[1]?.trim() ?? "";
  const attacks = []; for (let i = 1; i <= 4; i++) { const a = g(`ワザ${i}`); if (a) attacks.push(a.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")); }
  const ability = (g("特殊能力") || g("ポケパワー") || g("ポケボディー")).replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");
  const ill = [g("イラスト担当"), g("別イラスト担当"), g("イラスト担当2")].map((x) => x.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")).filter(Boolean);
  const bik = t.slice(t.indexOf("== 備考 ==")).split("\n== ")[0];
  const how = bik.split("\n").filter((l) => /^\*[^*]/.test(l)).map((l) => l.replace(/^\*\s*/, "").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1"));
  return { hp: g("HP"), attacks, ability, ill, how };
}
const bp = fs.readFileSync(path.join(__dirname, "bulbapedia-unnumbered-1996-2005-2026-10-15.txt"), "utf8").trim().split(/\r?\n/).map((l) => { const [idx, year, jname, en, type] = l.split("|"); return { idx, year: +year, jname, en, type }; });
const ps = JSON.parse(fs.readFileSync(path.join(__dirname, "pcg-search-promos-2026-10-15.json"), "utf8"));
const OLD = ["1st:プロモ", "neo:プロモ", "neo:プレミアムファイル", "neo:プレミアムファイル2", "neo:プレミアムファイル3", "adv:ナンバー外", "pcg:ナンバー外"];
const held = [];
for (const s of ["PMCG-P", "neo-P", "ADV-PY", "PCG-PY"]) for (const l of fs.readFileSync(path.join(__dirname, `${s}-held-2026-10-15.tsv`), "utf8").trim().split(/\r?\n/).slice(1)) { const c = l.split("\t"); held.push({ set: s, id: c[0], page: c[1], name: c[2], why: c[6] }); }

const out = [["card_id（予定）", "pcg-search", "名前", "HP", "ワザ・特殊能力", "クレジット", "ポケモンWiki のページ", "入手法", "Bulbapedia", "判定", "理由"].join("\t")];
const sameName = held.filter((h) => /同じ名前/.test(h.why));
const psAll = Object.entries(ps).filter(([, v]) => OLD.includes(v.group)).map(([page, v]) => ({ page, name: v.name, c: psCard(page) }));
const match = (c, p) => c.hp === p.hp && (c.ability ? N(c.ability) === N(p.ability) : true) && c.attacks.length === p.attacks.length && c.attacks.every((a, i) => N(a) === N(p.attacks[i])) && (!p.ill.length || !c.credit || p.ill.some((x) => N(x) === N(c.credit)));
for (const h of sameName) {
  const c = psCard(h.page);
  const targets = [...new Set(pwRows.filter((r) => N(r.name) === N(h.name) && r.target).map((r) => r.target))];
  const pages = [];
  for (const t of targets) { // 転送されるページはその先を読む
    let txt = await pwPage(t), title = t;
    const rd = txt.match(/#REDIRECT\s*\[\[([^\]|]*)/i);
    if (rd) { title = rd[1]; txt = await pwPage(title); }
    if (txt) pages.push({ title, ...parsePw(txt) });
  }
  const hits = c.kind.includes("トレーナー") ? [] : pages.filter((p) => match(c, p));
  if (process.env.DEBUG === h.page) console.error(JSON.stringify({ c: { hp: c.hp, credit: c.credit, ability: c.ability, attacks: c.attacks }, pages: pages.map(({ title, hp, attacks, ability, ill }) => ({ title, hp, attacks, ability, ill })) }, null, 1));
  let verdict = "保留", why = "";
  if (c.kind.includes("トレーナー")) why = "トレーナーズは本文が同じで見分けられない";
  else if (hits.length !== 1) why = `ポケモンWiki のページで合うものが${hits.length}つ`;
  else {
    const p = hits[0];
    const others = psAll.filter((x) => x.page !== h.page && N(x.name) === N(h.name) && match(x.c, p));
    if (others.length) why = `同じページに合う pcg-search のカードがほかに ${others.map((x) => x.page).join("・")}`;
    else if (p.how.length !== 1) why = `ポケモンWiki のページの入手法が${p.how.length}通り（どの配り方の版か決まらない）`;
    else {
      // 入手法の行に年が無いときは、番号の無いプロモの表でそのページにリンクしている行（1行だけのとき）の日付の年
      const tableRows = pwRows.filter((r) => r.target === p.title || targets.includes(r.target) && r.target === p.title);
      const year = +((p.how[0].match(/(\d{4})/) || [])[1] ?? (tableRows.length === 1 ? (tableRows[0].date.match(/(\d{4})/) || [])[1] : NaN));
      // テレホンカード・ジャンボカード・はがき・英語版・フランス語版は普通のカードではないので候補から外す
      const b = bp.filter((x) => N(x.jname) === N(h.name) && x.year === year && !/\[(Phone card|Jumbo|Postcard|English|French)/.test(x.en));
      if (b.length !== 1) why = `Bulbapedia の${year}年に同じ名前が${b.length}件`;
      else { verdict = "決まる"; why = `${b[0].idx}:${b[0].year}:${b[0].en}`; }
    }
  }
  out.push([h.id, h.page, h.name, c.hp, (c.ability ? `【特】${c.ability} ` : "") + c.attacks.join("・"), c.credit, hits.map((p) => p.title).join(" / "), hits.length === 1 ? hits[0].how.join(" ／ ") : "", "", verdict, why].join("\t"));
  console.log(verdict, h.id, h.name, "|", why);
}
fs.writeFileSync(path.join(__dirname, "same-name-decisions-2026-10-15.tsv"), out.join("\n") + "\n");
