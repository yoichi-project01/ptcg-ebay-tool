#!/usr/bin/env node
/**
 * 公式サイトの新しいカード（新しい弾・既存の弾やプロモの新しいカード）を見つけて取り込む（2026-10-09）。手順は CLAUDE.md「新しいカードの取り込み」。
 *
 *   node scripts/new-cards.mjs --rescan              公式の一覧を取り直す（rescan-official-list.mjs、約25分）→ 候補を出す
 *   node scripts/new-cards.mjs                       今の一覧（official-card-scan.json）で候補を出す（取り直さない）
 *   node scripts/new-cards.mjs --fetch               候補の details.php を取得し（1接続・2〜3秒間隔、再開可能）、一覧（report.tsv）を出す
 *   node scripts/new-cards.mjs --apply --set SV-P    確かめたカードを既存の弾に足す（行・画像・画像の対応表・SHA-256 の一覧）
 *   node scripts/new-cards.mjs --apply --new M6a     新しい弾を作る（scripts/new-cards/set-meta.json に弾の情報が要る。無ければ雛形を出して止まる）
 *   node scripts/new-cards.mjs --skip 12345,12346 --reason "…"   取り込まないと決めたカードを記録し、次から候補に出さない
 *   node scripts/new-cards.mjs --keys SO,SP1 --fetch               公式の一覧のキーを指定して、一度も取り込んでいない古いキーのカードを候補にする（--apply でも同じ --keys を付ける）
 *
 * 候補: 公式の一覧のカードのうち、これまでに確かめた cardID（最初の一覧 official-card-cache.json・各進捗ファイル・スクリプトの extraCardIds・
 *   台帳 scripts/new-cards/ledger.json）に無いもの。
 * 追加の条件（どれかが合わなければその弾は書かずに止まる）:
 *   - details.php に番号がある（番号付きの弾は「NNN / 総数」、プロモは「NNN / XX-P」）。番号が無いカードは足さない
 *     （番号の無い基本エネルギーは取得した後に台帳へ skip として記録し、次から候補に出さない。番号付きの基本エネルギーは足す）
 *   - 既存の弾: 印刷記号（img-regulation の alt）が弾の codeAlias（無ければ弾コード）と同じで、総数が弾の of と同じ（プロモはラベルが弾コード）
 *   - 同じ番号が既にあれば、名前が同じなら同じカードの別掲載として飛ばし、違えば止まる
 *   - 新しい弾: 1〜最大番号に欠番が無い（validateAndBuildK）。公式にまだ載っていない番号は set-meta.json の pendingGaps に書いたものだけ許す
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal, writeFileAtomic } from "./filename-utils.mjs";
import { parseCardDetailsFromHtml, RARITY_CODE_MAP, validateAndBuildK } from "./scrape-missing-sets.mjs";
import { imageExt, parsePromoDetailFromHtml, politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(__dirname, "new-cards");
const DATA = path.join(ROOT, "src", "cardData.json");
const SCAN = path.join(__dirname, "official-card-scan.json");
const LEDGER = path.join(DIR, "ledger.json");
const DETAILS = path.join(DIR, "details.json");
const META = path.join(DIR, "set-meta.json");
const API = "https://www.pokemon-card.com";
const argv = process.argv.slice(2);
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const today = new Date().toISOString().slice(0, 10);
fs.mkdirSync(DIR, { recursive: true });
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
const idOf = (thumb) => { const m = String(thumb).match(/\/(\d+)_/); return m ? String(parseInt(m[1], 10)) : null; };
const isBasicEnergy = (name) => /^基本.+エネルギー$/.test(name);

// --- これまでに確かめた cardID ---
function knownIds() {
  const known = new Set();
  const cache = readJson(path.join(__dirname, "official-card-cache.json"), { setMap: {} });
  for (const a of Object.values(cache.setMap)) for (const c of a) { const i = idOf(c.cardThumbFile); if (i) known.add(i); }
  for (const d of ["promo-progress", "scan-progress", "secret-progress"]) {
    const p = path.join(__dirname, d);
    if (!fs.existsSync(p)) continue;
    // gap-check.json はプロモの欠番を調べたときに「プロモの番号が無い」と確かめただけのカード（M6・MEE 等の通常の弾）なので数えない
    for (const f of fs.readdirSync(p).filter((f) => f.endsWith(".json") && f !== "gap-check.json")) for (const k of Object.keys(readJson(path.join(p, f), {}))) if (/^\d+$/.test(k)) known.add(String(parseInt(k, 10)));
  }
  for (const k of Object.keys(readJson(path.join(__dirname, "numberless-promos", "remaining-details.json"), {}))) known.add(String(parseInt(k, 10)));
  // スクリプトに直接書いた cardID（extraCardIds・excludeCardIds・printedNumbers・番号の無いプロモの計画）
  for (const f of ["scrape-missing-sets.mjs", "scrape-bw-xy.mjs", "scrape-promo-sets.mjs", "patch-existing-sets.mjs"]) {
    const t = fs.existsSync(path.join(__dirname, f)) ? fs.readFileSync(path.join(__dirname, f), "utf8") : "";
    for (const m of t.matchAll(/(?:extraCardIds|excludeCardIds|numberlessIds):\s*\[([^\]]*)\]/g)) for (const n of m[1].match(/\d{4,6}/g) ?? []) known.add(String(parseInt(n, 10)));
    // 連番の書き方 extraCardIds: Array.from({ length: 25 }, (_, i) => String(50753 + i))
    for (const m of t.matchAll(/extraCardIds:\s*Array\.from\(\{\s*length:\s*(\d+)\s*\},\s*\(_,\s*i\)\s*=>\s*(?:String\()?(\d+)\s*\+\s*i/g)) for (let i = 0; i < +m[1]; i++) known.add(String(+m[2] + i));
    for (const m of t.matchAll(/printedNumbers:\s*\{([^}]*)\}/g)) for (const n of m[1].match(/(\d{4,6}):/g) ?? []) known.add(String(parseInt(n, 10)));
  }
  for (const f of fs.readdirSync(path.join(__dirname, "numberless-promos")).filter((f) => f.endsWith(".json"))) {
    for (const c of readJson(path.join(__dirname, "numberless-promos", f), {}).cards ?? []) if (c.cardId) known.add(String(c.cardId));
  }
  for (const id of Object.keys(readJson(LEDGER, {}))) known.add(id);
  return known;
}

// --- 候補（公式の一覧にあって、確かめていない cardID） ---
// --keys SO,SP1,…: 公式の一覧のキーを指定して、最初の一覧（official-card-cache.json）や進捗ファイルにあっても候補に入れる
// （一度も取り込んでいない古いキー用。台帳に記録済みのカードと、cardData に既にあるカードの cardID は除く）
const KEYS = arg("--keys") ? new Set(arg("--keys").split(",")) : null;
function candidates() {
  const scan = readJson(SCAN, null);
  if (!scan) throw new Error("official-card-scan.json がありません（--rescan で取り直す）");
  const known = knownIds();
  const ledger = readJson(LEDGER, {});
  const out = [];
  for (const [key, list] of Object.entries(scan.setMap)) for (const c of list) {
    const id = idOf(c.cardThumbFile);
    if (!id) continue;
    if (KEYS ? !KEYS.has(key) || ledger[id] : known.has(id)) continue;
    const name = String(c.jaName ?? c.cardNameViewText ?? "").replace(/<[^>]*>/g, "");
    out.push({ cardId: id, key, listName: name, thumb: c.cardThumbFile });
  }
  return { scan, out };
}

// --- details.php ---
function parseDetail(html) {
  const nums = parseCardDetailsFromHtml(html); // [{local,total,rarity,jaName,cardThumbFile}]（「NNN / 総数」）
  const promo = parsePromoDetailFromHtml(html); // {jaName,badge,number,label,rarityCode,cardThumbFile}（「NNN / XX-P」）
  if (!promo) return null;
  const rar = promo.rarityCode ? (RARITY_CODE_MAP[promo.rarityCode] ?? null) : "";
  return {
    jaName: promo.jaName, badge: promo.badge, cardThumbFile: promo.cardThumbFile, rarityCode: promo.rarityCode,
    entries: nums.length ? nums.map((n) => ({ local: n.local, total: n.total, rarity: n.rarity })) : promo.number ? [{ local: promo.number, label: promo.label, rarity: rar }] : [],
  };
}

async function fetchAll(list) {
  const details = readJson(DETAILS, {});
  const todo = list.filter((c) => !details[c.cardId]);
  console.log(`details.php: ${list.length}件（取得済み ${list.length - todo.length}、残り ${todo.length}）`);
  let fails = 0;
  for (const c of todo) {
    const html = await politeFetch(`${API}/card-search/details.php/card/${c.cardId}`);
    const d = html ? parseDetail(html) : null;
    if (!d) { if (++fails >= 3) throw new Error("details.php の取得に3件続けて失敗しました（再実行で続きから）"); await politeDelay(); continue; }
    fails = 0;
    details[c.cardId] = { ...d, key: c.key, fetchedAt: today };
    writeJson(DETAILS, details);
    await politeDelay();
  }
  return details;
}

// --- 候補を弾に振り分ける ---
function classify(list, details, data) {
  const bySet = new Map(data.map((s) => [s.c, s]));
  const rows = [];
  for (const c of list) {
    const d = details[c.cardId];
    if (!d) { rows.push({ ...c, status: "未取得" }); continue; }
    if (!d.entries.length) { rows.push({ ...c, name: d.jaName, badge: d.badge, status: isBasicEnergy(d.jaName) ? "番号なし（基本エネルギー）" : "番号なし（要確認）" }); continue; }
    for (const e of d.entries) {
      const r = { ...c, name: d.jaName, badge: d.badge, number: e.local, of: e.total ?? e.label, rarity: e.rarity, target: "", status: "" };
      rows.push(r);
      if (e.rarity === null) { r.status = `未知のレアリティ（${d.rarityCode}）`; continue; }
      let cands;
      if (e.label) cands = [bySet.get(e.label)].filter(Boolean);
      else {
        cands = data.filter((s) => (s.codeAlias || s.c) === d.badge && String(s.of) === String(parseInt(e.total, 10)));
        if (cands.length > 1) cands = cands.filter((s) => s.c === c.key);
      }
      if (cands.length !== 1) { r.target = e.label ? e.label : `${d.badge}（${e.total ?? ""}）`; r.status = cands.length ? "弾が1つに決まらない" : "新しい弾"; continue; }
      const s = cands[0];
      r.target = s.c;
      const same = s.k.find((k) => parseInt(k[0], 10) === parseInt(e.local, 10));
      r.status = !same ? "追加" : same[1] === d.jaName ? "登録済み（同じカードの別掲載）" : `番号が重なる（登録済み: ${same[1]}）`;
    }
  }
  return rows;
}

function report(rows) {
  const cols = ["cardId", "key", "badge", "number", "of", "name", "rarity", "target", "status"];
  fs.writeFileSync(path.join(DIR, "report.tsv"), [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c] ?? "").join("\t"))].join("\n") + "\n");
  const g = {};
  for (const r of rows) { const k = `${r.target || r.key}\t${r.status}`; (g[k] ??= []).push(r); }
  console.log(`候補 ${rows.length}件（scripts/new-cards/report.tsv）`);
  for (const [k, v] of Object.entries(g).sort()) {
    const [t, s] = k.split("\t");
    const nums = v.map((r) => r.number).filter(Boolean).sort((a, b) => a - b);
    console.log(`  ${t}: ${s} ${v.length}件${nums.length ? `（${nums[0]}〜${nums.at(-1)}）` : ""} 例: ${v.slice(0, 3).map((r) => r.name || r.listName).join("、")}`);
  }
}

async function downloadRows(set, rows, details) {
  const total = computeSetTotal(set.k);
  const done = [];
  for (const r of rows) {
    const d = details[r.cardId];
    const buf = d.cardThumbFile ? await politeFetch(API + d.cardThumbFile, true) : null;
    if (!buf || buf.length <= 1000) throw new Error(`${set.c}-${r.number} の画像を取得できません（cardData は未更新。再実行で続きから）`);
    const dir = path.join(ROOT, "public", "cards", set.sr, set.c);
    fs.mkdirSync(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, buildFileName(r.name, set.c, r.number, r.rarity, total) + imageExt(buf)), buf);
    done.push(r);
    await politeDelay();
  }
  return done;
}

function finish(code, added, ledgerStatus) {
  execFileSync(process.execPath, [path.join(__dirname, "build-image-index.mjs"), "--only", code], { stdio: "inherit" });
  const ledger = readJson(LEDGER, {});
  for (const r of added) ledger[r.cardId] = { status: ledgerStatus, set: code, number: r.number, name: r.name, date: today };
  writeJson(LEDGER, ledger);
  const ids = [...new Set(added.map((r) => `${code}-${r.local}`))].sort();
  fs.writeFileSync(path.join(DIR, `${code}-added-card-ids-${today}.txt`), ids.join("\n") + "\n");
  console.log(`[${code}] ${ids.length}件を足しました: ${ids.join(" ")}`);
  // 照合は記録の後に行う（化けた画像が見つかっても、足した分の記録は残す）
  execFileSync(process.execPath, [path.join(__dirname, "image-hashes.mjs"), "--verify"], { stdio: "inherit" });
}

async function main() {
  if (argv.includes("--skip")) {
    const reason = arg("--reason");
    if (!reason) throw new Error("--reason で理由を書いてください");
    const ledger = readJson(LEDGER, {});
    for (const id of arg("--skip").split(",")) ledger[String(parseInt(id, 10))] = { status: "skip", reason, date: today };
    writeJson(LEDGER, ledger);
    return console.log("記録しました");
  }
  if (argv.includes("--rescan")) {
    execFileSync(process.execPath, [path.join(__dirname, "rescan-official-list.mjs")], { stdio: "inherit" });
  }
  const { out } = candidates();
  const details = argv.includes("--fetch") || argv.includes("--rescan") ? await fetchAll(out) : readJson(DETAILS, {});
  const raw = fs.readFileSync(DATA, "utf8");
  const data = JSON.parse(raw);
  const rows = classify(out, details, data);
  const ledger = readJson(LEDGER, {});
  // 番号の無い基本エネルギーと、登録済みのカードの別掲載（同じ番号・同じ名前）は台帳に記録し、次から候補に出さない（今回の一覧には出す）
  const energy = rows.filter((r) => (r.status === "番号なし（基本エネルギー）" || r.status.startsWith("登録済み")) && !ledger[r.cardId]);
  for (const r of energy) ledger[r.cardId] = { status: "skip", reason: r.status.startsWith("登録済み") ? `${r.target}-${r.number} の別掲載` : "番号の無い基本エネルギー", name: r.name, key: r.key, date: today };
  if (energy.length) writeJson(LEDGER, ledger);
  if (!argv.includes("--apply")) return report(rows);

  const code = arg("--set"), newKey = arg("--new");
  if (code) {
    const set = data.find((s) => s.c === code);
    if (!set) throw new Error(`弾がありません: ${code}`);
    const mine = rows.filter((r) => r.target === code);
    const bad = mine.filter((r) => r.status.startsWith("番号が重なる") || r.status.startsWith("未知"));
    if (bad.length) throw new Error(`[${code}] 確かめが必要な候補があります（足さずに止めます）: ${bad.map((r) => `${r.cardId} ${r.number} ${r.name} ${r.status}`).join(", ")}`);
    const add = [];
    for (const r of mine.filter((r) => r.status === "追加")) if (!add.some((a) => parseInt(a.number, 10) === parseInt(r.number, 10))) add.push(r);
    if (!add.length) return console.log(`[${code}] 足すカードはありません`);
    const width = set.k.find((k) => /^\d+$/.test(k[0]))?.[0].length ?? 3;
    for (const r of add) r.local = String(parseInt(r.number, 10)).padStart(width, "0");
    const isX = (k) => !/^\d+$/.test(k[0]);
    const next = { ...set, k: [...set.k.filter((k) => !isX(k)), ...add.map((r) => [r.local, r.name, "", r.rarity])] };
    next.k.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
    await downloadRows(next, add, details);
    set.k = [...next.k, ...set.k.filter(isX)];
    fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
    return finish(code, add, "added");
  }
  if (newKey) {
    const meta = readJson(META, {})[newKey];
    const mine = rows.filter((r) => r.status === "新しい弾" && (r.badge === newKey || r.key === newKey));
    if (!mine.length) throw new Error(`新しい弾の候補がありません: ${newKey}`);
    if (!meta) {
      const tpl = { c: newKey, ja: "", en: "", psaName: "", sr: "", y: 0, codeAlias: mine[0].badge, of: parseInt(mine[0].of, 10) };
      console.log(`scripts/new-cards/set-meta.json に弾の情報を書いてから再実行してください（手順は CLAUDE.md「新しいカードの取り込み」）:\n"${newKey}": ${JSON.stringify(tpl)}`);
      process.exit(1);
    }
    if (data.some((s) => s.c === meta.c)) throw new Error(`弾が既にあります: ${meta.c}`);
    if (!meta.ja || !meta.sr || !meta.y) throw new Error("set-meta.json の ja・sr・y を埋めてください（en・psaName は確かめられなければ空欄）");
    // pendingGaps: 公式にまだ載っていない番号（set-meta.json に書く）。この番号の欠けだけを許し、載ったら --apply --set <弾> で足す
    const { k, byLocal } = validateAndBuildK(mine.map((r) => ({ local: r.number, total: r.of, jaName: r.name, rarity: r.rarity, cardId: r.cardId })), meta.c, { allowedGaps: meta.pendingGaps ?? [] });
    const set = { c: meta.c, ja: meta.ja, en: meta.en ?? "", ...(meta.psaName ? { psaName: meta.psaName } : {}), sr: meta.sr, of: parseInt(mine[0].of, 10), y: meta.y, ...(meta.codeAlias ? { codeAlias: meta.codeAlias } : {}), k: k.map((r) => [r[0], r[1], "", r[3] ?? ""]) };
    const add = [...byLocal.values()].map((d) => ({ ...mine.find((r) => r.cardId === d.cardId), local: String(parseInt(d.local, 10)).padStart(3, "0") }));
    add.forEach((r) => (r.number = r.local));
    await downloadRows(set, add, details);
    data.push(set);
    fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
    return finish(meta.c, add, "added");
  }
  throw new Error("--apply には --set <弾> か --new <印刷記号> を付けてください");
}

main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
