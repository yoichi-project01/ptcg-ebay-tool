#!/usr/bin/env node
/**
 * !!! DEPRECATED — scripts/detect-contaminated-en-names.py に置き換え済み !!!
 *
 * 単語リスト方式（英語には現れないインドネシア語を列挙する方式）は原理的に検出漏れが
 * 避けられない。実際、外部レビューで "Ursaluna Bulan Merah ex"（正しい英語のポケモン名 +
 * インドネシア語の混成）のような部分混入を含む78件の未検出が確認された。
 * 後継の detect-contaminated-en-names.py は単語ごとの英語/インドネシア語での出現頻度を
 * 統計的に比較する方式（wordfreq）のため、単語列挙が不要で取りこぼしが少ない。
 * 参考として残す。
 *
 * ------------------------------------------------------------------------
 * (以下、元の説明)
 * cardData.json の英語名フィールドにインドネシア語が混入している箇所を検出し、
 * 空文字列にリセットする（誤った情報を出品に使うより、未登録として警告する方が安全なため）。
 *
 * 検出は2つのシグナルの和集合:
 *   1. 「英語のカード名には絶対に現れない」インドネシア語の単語リストとの一致
 *   2. 混入元データに共通して付与されているゼロ幅文字（U+200B〜U+200F, U+2060, U+FEFF）の有無。
 *      "Tara"/"Briar" のように単語リストでは検出できない固有名詞でも、同じ不正な
 *      取り込み経路を通った形跡（ゼロ幅文字）があるものは道連れで空欄化する
 *      （見た目が英語っぽくても出自を信頼できないため）。
 *
 * 単語リストは "hop" のような正規の英語カード名（"<Hop>" 系）と衝突する語を
 * 意図的に除外している。過去に "hop" を含めて誤検知した経緯があるため、
 * 単語を追加する際は英語のポケモンTCGカード名と衝突しないか必ず確認すること。
 *
 * 使い方: node scripts/blank-contaminated-en-names.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

const INDONESIAN_ONLY_WORDS = [
  // 助詞・代名詞・接続詞など
  "yang", "dengan", "untuk", "tidak", "dari", "akan", "adalah", "dapat", "atau", "jika",
  "ini", "itu", "dan", "ke", "pada", "oleh", "sebuah", "sebagai", "mau", "kalah",
  "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "satu",
  "orang", "dia", "mereka", "kita", "kami", "saya", "kamu", "aku", "semua", "setiap",
  "beberapa", "banyak", "sama", "beda", "sendiri", "bersama",
  // カード用語・道具・場所
  "profesor", "penelitian", "anak", "buah", "bintang", "lapangan", "pinggir", "pantai",
  "pembagi", "pengalaman", "pelindung", "dada", "bebatuan", "catatan", "teman", "rompi",
  "keintensan", "skenario", "kartu", "energi", "milik", "lawan", "permainan", "kekuatan",
  "kepala", "ikat", "gelang", "topeng", "jubah", "kacamata", "obor", "lentera", "kompas",
  "gunung", "sungai", "danau", "pulau", "kota", "desa", "jalan", "mobil", "sepeda",
  "kapal", "pesawat", "kereta", "pasir", "purba", "depan", "kaya", "balai", "semangat",
  "pilihan", "dasar", "listrik", "petarung", "daun", "kegelapan", "logam", "pemulihan",
  "pengalih", "stiker", "legasi", "bumerang", "fondasi", "sumur", "tungku", "mesa", "mukun",
  "malapetaka", "keselamatan", "kaku", "mendadak", "darurat", "perbelanjaan",
  "laboratorium", "pengacak", "agung", "besar", "zero", "nol", "obat", "luka", "tas",
  "tarung", "fermentasi", "postwick", "spikemuth", "duri", "istana", "usang", "beri",
  "gemerlap", "moci", "rantai", "manik", "obsesi", "rahasia", "konspirasi", "teknik",
  "pura", "kuil", "menara", "pemacu", "futur", "pengejar", "pengaruh", "pengurang",
  "pemicu", "penambah", "pengurus", "pembersih", "penghubung", "penukar", "pengubah",
  "perisai", "sarung", "jaket", "sepatu", "topi", "ikatan", "ransel", "peti", "kotak",
  "botol", "gelas", "piring", "mangkuk", "sendok", "garpu", "pisau", "jarum", "benang",
  "kain", "wol", "sutra", "emas", "perak", "tembaga", "besi", "baja", "kayu", "batu",
  "tanah", "lumpur", "angin", "api", "bumi", "langit", "matahari", "awan", "hujan",
  "salju", "embun", "kabut", "petir", "guntur", "wujud",
  // 色・様子・数量などの形容詞
  "bulan", "merah", "hijau", "biru", "kuning", "putih", "hitam", "malam", "siang", "pagi",
  "sore", "baru", "lama", "cepat", "lambat", "tinggi", "rendah", "kuat", "lemah", "panas",
  "dingin", "terang", "indah", "buruk", "baik", "jelek", "mudah", "sulit", "ringan",
  "berat", "penuh", "kosong", "dekat", "jauh", "atas", "bawah", "luar", "dalam", "kiri",
  "kanan", "belakang", "biasa", "istimewa", "hati", "murni", "kemurnian", "cahaya",
  "tandu", "tanku", "palu", "granit",
];
const WORD_RE = new RegExp(`\\b(${INDONESIAN_ONLY_WORDS.join("|")})\\b`, "i");
// U+200B-200F（ゼロ幅スペース/結合子/方向指定）, U+2060（単語結合子）, U+FEFF（BOM/ZWNBSP）
const INVISIBLE_CHAR_RE = /[​-‏⁠﻿]/;

function isContaminated(en) {
  return WORD_RE.test(en) || INVISIBLE_CHAR_RE.test(en);
}

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  let count = 0;
  const cleared = new Set();
  for (const set of cardData) {
    for (const k of set.k) {
      const en = k[2];
      if (en && isContaminated(en)) {
        cleared.add(en);
        k[2] = "";
        count++;
      }
    }
  }
  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2), "utf-8");
  console.log(`${count}件のカード、${cleared.size}種類のユニークな汚染文字列を空欄化しました。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
