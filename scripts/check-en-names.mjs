// cardData.json の英語名（k[2]）が、英語版のカード名として実在するかを調べる（2026-10-05、読み取りのみ。cardData は変えない）。
//
//   node scripts/check-en-names.mjs
//
// - TCGdex の英語版の全カード名（/v2/en/cards）と照らし、英語版に同じ名前のカードが無い英語名を一覧にする
// - TCGdex のインドネシア語版（/v2/id/cards）の同じ弾・型番の名前と一致するものは「インドネシア語版の名前」とし、
//   種類（ポケモン・サポート・グッズ・ポケモンのどうぐ・エネルギー）を /v2/id/cards/{id} で調べる
//   （結果は scripts/en-name-check/id-detail.json に保存し、再実行時は取り直さない）
// - 出力: scripts/en-name-check/affected.tsv（英語版に無い英語名の行）・summary.json（件数）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "scripts", "en-name-check");
const cardData = JSON.parse(readFileSync(path.join(ROOT, "src", "cardData.json"), "utf8"));
mkdirSync(OUT, { recursive: true });

const getJson = async (url) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`取得できません: ${url}`);
};

const enList = await getJson("https://api.tcgdex.net/v2/en/cards");
const idList = await getJson("https://api.tcgdex.net/v2/id/cards");
const norm = (s) => s.replace(/[‘’]/g, "'");
const enNames = new Set(enList.map((c) => norm(c.name)));
const idName = new Map(idList.map((c) => [c.id, c.name]));

const rows = [];
for (const s of cardData) for (const [num, ja, en] of s.k) {
  if (!en) continue;
  const id = `${s.c}-${num}`;
  rows.push({ id, set: s.c, ja, en, inEnglish: enNames.has(norm(en)), fromIndonesian: idName.get(id) === en });
}

// インドネシア語版の名前と一致する行の種類
const detailPath = path.join(OUT, "id-detail.json");
const detail = existsSync(detailPath) ? JSON.parse(readFileSync(detailPath, "utf8")) : {};
const todo = rows.filter((r) => r.fromIndonesian && !detail[r.id]).map((r) => r.id);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (todo.length) {
    const id = todo.shift();
    const j = await getJson(`https://api.tcgdex.net/v2/id/cards/${encodeURIComponent(id)}`);
    detail[id] = { name: j.name, category: j.category, trainerType: j.trainerType ?? null, energyType: j.energyType ?? null };
  }
}));
writeFileSync(detailPath, JSON.stringify(detail, null, 1));

const kind = (r) => {
  const d = detail[r.id];
  if (!d) return "不明（インドネシア語版と一致しない）";
  if (d.category === "Trainer") return `トレーナーズ/${d.trainerType ?? "?"}`;
  if (d.category === "Energy") return `エネルギー/${d.energyType ?? "?"}`;
  return d.category === "Pokemon" ? "ポケモン" : d.category;
};
const affected = rows.filter((r) => !r.inEnglish);
writeFileSync(path.join(OUT, "affected.tsv"), "﻿" + ["card_id\tset\tname_ja\tname_en_in_cardData\tsource\tkind",
  ...affected.map((r) => [r.id, r.set, r.ja, r.en, r.fromIndonesian ? "インドネシア語版" : "その他", kind(r)].join("\t"))].join("\r\n"));

const count = (list, f) => list.reduce((m, r) => (m[f(r)] = (m[f(r)] ?? 0) + 1, m), {});
const indo = rows.filter((r) => r.fromIndonesian);
const summary = {
  at: new Date().toISOString(),
  cards: cardData.reduce((n, s) => n + s.k.length, 0),
  withEnglishName: rows.length,
  notInEnglishCardNames: affected.length,
  fromIndonesian: { total: indo.length, bySet: count(indo, (r) => r.set), byKind: count(indo, kind), notInEnglishByKind: count(indo.filter((r) => !r.inEnglish), kind) },
  otherNotInEnglish: affected.filter((r) => !r.fromIndonesian).map((r) => `${r.id} ${r.ja} → ${r.en}`),
};
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
