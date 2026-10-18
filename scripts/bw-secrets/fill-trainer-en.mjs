#!/usr/bin/env node
// BW・LEGEND のシークレットで足したトレーナーズ（英語名が空欄）の英語名を入れる（2026-10-18、ユーザーの指示）。
//   node scripts/bw-secrets/fill-trainer-en.mjs [--apply]
// 公式に無いカードなのでイラストレーター（TCGdex 英語版との照合に使う）が分からない。代わりに、cardData にある同じ日本語名のトレーナーズ
// （同じ弾の本編を優先、無ければほかの BW の弾。今回足した行は除く）の英語名が1つに決まり、それが Bulbapedia の日本版の一覧の英語名と同じときだけ入れる。
// 一致しないもの・英語名が複数あるもの・同じ日本語名のカードが無いものは空欄のまま。根拠は trainer-en-2026-10-18.tsv
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const APPLY = process.argv.includes("--apply");
const ids = new Set(fs.readFileSync(path.join(__dirname, "added-card-ids-2026-10-18.txt"), "utf8").trim().split(/\r?\n/));
const bp = new Map(fs.readFileSync(path.join(__dirname, "bulbapedia-2026-10-18.tsv"), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t")).map((c) => [`${c[0]}-${c[1]}`, c[2]]));
const NF = (s) => (s ?? "").normalize("NFKC").replace(/(\s*([（(][^（()）]*[)）]|\[[^\]]*\]))+\s*$/, "").replace(/\s+/g, "");
const key = (s) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const out = [["card_id", "日本語名", "Bulbapedia の英語名", "照らし合わせた行", "その英語名", "結果"].join("\t")];
const changed = [];
for (const s of data) for (const k of s.k) {
  const id = `${s.c}-${k[0]}`;
  if (!ids.has(id) || k[2]) continue;
  let where = "同じ弾の本編";
  let pool = s.k.filter((r) => !ids.has(`${s.c}-${r[0]}`) && /^\d+$/.test(r[0]) && +r[0] <= s.of && NF(r[1]) === NF(k[1]) && r[2]).map((r) => ({ id: `${s.c}-${r[0]}`, en: r[2] }));
  if (!pool.length) {
    where = "ほかの BW の弾";
    pool = data.filter((t) => t.sr === "BW").flatMap((t) => t.k.filter((r) => !ids.has(`${t.c}-${r[0]}`) && NF(r[1]) === NF(k[1]) && r[2]).map((r) => ({ id: `${t.c}-${r[0]}`, en: r[2] })));
  }
  const ens = [...new Set(pool.map((p) => p.en))];
  const b = bp.get(id);
  let result;
  if (!pool.length) result = "空欄（同じ日本語名で英語名のあるカードが無い）";
  else if (ens.length > 1) result = "空欄（英語名が複数）";
  else if (key(ens[0]) !== key(b)) result = "空欄（Bulbapedia と一致しない）";
  else { result = "入れた"; if (APPLY) k[2] = b; changed.push(id); }
  out.push([id, k[1], b, `${where}: ${pool.map((p) => p.id).join("・") || "無し"}`, ens.join(" / "), result].join("\t"));
}
console.log(out.join("\n"));
fs.writeFileSync(path.join(__dirname, "trainer-en-2026-10-18.tsv"), out.join("\n") + "\n");
if (APPLY && changed.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(path.join(__dirname, "trainer-en-changed-card-ids-2026-10-18.txt"), changed.join("\n") + "\n");
  rebuildCardKinds();
}
console.log(`入れる ${changed.length}`);
