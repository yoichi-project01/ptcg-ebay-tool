#!/usr/bin/env node
// DP3・DP4 の取り込みで「同じカードの別掲載」として1行にまとめた4組を、ホロ版とノーマル版の2行に分ける（2026-10-12）。
//   node scripts/dp-x/split-holo.mjs --set DP3|DP4 [--apply]
// 根拠: 公式 details.php の2つの cardID は本文（名前・ワザ・イラストレーター・収録商品）が同じで、画像だけ違う。
//   画像を見比べると gif の方はイラストの枠に星形のホロ模様があり、jpg の方は模様が無い（scratchpad で拡大して確認）。
//   Bulbapedia のデッキの一覧も同じカードを Holofoil / Non Holofoil（ディアルガは「1 holographic; 1 non-holographic」）の2枚として載せている。
// 名前は「ディアルガ（ノーマル）」「ディアルガ（ホロ）」。英語名は同じ（英語版に別の名前は無い）。レアリティは両方とも空（公式にアイコンが無い）。
// 注意: build-dp-sets.mjs をもう一度実行すると、本文が同じ2つの cardID を再び1行にまとめてしまう（plan-{弾}.json の dupListings）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFileName, writeFileAtomic } from "../filename-utils.mjs";
import { imageExt, politeDelay, politeFetch } from "../scrape-promo-sets.mjs";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DATA = path.join(ROOT, "src", "cardData.json");
const INDEX = path.join(ROOT, "src", "imageIndex.json");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");

// normal: 今の行（jpg の画像）、holo: 足す行（gif の画像）
const PAIRS = {
  DP3: [{ normal: "3119", holo: "3120", ja: "ディアルガ" }, { normal: "3121", holo: "3122", ja: "パルキア" }],
  DP4: [{ normal: "10502", holo: "10503", ja: "エレキブル" }, { normal: "10505", holo: "10506", ja: "ブーバーン" }],
};
const details = JSON.parse(fs.readFileSync(path.join(__dirname, "details.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const set = data.find((s) => s.c === SET);
const dir = path.join(ROOT, "public", "cards", set.sr, set.c);
// 比べる本文: CLOSE より前。「進化」の欄（進化の系統のリンク。片方のページにだけあることがある）は外す
const body = (id) => {
  const t = details[id].text.slice(0, details[id].text.indexOf("CLOSE"));
  const i = t.indexOf("進化");
  const j = t.findIndex((s, k) => k > i && /^ポケモンカードゲーム/.test(s));
  return (i >= 0 && j > i ? [...t.slice(0, i), ...t.slice(j)] : t).join("/");
};
const changes = [];
for (const p of PAIRS[SET]) {
  const nId = `X${p.normal}`, hId = `X${p.holo}`;
  const row = set.k.find((r) => r[0] === nId);
  if (!row) throw new Error(`行が無い: ${SET}-${nId}`);
  if (set.k.some((r) => r[0] === hId)) { console.log(`${SET}-${hId} は既にある`); continue; }
  if (row[1] !== p.ja) throw new Error(`想定と違う名前: ${row}`);
  if (body(p.normal) !== body(p.holo)) throw new Error(`本文が違う: ${p.normal} / ${p.holo}`);
  if (!/\.jpg$/.test(details[p.normal].image) || !/\.gif$/.test(details[p.holo].image)) throw new Error("画像の形式が想定と違う");
  const nRow = [nId, `${p.ja}（ノーマル）`, row[2], row[3]];
  const hRow = [hId, `${p.ja}（ホロ）`, row[2], row[3]];
  changes.push({ id: `${SET}-${nId}`, before: row.join("/"), after: nRow.join("/"), image: details[p.normal].image });
  changes.push({ id: `${SET}-${hId}`, before: "（行なし）", after: hRow.join("/"), image: details[p.holo].image });
  if (!APPLY) continue;
  // ノーマル: 画像は今のまま（公式の jpg と同じか確かめる）、ファイル名だけ変える
  const rel = index[`${SET}/${nId}`];
  const cur = fs.readFileSync(path.join(ROOT, "public", rel));
  const offN = await politeFetch("https://www.pokemon-card.com" + details[p.normal].image, true); await politeDelay();
  if (!offN || !cur.equals(offN)) throw new Error(`${SET}-${nId} の今の画像が公式の jpg と違う`);
  const offH = await politeFetch("https://www.pokemon-card.com" + details[p.holo].image, true); await politeDelay();
  if (!offH || offH.length < 1000) throw new Error(`画像の取得に失敗: ${p.holo}`);
  fs.renameSync(path.join(ROOT, "public", rel), path.join(dir, buildFileName(nRow[1], SET, nId, nRow[3], 0) + ".jpg"));
  await writeFileAtomic(path.join(dir, buildFileName(hRow[1], SET, hId, hRow[3], 0) + imageExt(offH)), offH);
  row.splice(0, 4, ...nRow);
  set.k.splice(set.k.indexOf(row) + 1, 0, hRow);
}
console.log(JSON.stringify(changes, null, 1));
if (APPLY && changes.length) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(path.join(__dirname, `split-holo-${SET}.json`), JSON.stringify({ set: SET, date: "2026-10-12", changes }, null, 1) + "\n");
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-image-index.mjs"), "--only", SET], { stdio: "inherit" });
  rebuildCardKinds();
}
