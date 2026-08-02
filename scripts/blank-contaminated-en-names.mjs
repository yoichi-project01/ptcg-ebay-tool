#!/usr/bin/env node
/**
 * cardData.json の英語名フィールドにインドネシア語が混入している箇所を検出し、
 * 空文字列にリセットする（誤った情報を出品に使うより、未登録として警告する方が安全なため）。
 *
 * 検出は「英語のカード名には絶対に現れない」インドネシア語の単語リストに基づく。
 * "hop"/"super"/"gym"/"air"/"transfer"/"reversal"/"teal" など、正規の英語カード名にも
 * 現れうる単語は誤検知を避けるため対象から除外している
 * （実際に "<Hop>" 系の英語カード名を誤検知した経緯があるため要注意）。
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
  "yang", "dengan", "untuk", "tidak", "dari", "akan", "adalah", "dapat", "atau", "jika",
  "ini", "itu", "dan", "ke", "pada", "oleh", "sebuah", "sebagai", "mau", "kalah",
  "profesor", "penelitian", "anak", "buah", "bintang", "lapangan", "pinggir", "pantai",
  "pembagi", "pengalaman", "pelindung", "dada", "bebatuan", "catatan", "teman", "rompi",
  "keintensan", "skenario", "kartu", "energi", "milik", "lawan", "permainan", "kekuatan",
  "kepala", "ikat", "gelang", "topeng", "jubah", "kacamata", "obor", "lentera", "kompas",
  "gunung", "sungai", "danau", "pulau", "kota", "desa", "jalan", "mobil", "sepeda", "kapal",
  "pesawat", "kereta", "pasir", "purba", "depan", "kaya", "balai", "semangat", "pilihan",
  "dasar", "listrik", "petarung", "daun", "kegelapan", "logam", "pemulihan", "pengalih",
  "stiker", "legasi", "bumerang", "fondasi", "sumur", "tungku", "mesa", "mukun",
  "malapetaka", "keselamatan", "kaku", "mendadak", "darurat", "perbelanjaan",
  "laboratorium", "pengacak", "agung", "besar", "zero", "nol", "obat", "luka", "tas",
  "tarung", "fermentasi", "postwick", "spikemuth", "duri", "istana",
];
const RE = new RegExp(`\\b(${INDONESIAN_ONLY_WORDS.join("|")})\\b`, "i");

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  let count = 0;
  const cleared = new Set();
  for (const set of cardData) {
    for (const k of set.k) {
      const en = k[2];
      if (en && RE.test(en)) {
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
