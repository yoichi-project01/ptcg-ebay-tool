#!/usr/bin/env node
// CPs-003 シェイミ の英語名を "Shaymin LV.X" にする（2026-10-12）。根拠は cps-003-lvx.json。
//   node scripts/en-name-fix5/fix-cps-003-lvx.mjs
// fill-by-jname.mjs では Bulbapedia の jname「シェイミ」に Shaymin と Shaymin LV.X の両方のページがあり、候補が2つで空欄だった。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildCardKinds } from "../card-kinds/rebuild.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "..", "src", "cardData.json");
const ev = JSON.parse(fs.readFileSync(path.join(__dirname, "cps-003-lvx.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const row = data.find((s) => s.c === "CPs").k.find((r) => r[0] === "003");
if (row[1] !== "シェイミ") throw new Error(`想定と違う行: ${row}`);
if (row[2] === ev.en) { console.log("変更なし"); process.exit(0); }
if (row[2]) throw new Error(`英語名が既に入っている: ${row[2]}`);
row[2] = ev.en;
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
console.log(`CPs-003: "" → ${ev.en}`);
rebuildCardKinds();
