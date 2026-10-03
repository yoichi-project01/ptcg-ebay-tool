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
// 3つ目の情報源（任意）: ポケカくらぶの弾別一覧ページ（例 https://www.pokeca.net/product-list/680）
const EXTRA = arg("--extra");
// ポケカくらぶの型番の先頭が弾コードと違う場合に指定（例: S8a は S825）
const EXTRA_PREFIX = (arg("--extra-prefix") || SET || "").toUpperCase();
// 遊々亭の弾名が弾コードから作れない場合に指定（例: XY-BEST は hp）
const YUYUTEI_SLUG = arg("--yuyutei-slug");
// TCGdex に弾が無い場合（例: XY-BEST）は使わない。遊々亭とポケカくらぶの2つで照合する
const NO_TCGDEX = process.argv.includes("--no-tcgdex");
// TCGdex の弾 ID が弾コードと違う場合に指定（例: SM1p は SM1+）
const TCGDEX_ID = arg("--tcgdex-id") || SET;
const NO_RARITY_MARK = process.argv.includes("--no-rarity-mark");

// 遊々亭の URL の弾名（S8 → s08、S4a → s04a、S1W → s01w）
export const yuyuteiSlug = (code) => code.toLowerCase().replace(/^s(\d)(?=\D|$)/, "s0$1");
// 末尾の括弧注記（エラー版・通常版など）と表記ゆれを除いて比べる
// 末尾の注記（エラー版・通常版・[マグノリア博士] など）を外した名前。cardData（公式サイトの表記）も注記なしで登録している
export const stripNote = (s) => (s || "").replace(/(\s*([（(][^（()）]*[)）]|\[[^\]]*\]))+\s*$/, "").trim();
export const normName = (s) => stripNote((s || "").normalize("NFKC")).replace(/\s+/g, "");
export function parseYuyutei(html) {
  // 各カードは「<a href=カードページ>…<img alt="番号/総数 レアリティ 名前">」。説明文を起点に、直前のカードページのリンクを拾う
  const out = [];
  // レアリティの欄は、マークの無いカードでは「-」（例: XY-BEST「187/171 - イベルタルEX(UR仕様)」）。その場合は rarity を空にする
  for (const m of html.matchAll(/alt="(\d+)\/(\d+) ([A-Za-z]+|-) ([^"]*)"/g)) {
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const links = [...before.matchAll(/href="(https:\/\/yuyu-tei\.jp\/sell\/poc\/card\/[^"]+)"/g)];
    out.push({ url: links.length ? links[links.length - 1][1] : null, number: parseInt(m[1], 10), total: m[2], rarity: m[3] === "-" ? "" : m[3], name: m[4] });
  }
  return out;
}

// ポケカくらぶの一覧: <span class="goods_name">名前 レアリティ</span> <span class="model_number">…[S8EF129]…
export function parsePokeca(html) {
  const out = [];
  for (const m of html.matchAll(/<span class="goods_name">([^<]*)<\/span>\s*<span class="model_number"><span class="bracket">\[<\/span><span class="model_number_value">([^<]*)<\/span>/g)) {
    const num = (m[2].match(/(\d+)$/) || [])[1];
    if (!num) continue;
    // 名前の前後や括弧注記の隣にレアリティ表記が付く（例「パワータブレット（FUSION）UR」「ミュウVMAX HR（スペシャルアート・FUSION）」）
    const raw = m[1].trim();
    const rm = [...raw.matchAll(/(?:^|[^A-Za-z])(SAR|SSR|CSR|CHR|RRR|HR|UR|SR|AR|RR|PR|R|U|C)(?![A-Za-z])/g)];
    const rarity = rm.length ? rm[rm.length - 1][1] : null;
    const name = raw.replace(/[（(][^（()）]*[)）]/g, " ").replace(rarity ? new RegExp("(^|[^A-Za-z])" + rarity + "(?![A-Za-z])") : /$^/, "$1").replace(/\s+/g, " ").trim();
    out.push({ number: parseInt(num, 10), name, rarity, model: m[2] });
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
  if (!SET || !FROM) throw new Error("使い方: --set <弾> --from <開始番号>");
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
  if (NO_TCGDEX) progress.tcgdexSet = { total: null, cards: [], skipped: true };
  if (!progress.tcgdexSet) {
    const text = await politeFetch(`${TCGDEX}/sets/${encodeURIComponent(TCGDEX_ID)}`);
    note(!!text, "TCGdex 弾一覧");
    if (!text) throw new Error("TCGdex の弾一覧を取得できません");
    const j = JSON.parse(text);
    progress.tcgdexSet = { total: j.cardCount?.total, cards: j.cards.map((c) => ({ localId: c.localId, name: c.name, image: c.image || null })) };
    await save(); await politeDelay();
  }
  const targets = progress.tcgdexSet.cards.filter((c) => /^\d+$/.test(c.localId) && parseInt(c.localId, 10) >= FROM);
  for (const c of targets) {
    if (progress.tcgdexCards[c.localId]) continue;
    const text = await politeFetch(`${TCGDEX}/cards/${encodeURIComponent(TCGDEX_ID)}-${c.localId}`);
    note(!!text, `TCGdex ${SET}-${c.localId}`);
    if (text) { const j = JSON.parse(text); progress.tcgdexCards[c.localId] = { name: j.name, rarity: j.rarity || null, image: j.image || null }; await save(); }
    await politeDelay();
  }

  // 情報源2: 遊々亭の販売ページ（弾の全カードが1ページにある）
  if (!progress.yuyutei) {
    const url = `${YUYUTEI}/${YUYUTEI_SLUG || yuyuteiSlug(SET)}`;
    const html = await politeFetch(url);
    note(!!html, "遊々亭");
    if (!html) throw new Error(`遊々亭のページを取得できません: ${url}`);
    const title = (html.match(/<title>([^<]*)/) || [])[1] || "";
    progress.yuyutei = { url, title, entries: parseYuyutei(html) };
    await save(); await politeDelay();
  }
  const ytTitle = progress.yuyutei.title;
  // 遊々亭の表記は強化拡張パックの「p」が「+」（SM1p → [SM1+]）
  if (![`[${SET}]`, `[${SET.replace(/p$/, "+")}]`, `[${(YUYUTEI_SLUG || SET).toUpperCase()}]`].some((t) => ytTitle.includes(t))) throw new Error(`遊々亭のページが別の弾の可能性: ${ytTitle}`);

  // 情報源3（任意）: ポケカくらぶの弾別一覧
  if (EXTRA && progress.pokeca?.url !== EXTRA) {
    const html = await politeFetch(EXTRA);
    note(!!html, "ポケカくらぶ");
    if (!html) throw new Error(`ポケカくらぶのページを取得できません: ${EXTRA}`);
    const title = (html.match(/<title>([^<]*)/) || [])[1] || "";
    const entries = parsePokeca(html);
    // 一覧は60件ずつのページに分かれる。URL にページ指定が無ければ、ページ送りのリンクにある全ページを読む
    if (!/[?&]page=/.test(EXTRA)) {
      const base = EXTRA.replace(/^https:\/\/www\.pokeca\.net/, "");
      const pages = [...html.matchAll(/href="(?:https:\/\/www\.pokeca\.net)?([^"?]*)\?page=(\d+)"/g)].filter((m) => m[1] === base).map((m) => parseInt(m[2], 10));
      for (let pg = 2; pg <= Math.max(1, ...pages); pg++) {
        await politeDelay();
        const h = await politeFetch(`${EXTRA}?page=${pg}`);
        note(!!h, `ポケカくらぶ ${pg}ページ目`);
        if (!h) throw new Error(`ポケカくらぶのページを取得できません: ${EXTRA}?page=${pg}`);
        entries.push(...parsePokeca(h));
      }
    }
    progress.pokeca = { url: EXTRA, title, entries };
    await save(); await politeDelay();
  }
  // 型番の先頭が対象の弾と一致するものだけ使う（例: S1W なら S1WD061）
  const pk = EXTRA ? progress.pokeca.entries.filter((e) => e.model.toUpperCase().startsWith(EXTRA_PREFIX))
    // 番号は型番から弾の部分（EXTRA_PREFIX）を外した残りの末尾の数字（S8EF129→129、S825030→030）
    .map((e) => ({ ...e, number: parseInt((e.model.slice(EXTRA_PREFIX.length).match(/(\d+)$/) || [])[1], 10) }))
    .filter((e) => Number.isFinite(e.number)) : [];

  // 照合: 番号ごとに、情報源ごとの名前に票を入れ、同じ名前に2票以上集まったものだけ採用する。
  // レアリティは、レアリティを持つ情報源（遊々亭・ポケカくらぶ）のうち採用した名前を挙げたものの表記がそろう場合だけ使う
  const tdByNum = new Map(targets.map((c) => [parseInt(c.localId, 10), c]));
  const nums = [...new Set([...tdByNum.keys(), ...progress.yuyutei.entries.map((e) => e.number), ...pk.map((e) => e.number)])]
    .filter((n) => n >= FROM).sort((x, y) => x - y);
  const results = [];
  for (const n of nums) {
    const c = tdByNum.get(n);
    const td = c ? (progress.tcgdexCards[c.localId] || { name: c.name }) : null;
    const yt = progress.yuyutei.entries.filter((e) => e.number === n);
    const pe = pk.filter((e) => e.number === n);
    const id = `${SET}-${String(n).padStart(3, "0")}`;
    const r = { cardId: id, number: n,
      tcgdex: td ? { name: td.name, rarityClass: td.rarity ?? null, url: `${TCGDEX}/cards/${encodeURIComponent(TCGDEX_ID)}-${c.localId}` } : null,
      yuyutei: yt.map((e) => ({ name: e.name, rarity: e.rarity, total: e.total, url: e.url })),
      ...(EXTRA ? { pokeca: pe.map((e) => ({ name: e.name, rarity: e.rarity, model: e.model, url: EXTRA })) } : {}) };
    // 各情報源の名前（1情報源の中で名前が割れていれば、その情報源は票を入れない）
    const votes = new Map();
    const vote = (src, names) => { const u = [...new Set(names.map(normName))]; if (u.length === 1) votes.set(u[0], [...(votes.get(u[0]) || []), src]); };
    if (td) vote("TCGdex", [td.name]);
    if (yt.length) vote("遊々亭", yt.map((e) => e.name));
    if (pe.length) vote("ポケカくらぶ", pe.map((e) => e.name));
    const ranked = [...votes].sort((x, y) => y[1].length - x[1].length);
    const top = ranked[0];
    if (have.has(n)) r.status = "既に cardData にある";
    else if (!top || top[1].length < 2) r.status = "2つ以上の情報源で一致する名前が無い";
    else if (ranked[1] && ranked[1][1].length === top[1].length) r.status = "票が割れている";
    else {
      // --no-rarity-mark: カードにレアリティマークが無い弾（公式 details.php に全件レアリティのアイコンが無いことを確認したもの。例: XY-BEST）。
      // 店舗の「UR」「SR仕様」などは販売上の区分なので使わず、レアリティは空で登録する
      const rar = NO_RARITY_MARK ? [""] : [...new Set([...yt.filter((e) => normName(e.name) === top[0]).map((e) => e.rarity), ...pe.filter((e) => normName(e.name) === top[0]).map((e) => e.rarity)].filter(Boolean))];
      const totals = [...new Set(yt.map((e) => parseInt(e.total, 10)))];
      if (rar.length !== 1) r.status = rar.length ? "レアリティが割れている" : "レアリティの情報が無い";
      else if (totals.length && !totals.includes(set.of)) r.status = `総数が違う（遊々亭 ${totals.join("/")} / cardData ${set.of}）`;
      else {
        const ja = td && normName(td.name) === top[0] ? td.name : (yt.find((e) => normName(e.name) === top[0])?.name && stripNote(yt.find((e) => normName(e.name) === top[0]).name) || pe.find((e) => normName(e.name) === top[0]).name);
        r.status = "一致"; r.agreedBy = top[1]; r.add = { local: String(n).padStart(3, "0"), ja, rarity: rar[0] };
      }
    }
    if (!r.add && !have.has(n)) r.candidates = ranked.map(([name, srcs]) => ({ name, sources: srcs }));
    results.push(r);
  }

  for (const r of results) console.log(`${r.cardId}\t${r.status}${r.agreedBy ? "（" + r.agreedBy.join("・") + "）" : ""}\tTCGdex「${r.tcgdex?.name ?? "-"}」\t遊々亭「${r.yuyutei.map((e) => `${e.rarity} ${e.name}`).join(" / ")}」${EXTRA ? `\tポケカくらぶ「${r.pokeca.map((e) => `${e.rarity ?? ""} ${e.name}`).join(" / ")}」` : ""}`);
  const toAdd = results.filter((r) => r.add);
  const held = results.filter((r) => !r.add && !have.has(r.number));
  console.log(`追加: ${toAdd.length} 枚 / 保留: ${held.length} 枚${DRY ? "（dry-run）" : ""}`);
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

  const reportPath = path.join(OUT_DIR, `${SET}.json`);
  const prev = readJson(reportPath, { results: [] });
  const merged = new Map(prev.results.map((x) => [x.cardId, x]));
  for (const x of results) if (!(x.status === "既に cardData にある" && merged.has(x.cardId))) merged.set(x.cardId, x);
  const report = { set: SET, checkedAt: new Date().toISOString(),
    sources: { tcgdex: `${TCGDEX}/sets/${encodeURIComponent(TCGDEX_ID)}`, yuyutei: progress.yuyutei.url, ...(EXTRA || prev.sources?.pokeca ? { pokeca: EXTRA || prev.sources.pokeca } : {}) },
    rule: "番号ごとに TCGdex・遊々亭・ポケカくらぶ（指定時）の名前を照合し、2つ以上の情報源で一致したものだけ追加。レアリティは遊々亭・ポケカくらぶの表記（一致する場合のみ）。画像は TCGdex にある場合のみ（店舗の画像は使わない）",
    results: [...merged.values()].sort((x, y) => x.number - y.number) };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
  const idsPath = path.join(OUT_DIR, `${SET}-added-card-ids.txt`);
  const ids = new Set(fs.existsSync(idsPath) ? fs.readFileSync(idsPath, "utf8").split(/\r?\n/).filter(Boolean) : []);
  for (const r of toAdd) ids.add(r.cardId);
  fs.writeFileSync(idsPath, [...ids].sort().join("\n") + (ids.size ? "\n" : ""));
  console.log(`cardData に ${toAdd.length} 枚追加。根拠: scripts/secret-sources/${SET}.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
}
