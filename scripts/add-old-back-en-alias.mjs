#!/usr/bin/env node
/**
 * 旧裏（Old Back）セットのうち英語名(en)が未登録のものに、収集コミュニティで
 * 一貫して使われている英語通称を enAlias として追加する。
 *
 * setNameEn が既に正しい値を持つセット（PMCG2-4, neo1/neo3/neo4）は対象外
 * （フォールバックが不要なため）。
 *
 * 出典（すべてWeb調査で複数ソースを確認済み。詳細はCLAUDE.md参照）:
 *   PMCG1 拡張パック → "Base Set"（1996年の日本版拡張パックは英語版Base Setの直接の原型）
 *   PMCG5 リーダーズスタジアム → "Leaders' Stadium"
 *     （tcgcollector.com/pokemonplug.com/tcgtower.com等が一貫して使用。
 *     英語版Gym Heroesはこの弾と次弾の内容を再編成したものでカードプールが1:1では
 *     ないため、Gym Heroesという訳語は採用しなかった）
 *   PMCG6 闇からの挑戦 → "Challenge from the Darkness"（同上の理由でGym Challengeは不採用）
 *   neo2 遺跡をこえて... → "Neo Discovery"（Bulbapedia/Fandomで確認、カードプールもほぼ一致）
 *   VS1 ポケモンカード★VS → "Pokemon VS"（Bulbapedia「Pokémon VS (TCG)」。英語版は未発売）
 *   web1 ポケモンカード★web → "Pokemon Web"（Bulbapedia/TCG Collector「Pokémon Web」。英語版は未発売）
 *
 * 使い方: node scripts/add-old-back-en-alias.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");

const EN_ALIAS = {
  PMCG1: "Base Set",
  PMCG5: "Leaders' Stadium",
  PMCG6: "Challenge from the Darkness",
  neo2: "Neo Discovery",
  VS1: "Pokemon VS",
  web1: "Pokemon Web",
};

async function main() {
  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  let count = 0;
  for (const set of cardData) {
    if (EN_ALIAS[set.c]) {
      set.enAlias = EN_ALIAS[set.c];
      count++;
    }
  }
  await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
  console.log(`${count}件のセットにenAliasを追加しました。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
