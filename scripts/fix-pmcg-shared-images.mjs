// PMCG5・PMCG6 で同じポケモンの2行が1枚の画像を共有している組を直す（2026-10-08）。
//   node scripts/fix-pmcg-shared-images.mjs --set PMCG5 [--apply]
// 行のカードは、Bulbapedia の同じ位置の行のカードのページ（scripts/old-ja-check/bulbapedia-pmcg-pairs.txt。cardData と同じ並び）の HP・レアリティと、
// pcg-search のカードのページ（pmcg-pair-site.json。fetch はこのスクリプトの前に取得した HP・レアリティの記号 ●=C ◆=U ☆=スーパーレア）の HP・記号が
// 一致するカードがちょうど1枚のときだけ決める（pcg-search のページには LV が無いので HP とレアリティで見分ける）。
// 決まったカードの画像を pcg-search から取り直し（間隔・再試行はこれまでと同じ、title の名前・pmcg-site.json の SHA-256 と一致を確認）、
// 名前（pcg-search の名前。ポケモンWiki の一覧にもあること）・レアリティ（Bulbapedia と pcg-search の記号が一致し cardData と違うとき）も直す。
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
const SET = process.argv[process.argv.indexOf("--set") + 1];
if (!/^PMCG[56]$/.test(SET)) throw new Error("--set PMCG5|PMCG6");
const APPLY = process.argv.includes("--apply");
const PREFIX = { PMCG5: "1stgym1", PMCG6: "1stgym2" }[SET];
const site = JSON.parse(fs.readFileSync(path.join(CHK, "pmcg-site.json"), "utf8"));
const attr = JSON.parse(fs.readFileSync(path.join(CHK, "pmcg-pair-site.json"), "utf8"));
const wiki = JSON.parse(fs.readFileSync(path.join(CHK, "pokemonwiki-pmcg.json"), "utf8"))[SET].names;
const MARK = { "●": "C", "◆": "U", "☆": "SR" }, BPR = { Common: "C", Uncommon: "U", SuperRare: "SR" };
const bp = fs.readFileSync(path.join(CHK, "bulbapedia-pmcg-pairs.txt"), "utf8").split(/\r?\n/).filter((l) => l.startsWith(SET + "-")).map((l) => {
  const a = l.split("|"); return { id: a[0], name: a[1], rarity: BPR[a[2]], hp: a[3].slice(3), lv: a[4].slice(3) };
});
const norm = (s) => (s || "").normalize("NFKC").replace(/[\s\[\]・]/g, "");
const raw = fs.readFileSync(DATA, "utf8"), data = JSON.parse(raw), index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
const shaOf = new Map(fs.readFileSync(path.join(__dirname, "image-hashes.tsv"), "utf8").split(/\r?\n/).slice(1).map((l) => l.split("\t")).map((a) => [a[1], a[3]]));
const plans = [];
for (const b of bp) {
  const k = set.k.find((x) => `${SET}-${x[0]}` === b.id), ik = `${SET}/${parseInt(k[0], 10)}`;
  const cands = Object.entries(attr).filter(([sk, v]) => sk.startsWith(SET + "-") && v.hp === b.hp && MARK[v.rarityMark] === b.rarity).map(([sk]) => sk)
    .filter((sk) => norm(site[sk].title.split(" | ")[0]).endsWith(norm(k[1]).replace(/^.*の/, ""))); // 同じポケモン
  const p = { id: b.id, before: { ja: k[1], rarity: k[3] }, bulbapedia: `${b.name} HP${b.hp} LV${b.lv} ${b.rarity}`, candidates: cands, imageNow: Object.keys(site).find((sk) => site[sk].sha === shaOf.get(ik)) ?? null, after: null, status: "" };
  plans.push(p);
  if (cands.length !== 1) { p.status = `HP・レアリティが一致する pcg-search のカードが ${cands.length} 枚`; continue; }
  const s = cands[0], name = site[s].title.split(" | ")[0].trim();
  if (!wiki.some((w) => norm(w).replace(/LV\.?\d+$/, "") === norm(name))) { p.status = "ポケモンWiki に無い名前"; continue; }
  const rarity = b.rarity === "SR" ? k[3] : b.rarity; // スーパーレア（☆）は cardData の表記（UR）のまま
  p.site = s; p.after = { ja: name, rarity };
  p.status = [p.imageNow !== s && "画像を取り直す", name !== k[1] && "名前を直す", rarity !== k[3] && "レアリティを直す"].filter(Boolean).join("・") || "そのまま";
}
// 直した後に同じ弾で画像が重ならないこと
const fin = new Map();
for (const k of set.k) { const p = plans.find((x) => x.id === `${SET}-${k[0]}` && x.site); const sha = p ? site[p.site].sha : shaOf.get(`${SET}/${parseInt(k[0], 10)}`); if (sha) fin.set(sha, [...(fin.get(sha) || []), `${SET}-${k[0]}`]); }
const dup = [...fin.values()].filter((v) => v.length > 1);
if (dup.length) { console.log("画像が重なる:", JSON.stringify(dup)); if (APPLY) process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, bin) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); if (r.ok) return bin ? Buffer.from(await r.arrayBuffer()) : await r.text(); } catch {} await sleep(30000 * (i + 1)); } throw new Error(`取得できません: ${u}`); };
const renamed = [];
if (APPLY) for (const p of plans.filter((x) => x.site && x.status !== "そのまま")) {
  const k = set.k.find((x) => `${SET}-${x[0]}` === p.id), ik = `${SET}/${parseInt(k[0], 10)}`, num = p.site.split("-")[1];
  let buf = null;
  if (p.imageNow !== p.site) {
    const title = ((await get(`https://pcg-search.com/card/1st/${PREFIX}${num}.php`)).match(/<title>([^<]*)/) || [])[1] || ""; await sleep(2000 + Math.random() * 1000);
    if (norm(title.split(" | ")[0]) !== norm(p.after.ja)) throw new Error(`${p.id}: title が違います ${title}`);
    buf = await get(`https://pcg-search.com/img/1st/${PREFIX}${num}.png`, true); await sleep(2000 + Math.random() * 1000);
    if (crypto.createHash("sha256").update(buf).digest("hex") !== site[p.site].sha) throw new Error(`${p.id}: 画像が記録と違います`);
    p.refetched = true;
  }
  k[1] = p.after.ja; k[3] = p.after.rarity;
  const rel = index[ik], total = parseInt(rel.match(/／(\d+)/)[1], 10);
  const newRel = rel.slice(0, rel.lastIndexOf("/") + 1) + buildFileName(k[1], SET, k[0], k[3], total) + path.extname(rel);
  const to = path.join(ROOT, "public", newRel);
  if (newRel !== rel) {
    if (fs.existsSync(to) && newRel.toLowerCase() !== rel.toLowerCase()) throw new Error(`変更先のファイルが既にあります: ${newRel}`);
    fs.renameSync(path.join(ROOT, "public", rel), to); index[ik] = newRel; renamed.push({ key: ik, to: newRel });
  }
  if (buf) { fs.writeFileSync(to + ".tmp", buf); fs.renameSync(to + ".tmp", to); }
  p.file = rel === newRel ? rel : `${rel} → ${newRel}`;
}
const reasons = {}; for (const p of plans) reasons[p.status] = (reasons[p.status] || 0) + 1;
fs.writeFileSync(path.join(CHK, `pmcg-shared-${SET}${APPLY ? "" : "-check"}.json`), JSON.stringify({ set: SET, reasons, plans }, null, 1) + "\n");
if (APPLY) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  renameHashPaths(renamed, index);
  const ids = plans.filter((p) => p.refetched).map((p) => p.id);
  fs.writeFileSync(path.join(CHK, `pmcg-shared-${SET}-refetched-card-ids.txt`), ids.join("\n") + (ids.length ? "\n" : ""));
}
console.log(JSON.stringify({ set: SET, reasons }));
for (const p of plans) console.log(p.id, p.before.ja, p.before.rarity, "→", p.after ? `${p.after.ja} ${p.after.rarity}` : "-", p.site ?? "", "|", p.status);
