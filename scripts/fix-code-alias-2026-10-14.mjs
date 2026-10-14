#!/usr/bin/env node
// 印刷された記号（codeAlias）が内部の弾コードのままだった弾を、公式の画像で確かめた記号に直す（2026-10-14、レビューの C7）。
//   node scripts/fix-code-alias-2026-10-14.mjs [--apply]
// codeAlias はタイトル・説明文の Set の括弧・相場リンクの検索語に使う（src/App.jsx の displaySetCode）。弾コード（c）・SKU・画像の対応表のキーは変えない。
// 根拠: 各弾の公式の画像（下の image）のカード右下の記号を拡大して確かめた。公式サイトの img-regulation の alt は内部のフォルダ名（L1-Bhg 等）で印刷された記号ではない。
// 確かめられなかった弾（公式の画像が 162×226 で読めない）: L2-Sb・L2-Sh・DPt1-B〜DPt4-B（今のまま）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "cardData.json");
const FIXES = [
  { c: "L1-Bhg", from: "L1-Bhg", to: "L1", image: "/assets/images/card_images/large/L1-Bhg/025001_P_BIDORU.jpg", note: "赤い「L1」（ハートゴールドコレクション）" },
  { c: "L1-Bss", from: "L1-Bss", to: "L1", image: "/assets/images/card_images/large/L1-Bss/025132_P_KYATAPI.jpg", note: "青い「L1」（ソウルシルバーコレクション）" },
  { c: "L2-B", from: "L2-B", to: "L2", image: "/assets/images/card_images/large/L2-B/025574_P_NAZONOKUSA.jpg", note: "「L2」" },
  { c: "L3-B", from: "L3-B", to: "L3", image: "/assets/images/card_images/large/L3-B/026101_P_MADATSUBOMI.jpg", note: "「L3」" },
  { c: "MMB-P", from: undefined, to: "MMB", image: "/assets/images/card_images/large/MMB-P/031175_P_RIZADONEX.jpg", note: "赤い「MMB」（パワースタイル）" },
  { c: "MMB-S", from: undefined, to: "MMB", image: "/assets/images/card_images/large/MMB-S/031233_P_KIMORI.jpg", note: "青い「MMB」（スピードスタイル）" },
];
// LL は今の codeAlias「LL」が印刷と同じ（LL/026001_P_KONPAN.jpg）なので変えない
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
let n = 0;
for (const f of FIXES) {
  const s = data.find((x) => x.c === f.c);
  if (s.codeAlias === f.to) { console.log(`${f.c}: 直し済み（${f.to}）`); continue; }
  if (s.codeAlias !== f.from) throw new Error(`${f.c}: 想定と違う codeAlias ${s.codeAlias}`);
  console.log(`${f.c}: ${s.codeAlias ?? "（なし）"} → ${f.to}  ${f.note}`);
  if (process.argv.includes("--apply")) {
    // キーの位置は既存の弾と同じく of の前（無ければ k の前）
    const entries = Object.entries(s).filter(([k]) => k !== "codeAlias");
    const at = entries.findIndex(([k]) => k === "of" || k === "k");
    entries.splice(at < 0 ? entries.length : at, 0, ["codeAlias", f.to]);
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, Object.fromEntries(entries));
    n++;
  }
}
if (n) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
