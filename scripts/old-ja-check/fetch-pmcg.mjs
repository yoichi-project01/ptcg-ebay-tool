// pcg-search.com の PMCG1〜6 のカードページの title と画像を集める（読み取りだけ）。1接続・2〜3秒間隔・再開可能
import fs from "node:fs";
import crypto from "node:crypto";
const OUT = process.argv[2], IMG = process.argv[3];
fs.mkdirSync(IMG, { recursive: true });
const CONF = [["PMCG1","1st1",96],["PMCG2","1st2",48],["PMCG3","1st3",48],["PMCG4","1st4",65],["PMCG5","1stgym1",96],["PMCG6","1stgym2",98]];
const prog = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, bin) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); if (r.status === 404) return { status: 404 }; if (r.ok) return { status: 200, body: bin ? Buffer.from(await r.arrayBuffer()) : await r.text() }; } catch {} await sleep(30000 * (i + 1)); } return { status: -1 }; };
const items = [];
for (const [c, pre, n] of CONF) { for (let i = 1; i <= n; i++) items.push([c, pre, String(i).padStart(3, "0")]); }
for (let i = 1; i <= 6; i++) items.push(["PMCG1", "1st1", "s" + String(i).padStart(3, "0")]);
for (const [c, pre, num] of items) {
  const key = `${c}-${num}`; if (prog[key]) continue;
  const page = await get(`https://pcg-search.com/card/1st/${pre}${num}.php`); await sleep(2000 + Math.random() * 1000);
  const img = await get(`https://pcg-search.com/img/1st/${pre}${num}.png`, true); await sleep(2000 + Math.random() * 1000);
  if (page.status === -1 || img.status === -1) { console.log("取得失敗で停止", key); process.exit(1); }
  const title = page.status === 200 ? ((page.body.match(/<title>([^<]*)/) || [])[1] || null) : null;
  let sha = null; if (img.status === 200) { sha = crypto.createHash("sha256").update(img.body).digest("hex"); fs.writeFileSync(`${IMG}/${key}.png`, img.body); }
  prog[key] = { page: page.status, title, img: img.status, sha };
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(prog)); fs.renameSync(OUT + ".tmp", OUT);
}
console.log("完了", Object.keys(prog).length);
