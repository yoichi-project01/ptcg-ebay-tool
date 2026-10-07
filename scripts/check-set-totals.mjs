#!/usr/bin/env node
// 全部の弾の総数（cardData の of）を、公式サイトのカード番号の分母（details.php の「079 / 086」の 086）と照らし合わせる（2026-10-07）。
//   node scripts/check-set-totals.mjs        結果は scripts/set-total-check/result.json・report.tsv（cardData は変えない）
// 分母の出どころ:
//   1. scripts/scan-progress/{弾}.json（以前の取得で集めた details.php の結果。番号・分母つき）
//   2. 1 が無い・分母が取れていない弾は、公式一覧（official-card-scan.json）の同じ弾のキーから cardID を最大3件（先頭・中間・末尾）選んで details.php を取得
//      （同時接続1本・2〜3秒間隔。結果は set-total-check/details.json に保存し、再実行時は取得済みを飛ばす）
// 公式サイトに無い弾（PMCG・neo・VS・web・e・PCG）は「公式サイトに無い」として調べない。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { politeFetch, politeDelay } from "./scrape-promo-sets.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "scripts", "set-total-check");
mkdirSync(OUT, { recursive: true });
const data = JSON.parse(readFileSync(path.join(ROOT, "src", "cardData.json"), "utf8"));
const scan = JSON.parse(readFileSync(path.join(ROOT, "scripts", "official-card-scan.json"), "utf8")).setMap;
const DET = path.join(OUT, "details.json");
const det = existsSync(DET) ? JSON.parse(readFileSync(DET, "utf8")) : {};
const NOT_OFFICIAL = new Set(["PMCG", "neo", "VS", "web", "e", "PCG"]);
// 公式一覧のキーが弾コードと違う弾（取り込みのときに使った cardID）
const EXTRA_IDS = { "XY-BEST": ["33553", "33700", "33851"] };
const idOf = (e) => String(parseInt(e.cardThumbFile.match(/\/(\d+)_/)[1], 10));
const pairs = (html) => [...html.matchAll(/&nbsp;(\d+)&nbsp;\/&nbsp;(\d+)\s*&nbsp;/g)].map((m) => [m[1], m[2]]);

const rows = [];
let fails = 0;
for (const s of data) {
  if (!(s.of > 0)) continue;
  if (NOT_OFFICIAL.has(s.sr)) { rows.push({ set: s.c, sr: s.sr, of: s.of, dens: {}, source: "公式サイトに無い", status: "調べていない" }); continue; }
  const dens = {};
  let source = "";
  const f = path.join(ROOT, "scripts", "scan-progress", `${s.c}.json`);
  if (existsSync(f)) {
    for (const v of Object.values(JSON.parse(readFileSync(f, "utf8")))) for (const x of v.cards || []) if (/^\d+$/.test(x.total || "")) dens[x.total] = (dens[x.total] || 0) + 1;
    if (Object.keys(dens).length) source = "scan-progress";
  }
  // 記録が無い・分母が1種類でない・総数と違うときは、公式 details.php で数枚確かめる
  if (!source || Object.keys(dens).length !== 1 || parseInt(Object.keys(dens)[0], 10) !== s.of) {
    const ids = EXTRA_IDS[s.c] || (scan[s.c] || []).map(idOf);
    const pick = [...new Set([ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]].filter(Boolean))];
    const got = {};
    for (const id of pick) {
      if (!(id in det)) {
        const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${id}`);
        await politeDelay();
        if (!html) { if (++fails >= 3) throw new Error("連続3件失敗したため停止します（再実行で続きから）"); continue; }
        fails = 0;
        det[id] = { set: s.c, pairs: pairs(html) };
        writeFileSync(DET, JSON.stringify(det, null, 1) + "\n");
      }
      for (const [, den] of det[id].pairs) got[den] = (got[den] || 0) + 1;
    }
    if (Object.keys(got).length) { for (const k of Object.keys(dens)) delete dens[k]; Object.assign(dens, got); source = `details.php（${pick.join(" ")}）`; }
  }
  const keys = Object.keys(dens);
  const status = !keys.length ? "分母が取れない" : keys.length === 1 && parseInt(keys[0], 10) === s.of ? "一致" : "食い違い";
  rows.push({ set: s.c, sr: s.sr, of: s.of, dens, source, status });
}
writeFileSync(path.join(OUT, "result.json"), JSON.stringify(rows, null, 1) + "\n");
writeFileSync(path.join(OUT, "report.tsv"), ["set\tsr\tof\tdens\tsource\tstatus", ...rows.map((r) => [r.set, r.sr, r.of, JSON.stringify(r.dens), r.source, r.status].join("\t"))].join("\n") + "\n");
const count = {};
for (const r of rows) count[r.status] = (count[r.status] || 0) + 1;
console.log(count);
for (const r of rows.filter((r) => r.status !== "一致" && r.status !== "調べていない")) console.log(r.set, r.of, JSON.stringify(r.dens), r.source, r.status);
