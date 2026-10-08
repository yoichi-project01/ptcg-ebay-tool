// PMCG の画像の取り違えを直す（2026-10-08）。
//   node scripts/fix-pmcg-images.mjs --set PMCG4            確認だけ（scripts/old-ja-check/pmcg-images-{弾}-check.json）
//   node scripts/fix-pmcg-images.mjs --set PMCG4 --apply    pcg-search から画像を取り直し、cardData の名前・画像のファイル名・imageIndex.json を直す
// 対象: scripts/old-ja-check/pmcg-wrong-images.tsv の行（名前と画像が別のカード）と、画像の無い行。
// 行の正しいカードは Bulbapedia の日本版の一覧（bulbapedia-old-3.txt・-4.txt。cardData と同じ並び）の同じ位置の行で決める:
//   - ポケモン: Bulbapedia の英語名が今の英語名を含む → 名前は正しい。画像を、pcg-search の同じ名前のカードの画像に取り直す。
//   - トレーナーズ・エネルギー: Bulbapedia のカードのページの日本語名（jname）が今の名前と同じ → 名前は正しい（画像を取り直す）。
//     jname が今の名前と違い、jname と同じ名前（基本エネルギーは「基本」を除く・pcg-search の名前が jname で始まるものも見る）の pcg-search のカードが
//     ちょうど1枚あり、そのカードの名前がポケモンWiki の一覧にある（基本エネルギーはポケモンWiki に無いので pcg-search と Bulbapedia の2つ） → 名前をそのカードの名前に直し、画像もそのカードにする。
//     今の名前が pcg-search とポケモンWiki の両方にあり、jname が pcg-search のどのカードの名前でもない（元気のかけら／げんきのかけら のような書き方の違い）→ 名前は正しい。
// 取り直した画像は、pmcg-site.json に記録した SHA-256 と同じこと、ページの title の名前が行の名前と同じこと、同じ弾のほかの行の画像と中身が重ならないことを確かめる。
// 間隔・再試行はこれまでと同じ（1接続・2〜3秒、失敗は30秒・60秒待って再試行）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildFileName } from "./filename-utils.mjs";
import { renameHashPaths } from "./image-hashes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const CHK = path.join(__dirname, "old-ja-check");
if (!process.argv.includes("--set")) throw new Error("--set <弾> を指定してください");
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!/^PMCG[1-6]$/.test(SET)) throw new Error(`対象外の弾です: ${SET}`);
const APPLY = process.argv.includes("--apply");
const PREFIX = { PMCG1: "1st1", PMCG2: "1st2", PMCG3: "1st3", PMCG4: "1st4", PMCG5: "1stgym1", PMCG6: "1stgym2" }[SET];

const site = JSON.parse(fs.readFileSync(path.join(CHK, "pmcg-site.json"), "utf8"));
const wiki = JSON.parse(fs.readFileSync(path.join(CHK, "pokemonwiki-pmcg.json"), "utf8"))[SET]?.names ?? [];
const bp = new Map();
let cur = null;
for (const f of ["bulbapedia-old-3.txt", "bulbapedia-old-4.txt"]) for (const l of fs.readFileSync(path.join(CHK, f), "utf8").split(/\r?\n/)) {
  if (l.startsWith("## ")) { cur = l.slice(3).split("|")[0]; continue; }
  if (!l || cur !== SET) continue;
  const [num, name, type, jname] = l.split("|");
  bp.set(num.replace("*", ""), { name, type, jname });
}
const norm = (s) => (s || "").normalize("NFKC").replace(/[\s\[\]・]/g, "").replace(/LV\.?\d+$/, "");
const key = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const siteCards = Object.entries(site).filter(([k, v]) => k.startsWith(SET + "-") && v.title && v.img === 200).map(([k, v]) => ({ k, name: v.title.split(" | ")[0].trim(), sha: v.sha }));
const siteByName = (name) => siteCards.filter((c) => norm(c.name) === norm(name));
const inWiki = (name) => wiki.some((w) => norm(w) === norm(name));
const shaOf = new Map(fs.readFileSync(path.join(__dirname, "image-hashes.tsv"), "utf8").split(/\r?\n/).slice(1).map((l) => l.split("\t")).map((a) => [a[1], a[3]]));

const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
const wrong = new Set(fs.readFileSync(path.join(CHK, "pmcg-wrong-images.tsv"), "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split("\t")[0]));
const ikey = (k) => `${SET}/${parseInt(k[0], 10)}`;
const plans = [];
for (const k of set.k) {
  const id = `${SET}-${k[0]}`;
  const hasImage = !!index[ikey(k)];
  const imgCard = hasImage ? siteCards.find((c) => c.sha === shaOf.get(ikey(k))) ?? null : null;
  // 名前と画像が同じカードの基本エネルギー（名前だけ違う）も、名前の確認の対象にする
  const energyName = SET === "PMCG1" && /^(097|098|099|100|101|102)$/.test(k[0]);
  if (!wrong.has(id) && hasImage && !energyName) continue;
  const b = bp.get(k[0]);
  const p = { id, before: k[1], en: k[2], bulbapedia: b ? `${b.name}${b.jname ? " / " + b.jname : ""}` : null, imageNow: imgCard ? `${imgCard.k} ${imgCard.name}` : null, after: k[1], site: null, status: "" };
  plans.push(p);
  if (!b) { p.status = "Bulbapedia の一覧に無い"; continue; }
  if (k[2]) { // ポケモン
    if (!key(b.name).endsWith(key(k[2]))) { p.status = "Bulbapedia の英語名と今の英語名が違う"; continue; }
  } else {
    const j = norm(b.jname).replace(/^基本/, "");
    const exact = siteCards.filter((c) => norm(c.name) === j);
    const cands = exact.length ? exact : siteCards.filter((c) => norm(c.name).startsWith(j));
    const nameOk = siteByName(k[1]).length === 1 && (norm(b.jname) === norm(k[1]) || (inWiki(k[1]) && !exact.length));
    if (nameOk) { /* Bulbapedia と同じか、書き方の違いだけ。名前は正しい */ }
    else if (cands.length === 1 && (inWiki(cands[0].name) || /^基本.*エネルギー$/.test(b.jname))) { p.after = cands[0].name; }
    else { p.status = `名前を確かめられない（Bulbapedia ${b.jname}・pcg-search の候補 ${cands.map((c) => c.name).join("/") || "なし"}）`; continue; }
  }
  const t = siteByName(p.after);
  if (t.length !== 1) { p.status = `pcg-search に同じ名前のカードが ${t.length} 枚`; continue; }
  p.site = t[0].k;
  p.status = p.after !== k[1] ? (imgCard?.k === p.site ? "名前を直す（画像は正しい）" : "名前を直し、画像を取り直す") : (imgCard?.k === p.site ? "そのまま" : "画像を取り直す");
}
// 取り直した後に同じ弾のほかの行と画像が重ならないか（今の画像を使い続ける行の SHA-256 と比べる）
const ok = plans.filter((p) => p.site);
const used = new Map();
for (const k of set.k) { const p = ok.find((x) => x.id === `${SET}-${k[0]}`); const sha = p ? site[p.site].sha : shaOf.get(ikey(k)); if (sha) (used.get(sha) || used.set(sha, []).get(sha)).push(`${SET}-${k[0]}`); }
for (const p of ok) { const others = used.get(site[p.site].sha).filter((x) => x !== p.id); if (others.length) p.status = `取り直すと ${others.join(",")} と画像が重なる`; }
const todo = plans.filter((p) => /^(名前を|画像を)/.test(p.status));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, bin) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); if (r.ok) return bin ? Buffer.from(await r.arrayBuffer()) : await r.text(); } catch {} await sleep(30000 * (i + 1)); } throw new Error(`取得できません: ${u}`); };
const fileNamePart = (ja) => buildFileName(ja, "ZZ", "1", "").replace(/_ZZ-1$/, "");
const hashRenames = [];
if (APPLY) for (const p of todo) {
  const k = set.k.find((x) => `${SET}-${x[0]}` === p.id);
  const num = p.site.split("-")[1];
  if (p.status !== "名前を直す（画像は正しい）") {
    const title = ((await get(`https://pcg-search.com/card/1st/${PREFIX}${num}.php`)).match(/<title>([^<]*)/) || [])[1] || ""; await sleep(2000 + Math.random() * 1000);
    if (norm(title.split(" | ")[0]) !== norm(p.after)) throw new Error(`${p.id}: pcg-search の title が行の名前と違います: ${title}`);
    const img = await get(`https://pcg-search.com/img/1st/${PREFIX}${num}.png`, true); await sleep(2000 + Math.random() * 1000);
    const sha = crypto.createHash("sha256").update(img).digest("hex");
    if (sha !== site[p.site].sha) throw new Error(`${p.id}: 画像が記録（pmcg-site.json）と違います`);
    p.buf = img; p.sha = sha;
  }
  k[1] = p.after;
  const ik = ikey(k), rel = index[ik];
  let newRel;
  if (rel) {
    const dir = rel.slice(0, rel.lastIndexOf("/") + 1), file = rel.slice(rel.lastIndexOf("/") + 1), at = file.lastIndexOf(`_${SET}-`);
    newRel = dir + fileNamePart(p.after) + file.slice(at);
  } else {
    const sample = Object.entries(index).find(([x]) => x.startsWith(SET + "/"))[1];
    const total = parseInt(sample.match(/／(\d+)/)[1], 10);
    newRel = sample.slice(0, sample.lastIndexOf("/") + 1) + buildFileName(p.after, SET, k[0], k[3] || "", total) + ".png";
  }
  const to = path.join(ROOT, "public", newRel);
  if (rel && newRel !== rel) {
    if (fs.existsSync(to) && newRel.toLowerCase() !== rel.toLowerCase()) throw new Error(`変更先のファイルが既にあります: ${newRel}`);
    fs.renameSync(path.join(ROOT, "public", rel), to);
  } else if (!rel && fs.existsSync(to)) throw new Error(`画像の無い行の変更先にファイルが既にあります: ${newRel}`);
  if (p.buf) { fs.writeFileSync(to + ".tmp", p.buf); fs.renameSync(to + ".tmp", to); delete p.buf; }
  index[ik] = newRel; if (rel && newRel !== rel) hashRenames.push({ key: ik, to: newRel });
  p.file = rel === newRel ? newRel : `${rel ?? "（なし）"} → ${newRel}`;
}
const reasons = {}; for (const p of plans) reasons[p.status] = (reasons[p.status] || 0) + 1;
fs.writeFileSync(path.join(CHK, `pmcg-images-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, reasons, plans }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  renameHashPaths(hashRenames, index);
  const imgIds = todo.filter((p) => p.sha).map((p) => p.id), nameIds = todo.filter((p) => p.after !== p.before).map((p) => p.id);
  fs.writeFileSync(path.join(CHK, `pmcg-images-${SET}-refetched-card-ids.txt`), imgIds.join("\n") + (imgIds.length ? "\n" : ""));
  fs.writeFileSync(path.join(CHK, `pmcg-images-${SET}-renamed-card-ids.txt`), nameIds.join("\n") + (nameIds.length ? "\n" : ""));
}
console.log(JSON.stringify({ set: SET, reasons }));
