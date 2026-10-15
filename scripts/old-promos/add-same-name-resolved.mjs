#!/usr/bin/env node
// resolve-same-name.mjs で「決まる」となった同じ名前のカードを足す（2026-10-15）。  node scripts/old-promos/add-same-name-resolved.mjs --set PMCG-P [--apply]
// 型番は「Y＋pcg-search の通し番号」。同じ名前のカードがほかにもあるので、日本語名の末尾に配布元（ポケモンWiki の入手法）の括弧注記を付ける（CLAUDE.md の決まり）。
// 英語名は Bulbapedia の名前と規則の名前（種族名）の一致。画像は pcg-search（取得時の SHA-256 と照合）。根拠は same-name-decisions-2026-10-15.tsv
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildFileName, writeFileAtomic } from "../filename-utils.mjs";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const SET = args[args.indexOf("--set") + 1];
const APPLY = args.includes("--apply");
const ps = JSON.parse(fs.readFileSync(path.join(__dirname, "pcg-search-promos-2026-10-15.json"), "utf8"));
const species = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "en-name-fix3", "species-ja-en.json"), "utf8")).species.map((s) => [s.ja.normalize("NFKC"), s.en]));
const rows = fs.readFileSync(path.join(__dirname, "same-name-decisions-2026-10-15.tsv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split("\t"))
  .filter((c) => c[9] === "決まる" && c[0].startsWith(`${SET}-Y`))
  .map((c) => {
    const how = c[7].replace(/^\([^)]*\)\s*/, "").replace(/(おまけカード|プレゼントカード)$/, "").trim();
    const [idx, year, bpEn] = c[10].split(":");
    const rule = species.get(c[2].normalize("NFKC"));
    return { id: c[0], local: c[0].slice(SET.length + 1), page: c[1], name: c[2], ja: `${c[2]}（${how}）`, en: rule && rule === bpEn ? rule : "", bp: c[10], how: c[7], pwPage: c[6] };
  });
for (const r of rows) console.log(r.id, r.ja, "|", r.en);
if (!APPLY || !rows.length) process.exit(0);
const DATA = path.join(ROOT, "src", "cardData.json");
const raw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(raw);
const set = data.find((s) => s.c === SET);
for (const r of rows) {
  if (set.k.some((k) => k[0] === r.local)) throw new Error(`既にある: ${r.id}`);
  const p = ps[r.page];
  const buf = fs.readFileSync(path.join(ROOT, "scripts", "pcg-search-cache", "promo", "img", path.basename(p.image)));
  if (crypto.createHash("sha256").update(buf).digest("hex") !== p.sha256) throw new Error(`画像の SHA-256 が取得時と違う: ${p.image}`);
  await writeFileAtomic(path.join(ROOT, "public", "cards", set.sr, SET, buildFileName(r.ja, SET, r.local, "", 0) + path.extname(p.image)), buf);
  set.k.push([r.local, r.ja, r.en, ""]);
}
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
rebuildCardKinds();
fs.writeFileSync(path.join(__dirname, `${SET}-same-name-added-card-ids-2026-10-15.txt`), rows.map((r) => r.id).join("\n") + "\n");
console.log(`${SET}: ${rows.length}行を足した`);
