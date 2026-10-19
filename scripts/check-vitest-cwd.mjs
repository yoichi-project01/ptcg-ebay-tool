// vitest をドライブ文字の大小を変えた場所から起動して、全部のファイルが「reading 'config'」で止まらないか確かめる（2026-10-20、Windows だけ。psa-kaitori の同名のスクリプトと同じ）。
//   node scripts/check-vitest-cwd.mjs [テストのファイル…]（既定は2ファイル。--all で全部）
// 起動の仕方：node <vitest.mjs>・npx vitest・npm test を、作業フォルダが c:\… と C:\… のそれぞれで
import { spawnSync } from "node:child_process";
import path from "node:path";

if (process.platform !== "win32") { console.log("Windows だけで確かめます"); process.exit(0); }
const root = process.cwd();
const variants = [root[0].toLowerCase() + root.slice(1), root[0].toUpperCase() + root.slice(1)];
const args = process.argv.slice(2);
const files = args.includes("--all") ? [] : args.length ? args : ["scripts/filename-utils.test.mjs", "scripts/check-row-alignment.test.mjs"];
let ng = 0;
for (const cwd of variants) {
  const ways = [
    ["node vitest.mjs", process.execPath, [path.join(cwd, "node_modules", "vitest", "vitest.mjs"), "run", ...files], false],
    ["npx vitest", "npx", ["vitest", "run", ...files], true],
    ["npm test", "npm", ["test", "--", ...files], true],
  ];
  for (const [name, cmd, a, shell] of ways) {
    const r = spawnSync(cmd, a, { cwd, encoding: "utf8", shell, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || "") + (r.stderr || "");
    const files_ = out.match(/Test Files[^\n]*/)?.[0]?.trim() ?? "（結果なし）";
    const bad = r.status !== 0 || /reading 'config'/.test(out);
    if (bad) ng++;
    console.log(`${bad ? "NG" : "OK"}  ${JSON.stringify(cwd)} ${name}：${files_}${/reading 'config'/.test(out) ? "（reading 'config'）" : ""}`);
  }
}
console.log(ng ? `NG ${ng}件` : "すべて OK");
process.exit(ng ? 1 : 0);
