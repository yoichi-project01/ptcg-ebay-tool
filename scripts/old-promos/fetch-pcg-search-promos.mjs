#!/usr/bin/env node
// 古いプロモ（旧裏・neo・★VS・web・e・ADV・PCG）の pcg-search.com のカードのページと画像を取る（2026-10-15）。
//   node scripts/old-promos/fetch-pcg-search-promos.mjs
// ページの一覧は pcg-search-promo-list-2026-10-15.json（/card/card_list.php から取り出したもの）。番号付きの分類（ADV・PCG のプロモ・プレイヤーズ、
// e のプロモ・トレーナーズ）を先に、番号の無い分類を後に取る。ページから名前（title）・収録と番号（「(001/063)」。番号の無いものは無し）・
// レアリティの印・イラストレーター・画像のパスを取り、画像も取る。1接続・2〜3秒間隔、失敗は待って再試行（30→90→300秒）。途中で止まっても再実行で続きから。
// ページと画像は scripts/pcg-search-cache/promo/（.gitignore 対象）、結果は scripts/old-promos/pcg-search-promos-2026-10-15.json（画像の SHA-256 つき）
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, "..", "pcg-search-cache", "promo");
const OUT = path.join(__dirname, "pcg-search-promos-2026-10-15.json");
fs.mkdirSync(path.join(CACHE, "img"), { recursive: true });
const list = JSON.parse(fs.readFileSync(path.join(__dirname, "pcg-search-promo-list-2026-10-15.json"), "utf8")).groups;
const ORDER = ["adv:プロモ", "adv:プレイヤーズ", "pcg:プレイヤーズ", "pcg:プロモ", "e:プロモ", "e:トレーナーズ", "adv:トレーナーズ"];
const rank = (g) => { const i = ORDER.indexOf(`${g.dir}:${g.title}`); return i < 0 ? 99 : i; };
const groups = [...list].sort((a, b) => rank(a) - rank(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delay = () => sleep(2000 + Math.random() * 1000);
async function get(url, binary) {
  for (const wait of [0, 30000, 90000, 300000]) {
    if (wait) { console.log(`  待って再試行 ${wait / 1000}秒: ${url}`); await sleep(wait); }
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60000) });
      if (r.ok) return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
      if (r.status === 404) return null;
    } catch {}
  }
  throw new Error(`取れなかった: ${url}`);
}
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
for (const g of groups) {
  for (const [page, listName] of g.pages) {
    if (out[page]?.sha256) continue;
    const pageFile = path.join(CACHE, `${page}.html`);
    let html = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, "utf8") : null;
    if (!html) { html = await get(`https://pcg-search.com/card/${g.dir}/${page}.php`); await delay(); if (!html) throw new Error(`ページが無い: ${page}`); fs.writeFileSync(pageFile, html); }
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.trim() ?? "";
    const name = title.replace(/\s*\|.*$/, "").trim();
    const num = (title.match(/\((\d{3}|-)\/(\d{3}|-)\)\s*$/) || []).slice(1);
    const rarity = (html.match(/レアリティ\s*([^<\s]*)\s*</) || [])[1] ?? "";
    const illus = (html.match(/illus\.([^<]*)</) || [])[1]?.trim() ?? "";
    const img = (html.match(/src="\.\.\/\.\.\/(img\/(?:1st|neo|vs|web|e|adv|pcg)\/[^"]+)"/) || [])[1];
    if (!name || !img) throw new Error(`ページの形が違う: ${page} ${title}`);
    const imgFile = path.join(CACHE, "img", path.basename(img));
    let buf = fs.existsSync(imgFile) ? fs.readFileSync(imgFile) : null;
    if (!buf) { buf = await get(`https://pcg-search.com/${img}`, true); await delay(); if (!buf || buf.length < 1000) throw new Error(`画像が無い: ${page}`); fs.writeFileSync(imgFile, buf); }
    out[page] = { group: `${g.dir}:${g.title}`, listName, name, title, num: num[0] ?? "", den: num[1] ?? "", rarity, illustrator: illus, image: img, bytes: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex") };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  }
  console.log(`${g.dir}:${g.title} ${g.pages.length}件 完了`);
}
console.log(`完了: ${Object.keys(out).length}件`);
