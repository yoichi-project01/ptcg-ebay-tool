#!/usr/bin/env node
// 同じ弾の中で、別の番号のカードと中身がまったく同じ画像ファイル（バイト一致）を洗い出す（2026-10-05）。
// 旧 scrape-official-images.mjs は名前で画像を探していたため、同じ名前の別番号（RR と SR・SAR・BWR、通常版と AR など）に
// 同じ絵柄を保存してしまっていた（例 SV11W-174 レシラムex BWR が SV11W-017 RR と同じファイル）。
// 出力: scripts/image-dup-report/duplicate-images.tsv（直すべきカードの一覧）・summary.json
// 公式 details.php の結果（scripts/scan-progress/{弾}.json）がある弾は、その番号の公式画像のパスも書く。
// 使い方: node scripts/find-duplicate-images.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts", "image-dup-report");
const ii = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "imageIndex.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "cardData.json"), "utf8"));
const rowOf = new Map();
for (const s of data) for (const r of s.k) rowOf.set(`${s.c}/${/^\d+$/.test(r[0]) ? parseInt(r[0], 10) : r[0]}`, { set: s.c, local: r[0], name: r[1], rarity: r[3] || "" });

// 意図して同じ画像を使っているもの（公式サイトの1ページに複数の番号が載るカード。CLAUDE.md 参照）
const INTENDED = (name) => /LEGEND$/.test(name) || /V-UNION$/.test(name);

const groups = new Map();
for (const [key, rel] of Object.entries(ii)) {
  const set = key.split("/")[0];
  const h = crypto.createHash("md5").update(fs.readFileSync(path.join(ROOT, "public", rel))).digest("hex");
  const g = `${set}:${h}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(key);
}

// details.php の結果（番号 → 公式の画像パス）
const official = new Map();
const progDir = path.join(ROOT, "scripts", "scan-progress");
for (const f of fs.existsSync(progDir) ? fs.readdirSync(progDir) : []) {
  if (!f.endsWith(".json")) continue;
  const set = f.replace(/\.json$/, "");
  const j = JSON.parse(fs.readFileSync(path.join(progDir, f), "utf8"));
  for (const [cardId, d] of Object.entries(j.details || j)) for (const c of d?.cards || []) {
    if (!c.local) continue;
    official.set(`${set}/${parseInt(c.local, 10)}`, { cardId, jaName: c.jaName, rarity: c.rarity, thumb: c.cardThumbFile });
  }
}

const rows = [];
const summary = { checkedAt: new Date().toISOString().slice(0, 10), groups: 0, cards: 0, intended: 0, bySet: {} };
for (const keys of groups.values()) {
  if (keys.length < 2) continue;
  const infos = keys.map((k) => ({ key: k, ...(rowOf.get(k) || { set: k.split("/")[0], local: k.split("/")[1], name: "(cardData に無い行)", rarity: "" }) }));
  const intended = infos.every((x) => INTENDED(x.name));
  if (intended) { summary.intended += keys.length; continue; }
  summary.groups++;
  for (const x of infos) {
    summary.cards++;
    summary.bySet[x.set] = (summary.bySet[x.set] || 0) + 1;
    const o = official.get(x.key);
    const others = infos.filter((y) => y !== x).map((y) => `${y.set}-${y.local}`).join(" ");
    const note = x.name === "(cardData に無い行)" ? "cardData に無い行（数字でない型番など）。画像索引から外す候補"
      : infos.some((y) => y !== x && y.name !== x.name) ? "名前の違うカードと同じ画像" : "";
    rows.push([`${x.set}-${x.local}`, x.name, x.rarity, ii[x.key], others,
      o ? `公式 cardID ${o.cardId}（${o.jaName} ${o.rarity}）${o.thumb}` : "未取得（details.php で番号を確かめて取得する）", note].join("\t"));
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "duplicate-images.tsv"),
  ["card_id\t名前\tレアリティ\t今の画像\t同じ中身の画像を持つカード\t正しいはずのもの\t備考", ...rows.sort()].join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(`同じ中身のグループ ${summary.groups}（意図したもの ${summary.intended}枚を除く）・対象カード ${summary.cards}枚`);
console.log(Object.entries(summary.bySet).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(" "));
