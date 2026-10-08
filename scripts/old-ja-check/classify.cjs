const fs = require("fs");
const T = process.env.TEMP + "/claude/oldja/";
const d = require(process.argv[2] + "/src/cardData.json");
const pcg = JSON.parse(fs.readFileSync(T + "pcg-titles.json", "utf8"));
const norm = (s) => (s || "").normalize("NFKC").replace(/[\s・･]/g, "").replace(/δ-?デルタ種|\(デルタ種\)|（デルタ種）/g, "δ").replace(/[‐－―−]/g, "-");
const tally = {}, rows = [], bySet = {};
const missKind = (cd, pc) => {
  const a = norm(cd), b = norm(pc), ks = [];
  if (/ex/.test(b) && !/ex/.test(a)) ks.push("ex");
  if (/δ/.test(b) && !/δ/.test(a)) ks.push("δ");
  if (/☆/.test(b) && !/☆/.test(a)) ks.push("☆");
  if (/^(わるい|やさしい|ひかる|ひかりの)/.test(b) && !/^(わるい|やさしい|ひかる|ひかりの)/.test(a)) ks.push("わるい/やさしい/ひかる");
  if (/^.+の/.test(b) && !/^(わるい|やさしい|ひかる|ひかりの)/.test(b) && !b.includes(a.split("の").pop()) === false && !a.includes("の")) ks.push("持ち主（〜の）");
  if (/\[.\]/.test(b) && !/\[.\]/.test(a)) ks.push("アンノーンの文字");
  return ks.length ? ks.join("+") : "その他の前置き・注記";
};
for (const [key, p] of Object.entries(pcg)) {
  if (!p.title) continue;
  const c = key.slice(0, key.lastIndexOf("-")), num = key.slice(key.lastIndexOf("-") + 1);
  const m = p.title.match(/^(.*?) \| /); if (!m) continue;
  const pname = m[1].trim();
  const s = d.find((x) => x.c === c); const k = s.k.find((k) => k[0] === num); if (!k) continue;
  const b = (bySet[c] ||= { 行: 0, 一致: 0 }); b.行++;
  if (norm(k[1]) === norm(pname)) { b.一致++; continue; }
  const kind = k[2] ? "ポケモン" : /エネルギー/.test(pname) ? "エネルギー" : "トレーナーズ";
  let cat;
  if (kind === "ポケモン") cat = norm(pname).includes(norm(k[1]).replace(/δ$/, "")) ? "欠落:" + missKind(k[1], pname) : "名前が違う";
  else cat = "名前が違う";
  const kk = kind + "/" + cat;
  b[kk] = (b[kk] || 0) + 1; tally[kk] = (tally[kk] || 0) + 1;
  rows.push([key, kind, cat, k[1], pname, k[2] || ""].join("\t"));
}
fs.writeFileSync(T + "diff2.tsv", "id\t種類\t分類\tcardData\tpcg-search\ten\n" + rows.join("\n") + "\n");
fs.writeFileSync(T + "bySet.json", JSON.stringify(bySet, null, 1));
console.log(JSON.stringify(tally, null, 1));
let tot = 0, ok = 0; for (const b of Object.values(bySet)) { tot += b.行; ok += b.一致; } console.log("rows", tot, "match", ok, "diff", tot - ok);
