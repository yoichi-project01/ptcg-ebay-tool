#!/usr/bin/env node
// scripts/old-promos/psa-names.json の弾の PSA の表記を scripts/set-psa-names.json に書く（2026-10-15）。  node scripts/old-promos/add-psa-names.mjs ADV-P
import fs from "node:fs";
const src = JSON.parse(fs.readFileSync("scripts/old-promos/psa-names.json", "utf8"));
const F = "scripts/set-psa-names.json";
const raw = fs.readFileSync(F, "utf8");
const j = JSON.parse(raw);
for (const c of process.argv.slice(2)) { j[c] = src[c]; console.log(c, src[c].psaName); }
fs.writeFileSync(F, JSON.stringify(j, null, raw.match(/\n( +)"/)[1].length) + (raw.endsWith("\n") ? "\n" : ""));
