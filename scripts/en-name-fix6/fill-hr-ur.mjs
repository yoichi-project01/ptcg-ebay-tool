#!/usr/bin/env node
// 英語名が空の HR・UR（2026-10-14 の時点で38行）に、これまでと同じ確かめ方で入れられるものだけ英語名を入れる（レビューの C1）。
//   node scripts/en-name-fix6/fill-hr-ur.mjs [--apply]     根拠は hr-ur.tsv、変えた card_id は hr-ur-changed-card-ids.txt
// 1つ目の情報源: Bulbapedia の日本版の一覧の同じ番号の英語名（en-name-fix2/decisions.tsv の bpName。旧裏は old-ja-check/bulbapedia-old-*.txt の同じ番号の行で、日本語名も同じもの）
// 2つ目の情報源（これまでの決まり）:
//   基本エネルギー: 同じ日本語名のほかの行の英語名が1つだけで Bulbapedia と同じ（en-name-fix4/fill-store-secrets.mjs と同じ）
//   特殊エネルギー: TCGdex 英語版に同じ名前のエネルギーがある（カードにイラストレーターの記載が無いため。2026-10-07 のユーザー判断。
//     ユニットエネルギーは TCGdex が "Unit Energy GrassFireWater" と書くので照合のときだけ読み替える。書くのは Bulbapedia の "Unit Energy GRW"）
//   トレーナーズ: 同じ日本語名のほかの行の英語名が1つだけで Bulbapedia と同じ、かつ TCGdex 英語版に同じ名前・同じ種類のカードがある
// 画像は取らない
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const S = path.join(__dirname, "..");
const DATA = path.join(S, "..", "src", "cardData.json");
const APPLY = process.argv.includes("--apply");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const key = (s) => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase().replace(/[\s\-–.':!]/g, "");
const N = (s) => (s || "").normalize("NFKC").replace(/\s+/g, "");

// Bulbapedia
const dec = new Map(fs.readFileSync(path.join(S, "en-name-fix2", "decisions.tsv"), "utf8").split(/\r?\n/).slice(1).map((l) => l.split("\t")).map((r) => [r[0], { name: r[5], type: r[6] }]));
const OLD_LISTS = { PMCG4: "old-ja-check/bulbapedia-old-4.txt" };
function oldBulbapedia(setCode, local, ja) {
  const f = OLD_LISTS[setCode];
  if (!f) return null;
  let code = null;
  for (const l of fs.readFileSync(path.join(S, f), "utf8").split(/\r?\n/)) {
    if (l.startsWith("## ")) { code = l.slice(3).split("|")[0]; continue; }
    const p = l.split("|");
    if (code === setCode && p[0].replace(/\*$/, "") === local && N(p[3]) === N(ja)) return { name: p[1], type: p[2], jname: p[3] };
  }
  return null;
}
// TCGdex 英語版
const tcg = ["Trainer", "Energy"].flatMap((c) => JSON.parse(fs.readFileSync(path.join(S, "en-name-fix3", ".cache", `tcgdex-en-${c}.json`), "utf8")).data.cards);
const UNIT = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", M: "Metal", F: "Fighting", D: "Darkness", Y: "Fairy" };
const tcgName = (bp) => { const m = /^Unit Energy ([A-Z]{3})$/.exec(bp); return m ? `Unit Energy ${[...m[1]].map((c) => UNIT[c]).join("")}` : bp; };
const TTYPE = { Item: ["Item", "Tool"], Supporter: ["Supporter"], Stadium: ["Stadium"], Trainer: ["Item", "Supporter", "Stadium", "Tool", undefined] };
// 同じ日本語名のほかの行の英語名
const jaEn = new Map();
for (const s of data) for (const k of s.k) if (k[2]) { const m = jaEn.get(N(k[1])) || new Set(); m.add(k[2]); jaEn.set(N(k[1]), m); }

const rows = [["card_id", "ja", "rarity", "bulbapedia", "type", "en", "status", "note"]];
const changed = [];
for (const s of data) {
  for (const k of s.k) {
    if (k[2] || !["HR", "UR"].includes(k[3])) continue;
    const id = `${s.c}-${k[0]}`;
    const old = oldBulbapedia(s.c, k[0], k[1]);
    const bp = old ?? dec.get(id) ?? { name: "", type: "" };
    let en = "", note = "";
    const others = [...(jaEn.get(N(k[1])) ?? [])];
    if (!bp.name) note = "Bulbapedia の一覧に無い";
    else if (/^基本.+エネルギー$/.test(N(k[1]))) {
      if (others.length === 1 && key(others[0]) === key(bp.name)) { en = bp.name; note = `基本エネルギー: Bulbapedia「${bp.name}」と同じ日本語名のほかの行の英語名「${others[0]}」が一致`; }
      else note = `同じ日本語名のほかの行の英語名が ${others.length} 通り（${others.join(" / ")}）`;
    } else if (bp.type === "Energy") {
      const hit = tcg.find((c) => c.category === "Energy" && key(c.name) === key(tcgName(bp.name)));
      if (hit) { en = bp.name; note = `特殊エネルギー: Bulbapedia「${bp.name}」と TCGdex 英語版の同じ名前のエネルギー（${hit.id}「${hit.name}」）`; }
      else note = `TCGdex 英語版に同じ名前のエネルギーが無い（${tcgName(bp.name)}）`;
    } else if (TTYPE[bp.type]) {
      const hit = tcg.find((c) => c.category === "Trainer" && key(c.name) === key(bp.name) && TTYPE[bp.type].includes(c.trainerType));
      const sameOthers = others.length === 0 || (others.length === 1 && key(others[0]) === key(bp.name));
      if (hit && sameOthers && (old || others.length === 1)) {
        en = bp.name;
        note = old ? `トレーナーズ: Bulbapedia の同じ番号のカード「${bp.name}」（日本語名「${old.jname}」）と TCGdex 英語版の同じ名前（${hit.id}）`
          : `トレーナーズ: Bulbapedia「${bp.name}」・同じ日本語名のほかの行の英語名「${others[0]}」・TCGdex 英語版の同じ名前の ${hit.trainerType}（${hit.id}）`;
      } else note = !hit ? `TCGdex 英語版に同じ名前・種類のカードが無い` : `同じ日本語名のほかの行の英語名が ${others.length} 通り（${others.join(" / ")}）`;
    } else note = `種類が分からない（${bp.type}）`;
    rows.push([id, k[1], k[3], bp.name, bp.type, en, en ? "入れる" : "空欄のまま", note]);
    if (en) { changed.push(id); if (APPLY) k[2] = en; }
  }
}
const c = rows.slice(1).reduce((a, r) => ((a[r[6]] = (a[r[6]] || 0) + 1), a), {});
console.log(c);
for (const r of rows.slice(1)) console.log("  " + [r[0], r[1], r[5] || "—", r[7]].join(" | "));
fs.writeFileSync(path.join(__dirname, APPLY ? "hr-ur.tsv" : "hr-ur-check.tsv"), rows.map((r) => r.join("\t")).join("\n") + "\n");
if (APPLY && changed.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(__dirname, "hr-ur-changed-card-ids.txt"), changed.join("\n") + "\n");
  rebuildCardKinds();
}
