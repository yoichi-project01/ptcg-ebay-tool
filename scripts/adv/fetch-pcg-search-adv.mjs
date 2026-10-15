#!/usr/bin/env node
// ADV 世代の5弾（第1〜4弾・強化拡張パックex1）の pcg-search.com のカードのページと画像を取る（2026-10-15）。
//   node scripts/adv/fetch-pcg-search-adv.mjs
// ページ /card/adv/{adv1〜4|advex1}{NNN}.php から、名前（title）・番号（「(001/055)」）・レアリティの印（●◆★☆）・イラストレーター・画像のパスを取り、
// 画像 /img/adv/….png も取る。1接続・2〜3秒間隔、失敗は待って再試行（30→90→300秒）。途中で止まっても再実行で続きから。
// ページと画像は scripts/pcg-search-cache/adv/（.gitignore 対象）、結果は scripts/adv/pcg-search-adv-2026-10-15.json（画像の SHA-256 つき）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, "..", "pcg-search-cache", "adv");
const OUT = path.join(__dirname, "pcg-search-adv-2026-10-15.json");
fs.mkdirSync(path.join(CACHE, "img"), { recursive: true });
const SETS = [["adv1", 55], ["adv2", 53], ["adv3", 54], ["adv4", 83], ["advex1", 80]];
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
for (const [s, n] of SETS) {
  for (let i = 1; i <= n; i++) {
    const id = `${s}${String(i).padStart(3, "0")}`;
    if (out[id]?.sha256) continue;
    const pageFile = path.join(CACHE, `${id}.html`);
    let html = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, "utf8") : null;
    if (!html) { html = await get(`https://pcg-search.com/card/adv/${id}.php`); await delay(); if (!html) throw new Error(`ページが無い: ${id}`); fs.writeFileSync(pageFile, html); }
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.trim() ?? "";
    const m = title.match(/^(.*?)\s*\|\s*(.*)\((\d{3})\/(\d{3})\)\s*$/);
    const rarity = (html.match(/レアリティ\s*([^<\s]*)\s*</) || [])[1] ?? "";
    const illus = (html.match(/illus\.([^<]*)</) || [])[1]?.trim() ?? "";
    const img = (html.match(/src="\.\.\/\.\.\/(img\/adv\/[^"]+)"/) || [])[1];
    if (!m || !img) throw new Error(`ページの形が違う: ${id} ${title}`);
    const imgFile = path.join(CACHE, "img", path.basename(img));
    let buf = fs.existsSync(imgFile) ? fs.readFileSync(imgFile) : null;
    if (!buf) { buf = await get(`https://pcg-search.com/${img}`, true); await delay(); if (!buf || buf.length < 1000) throw new Error(`画像が無い: ${id}`); fs.writeFileSync(imgFile, buf); }
    out[id] = { name: m[1].trim(), pack: m[2].trim(), num: m[3], den: m[4], rarity, illustrator: illus, image: img, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
    if (i % 10 === 0) console.log(`${id} ${out[id].name} ${rarity}`);
  }
}
console.log(`完了: ${Object.keys(out).length}件`);
