// pcg-search.com のカードページの <title> から名前と番号を集める（読み取りだけ）。1接続・2〜3秒間隔・再開可能
import fs from "node:fs";
const OUT = process.argv[2];
const d = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const CONF = { neo1:["neo","neo1",3],neo2:["neo","neo2",3],neo3:["neo","neo3",3],neo4:["neo","neo4",3],E1:["e","e1",3],E2:["e","e2",3],E3:["e","e3",3],E4:["e","e4",3],E5:["e","e5",3],
  PCG1:["pcg","pcg1",3],PCG2:["pcg","pcg2",3],PCG3:["pcg","pcg3",3],PCG4:["pcg","pcg4",3],PCG5:["pcg","pcg5",3],PCG6:["pcg","pcg6",3],PCG7:["pcg","pcg7",3],PCG8:["pcg","pcg8",3],PCG9:["pcg","pcg9",3],
  VS1:["vs","vs",4], web1:["web","web",4] };
const prog = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
for (const [c, [dir, pre, w]] of Object.entries(CONF)) {
  const s = d.find((x) => x.c === c);
  const max = Math.max(...s.k.filter((k) => /^\d+$/.test(k[0])).map((k) => +k[0]));
  for (let n = 1; n <= max; n++) {
    const key = `${c}-${String(n).padStart(3, "0")}`;
    if (prog[key]) continue;
    const url = `https://pcg-search.com/card/${dir}/${pre}${String(n).padStart(w, "0")}.php`;
    let title = null, status = 0;
    try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }); status = r.status; if (r.ok) title = ((await r.text()).match(/<title>([^<]*)/) || [])[1] || null; } catch { status = -1; }
    if (status === -1 || status >= 500 || status === 403) { if (++fails >= 3) { console.log("連続3件失敗で停止"); process.exit(1); } await sleep(30000); n--; continue; }
    fails = 0;
    prog[key] = { url, status, title };
    fs.writeFileSync(OUT + ".tmp", JSON.stringify(prog)); fs.renameSync(OUT + ".tmp", OUT);
    await sleep(2000 + Math.random() * 1000);
  }
  console.log(c, "done");
}
console.log("完了", Object.keys(prog).length);
