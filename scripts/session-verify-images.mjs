#!/usr/bin/env node
// 作業を始めるとき（Claude Code の SessionStart フック、.claude/settings.json）に画像の照合（image-hashes.mjs --verify）を走らせ、結果を短く知らせる（2026-10-15）。
// ビット化けは更新日時が変わらないので、更新日時に頼らずに毎回中身を照合する（約15秒）。結果は Claude Code のフックの JSON（systemMessage と additionalContext）で出す。
//   node scripts/session-verify-images.mjs
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "image-hashes.mjs"), "--verify"], { cwd: ROOT, encoding: "utf8" });
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
const count = (label) => +((out.match(new RegExp(`${label}: (\\d+)件`)) || [])[1] ?? NaN);
const changed = count("中身が変わった"), missing = count("ファイルが無い");
const details = out.split(/\r?\n/).filter((l) => /^\s+\S+\t/.test(l)).slice(0, 10).join("\n");
let msg;
if (Number.isNaN(changed) || Number.isNaN(missing)) msg = `⚠ 画像の照合を実行できませんでした（終了コード ${r.status}）。node scripts/image-hashes.mjs --verify を手で実行してください。`;
else if (changed || missing) msg = `⚠⚠ 画像の照合: 中身が変わった ${changed}件・ファイルが無い ${missing}件。作業の前に元の出どころから取り直して戻してください（CLAUDE.md「作業環境」）。\n${details}`;
else msg = "画像の照合: 中身が変わった 0件・ファイルが無い 0件";
process.stdout.write(JSON.stringify({ systemMessage: msg, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg } }) + "\n");
