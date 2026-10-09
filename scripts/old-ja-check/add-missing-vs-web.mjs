#!/usr/bin/env node
// VS1-077 イツキのヤドキング・VS1-142 R団のバンギラス・web1-039 ロケット団のニャースを追加する（2026-10-10）。
//   node scripts/old-ja-check/add-missing-vs-web.mjs [--apply]
// 2026-10-10 の点検（scripts/audit/）で、pcg-search.com とポケモンWiki の番号付き一覧に載っているのに cardData に無い3行。
// 日本語名: pcg-search のカードページの title とポケモンWiki（old-ja-check/pokemonwiki-names.json）の同じ番号の名前が一致。
// レアリティ: pcg-search の「レアリティ」欄（● → C、★ → R、「-(キラ)」はマークなし → 空）。既存の行と同じ変換。
// 英語名: 日本語名から作った名前（イツキの→Will's、R団の→Rocket's、ロケット団の→Team Rocket's ＋ 種族名）と Bulbapedia の一覧（Pokémon VS (TCG)・Pokémon Web (TCG)、
//   2026-10-10 にブラウザで確認: 077/141 Will's Slowking・142/141 Rocket's Tyranitar（Secret Rare）・039/048 Team Rocket's Meowth）が一致。
// 画像: pcg-search の画像（/img/vs/vs0077.png 等）。1接続・2〜3秒間隔、User-Agent は Mozilla/5.0。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal } from "../filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const APPLY = process.argv.includes("--apply");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADD = [
  { set: "VS1", num: "077", page: "https://pcg-search.com/card/vs/vs0077.php", img: "https://pcg-search.com/img/vs/vs0077.png", ja: "イツキのヤドキング", en: "Will's Slowking", mark: "●", rarity: "C" },
  { set: "VS1", num: "142", page: "https://pcg-search.com/card/vs/vs0142.php", img: "https://pcg-search.com/img/vs/vs0142.png", ja: "R団のバンギラス", en: "Rocket's Tyranitar", mark: "-(キラ)", rarity: "" },
  { set: "web1", num: "039", page: "https://pcg-search.com/card/web/web0039.php", img: "https://pcg-search.com/img/web/web0039.png", ja: "ロケット団のニャース", en: "Team Rocket's Meowth", mark: "★", rarity: "R" },
];
const wiki = JSON.parse(fs.readFileSync(path.join(__dirname, "pokemonwiki-names.json"), "utf8"));
const get = async (u, bin) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${u} ${r.status}`); return bin ? Buffer.from(await r.arrayBuffer()) : r.text(); };
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const result = [];
const ONLY = process.argv.includes("--set") ? process.argv[process.argv.indexOf("--set") + 1] : null;
for (const a of ADD.filter((x) => !ONLY || x.set === ONLY)) {
  const html = await get(a.page); await sleep(2000 + Math.random() * 1000);
  const title = (html.match(/<title>([^|<]*)/) || [])[1]?.trim();
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const mark = (text.match(/レアリティ (\S+)/) || [])[1];
  const numOk = text.includes(`(${a.num}/`);
  const w = wiki[a.set]?.rows?.[a.num];
  if (title !== a.ja || w !== a.ja || mark !== a.mark || !numOk) throw new Error(`確認できません: ${a.set}-${a.num} title=${title} wiki=${w} mark=${mark} num=${numOk}`);
  const s = data.find((x) => x.c === a.set);
  if (s.k.some((k) => k[0] === a.num)) throw new Error(`既にあります: ${a.set}-${a.num}`);
  const png = await get(a.img, true); await sleep(2000 + Math.random() * 1000);
  if (png.subarray(1, 4).toString() !== "PNG") throw new Error(`PNG ではありません: ${a.img}`);
  s.k.push([a.num, a.ja, a.en, a.rarity]);
  s.k.sort((x, y) => (parseInt(x[0], 10) || 9999) - (parseInt(y[0], 10) || 9999));
  const file = buildFileName(a.ja, a.set, a.num, a.rarity, computeSetTotal(s.k)) + ".png";
  const dir = path.join(ROOT, "public", "cards", s.sr, a.set);
  if (APPLY) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file), png); }
  result.push({ id: `${a.set}-${a.num}`, ja: a.ja, en: a.en, rarity: a.rarity, file, pcgSearch: title, pokemonWiki: w, mark, bytes: png.length });
}
if (APPLY) fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
fs.writeFileSync(path.join(__dirname, `add-missing-vs-web-result${ONLY ? "-" + ONLY : ""}.json`), JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result, null, 1));
