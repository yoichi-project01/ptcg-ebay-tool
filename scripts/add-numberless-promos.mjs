#!/usr/bin/env node
// 番号の無いプロモ（勝利の勲章などの大会賞品）を cardData に足す（2026-10-06）。
//   node scripts/add-numberless-promos.mjs scripts/numberless-promos/SM-P-victory-medal.json
// 型番は「X＋公式 details.php の cardID」（例 SM-P-X33404）。先頭を数字以外にして通常の型番と重ならないようにする。
// 計画ファイルの各カードについて details.php をもう一度取得し、次をすべて満たすものだけ足す:
//   名前が計画の name と一致・番号が無い・バッジ（印刷記号）がプロモの記号・本文の大会名が計画の eventDetails と一致
// 日本語名は同じ名前のカードを見分けられるよう、大会名と順位を括弧で付ける（計画の ja）。画像は details.php の画像を取る。
// 同時接続1本・2〜3秒間隔（scrape-promo-sets.mjs の politeFetch）。取得後は build-image-index.mjs --only <弾> で対応表と SHA-256 の一覧を合わせる。
// 結果は scripts/numberless-promos/{計画ファイル名}-result.json、追加した card_id は {計画ファイル名}-added-card-ids.txt。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, writeFileAtomic } from "./filename-utils.mjs";
import { politeDelay, politeFetch } from "./scrape-promo-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const planPath = process.argv[2];
if (!planPath) throw new Error("計画ファイルを指定してください");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
// 印刷記号（details.php の img-regulation の alt）は弾ごとに違う（SM-P は SMP、S-P は S-P 等）ので計画ファイルの badge で指定する

const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "imageIndex.json"), "utf8"));
const set = data.find((s) => s.c === plan.set);
if (!set) throw new Error(`cardData に ${plan.set} がありません`);
const folder = path.dirname(Object.entries(index).find(([k]) => k.startsWith(plan.set + "/"))[1]); // 例 cards/SM/SM-P

const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").split("\n").map((s) => s.trim()).filter(Boolean);
const results = [];
let fails = 0;
for (const c of plan.cards) {
  const id = `X${c.cardId}`;
  const r = { cardId: c.cardId, id: `${plan.set}-${id}`, ja: c.ja };
  results.push(r);
  if (set.k.some((k) => k[0] === id)) { r.status = "既にある"; continue; }
  const html = await politeFetch(`https://www.pokemon-card.com/card-search/details.php/card/${c.cardId}`);
  await politeDelay();
  if (!html) { if (++fails >= 3) throw new Error("連続3件失敗したため停止します"); r.status = "details.php を取得できない"; continue; }
  fails = 0;
  const name = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "");
  const badge = (html.match(/<img[^>]*class="img-regulation"[^>]*alt="([^"]+)"/) || [])[1] ?? null;
  const hasNumber = /&nbsp;\d+&nbsp;\/&nbsp;/.test(html);
  const img = (html.match(/<img class="fit" src="([^"]+)"/) || [])[1] ?? null;
  const text = textOf(html);
  Object.assign(r, { name, badge, hasNumber, image: img });
  if (name !== (c.name ?? plan.name)) { r.status = `名前が違う（${name}）`; continue; } // 公式の名前に順位が入っているもの（勝利の証（優勝）等）はカードごとに name を指定
  if (hasNumber) { r.status = "番号がある（番号付きの行として扱う）"; continue; }
  if (badge !== plan.badge) { r.status = `印刷記号が違う（${badge}）`; continue; }
  if (c.eventDetails && !text.includes(c.eventDetails)) { r.status = "本文の大会名が計画と違う"; continue; }
  if (!img) { r.status = "画像が無い"; continue; }
  const buf = await politeFetch(`https://www.pokemon-card.com${img}`, true);
  await politeDelay();
  if (!buf || buf.length < 1000) { r.status = "画像を取得できない"; continue; }
  const ext = buf[0] === 0x89 ? ".png" : buf[0] === 0x47 ? ".gif" : ".jpg";
  const rel = path.posix.join(folder, buildFileName(c.ja, plan.set, id, "", 0) + ext);
  await writeFileAtomic(path.join(ROOT, "public", rel), buf);
  set.k.push([id, c.ja, "", ""]);
  Object.assign(r, { file: rel, bytes: buf.length, status: "追加" });
}
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
const base = planPath.replace(/\.json$/, "");
const added = results.filter((x) => x.status === "追加");
fs.writeFileSync(`${base}-result.json`, JSON.stringify({ at: new Date().toISOString(), set: plan.set, results }, null, 1));
fs.writeFileSync(`${base}-added-card-ids.txt`, added.map((x) => x.id).join("\n") + (added.length ? "\n" : ""));
for (const x of results) if (x.status !== "追加") console.log(x.cardId, x.status);
console.log(`[${plan.set}] ${added.length}/${plan.cards.length}件を追加`);
