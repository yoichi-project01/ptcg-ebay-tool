// 画像の照合（image-hashes.mjs --verify）と画像の対応表の作り直し（build-image-index.mjs）の安全装置のテスト（2026-10-14）。
// 本物のデータには触れず、一時フォルダにリポジトリと同じ形（scripts/・src/・public/cards/）の小さな見本を作って、スクリプトを別のプロセスで実行する
// （どちらのスクリプトもリポジトリの場所をスクリプトの置き場所から決めるため、コピーすればその見本だけを読む）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
let dir;

const write = (rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const run = (script, ...args) => spawnSync(process.execPath, [path.join(dir, "scripts", script), ...args], { cwd: dir, encoding: "utf8" });
// 画像の中身（MIN_IMAGE_BYTES 500 以上）。seed ごとに違う中身
const img = (seed) => Buffer.alloc(800, seed);

// 見本: 弾 AA（3枚）・BB（2枚）。画像の対応表と SHA-256 の一覧まで作る
function makeSample() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ptcg-image-safety-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const f of ["build-image-index.mjs", "image-hashes.mjs", "filename-utils.mjs"]) fs.copyFileSync(path.join(SCRIPTS, f), path.join(dir, "scripts", f));
  write("src/cardData.json", JSON.stringify([
    { c: "AA", sr: "X", of: 3, k: [["001", "あ", "", "C"], ["002", "い", "", "C"], ["003", "う", "", "C"]] },
    { c: "BB", sr: "X", of: 2, k: [["001", "え", "", "C"], ["002", "お", "", "C"]] },
  ]));
  const files = { "AA/1": "あ_AA-001／3_C", "AA/2": "い_AA-002／3_C", "AA/3": "う_AA-003／3_C", "BB/1": "え_BB-001／2_C", "BB/2": "お_BB-002／2_C" };
  let seed = 1;
  const index = {};
  for (const [key, stem] of Object.entries(files)) {
    const rel = `cards/X/${key.split("/")[0]}/${stem}.jpg`;
    write(`public/${rel}`, img(seed++));
    index[key] = rel;
  }
  write("src/imageIndex.json", JSON.stringify(index));
  const r = run("image-hashes.mjs", "--build");
  expect(r.status, r.stderr).toBe(0);
  return index;
}

beforeEach(() => { dir = null; });
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("image-hashes.mjs --verify", () => {
  it("中身が一覧と同じなら 0件・終了コード 0", () => {
    makeSample();
    const r = run("image-hashes.mjs", "--verify");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("中身が変わった: 0件");
  });
  it("1ビットの反転を見つけて終了コード 1", () => {
    const index = makeSample();
    const p = path.join(dir, "public", index["AA/2"]);
    const buf = fs.readFileSync(p);
    buf[100] ^= 0x80; // 実際に起きているビット化けと同じ形（0x80 のビット）
    fs.writeFileSync(p, buf);
    const r = run("image-hashes.mjs", "--verify");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("中身が変わった: 1件");
    expect(r.stdout).toContain("AA-002");
  });
  it("ファイルが無いときも終了コード 1", () => {
    const index = makeSample();
    fs.rmSync(path.join(dir, "public", index["BB/1"]));
    const r = run("image-hashes.mjs", "--verify");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ファイルが無い: 1件");
  });
});

describe("build-image-index.mjs の安全装置", () => {
  it("件数が2%を超えて減るときは書き込まずに止まる", () => {
    const index = makeSample();
    const before = read("src/imageIndex.json");
    fs.rmSync(path.join(dir, "public", index["AA/3"])); // 5件 → 4件（20%減）
    const r = run("build-image-index.mjs");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("中断");
    expect(read("src/imageIndex.json")).toBe(before);
  });
  it("全体の作り直しで既存のキーの指す先が2%を超えて変わるときは止まる（古い名前のファイルを拾う事故）", () => {
    makeSample();
    const before = read("src/imageIndex.json");
    // 同じ番号の古い名前の .jpg を置く（取り直し前のファイルが残っている形）。.jpg は後から見つかった方が使われる
    write("public/cards/X/AA/古い名前_AA-001／9_C.jpg", img(50));
    write("public/cards/X/AA/古い名前_AA-002／9_C.jpg", img(51));
    const r = run("build-image-index.mjs");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("画像の指す先が変わります");
    expect(read("src/imageIndex.json")).toBe(before);
  });
  it("--only は指定した弾だけ読み直し、ほかの弾・既存のファイルの指す先は変えない", () => {
    const index = makeSample();
    write("public/cards/X/AA/古い名前_AA-001／9_C.jpg", img(50)); // 古い名前のファイルがあっても既存の索引を使い続ける
    fs.rmSync(path.join(dir, "public", index["BB/2"])); // BB は対象外なので消えても索引から消さない
    const r = run("build-image-index.mjs", "--only", "AA");
    expect(r.status, r.stderr).toBe(0);
    const after = JSON.parse(read("src/imageIndex.json"));
    expect(after["AA/1"]).toBe(index["AA/1"]);
    expect(after["BB/2"]).toBe(index["BB/2"]);
    expect(Object.keys(after)).toEqual(Object.keys(index)); // キーの並びも保つ
  });
  it("--only で cardData に無い番号のファイルは索引に足さない", () => {
    makeSample();
    write("public/cards/X/AA/なにか_AA-009／3_C.jpg", img(60));
    const r = run("build-image-index.mjs", "--only", "AA");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(read("src/imageIndex.json"))["AA/9"]).toBeUndefined();
  });
  it("--only で取り直した画像は SHA-256 の一覧も計算し直す（照合が通る）", () => {
    const index = makeSample();
    fs.writeFileSync(path.join(dir, "public", index["AA/1"]), img(70)); // 同じパスのまま取り直した
    expect(run("image-hashes.mjs", "--verify").status).toBe(1);
    expect(run("build-image-index.mjs", "--only", "AA").status).toBe(0);
    expect(run("image-hashes.mjs", "--verify").status).toBe(0);
  });
});
