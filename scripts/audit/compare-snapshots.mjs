#!/usr/bin/env node
// output-snapshot.test.jsx で書き出した2つの出力を比べ、項目ごとに変わった行の数と例を出す（2026-10-14）。
//   node scripts/audit/compare-snapshots.mjs before.json after.json [出力.json] [--examples N]
import fs from "node:fs";

const [a, b, outPath] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const nIdx = process.argv.indexOf("--examples");
const N = nIdx > 0 ? parseInt(process.argv[nIdx + 1], 10) : 5;
const A = JSON.parse(fs.readFileSync(a, "utf8")), B = JSON.parse(fs.readFileSync(b, "utf8"));
const res = { rows: Object.keys(B).length, added: [], removed: [], changed: {} };
for (const id of Object.keys(A)) if (!(id in B)) res.removed.push(id);
for (const id of Object.keys(B)) {
  if (!(id in A)) { res.added.push(id); continue; }
  for (const field of Object.keys(B[id])) {
    const x = JSON.stringify(A[id][field]), y = JSON.stringify(B[id][field]);
    if (x === y) continue;
    const c = (res.changed[field] ??= { count: 0, ids: [], examples: [] });
    c.count++;
    c.ids.push(id);
    if (c.examples.length < N) {
      let before = A[id][field], after = B[id][field];
      if (field === "desc") { // 説明文は変わった行だけ
        const la = before.split("\n"), lb = after.split("\n");
        before = la.filter((l) => !lb.includes(l)); after = lb.filter((l) => !la.includes(l));
      } else if (typeof before === "object") { // Item Specifics・CSV は変わったキーだけ
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        before = Object.fromEntries(keys.map((k) => [k, A[id][field][k]])); after = Object.fromEntries(keys.map((k) => [k, B[id][field][k]]));
      }
      c.examples.push({ id, before, after });
    }
  }
}
for (const [field, c] of Object.entries(res.changed)) console.log(`${field}: ${c.count}行`);
console.log(`追加 ${res.added.length}・削除 ${res.removed.length}`);
if (outPath) fs.writeFileSync(outPath, JSON.stringify(res, null, 1) + "\n");
