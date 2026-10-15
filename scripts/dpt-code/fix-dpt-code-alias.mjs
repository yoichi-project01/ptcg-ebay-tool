#!/usr/bin/env node
// DPt1-B〜DPt4-B の印刷された記号（codeAlias）を Pt1〜Pt4 にする（2026-10-15、ユーザーの指示）。
//   node scripts/dpt-code/fix-dpt-code-alias.mjs [--apply]
// codeAlias はタイトル・説明文の Set の括弧・相場リンクの検索語に使う（src/App.jsx の displaySetCode）。弾コード（c）・SKU・画像の対応表のキーは変えない。
// 根拠: Bulbapedia の各弾のページの弾のマークの画像（下の symbol。文字が Pt1〜Pt4。2026-10-15 に取得、SHA-256 を記録）。公式の画像は 162×226 で
// マークが読めない（fix-code-alias-2026-10-14.mjs の注記）。ポケモンWiki の商品ページには略称の欄が無い。弾コード DPt1-B 等は公式の画像のフォルダ名
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const FIXES = [
  { c: "DPt1-B", to: "Pt1", symbol: "https://archives.bulbagarden.net/media/upload/8/86/SetSymbolGalactic_Conquest.png", sha256: "28b805d5e95a27d9b9d38d3a0b7557397ae0a377e7a5b06759356dc6caf4cdc3" },
  { c: "DPt2-B", to: "Pt2", symbol: "https://archives.bulbagarden.net/media/upload/1/15/SetSymbolBonds_to_the_End_of_Time.png", sha256: "ca09c25198721df158a56ebde2f74e70d9a721f246fdcbe2de4c43120a9e1aa9" },
  { c: "DPt3-B", to: "Pt3", symbol: "https://archives.bulbagarden.net/media/upload/f/f3/SetSymbolBeat_of_the_Frontier.png", sha256: "c1f93dd7678b55d07f0247144d75f3b28a93a5aeaaa0bbd47d8402cf5e5bbab3" },
  { c: "DPt4-B", to: "Pt4", symbol: "https://archives.bulbagarden.net/media/upload/4/4c/SetSymbolAdvent_of_Arceus.png", sha256: "55bb5e0d8c1542aa3328629d698ea951761a0ce2ed35f7601dbdbee7ef376a0d" },
];
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
let n = 0;
for (const f of FIXES) {
  const s = data.find((x) => x.c === f.c);
  if (s.codeAlias === f.to) { console.log(`${f.c}: 直し済み（${f.to}）`); continue; }
  if (s.codeAlias !== undefined) throw new Error(`${f.c}: 想定と違う codeAlias ${s.codeAlias}`);
  console.log(`${f.c}: （なし） → ${f.to}`);
  if (process.argv.includes("--apply")) {
    // キーの位置は既存の弾と同じく of の前（無ければ k の前）
    const entries = Object.entries(s);
    const at = entries.findIndex(([k]) => k === "of" || k === "k");
    entries.splice(at < 0 ? entries.length : at, 0, ["codeAlias", f.to]);
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, Object.fromEntries(entries));
    n++;
  }
}
if (n) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
console.log(`${n}弾`);
