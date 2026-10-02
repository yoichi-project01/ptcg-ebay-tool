#!/usr/bin/env node
// 公式サイト（カード検索・details.php）に載っていない HR・UR 等を、公式以外の2つの情報源の照合で補う。
//   情報源1: TCGdex（https://api.tcgdex.net/v2/ja/sets/{set} の番号・名前）
//   情報源2: 遊々亭（https://yuyu-tei.jp/sell/poc/s/{slug} の画像の説明文「番号/総数 レアリティ 名前」）
// 番号と名前が両方で一致したカードだけを cardData.json に追加する。レアリティは遊々亭の表記
// （日本版のレアリティマーク）を使う。TCGdex のレアリティは英語の大まかな分類で日本版の表記と
// 対応しないため照合には使わず、記録だけ残す。食い違い・片方にしか無い番号は追加しない。
// 画像は TCGdex に画像がある場合だけ取得し、出どころを記録する（無ければ画像なし）。
//
// アクセスは同時接続1本・2〜3秒間隔、403/通信エラーは待って再試行、連続3件失敗で停止
// （scrape-promo-sets.mjs の politeFetch / politeDelay を使用）。取得結果は
// scripts/secret-progress/{set}.json に保存し、再実行時は取得済みを飛ばす。
// 結果（照合の根拠 URL・追加した card_id）は scripts/secret-sources/ に出す。
//
// 使い方: node scripts/add-secrets-from-sources.mjs --set S8 --from 116 [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { politeFetch, politeDelay } from "./scrape-promo-sets.mjs";
import { buildFileName, computeSetTotal, writeFileAtomic, MIN_IMAGE_BYTES } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const PROGRESS_DIR = path.join(__dirname, "secret-progress");
const OUT_DIR = path.join(__dirname, "secret-sources");
const TCGDEX = "https://api.tcgdex.net/v2/ja";
const YUYUTEI = "https://yuyu-tei.jp/sell/poc/s";
const MAX_CONSECUTIVE_FAILURES = 3;

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const SET = arg("--set");
const FROM = parseInt(arg("--from") || "0", 10);
const DRY = process.argv.includes("--dry-run");
if (!SET || !FROM) { console.error("使い方: --set <弾> --from <開始番号>"); process.exit(1); }

// 遊々亭の URL の弾名（S8 → s08、S4a → s04a、S1W → s01w）
export const yuyuteiSlug = (code) => code.toLowerCase().replace(/^s(\d)(?=\D|$)/, "s0$1");
// 末尾の括弧注記（エラー版・通常版など）と表記ゆれを除いて比べる
export const normName = (s) => (s || "").normalize("NFKC").replace(/[（(][^（()）]*[)）]\s*$/, "").replace(/\s+/g, "").trim();
export function parseYuyutei(html) {
  // 各カードは「<a href=カードページ>…<img alt="番号/総数 レアリティ 名前">」。説明文を起点に、直前のカードページのリンクを拾う
  const out = [];
  for (const m of html.matchAll(/alt="(\d+)\/(\d+) ([A-Za-z]+) ([^"]*)"/g)) {
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const links = [...before.matchAll(/href="(https:\/\/yuyu-tei\.jp\/sell\/poc\/card\/[^"]+)"/g)];
    out.push({ url: links.length ? links[links.length - 1][1] : null, number: parseInt(m[1], 10), total: m[2], rarity: m[3], name: m[4] });
  }
  return out;
}

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
let consecutiveFailures = 0;
function note(ok, what) {
  if (ok) { consecutiveFailures = 0; return; }
  if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`連続${MAX_CONSECUTIVE_FAILURES}件失敗したため停止します（${what}）。再実行で続きから再開します`);
}

async function main() {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const progressPath = path.join(PROGRESS_DIR, `${SET}.json`);
  const progress = readJson(progressPath, { tcgdexCards: {}, yuyutei: null, images: {} });
  const save = () => writeFileAtomic(progressPath, JSON.stringify(progress, null, 1));

  const raw = fs.readFileSync(DATA, "utf8");
  const data = JSON.parse(raw);
  const set = data.find((s) => s.c === SET);
  if (!set) throw new Error(`cardData に弾が無い: ${SET}`);
  const have = new Set(set.k.map((r) => parseInt(r[0], 10)));

  // 情報源1: TCGdex の弾の一覧と、対象番号のカード詳細（画像・レアリティ分類の記録用）
  if (!progress.tcgdexSet) {
    const text = await politeFetch(`${TCGDEX}/sets/${SET}`);
    note(!!text, "TCGdex 弾一覧");
    if (!text) throw new Error("TCGdex の弾一覧を取得できません");
    const j = JSON.parse(text);
    progress.tcgdexSet = { total: j.cardCount?.total, cards: j.cards.map((c) => ({ localId: c.localId, name: c.name, image: c.image || null })) };
    await save(); await politeDelay();
  }
  const targets = progress.tcgdexSet.cards.filter((c) => /^\d+$/.test(c.localId) && parseInt(c.localId, 10) >= FROM);
  for (const c of targets) {
    if (progress.tcgdexCards[c.localId]) continue;
    const text = await politeFetch(`${TCGDEX}/cards/${SET}-${c.localId}`);
    note(!!text, `TCGdex ${SET}-${c.localId}`);
    if (text) { const j = JSON.parse(text); progress.tcgdexCards[c.localId] = { name: j.name, rarity: j.rarity || null, image: j.image || null }; await save(); }
    await politeDelay();
  }

  // 情報源2: 遊々亭の販売ページ（弾の全カードが1ページにある）
  if (!progress.yuyutei) {
    const url = `${YUYUTEI}/${yuyuteiSlug(SET)}`;
    const html = await politeFetch(url);
    note(!!html, "遊々亭");
    if (!html) throw new Error(`遊々亭のページを取得できません: ${url}`);
    const title = (html.match(/<title>([^<]*)/) || [])[1] || "";
    progress.yuyutei = { url, title, entries: parseYuyutei(html) };
    await save(); await politeDelay();
  }
  const ytTitle = progress.yuyutei.title;
  if (!ytTitle.includes(`[${SET}]`)) throw new Error(`遊々亭のページが別の弾の可能性: ${ytTitle}`);

  // 照合
  const results = [];
  for (const c of targets) {
    const n = parseInt(c.localId, 10);
    const td = progress.tcgdexCards[c.localId];
    const yt = progress.yuyutei.entries.filter((e) => e.number === n);
    const id = `${SET}-${String(n).padStart(3, "0")}`;
    const r = { cardId: id, number: n, tcgdex: { name: td?.name ?? c.name, rarityClass: td?.rarity ?? null, url: `${TCGDEX}/cards/${SET}-${c.localId}` },
      yuyutei: yt.map((e) => ({ name: e.name, rarity: e.rarity, total: e.total, url: e.url })) };
    const ytNames = [...new Set(yt.map((e) => normName(e.name)))];
    const ytRar = [...new Set(yt.map((e) => e.rarity))];
    if (have.has(n)) r.status = "既に cardData にある";
    else if (!yt.length) r.status = "遊々亭に無い";
    else if (ytNames.length > 1 || ytRar.length > 1) r.status = "遊々亭の中で名前・レアリティが割れている";
    else if (yt[0].total !== String(set.of).padStart(yt[0].total.length, "0") && parseInt(yt[0].total, 10) !== set.of) r.status = `総数が違う（遊々亭 ${yt[0].total} / cardData ${set.of}）`;
    else if (ytNames[0] !== normName(r.tcgdex.name)) r.status = "名前が一致しない";
    else { r.status = "一致"; r.add = { local: String(n).padStart(3, "0"), ja: r.tcgdex.name, rarity: ytRar[0] }; }
    results.push(r);
  }
  // 遊々亭にあって TCGdex に無い番号も記録する
  const tdNums = new Set(targets.map((c) => parseInt(c.localId, 10)));
  const ytOnly = [...new Set(progress.yuyutei.entries.filter((e) => e.number >= FROM && !tdNums.has(e.number) && !have.has(e.number)).map((e) => e.number))];

  for (const r of results) console.log(`${r.cardId}\t${r.status}\tTCGdex「${r.tcgdex.name}」\t遊々亭「${r.yuyutei.map((e) => `${e.rarity} ${e.name}`).join(" / ")}」`);
  if (ytOnly.length) console.log(`遊々亭にだけある番号: ${ytOnly.join(", ")}`);
  const toAdd = results.filter((r) => r.add);
  console.log(`追加: ${toAdd.length} 枚 / 追加しない: ${results.length - toAdd.length} 枚${DRY ? "（dry-run）" : ""}`);
  if (DRY) return;

  // 画像（TCGdex に画像があるものだけ）
  const total = computeSetTotal([...set.k, ...toAdd.map((r) => [r.add.local])]);
  for (const r of toAdd) {
    const img = progress.tcgdexCards[String(r.number)]?.image || progress.tcgdexSet.cards.find((c) => c.localId === String(r.number))?.image;
    r.image = null;
    if (!img) { r.image = { source: null, note: "TCGdex に画像なし" }; continue; }
    const url = `${img}/high.jpg`;
    const fileName = buildFileName(r.add.ja, SET, r.add.local, r.add.rarity, total) + ".jpg";
    const dest = path.join(ROOT, "public", "cards", set.sr, SET, fileName);
    if (!fs.existsSync(dest)) {
      const buf = await politeFetch(url, true);
      note(!!buf, `画像 ${r.cardId}`);
      await politeDelay();
      if (!buf || buf.length < MIN_IMAGE_BYTES || !(buf[0] === 0xff && buf[1] === 0xd8)) { r.image = { source: url, note: "取得できず" }; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await writeFileAtomic(dest, buf);
    }
    r.image = { source: url, file: path.relative(path.join(ROOT, "public"), dest).split(path.sep).join("/") };
  }

  // cardData へ追加（番号順に並べる）
  for (const r of toAdd) set.k.push([r.add.local, r.add.ja, "", r.add.rarity]);
  set.k.sort((a, b) => (parseInt(a[0], 10) || 0) - (parseInt(b[0], 10) || 0));
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));

  const report = { set: SET, checkedAt: new Date().toISOString(), sources: { tcgdex: `${TCGDEX}/sets/${SET}`, yuyutei: progress.yuyutei.url },
    rule: "番号と名前が TCGdex と遊々亭で一致したものだけ追加。レアリティは遊々亭の表記", results, yuyuteiOnly: ytOnly };
  fs.writeFileSync(path.join(OUT_DIR, `${SET}.json`), JSON.stringify(report, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, `${SET}-added-card-ids.txt`), toAdd.map((r) => r.cardId).join("\n") + (toAdd.length ? "\n" : ""));
  console.log(`cardData に ${toAdd.length} 枚追加。根拠: scripts/secret-sources/${SET}.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
