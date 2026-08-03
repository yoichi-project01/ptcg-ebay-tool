import { useState, useMemo, useEffect, Component } from "react";
import CARD_DATA from "./cardData.json";
import IMAGE_INDEX from "./imageIndex.json";

// ---------- 定数 ----------
const RARITIES = ["", "SAR", "SR", "AR", "UR", "RR", "RRR", "CHR", "CSR", "HR", "SSR", "S", "ACE", "BWR", "R", "U", "C", "PROMO"];
const CONDITIONS = [
  { code: "NM", label: "NM（ほぼ完美品）", en: "Near Mint" },
  { code: "NM/M", label: "NM/M（完美品に近い）", en: "Near Mint / Mint" },
  { code: "LP", label: "LP（軽い使用感）", en: "Lightly Played" },
  { code: "MP", label: "MP（目立つ傷あり）", en: "Moderately Played" },
  { code: "HP", label: "HP（大きなダメージ）", en: "Heavily Played" },
];
const PRODUCT_TYPES = [
  { code: "pack", label: "ブースターパック" },
  { code: "box", label: "ブースターBOX" },
];
const SERIE_ORDER = { M: 0, SV: 1, S: 2, SM: 3, XYb: 4, XY: 5, BW: 6, L: 7, DPt: 8, DP: 9, PCG: 10, ADV: 11, e: 12, VS: 13, web: 14, neo: 15, PMCG: 16 };
// cardData.json の sr（シリーズコード）から英語シリーズ名を引く。現代タイトル生成
// （buildModernTitle）でセット英語名の前に付けて検索露出を上げるために使う。
// 不明な呼称は推測で埋めず、未定義ならタイトル側で単に省略される
// - SV/S: 海外版TCGの正式シリーズ名
// - M: 2025年発表の新シリーズ「Mega Evolution」。The Pokémon Companyの公式プレスリリース
//   （press.pokemon.com "MEDIA ALERT: First Expansion of New Pokémon Trading Card Game:
//   Mega Evolution Series..."）およびBulbapediaで確認済み
// - PCG/PMCG/e/neo/VS/web（旧裏世代）はここでは扱わず、旧裏専用のセット単位 enAlias で対応する
const SERIE_EN_NAMES = {
  SV: "Scarlet & Violet",
  S: "Sword & Shield",
  SM: "Sun & Moon",
  M: "Mega Evolution",
};
// タイトルに "Holo" を追加するレアリティ（現代カードの優先度12）
const HOLO_RARITIES = new Set(["SAR", "SR", "AR", "UR", "RR", "HR", "CHR", "CSR", "SSR"]);
const PRINT_VARIANTS = [
  { code: "", label: "指定しない" },
  { code: "No Rarity", label: "No Rarity（ノーレアリティ・レアリティマークなし）" },
  { code: "1st Edition", label: "1st Edition（初期版・マークあり）" },
  { code: "Unlimited", label: "Unlimited（通常版・マークなし）" },
];
// 1st Edition マークが存在する世代（拡張パック〜ジム拡張2）
const PRINT_VARIANT_SET_RE = /^PMCG[1-6]$/i;
// No Rarity（カード右下のレアリティマークが無い最初期版）が存在するセット。
// 1996年の日本版拡張パック（Base Set）の初回印刷のみに存在することを確認済み
// （PSA/Fanatics Collect等のグレーディング済みカード出品でも "1996 Pokemon Japanese
// Base Set No Rarity Symbol" として一貫して扱われている）。ポケモンジャングル/化石の秘密/
// ロケット団（PMCG2-4）や拡張パック以降のジム弾（PMCG5-6）にはNo Rarity版が存在するという
// 情報源が見つからなかったため対象外とした。1st Editionは引き続きPMCG1-6全体が対象
const NO_RARITY_SET_RE = /^PMCG1$/i;
// 旧裏面（オールドバック）対象セット。新裏に切り替わるのは e シリーズ以降のため
// PMCG（拡張パック〜ジム拡張2）に加え neo1-4 / VS1 / web1 も対象
const OLD_BACK_SET_RE = /^(PMCG[1-6]|neo[1-4]|VS1|web1)$/i;
const GRADING_COMPANIES = ["", "PSA", "BGS", "CGC", "SGC"];
const GRADE_LABELS = {
  "10": "GEM MINT", "9.5": "MINT", "9": "MINT", "8.5": "NM-MT", "8": "NM-MT",
  "7.5": "NM", "7": "NM", "6.5": "EX-MT", "6": "EX-MT", "5.5": "EX", "5": "EX",
  "4": "VG-EX", "3": "VG", "2": "GOOD", "1": "PR",
};
function gradeLabelText(grade) {
  return GRADE_LABELS[String(grade).trim()] || "";
}
const HISTORY_KEY = "ptcg-ebay-tool:history";
const HISTORY_LIMIT = 60;

const DEFAULT_FORM = {
  setNameJa: "", setNameEn: "", setCode: "", shipFrom: "Osaka, Japan", handlingDays: "1-2",
  pokemonJa: "", pokemonEn: "", rarity: "", cardNo: "", condition: "NM", conditionNotes: "",
  printVariant: "", printVariantNote: "", oldBack: false,
  graded: false, gradingCompany: "", grade: "", certNumber: "",
  costJpy: "", extraCostJpy: "", exchangeRate: "155", sellPriceUsd: "", ebayFeePercent: "13.25", ebayFixedFeeUsd: "0.40", shippingCostUsd: "",
  targetMarginPercent: "30", quantity: "1", bestOfferEnabled: false, picUrl: "",
  productType: "pack", cardsPerPack: "", packsPerBox: "30", shrink: true,
};

// 出品ごとに必ず変わる（=カードを切り替えたらリセットすべき）フィールド。
// shipFrom / handlingDays / exchangeRate / ebayFeePercent / ebayFixedFeeUsd は
// 毎回だいたい同じ値を使うので引き継ぐ（PER_LISTING_FIELDSに含めない）
const PER_LISTING_FIELDS = {
  pokemonJa: "", pokemonEn: "", rarity: "", cardNo: "",
  setNameJa: "", setNameEn: "", setCode: "",
  condition: "NM", conditionNotes: "",
  printVariant: "", printVariantNote: "", oldBack: false,
  graded: false, gradingCompany: "", grade: "", certNumber: "",
  costJpy: "", extraCostJpy: "", sellPriceUsd: "", picUrl: "",
};

const holoGrad =
  "linear-gradient(120deg,#7de2ff 0%,#a78bfa 30%,#f9a8d4 55%,#fde68a 80%,#7de2ff 100%)";

// ---------- 検索 ----------
// NFKC\u6b63\u898f\u5316\uff08\u5168\u89d2\u82f1\u6570\u30fb\u5168\u89d2\u8a18\u53f7\u3092\u534a\u89d2\u3078\uff09\u3001\u3072\u3089\u304c\u306a\u2192\u30ab\u30bf\u30ab\u30ca\u3001\u5c0f\u6587\u5b57\u5316\u306e\u307f\u3092\u884c\u3046\u3002
// \u7a7a\u767d\u30fb\u4e2d\u9ed2\u306e\u9664\u53bb\u306f\u30c8\u30fc\u30af\u30f3\u5206\u5272\u3092\u58ca\u3059\u305f\u3081\u3001\u5206\u5272\u5f8c\u306b stripSeparators \u3067\u5225\u9014\u9069\u7528\u3059\u308b
export function normalizeBase(s) {
  return (s || "")
    .normalize("NFKC")
    // \u30bc\u30ed\u5e45\u30b9\u30da\u30fc\u30b9/\u7d50\u5408\u5b50/\u65b9\u5411\u6307\u5b9a(U+200B-200F)\u30fb\u5358\u8a9e\u7d50\u5408\u5b50(U+2060)\u30fbBOM(U+FEFF)\u3092\u9664\u53bb\u3002
    // \u30bf\u30a4\u30c8\u30eb\u3084\u30d5\u30a1\u30a4\u30eb\u540d\u306b\u7d1b\u308c\u8fbc\u3080\u3068\u76ee\u306b\u898b\u3048\u306a\u3044\u307e\u307e\u691c\u7d22\u306b\u5f15\u3063\u304b\u304b\u3089\u306a\u304f\u306a\u308b\u305f\u3081
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    // \u6e7e\u66f2\u30a2\u30dd\u30b9\u30c8\u30ed\u30d5\u30a3/\u5f15\u7528\u7b26(U+2018/2019/201C/201D)\u3092\u76f4\u7dda\u5f62\u306b\u7d71\u4e00\u3002
    // "Farfetch'd" \u306e\u3088\u3046\u306b\u53d6\u308a\u8fbc\u307f\u7d4c\u8def\u306b\u3088\u3063\u3066\u8868\u8a18\u304c\u63fa\u308c\u308b\u305f\u3081\u3001\u691c\u7d22\u5074\u3067\u3082\u5438\u53ce\u3059\u308b
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .toLowerCase()
    .trim();
}
function stripSeparators(s) {
  return s.replace(/[\u30fb\uff65\s]/g, "");
}
function normalize(s) {
  return stripSeparators(normalizeBase(s));
}
function pad3(n) {
  return String(n).padStart(3, "0");
}
// カード名の正規化結果を読み込み時に一度だけキャッシュし、検索のたびに再計算しないようにする
// 日本語名・英語名がどちらも無いカードは名前検索にヒットさせようがないため除外する
const SEARCH_INDEX = CARD_DATA.map((s) => ({
  set: s,
  setKey: normalize(s.ja + " " + s.en + " " + s.c),
  cards: s.k
    .filter((k) => k[1] || k[2])
    .map((k) => {
      const [, ja, en, rarity] = k;
      // ja/en の間には絶対に入力されない区切り文字（U+0000）を挟む。
      // stripSeparators は空白を消すため、単純に " " で連結すると
      // 日本語名と英語名が直結してしまい、英語名側での前方一致判定が効かなくなる
      return {
        k,
        nameKey: normalize(ja) + "\0" + normalize(en),
        jaKey: normalize(ja),
        enKey: normalize(en),
        rarityKey: rarity ? normalize(rarity) : "",
      };
    }),
}));
export function searchCards(query) {
  const tokens = normalizeBase(query).split(/\s+/).filter(Boolean).map(stripSeparators);
  if (tokens.length === 0) return [];
  const results = [];
  for (const { set: s, setKey, cards } of SEARCH_INDEX) {
    for (const { k, nameKey, jaKey, enKey, rarityKey } of cards) {
      let nameScore = 0;
      let ok = true;
      for (const t of tokens) {
        if (nameKey === t) nameScore = Math.max(nameScore, 3);
        else if (jaKey === t || enKey === t) nameScore = Math.max(nameScore, 3);
        else if (nameKey.startsWith(t)) nameScore = Math.max(nameScore, 2);
        else if (nameKey.includes(t)) nameScore = Math.max(nameScore, 1);
        else if (rarityKey && t === rarityKey) nameScore = Math.max(nameScore, 1);
        else if (setKey.includes(t)) nameScore = Math.max(nameScore, 1);
        else { ok = false; break; }
      }
      if (ok && nameScore > 0) results.push({ set: s, card: k, score: nameScore });
    }
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sa = SERIE_ORDER[a.set.sr] ?? 99;
    const sb = SERIE_ORDER[b.set.sr] ?? 99;
    if (sa !== sb) return sa - sb;
    if (a.set.c !== b.set.c) return b.set.c.localeCompare(a.set.c);
    return b.card[0].localeCompare(a.card[0]);
  });
  return results.slice(0, 24);
}
function cardNoOf(setObj, local) {
  if (setObj.of > 0 && /^\d+$/.test(local)) return `${pad3(local)}/${pad3(setObj.of)}`;
  return "";
}
// 候補カード選択時のフォーム更新ロジック（純関数化してテストしやすくする）。
// 英語名・セット英語名が未登録の場合は必ず空文字にする — 前カードの値を引き継ぐと
// 「タイトルは合っているように見えるが実は別カードの英語名」という事故になるため。
// 状態・鑑定情報・仕入れ値等（PER_LISTING_FIELDS）も同じ理由で既定ではリセットする。
// carryOverCondition を true にすると、同じカードの状態違いを連続出品する場合などに
// 状態・鑑定情報・価格を明示的に引き継げる（既定はオフ = 安全側）
export function applyCandidateToForm(prev, r, { carryOverCondition = false } = {}) {
  const [local, ja, en, rarity] = r.card;
  const base = carryOverCondition ? prev : { ...prev, ...PER_LISTING_FIELDS };
  return {
    ...base,
    pokemonJa: ja, pokemonEn: en || "",
    rarity: RARITIES.includes(rarity) ? rarity : "",
    cardNo: cardNoOf(r.set, local), setCode: r.set.c,
    setNameJa: r.set.ja, setNameEn: r.set.en || "",
  };
}
// selectedKey ("setCode/local") からDB上のカード情報を引く。
// 候補選択後にレアリティを手で書き換えていないか確認するために使う
function findDbCard(selectedKey) {
  if (!selectedKey) return null;
  const idx = selectedKey.lastIndexOf("/");
  if (idx < 0) return null;
  const setCode = selectedKey.slice(0, idx);
  const local = selectedKey.slice(idx + 1);
  const set = CARD_DATA.find((s) => s.c === setCode);
  if (!set) return null;
  const card = set.k.find((k) => k[0] === local);
  return card ? { set, card } : null;
}
// ローカルにスクレイピング済み画像があればそのパスを返す
function localImage(setObj, local) {
  const n = parseInt(local, 10);
  const key = `${setObj.c}/${isNaN(n) ? local : n}`;
  return IMAGE_INDEX[key] ? `/${IMAGE_INDEX[key]}` : null;
}

// f.printVariant をそのまま使わず、セットに対して有効な値かどうかを毎回検証する。
// UIの選択肢自体もセットに応じてフィルタしているが、履歴読み込みなどでセットコードだけ
// 後から変わった場合の防御も兼ねる（"No Rarity"はPMCG1のみ、それ以外はPMCG1-6全体）
function resolvePrintVariant(f) {
  if (!PRINT_VARIANT_SET_RE.test(f.setCode)) return "";
  if (f.printVariant === "No Rarity" && !NO_RARITY_SET_RE.test(f.setCode)) return "";
  return f.printVariant;
}

// ---------- タイトル ----------
// 実売タイトルの調査に基づく暫定実装（CLAUDE.md参照）。「この形式で売上が伸びる」という
// 因果関係は検証していない。共通して現れる要素（年号・Japanese・Holo等）は信頼できるが、
// 実際の効果はSeller Hubのインプレッション数等で形式ごとに比較しないと分からない
// 旧裏（Old Back）セットは検索のされ方が根本的に異なるため buildVintageTitle に分岐する
export function buildSingleTitle(f, opts) {
  if (OLD_BACK_SET_RE.test(f.setCode)) return buildLegacyOldBackTitle(f);
  return buildModernTitle(f, opts);
}
// TODO(タスク5): 旧裏専用の buildVintageTitle に置き換え予定。それまでの間、
// 従来のフラットな組み立て（優先度なし・80文字時は呼び出し側の警告表示に依存）を維持する
function buildLegacyOldBackTitle(f) {
  const printVariant = resolvePrintVariant(f);
  const oldBack = OLD_BACK_SET_RE.test(f.setCode) && f.oldBack ? "Old Back" : "";
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  const conditionToken = isGraded
    ? [f.gradingCompany, f.grade.trim(), gradeLabelText(f.grade)].filter(Boolean).join(" ")
    : f.condition;
  return [f.pokemonEn, f.rarity, f.cardNo, f.setCode, f.setNameEn, printVariant, oldBack, "Japanese Pokemon Card", conditionToken]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
// "Pokemon"という単語を含むセット英語名（例: "Pokemon 151"）は、タイトル中の固定文字列
// "Pokemon Card" と重複するため、シリーズ英語名と組み合わせる前に単語ごと取り除く
function buildSetNameToken(setNameEn, serieEn) {
  if (!setNameEn) return "";
  const cleaned = setNameEn.replace(/\bpokemon\b/i, "").replace(/\s+/g, " ").trim() || setNameEn;
  if (serieEn && !cleaned.toLowerCase().includes(serieEn.toLowerCase())) {
    return `${serieEn} ${cleaned}`;
  }
  return cleaned;
}
// 削除可能な4要素（優先度9〜12）の内部キー→UI表示用の日本語ラベル
const MODERN_TITLE_DROPPABLE_LABELS = {
  setName: "セット英語名", year: "発売年", holo: "Holo", rarityFull: "レアリティのフルスペル",
};
// 現代カード（旧裏以外）向けのタイトル組み立て本体。要素を優先度順の配列にし、
// maxLengthを超えたら削除可能な要素を優先度の低いものから1つずつ落とす。
// UI側で「何を省略したか」を表示できるよう、落とした要素のキーも一緒に返す
function assembleModernTitle(f, maxLength) {
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  const gradedToken = isGraded
    ? [f.gradingCompany, f.grade.trim(), gradeLabelText(f.grade)].filter(Boolean).join(" ")
    : "";
  const setData = CARD_DATA.find((s) => s.c === f.setCode);
  const serieEn = (setData && SERIE_EN_NAMES[setData.sr]) || "";
  const setNameToken = buildSetNameToken(f.setNameEn, serieEn);
  const year = setData?.y ? String(setData.y) : "";
  const rarityFull = f.rarity ? (RARITY_EN_LABELS[f.rarity] || "") : "";
  const holo = HOLO_RARITIES.has(f.rarity);

  // 削除可能な4要素（優先度9〜12）。true/falseで含めるかどうかを切り替える
  const include = { setName: Boolean(setNameToken), year: Boolean(year), holo, rarityFull: Boolean(rarityFull) };
  const assemble = () => [
    gradedToken, // 1. 鑑定情報（鑑定品のみ、先頭）
    f.pokemonEn, // 2. カード名
    f.rarity, // 3. レアリティ略号
    f.cardNo, // 4. カード番号
    "Japanese", // 5.
    f.setCode, // 6. セット型番
    "Pokemon Card", // 7.
    isGraded ? "" : f.condition, // 8. 状態（未鑑定のみ）
    include.setName ? setNameToken : "", // 9. セット英語名（削除可）
    include.year ? year : "", // 10. 発売年（削除可）
    include.holo ? "Holo" : "", // 11.（削除可）
    include.rarityFull ? rarityFull : "", // 12. レアリティフルスペル（削除可）
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  let title = assemble();
  const dropped = [];
  // 優先度の低いものから順に1要素ずつ落とす。優先度8までの要素は落とさない
  for (const key of ["rarityFull", "holo", "year", "setName"]) {
    if (title.length <= maxLength) break;
    if (include[key]) {
      include[key] = false;
      dropped.push(key);
      title = assemble();
    }
  }
  return { title, dropped };
}
export function buildModernTitle(f, { maxLength = 80 } = {}) {
  return assembleModernTitle(f, maxLength).title;
}
// 80文字に収めるために省略した要素（セット英語名・発売年・Holo・レアリティフルスペル）を
// 日本語ラベルの配列で返す。UI側で「何を省略したか」を表示するために使う
// （旧裏セットはbuildLegacyOldBackTitle側で扱うため常に空配列）
export function getDroppedModernTitleParts(f, { maxLength = 80 } = {}) {
  if (OLD_BACK_SET_RE.test(f.setCode)) return [];
  return assembleModernTitle(f, maxLength).dropped.map((key) => MODERN_TITLE_DROPPABLE_LABELS[key]);
}
function buildPackTitle(f) {
  const type = f.productType === "box" ? "Booster Box" : "Booster Pack";
  return ["Pokemon Card", f.setNameEn, f.setCode, "Japanese", "Factory Sealed", type,
    f.productType === "box" && f.shrink ? "w/ Shrink" : ""]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// ---------- アイテムスペシフィック ----------
// 日本語の短縮レアリティ表記をeBayの出品で一般的に使われる英語表記に変換する。
// SV世代（Art Rare/Special Art Rare/Double Rare/Triple Rare/Ultra Rare/Hyper Rare/
// ACE SPEC Rare）は英語版TCGの公式レアリティ名と一致するが、それ以外の世代
// （SR/CHR/CSR/SSR/S/BWR等）は日本語圏コミュニティの慣用訳のベストエフォート
export const RARITY_EN_LABELS = {
  SAR: "Special Art Rare", SR: "Special Rare", AR: "Art Rare", UR: "Ultra Rare",
  RR: "Double Rare", RRR: "Triple Rare", CHR: "Character Rare", CSR: "Character Super Rare",
  HR: "Hyper Rare", SSR: "Shiny Super Rare", S: "Shiny", ACE: "ACE SPEC Rare",
  BWR: "Black White Rare", R: "Rare", U: "Uncommon", C: "Common", PROMO: "Promo",
};
// eBayの未鑑定シングルカード用コンディション記述子（2023年10月〜の新体系）のラベル文字列。
// ※ File Exchange CSV等で必要になる数値ConditionID/DescriptionIDは提供元・カテゴリ
// 依存で確度を持って断定できないため、ラベル文字列のみを扱う（UI表示・CSVコメント用）
export const CONDITION_DESCRIPTOR_LABELS = {
  "NM": "Near Mint or Better", "NM/M": "Near Mint or Better",
  "LP": "Excellent", "MP": "Very Good", "HP": "Poor",
};
// "Charizard ex" -> "Charizard" のように接尾辞（ex/EX/GX/V/VMAX/VSTAR/V-UNION）を除去する。
// 長い接尾辞から先に判定しないと "VMAX" が "V" にマッチして壊れるため順序に注意
// 既知の制約: cardData.json にカード種別（Pokemon/Trainer/Energy）の情報が無いため、
// トレーナーズ/エネルギーカードにもこの関数がそのまま適用され、eBayのItem Specifics上で
// 本来空欄であるべき "Character" にトレーナー名がそのまま入ってしまう
// （例: "Night Stretcher" というグッズカードでも Character: "Night Stretcher" と出力される）。
// 種別データを取得できれば buildItemSpecifics 側で Pokemon 以外は Character を出さないよう
// できるが、TCGdexから12,654枚分のcategoryを個別取得する必要がありこのセッションでは未対応
function extractCharacter(en) {
  if (!en) return "";
  return en.replace(/\s+(VMAX|VSTAR|V-UNION|GX|EX|ex)$/, "").replace(/\s+V$/, "").trim();
}
// eBayのCondition欄（Ungraded/Graded）でどの選択肢を選ぶべきかを案内する短い文
export function buildConditionGuide(f) {
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  if (isGraded) {
    return `eBayでは「Graded」を選択 → Professional Grader: ${f.gradingCompany} / Grade: ${f.grade.trim()}`;
  }
  const label = CONDITION_DESCRIPTOR_LABELS[f.condition];
  return label ? `eBayでは「Ungraded」を選択 → Card Condition: ${label}` : "";
}
// フォームの内容からeBayのItem Specifics（項目名と値のペア）を組み立てる。
// 値が空になる項目（データ未登録・該当なし）は出力しない
export function buildItemSpecifics(f) {
  const setData = CARD_DATA.find((s) => s.c === f.setCode);
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  const features = [];
  if (OLD_BACK_SET_RE.test(f.setCode) && f.oldBack) features.push("Old Back");
  const printVariant = resolvePrintVariant(f);
  if (printVariant === "1st Edition" || printVariant === "No Rarity") features.push(printVariant);

  const pairs = [
    ["Game", "Pokémon TCG"],
    ["Card Name", f.pokemonEn],
    ["Character", extractCharacter(f.pokemonEn)],
    ["Set", f.setNameEn],
    ["Card Number", f.cardNo],
    ["Rarity", f.rarity ? (RARITY_EN_LABELS[f.rarity] || f.rarity) : ""],
    ["Language", "Japanese"],
    ["Manufacturer", "The Pokémon Company"],
    ["Graded", f.graded ? "Yes" : "No"],
  ];
  if (isGraded) {
    pairs.push(["Professional Grader", f.gradingCompany]);
    pairs.push(["Grade", f.grade.trim()]);
    if (f.certNumber.trim()) pairs.push(["Certification Number", f.certNumber.trim()]);
  } else {
    pairs.push(["Card Condition", CONDITION_DESCRIPTOR_LABELS[f.condition] || ""]);
  }
  if (features.length) pairs.push(["Features", features.join(", ")]);
  if (setData?.y) pairs.push(["Year Manufactured", String(setData.y)]);

  return pairs.filter(([, value]) => value);
}

// ---------- SKU（カスタムラベル） ----------
// 在庫管理・CSV出品・写真ファイル名で共通して使えるSKUを機械的に組み立てる。
// 例: SV2a-201-NM / PMCG1-004-1ST-PSA10
export function buildSku(f, mode) {
  const parts = mode === "pack"
    ? [f.setCode, f.productType === "box" ? "BOX" : "PACK"]
    : [
        f.setCode,
        f.cardNo ? f.cardNo.split("/")[0] : "",
        f.graded && f.gradingCompany && f.grade.trim() ? `${f.gradingCompany}${f.grade.trim()}` : f.condition,
        resolvePrintVariant(f) === "1st Edition" ? "1ST" : "",
        resolvePrintVariant(f) === "No Rarity" ? "NR" : "",
      ];
  return parts.filter(Boolean).join("-").replace(/[^\w-]/g, "").toUpperCase();
}

// ---------- 出品キュー / CSV一括アップロード ----------
// eBayカテゴリ「CCG Individual Cards」。ユーザー確認済みの値
export const CSV_CATEGORY_ID = "183454";
// eBayのConditionID（2023年10月以降のトレーディングカード新コンディション体系）。
// カテゴリ・地域・アカウントの状況により実際の値が異なる可能性があるため、
// CSVを本番アップロードする前に必ずeBayのFile Exchangeテンプレート（またはReportsタブの
// ダウンロード用テンプレート）で最新の値を確認し、必要ならこの定数を書き換えること
export const CSV_CONDITION_ID = { graded: "2750", ungraded: "4000" };
// 2023年10月〜のCondition Descriptor（未鑑定シングルカードは必須）。
// 列ヘッダー自体にdescriptorのIDを埋め込むFile Exchangeの記法に従う。
// 未鑑定側（Card Condition）の値IDは判明しているが、鑑定品側（Professional Grader /
// Grade）の選択肢ごとの値ID（PSA/BGS/CGC/SGCや10/9.5等の個別ID）は未確認のため、
// 列は用意するが値は空欄のままにしてある。本番アップロード前にeBayのCondition
// Descriptor IDsドキュメントで実際の値を確認し、CSV_GRADED_DESCRIPTOR_VALUE_IDS等の
// 定数を追加してから埋めること（未確認のまま推測値を入れるのは事故のもと）
const CSV_UNGRADED_CONDITION_COLUMN = "CD:Card Condition - (ID: 40001)";
const CSV_GRADED_GRADER_COLUMN = "CD:Professional Grader - (ID: 27501)";
const CSV_GRADED_GRADE_COLUMN = "CD:Grade - (ID: 27502)";
const CSV_GRADED_CERT_COLUMN = "CD:Certification Number - (ID: 27503)";
const CSV_UNGRADED_CONDITION_VALUE_IDS = {
  "NM": "400010", "NM/M": "400010", "LP": "400011", "MP": "400012", "HP": "400013",
};
const CSV_COLUMNS = [
  "Action", "CustomLabel", "Category", "Title", "Description", "ConditionID",
  CSV_UNGRADED_CONDITION_COLUMN, CSV_GRADED_GRADER_COLUMN, CSV_GRADED_GRADE_COLUMN,
  CSV_GRADED_CERT_COLUMN,
  "Format", "Duration", "StartPrice", "Quantity", "BestOfferEnabled", "PicURL",
  "ShippingProfileName", "ReturnProfileName", "PaymentProfileName",
  "C:Card Name", "C:Character", "C:Set", "C:Card Number", "C:Rarity", "C:Language",
  "C:Manufacturer", "C:Graded", "C:Professional Grader", "C:Grade",
  "C:Certification Number", "C:Card Condition", "C:Features", "C:Year Manufactured",
];
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// eBayのDescription列はHTMLとして描画されるため、プレーンテキストの改行を<br>に変換する。
// 画面表示用のプレーンテキスト（desc）とは別に、CSV出力時だけ変換する
function descToHtml(text) {
  const escaped = String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.split("\n").join("<br>");
}
// 1件の出品キューエントリからCSVの1行分（列名→値）を組み立てる
export function buildListingCsvRow(entry) {
  const specifics = Object.fromEntries(buildItemSpecifics(entry.f));
  const isGraded = entry.f.graded && entry.f.gradingCompany && entry.f.grade?.trim();
  return {
    Action: "Add",
    CustomLabel: entry.sku,
    Category: CSV_CATEGORY_ID,
    Title: entry.title,
    Description: descToHtml(entry.desc),
    ConditionID: isGraded ? CSV_CONDITION_ID.graded : CSV_CONDITION_ID.ungraded,
    [CSV_UNGRADED_CONDITION_COLUMN]: isGraded ? "" : (CSV_UNGRADED_CONDITION_VALUE_IDS[entry.f.condition] || ""),
    // 鑑定品側は値ID未確認のため空欄（上記コメント参照）。手動で埋めるかeBayテンプレート確認後に対応
    [CSV_GRADED_GRADER_COLUMN]: "",
    [CSV_GRADED_GRADE_COLUMN]: "",
    [CSV_GRADED_CERT_COLUMN]: "",
    Format: "FixedPrice",
    Duration: "GTC",
    StartPrice: entry.f.sellPriceUsd || "",
    Quantity: entry.f.quantity || "1",
    BestOfferEnabled: entry.f.bestOfferEnabled ? "1" : "0",
    PicURL: entry.f.picUrl || "",
    // ビジネスポリシー名はアカウント固有のため既定値を持たない。CSV編集時か
    // eBay側テンプレートで手動入力すること
    ShippingProfileName: "",
    ReturnProfileName: "",
    PaymentProfileName: "",
    "C:Card Name": specifics["Card Name"] || "",
    "C:Character": specifics["Character"] || "",
    "C:Set": specifics["Set"] || "",
    "C:Card Number": specifics["Card Number"] || "",
    "C:Rarity": specifics["Rarity"] || "",
    "C:Language": specifics["Language"] || "",
    "C:Manufacturer": specifics["Manufacturer"] || "",
    "C:Graded": specifics["Graded"] || "",
    "C:Professional Grader": specifics["Professional Grader"] || "",
    "C:Grade": specifics["Grade"] || "",
    "C:Certification Number": specifics["Certification Number"] || "",
    "C:Card Condition": specifics["Card Condition"] || "",
    "C:Features": specifics["Features"] || "",
    "C:Year Manufactured": specifics["Year Manufactured"] || "",
  };
}
// 出品キュー配列からFile Exchange形式に近いCSV文字列を組み立てる（ヘッダー行つき、CRLF区切り）。
// 先頭にUTF-8 BOMを付与し、Excelで開いた際の文字化けを防ぐ
export function buildListingCsv(entries) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    const row = buildListingCsvRow(entry);
    lines.push(CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

// ---------- eBay相場検索 ----------
function buildEbaySearchQuery(f, mode) {
  if (mode === "single") {
    return [f.pokemonEn, f.rarity, f.cardNo, f.setCode].filter(Boolean).join(" ");
  }
  const type = f.productType === "box" ? "Booster Box" : "Booster Pack";
  return [f.setNameEn, f.setCode, "Japanese", type].filter(Boolean).join(" ");
}
function buildEbaySearchUrl(query, { sold = false } = {}) {
  if (!query.trim()) return "";
  const params = new URLSearchParams({ _nkw: query });
  if (sold) { params.set("LH_Sold", "1"); params.set("LH_Complete", "1"); }
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// ---------- 利益計算 ----------
export function calcProfit(f) {
  const rate = parseFloat(f.exchangeRate);
  const sellPriceUsd = parseFloat(f.sellPriceUsd);
  if (!rate || rate <= 0 || !sellPriceUsd || sellPriceUsd <= 0) return null;
  const costJpy = parseFloat(f.costJpy) || 0;
  const extraCostJpy = parseFloat(f.extraCostJpy) || 0;
  const feePercent = parseFloat(f.ebayFeePercent) || 0;
  const fixedFeeUsd = parseFloat(f.ebayFixedFeeUsd) || 0;
  const shippingCostUsd = parseFloat(f.shippingCostUsd) || 0;

  const costUsd = (costJpy + extraCostJpy) / rate;
  const feeUsd = sellPriceUsd * (feePercent / 100) + fixedFeeUsd;
  const profitUsd = sellPriceUsd - feeUsd - shippingCostUsd - costUsd;
  const marginPercent = (profitUsd / sellPriceUsd) * 100;
  return { costUsd, feeUsd, profitUsd, marginPercent, profitJpy: profitUsd * rate };
}
// calcProfit の逆算版: 目標利益率を満たす最低限の売値（USD）を求める。
// profit = sell - (sell*fee% + fixedFee) - shipping - cost = sell * targetMargin
// を sell について解くと sell = (fixedFee + shipping + cost) / (1 - fee% - targetMargin)
export function computeRecommendedPrice(f, targetMarginPercent) {
  const rate = parseFloat(f.exchangeRate);
  const margin = parseFloat(targetMarginPercent) / 100;
  if (!rate || rate <= 0 || isNaN(margin)) return null;
  const costJpy = parseFloat(f.costJpy) || 0;
  const extraCostJpy = parseFloat(f.extraCostJpy) || 0;
  const feePercent = parseFloat(f.ebayFeePercent) || 0;
  const fixedFeeUsd = parseFloat(f.ebayFixedFeeUsd) || 0;
  const shippingCostUsd = parseFloat(f.shippingCostUsd) || 0;
  const costUsd = (costJpy + extraCostJpy) / rate;
  const denom = 1 - feePercent / 100 - margin;
  if (denom <= 0) return null; // 手数料率+目標利益率が100%以上では解なし
  return (fixedFeeUsd + shippingCostUsd + costUsd) / denom;
}
// 心理的価格（X.99）に切り上げる。必ず入力値以上になるよう切り上げるため、
// 目標利益率を満たさなくなることはない
export function roundUpToPsychologicalPrice(usd) {
  if (usd == null || !isFinite(usd)) return null;
  let v = Math.floor(usd) + 0.99;
  if (v < usd) v += 1;
  return Math.round(v * 100) / 100;
}

// ---------- 出品履歴（localStorage） ----------
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e === "object" && e.f && e.id);
  } catch {
    return [];
  }
}
function saveHistoryToStorage(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {}
}
// history・queue の両方で使う: entry.f から画像パスを引く
function entryImage(entry) {
  const local = entry.f.cardNo ? entry.f.cardNo.split("/")[0] : "";
  const n = parseInt(local, 10);
  if (!entry.f.setCode || isNaN(n)) return null;
  const key = `${entry.f.setCode}/${n}`;
  return IMAGE_INDEX[key] ? `/${IMAGE_INDEX[key]}` : null;
}

// ---------- 出品キュー（localStorage） ----------
const QUEUE_KEY = "ptcg-ebay-tool:queue";
function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e === "object" && e.f && e.id);
  } catch {
    return [];
  }
}
function saveQueueToStorage(list) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch {}
}

// ---------- 説明文 ----------
function buildSingleDesc(f) {
  const notes = f.conditionNotes.trim();
  const inScope = PRINT_VARIANT_SET_RE.test(f.setCode);
  const printVariant = resolvePrintVariant(f);
  const printNote = inScope ? f.printVariantNote.trim() : "";
  const oldBack = OLD_BACK_SET_RE.test(f.setCode) && f.oldBack;
  const isGraded = f.graded && f.gradingCompany && f.grade.trim();
  const label = isGraded ? gradeLabelText(f.grade) : "";
  const certNumber = isGraded ? f.certNumber.trim() : "";

  let conditionLine;
  if (isGraded) {
    conditionLine = `Professionally Graded — ${f.gradingCompany} ${f.grade.trim()}${label ? ` (${label})` : ""}`;
  } else {
    const cond = CONDITIONS.find((c) => c.code === f.condition);
    conditionLine = `${cond ? `${cond.en} (${cond.code})` : f.condition || "See photos"} — please see photos for the actual condition.`;
  }

  const conditionNotesBlock = isGraded
    ? `${notes ? `- ${notes}` : "- No notes on the slab/case. Please check all photos before purchase."}
- Card is professionally graded and sealed in its original ${f.gradingCompany} holder.
- Shipped securely wrapped in bubble wrap inside a rigid box.`
    : `${notes ? `- ${notes}` : "- No major flaws noted. Please check all photos before purchase."}
- Stored in a smoke-free environment, kept sleeved.`;

  return `Thank you for checking out my listing!

■ Card Details
- Card: ${f.pokemonEn || "[Pokemon name]"} ${f.rarity || ""} ${f.cardNo || ""}
- Set: ${f.setNameEn || "[Set name]"}${f.setCode ? ` (${f.setCode})` : ""}
- Language: Japanese
${printVariant ? `- Print: ${printVariant}\n` : ""}${oldBack ? `- Back Design: Old Back (旧裏)\n` : ""}${printNote ? `- Print Note: ${printNote}\n` : ""}- Condition: ${conditionLine}
${certNumber ? `- Certification #: ${certNumber}\n` : ""}- The exact card pictured is the one you will receive.

■ Condition Notes
${conditionNotesBlock}

■ Shipping from Japan
- Ships from ${f.shipFrom || "Japan"} within ${f.handlingDays || "1-2"} business days
- Protected with a penny sleeve + toploader, waterproof packaging and a rigid mailer
- Tracking number provided for all orders
- Estimated delivery: 7-14 days depending on your country and customs

Please feel free to message me with any questions.
Thank you and happy collecting!`;
}
function buildPackDesc(f) {
  const isBox = f.productType === "box";
  const item = isBox
    ? `1x Factory Sealed Booster Box${f.packsPerBox ? ` (${f.packsPerBox} packs)` : ""}${f.shrink ? ", shrink wrap intact" : ""}`
    : `1x Factory Sealed Booster Pack${f.cardsPerPack ? ` (${f.cardsPerPack} cards per pack)` : ""}`;
  return `Thank you for visiting my listing!

■ Item Description
- Pokemon Card Game — Japanese version
- Set: ${f.setNameEn || "[Set name]"}${f.setCode ? ` (${f.setCode})` : ""}
- ${item}
- Language: Japanese
- Condition: New / Factory Sealed, never opened
- Our packs are NEVER weighed or searched — pulled directly from a sealed booster box

■ Shipping from Japan
- Ships from ${f.shipFrom || "Japan"} within ${f.handlingDays || "1-2"} business days
- All items shipped with a tracking number
- Protected with rigid materials and waterproof packaging
- Estimated delivery: 7-14 days (varies by country and customs)

■ Note
- Pull results (which cards you get) are based on luck — no refunds based on pack contents
- If you have any questions, feel free to message me. I usually reply within 24 hours

Thank you for looking! Happy collecting!`;
}

// ---------- クリップボード ----------
async function copyText(text, setDone) {
  try {
    await navigator.clipboard.writeText(text);
    setDone(true);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); setDone(true); } finally { document.body.removeChild(ta); }
  }
  setTimeout(() => setDone(false), 1600);
}

// ---------- UI部品 ----------
function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#3b4256", letterSpacing: "0.04em", marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 11, color: "#8b93a7", marginTop: 4 }}>{hint}</span>}
    </label>
  );
}
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1.5px solid #d9deea", background: "#fff", fontSize: 14, color: "#1a2238", outline: "none",
};
function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => copyText(text, setDone)} style={{
      padding: "8px 16px", borderRadius: 999, border: "none", cursor: "pointer",
      fontSize: 13, fontWeight: 700, color: done ? "#0a6e3f" : "#fff",
      background: done ? "#d3f5e3" : "#1a2238", transition: "all .2s",
    }}>{done ? "コピーしました ✓" : label}</button>
  );
}
// アイテムスペシフィックの1行（ラベル・値・小さいコピーボタン）
function FragmentRow({ label, value }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#5b6478", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "#1a2238", wordBreak: "break-word" }}>{value}</span>
      <button onClick={() => copyText(value, setDone)} style={{
        padding: "3px 10px", borderRadius: 999, border: "1.5px solid #e4e8f2", cursor: "pointer",
        fontSize: 10.5, fontWeight: 700, color: done ? "#0a6e3f" : "#5b6478",
        background: done ? "#d3f5e3" : "#fafbfe", whiteSpace: "nowrap",
      }}>{done ? "✓" : "コピー"}</button>
    </>
  );
}
function CardImage({ src, name }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div style={{
        width: "100%", aspectRatio: "63/88", borderRadius: 8,
        background: "linear-gradient(160deg,#e8ebf4,#d5daea)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 8, boxSizing: "border-box",
      }}>
        <span style={{ fontSize: 11, color: "#5b6478", textAlign: "center", lineHeight: 1.5 }}>
          {name}<br /><span style={{ fontSize: 10, color: "#8b93a7" }}>画像なし</span>
        </span>
      </div>
    );
  }
  return (
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} style={{
      width: "100%", aspectRatio: "63/88", objectFit: "contain", borderRadius: 8, background: "#eef0f7", display: "block",
    }} />
  );
}

// ---------- エラーバウンダリ ----------
// 履歴に古いスキーマのデータが残っていた場合など、想定外のエラーで
// 画面全体が真っ白になるのを防ぎ、リセット手段を提示する
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "#f2f4f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ maxWidth: 480, background: "#fff", borderRadius: 16, padding: "24px 26px", boxShadow: "0 1px 4px rgba(26,34,56,.06)" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800, color: "#a3352b" }}>予期しないエラーが発生しました</h2>
            <p style={{ fontSize: 13, color: "#5b6478", lineHeight: 1.7 }}>
              保存済みの出品履歴に古い形式のデータが含まれている可能性があります。ページを再読み込みしてください。
            </p>
            <pre style={{ fontSize: 11, color: "#8b93a7", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(this.state.error?.message || this.state.error)}</pre>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button onClick={() => location.reload()} style={{
                padding: "8px 16px", borderRadius: 999, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700, color: "#fff", background: "#1a2238",
              }}>再読み込み</button>
              <button onClick={() => { try { localStorage.removeItem(HISTORY_KEY); } catch {} location.reload(); }} style={{
                padding: "8px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
                fontSize: 13, fontWeight: 700, color: "#a3352b", background: "#fff",
              }}>履歴をクリアして再読み込み</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------- メイン ----------
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const [mode, setMode] = useState("single");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCandidates, setShowCandidates] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const [carryOverCondition, setCarryOverCondition] = useState(false);
  const imageCount = Object.keys(IMAGE_INDEX).length;

  const [f, setF] = useState(DEFAULT_FORM);
  const set = (k) => (e) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const [history, setHistory] = useState(() => loadHistory());
  const [historyFilter, setHistoryFilter] = useState("");
  const [historySaved, setHistorySaved] = useState(false);

  const [queue, setQueue] = useState(() => loadQueue());
  const [queueSaved, setQueueSaved] = useState(false);
  const [lotCostJpy, setLotCostJpy] = useState("");

  const [profitOpen, setProfitOpen] = useState(() => {
    try { return localStorage.getItem("ptcg-ebay-tool:profitOpen") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("ptcg-ebay-tool:profitOpen", profitOpen ? "1" : "0"); } catch {}
  }, [profitOpen]);

  const candidates = useMemo(
    () => (searchQuery.trim().length >= 2 ? searchCards(searchQuery) : []),
    [searchQuery]
  );
  const title = useMemo(() => (mode === "single" ? buildSingleTitle(f) : buildPackTitle(f)), [mode, f]);
  const generatedDesc = useMemo(() => (mode === "single" ? buildSingleDesc(f) : buildPackDesc(f)), [mode, f]);
  // 説明文の手動編集（textarea）。フォーム内容が変わったら再生成された説明文に戻す
  const [descOverride, setDescOverride] = useState(null);
  useEffect(() => { setDescOverride(null); }, [mode, f]);
  const desc = descOverride ?? generatedDesc;
  const over = title.length > 80;
  // 80文字に収めるために自動的に省略された要素（セット英語名・発売年・Holo・
  // レアリティフルスペル）。自動調整が入るため通常は over が発火しなくなるが、
  // 何が削られたのかは分かるようにしておく
  const droppedTitleParts = useMemo(
    () => (mode === "single" ? getDroppedModernTitleParts(f) : []),
    [mode, f]
  );
  // セット英語名は buildPackTitle でも使われるため両モード共通、ポケモン名はシングル限定
  const missingSetEn = !f.setNameEn.trim();
  const missingPokemonEn = mode === "single" && !f.pokemonEn.trim();
  const missingEn = missingPokemonEn || missingSetEn;
  const ebayQuery = useMemo(() => buildEbaySearchQuery(f, mode), [f, mode]);
  const ebaySoldUrl = useMemo(() => buildEbaySearchUrl(ebayQuery, { sold: true }), [ebayQuery]);
  const ebayActiveUrl = useMemo(() => buildEbaySearchUrl(ebayQuery), [ebayQuery]);
  const profit = useMemo(() => calcProfit(f), [f]);
  const recommendedPrice = useMemo(() => {
    const raw = computeRecommendedPrice(f, f.targetMarginPercent);
    return raw != null ? roundUpToPsychologicalPrice(raw) : null;
  }, [f]);
  // 同じセット・レアリティで直近に出品した売値を履歴から探す（価格決定の参考用）
  const priceHistoryHint = useMemo(() => {
    if (mode !== "single" || !f.setCode) return null;
    const match = history.find((h) => h.mode === "single" && h.f?.setCode === f.setCode && h.f?.rarity === f.rarity && h.f?.sellPriceUsd);
    return match ? { price: match.f.sellPriceUsd, savedAt: match.savedAt } : null;
  }, [history, mode, f.setCode, f.rarity]);
  // 鑑定品はCSVのCondition Descriptor値ID（鑑定会社/グレード）が未確認のまま空欄出力される
  // ため、そのままアップロードするとその行がエラーになる。キュー内の該当件数を数えて警告表示する
  const gradedInQueue = useMemo(() => queue.filter((e) => e.f.graded).length, [queue]);
  const itemSpecifics = useMemo(() => (mode === "single" ? buildItemSpecifics(f) : []), [mode, f]);
  const itemSpecificsText = useMemo(
    () => itemSpecifics.map(([label, value]) => `${label}: ${value}`).join("\n"),
    [itemSpecifics]
  );
  const conditionGuide = useMemo(() => (mode === "single" ? buildConditionGuide(f) : ""), [mode, f]);
  const sku = useMemo(() => buildSku(f, mode), [f, mode]);
  const allInOneText = useMemo(
    () => [`【Title】\n${title}`, `【Description】\n${desc}`, itemSpecificsText && `【Item Specifics】\n${itemSpecificsText}`]
      .filter(Boolean).join("\n\n"),
    [title, desc, itemSpecificsText]
  );

  // 候補選択後にレアリティ/カード番号を手で書き換えていないか確認する
  const dbCard = useMemo(() => findDbCard(selectedKey), [selectedKey]);
  const rarityMismatch = mode === "single" && dbCard?.card[3] && f.rarity && f.rarity !== dbCard.card[3]
    ? dbCard.card[3] : null;
  const cardNoWarning = useMemo(() => {
    const m = mode === "single" && f.cardNo.match(/^(\d+)\/(\d+)$/);
    if (!m) return null;
    const [, n, tot] = m;
    return parseInt(n, 10) > parseInt(tot, 10) ? `カード番号(${n})がセット総数(${tot})を超えています` : null;
  }, [mode, f.cardNo]);

  const saveCurrentToHistory = () => {
    // 直前のエントリと内容が同じなら重複保存しない
    if (history[0] && history[0].mode === mode && history[0].title === title && history[0].desc === desc) {
      return;
    }
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      savedAt: new Date().toISOString(),
      mode, f, title, desc,
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, HISTORY_LIMIT);
      saveHistoryToStorage(next);
      return next;
    });
  };
  const handleSaveClick = () => {
    saveCurrentToHistory();
    setHistorySaved(true);
    setTimeout(() => setHistorySaved(false), 1600);
  };
  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim();
    if (!q) return history;
    const nq = normalize(q);
    return history.filter((e) => normalize(`${e.f.pokemonJa} ${e.f.pokemonEn} ${e.f.setNameJa} ${e.f.setNameEn}`).includes(nq));
  }, [history, historyFilter]);
  const loadFromHistory = (entry) => {
    setMode(entry.mode === "pack" ? "pack" : "single");
    setF({ ...DEFAULT_FORM, ...(entry.f || {}) });
    const local = entry.f?.cardNo ? entry.f.cardNo.split("/")[0] : "";
    const n = parseInt(local, 10);
    setSelectedKey(entry.f?.setCode && !isNaN(n) ? `${entry.f.setCode}/${n}` : "");
  };
  const deleteHistoryEntry = (id) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistoryToStorage(next);
      return next;
    });
  };

  const addToQueue = () => {
    // 同じカード・同じ状態を2枚キューに入れるとSKUが衝突するため、連番を付けて一意化する
    // （CSVはCustomLabel列が行ごとに一意である必要がある）
    const used = new Set(queue.map((e) => e.sku));
    let finalSku = sku;
    let n = 2;
    while (used.has(finalSku)) finalSku = `${sku}-${n++}`;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      addedAt: new Date().toISOString(),
      mode, f, title, desc, sku: finalSku, itemSpecifics,
    };
    setQueue((prev) => {
      const next = [...prev, entry];
      saveQueueToStorage(next);
      return next;
    });
    setQueueSaved(true);
    setTimeout(() => setQueueSaved(false), 1600);
  };
  const removeFromQueue = (id) => {
    setQueue((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveQueueToStorage(next);
      return next;
    });
  };
  const clearQueue = () => {
    setQueue([]);
    saveQueueToStorage([]);
  };
  // 1BOXから出た複数枚をまとめて出品する際など、キュー全件の仕入れ値を一括で書き換える。
  // 仕入れ値が変わると目標利益率を満たす売値も変わるため、各エントリのtargetMarginPercentを
  // 使って推奨売値を再計算し、sellPriceUsdも合わせて更新する
  const applyLotCostToQueue = () => {
    if (!lotCostJpy.trim()) return;
    setQueue((prev) => {
      const next = prev.map((e) => {
        const updatedF = { ...e.f, costJpy: lotCostJpy };
        const recommended = roundUpToPsychologicalPrice(
          computeRecommendedPrice(updatedF, updatedF.targetMarginPercent)
        );
        if (recommended != null) updatedF.sellPriceUsd = String(recommended);
        return { ...e, f: updatedF };
      });
      saveQueueToStorage(next);
      return next;
    });
  };
  const downloadQueueCsv = () => {
    const csv = buildListingCsv(queue);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ptcg-listing-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const applyCandidate = (r) => {
    const [local] = r.card;
    setSelectedKey(r.set.c + "/" + local);
    setF((p) => applyCandidateToForm(p, r, { carryOverCondition }));
    setShowCandidates(false);
  };
  // 検索を使わない手入力派向け：出品固有フィールドだけを空に戻す
  const startNewListing = () => {
    setF((p) => ({ ...p, ...PER_LISTING_FIELDS }));
    setSelectedKey("");
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#f2f4f9",
      fontFamily: '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic Medium",Meiryo,sans-serif',
      color: "#1a2238", padding: "28px 16px 60px",
    }}>
      {/* 画面幅が狭い（＝入力フォームの下にタイトルカードが縦積みになる）ときだけ
          タイトルカードを画面上部に固定し、入力しながら確認できるようにする */}
      <style>{`@media (max-width: 700px) { .sticky-title { position: sticky; top: 8px; z-index: 10; } }`}</style>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <header style={{ marginBottom: 22 }}>
          <div style={{ display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: "#5b6478", marginBottom: 6 }}>
            EBAY LISTING GENERATOR
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>ポケカ出品文メーカー</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#5b6478" }}>
            内蔵データベース（12,654枚）から候補を選ぶだけで、eBay用の英語タイトルと説明文を自動生成します。
            {imageCount > 0
              ? ` ローカル画像 ${imageCount.toLocaleString()} 枚を読み込み済み。`
              : " （画像は npm run images でダウンロードすると表示されます）"}
          </p>
        </header>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "inline-flex", background: "#e4e8f2", borderRadius: 999, padding: 4 }}>
            {[{ k: "single", label: "シングルカード" }, { k: "pack", label: "未開封パック / BOX" }].map((t) => (
              <button key={t.k} onClick={() => setMode(t.k)} style={{
                padding: "8px 20px", borderRadius: 999, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700, color: mode === t.k ? "#fff" : "#3b4256",
                background: mode === t.k ? "#1a2238" : "transparent", transition: "all .2s",
              }}>{t.label}</button>
            ))}
          </div>
          <button onClick={startNewListing} title="ポケモン名・レアリティ・状態・鑑定情報・価格をクリアします（発送元や為替レートなどの共通設定は残ります）" style={{
            padding: "8px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
            fontSize: 13, fontWeight: 700, color: "#3b4256", background: "#fff",
          }}>新しい出品を始める</button>
        </div>

        {mode === "single" && (
          <section style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)", marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800 }}>カード名で検索</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8b93a7" }}>
              入力すると内蔵データから即座に候補を表示します。「リザードン SAR」「ピカチュウ SV2a」のようにレアリティやセット型番で絞り込みもできます。
            </p>
            <input style={{ ...inputStyle, fontSize: 15, padding: "12px 14px" }} value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowCandidates(true); }}
              onFocus={() => setShowCandidates(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && candidates.length === 1) applyCandidate(candidates[0]);
                if (e.key === "Escape") setShowCandidates(false);
              }}
              placeholder="例: リザードンex / ナゾノクサ / ピカチュウ SAR" />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, fontWeight: 700, color: "#5b6478" }}>
              <input type="checkbox" checked={carryOverCondition} onChange={(e) => setCarryOverCondition(e.target.checked)} />
              前回の状態・鑑定情報・価格を引き継ぐ（同じカードの状態違いを連続出品する場合のみON推奨）
            </label>
            {searchQuery.trim().length >= 2 && candidates.length === 0 && (
              <div style={{ fontSize: 12.5, color: "#c0392b", marginTop: 12 }}>
                候補が見つかりませんでした。表記を変えるか、下のフォームに手動で入力してください。
              </div>
            )}
            {!showCandidates && candidates.length > 0 && (
              <button onClick={() => setShowCandidates(true)} style={{
                marginTop: 12, padding: "6px 4px", border: "none", background: "none", cursor: "pointer",
                fontSize: 12.5, fontWeight: 800, color: "#7c6cf0",
              }}>候補 {candidates.length} 件を再表示</button>
            )}
            {showCandidates && candidates.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginTop: 16, maxHeight: 560, overflowY: "auto" }}>
                {candidates.map((r) => {
                  const [local, ja, en, rarity] = r.card;
                  const key = r.set.c + "/" + local;
                  const sel = selectedKey === key;
                  return (
                    <button key={key} onClick={() => applyCandidate(r)} style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 12, padding: 10,
                      border: sel ? "2px solid #7c6cf0" : "2px solid #e4e8f2",
                      background: sel ? "#f4f2ff" : "#fafbfe", transition: "all .15s", fontFamily: "inherit",
                    }}>
                      <CardImage src={localImage(r.set, local)} name={ja || en} />
                      <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: "#1a2238", lineHeight: 1.4 }}>{ja || en}</div>
                      <div style={{ fontSize: 11.5, color: "#5b6478", marginTop: 2, lineHeight: 1.5 }}>
                        {[rarity, cardNoOf(r.set, local)].filter(Boolean).join(" · ") || "レアリティ未登録"}<br />
                        {r.set.ja || r.set.en} ({r.set.c})
                      </div>
                      {(!en || !r.set.en) && (
                        <div style={{ marginTop: 6, display: "inline-block", fontSize: 10, fontWeight: 800, color: "#a3352b", background: "#fdecea", borderRadius: 999, padding: "2px 8px" }}>
                          {!en && !r.set.en ? "英語名・セット英語名なし" : !en ? "英語名なし" : "セット英語名なし"}
                        </div>
                      )}
                      <div style={{ marginTop: 8, fontSize: 11, fontWeight: 800, color: sel ? "#5b48d6" : "#7c6cf0" }}>
                        {sel ? "✓ 入力済み" : "このカードを使う →"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          <section style={{ flex: "1 1 340px", minWidth: 300, background: "#fff", borderRadius: 16, padding: "22px 22px 12px", boxShadow: "0 1px 4px rgba(26,34,56,.06)" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800 }}>カード情報の入力</h2>
            {mode === "single" && (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}><Field label="ポケモン名（日本語）"><input style={inputStyle} value={f.pokemonJa} onChange={set("pokemonJa")} placeholder="例: リザードンex" /></Field></div>
                  <div style={{ flex: 1 }}><Field label="ポケモン名（英語）"><input style={inputStyle} value={f.pokemonEn} onChange={set("pokemonEn")} placeholder="例: Charizard ex" /></Field></div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <Field label="レアリティ" hint={rarityMismatch ? `⚠ DB上のレアリティは ${rarityMismatch} です` : undefined}>
                      <select style={inputStyle} value={f.rarity} onChange={set("rarity")}>{RARITIES.map((r) => <option key={r} value={r}>{r || "選択してください"}</option>)}</select>
                    </Field>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Field label="カード番号" hint={cardNoWarning ? `⚠ ${cardNoWarning}` : "例: 201/165"}>
                      <input style={inputStyle} value={f.cardNo} onChange={set("cardNo")} placeholder="201/165" />
                    </Field>
                  </div>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="セット名（日本語）"><input style={inputStyle} value={f.setNameJa} onChange={set("setNameJa")} placeholder="例: ポケモンカード151" /></Field></div>
              <div style={{ flex: 1 }}><Field label="セット名（英語）"><input style={inputStyle} value={f.setNameEn} onChange={set("setNameEn")} placeholder="例: Pokemon 151" /></Field></div>
            </div>
            <Field label="セット型番" hint="例: SV2a / sv9 / M2"><input style={inputStyle} value={f.setCode} onChange={set("setCode")} placeholder="SV2a" /></Field>
            {mode === "single" ? (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#3b4256" }}>
                  <input type="checkbox" checked={f.graded} onChange={set("graded")} />鑑定品として出品（PSA / BGS / CGC / SGC など）
                </label>
                {f.graded ? (
                  <>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <Field label="鑑定会社">
                          <select style={inputStyle} value={f.gradingCompany} onChange={set("gradingCompany")}>
                            {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c || "選択してください"}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div style={{ flex: 1 }}><Field label="グレード" hint="例: 10 / 9.5"><input style={inputStyle} value={f.grade} onChange={set("grade")} placeholder="10" /></Field></div>
                    </div>
                    <Field label="鑑定書番号（任意）"><input style={inputStyle} value={f.certNumber} onChange={set("certNumber")} placeholder="例: 12345678" /></Field>
                    <Field label="スラブの状態メモ（英語・任意）" hint="ケースの傷など、あれば記載">
                      <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={f.conditionNotes} onChange={set("conditionNotes")} placeholder="例: Small scratch on the case back" />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="状態（コンディション）" hint="迷ったら1段階低めが安全です">
                      <select style={inputStyle} value={f.condition} onChange={set("condition")}>{CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}</select>
                    </Field>
                    <Field label="状態の補足（英語・任意）" hint="例: Tiny whitening on the back bottom edge (see photo #4)">
                      <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={f.conditionNotes} onChange={set("conditionNotes")} placeholder="傷や白かけがあれば正直に記載" />
                    </Field>
                  </>
                )}
                {PRINT_VARIANT_SET_RE.test(f.setCode) && (
                  <>
                    <Field label="印刷バリエーション" hint={NO_RARITY_SET_RE.test(f.setCode)
                      ? "拡張パック（1996年初回印刷）はNo Rarity（レアリティマークなし）が最も価値に影響します。1st Editionマークの有無も価値が変わります"
                      : "拡張パック〜ジム拡張2（PMCG1〜6）は1st Editionマークの有無で価値が変わります"}>
                      <select style={inputStyle} value={f.printVariant} onChange={set("printVariant")}>
                        {PRINT_VARIANTS.filter((v) => v.code !== "No Rarity" || NO_RARITY_SET_RE.test(f.setCode))
                          .map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                      </select>
                    </Field>
                    <Field label="その他の印刷差異（英語・任意）" hint="例: Miscut / Error card">
                      <input style={inputStyle} value={f.printVariantNote} onChange={set("printVariantNote")} placeholder="エラーカードなど" />
                    </Field>
                  </>
                )}
                {OLD_BACK_SET_RE.test(f.setCode) && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#3b4256" }}>
                    <input type="checkbox" checked={f.oldBack} onChange={set("oldBack")} />旧裏（オールドバック）
                  </label>
                )}
              </>
            ) : (
              <>
                <Field label="商品タイプ"><select style={inputStyle} value={f.productType} onChange={set("productType")}>{PRODUCT_TYPES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></Field>
                {f.productType === "pack" ? (
                  <Field label="1パックのカード枚数（任意）"><input style={inputStyle} value={f.cardsPerPack} onChange={set("cardsPerPack")} placeholder="例: 5" /></Field>
                ) : (
                  <>
                    <Field label="1BOXのパック数"><input style={inputStyle} value={f.packsPerBox} onChange={set("packsPerBox")} placeholder="30" /></Field>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#3b4256" }}>
                      <input type="checkbox" checked={f.shrink} onChange={set("shrink")} />シュリンク付き
                    </label>
                  </>
                )}
              </>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="発送元"><input style={inputStyle} value={f.shipFrom} onChange={set("shipFrom")} /></Field></div>
              <div style={{ flex: 1 }}><Field label="発送までの営業日"><input style={inputStyle} value={f.handlingDays} onChange={set("handlingDays")} /></Field></div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1 }}><Field label="数量" hint="CSV出品時のQuantity"><input style={inputStyle} inputMode="numeric" value={f.quantity} onChange={set("quantity")} /></Field></div>
              <div style={{ flex: 1, paddingTop: 22 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#3b4256" }}>
                  <input type="checkbox" checked={f.bestOfferEnabled} onChange={set("bestOfferEnabled")} />Best Offerを有効にする
                </label>
              </div>
            </div>

            <details open={profitOpen} onToggle={(e) => setProfitOpen(e.target.open)} style={{ marginTop: 8, paddingTop: 16, borderTop: "1.5px solid #eef0f7" }}>
              <summary style={{ margin: "0 0 4px", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>利益計算（任意）</summary>
              <p style={{ margin: "8px 0 12px", fontSize: 11.5, color: "#8b93a7" }}>
                上の「eBayで相場を見る」（または下の相場リンク）で確認した金額を想定売値に入れると、手数料・仕入れ値を差し引いた利益が分かります。
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="仕入れ値（円）"><input style={inputStyle} inputMode="decimal" value={f.costJpy} onChange={set("costJpy")} placeholder="例: 3000" /></Field></div>
                <div style={{ flex: 1 }}><Field label="諸経費（円・任意）" hint="送料・スリーブ等"><input style={inputStyle} inputMode="decimal" value={f.extraCostJpy} onChange={set("extraCostJpy")} placeholder="例: 200" /></Field></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Field label="想定売値（USD）">
                    <input style={inputStyle} inputMode="decimal" value={f.sellPriceUsd} onChange={set("sellPriceUsd")} placeholder="例: 45" />
                  </Field>
                  {ebaySoldUrl && (
                    <a href={ebaySoldUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: -10, marginBottom: 10, fontSize: 11, color: "#7c6cf0", fontWeight: 700 }}>
                      eBayで相場を見る（売却済み）→
                    </a>
                  )}
                  {priceHistoryHint && (
                    <div style={{ fontSize: 11, color: "#5b6478", marginBottom: 10 }}>
                      前回同セット・同レアリティを ${priceHistoryHint.price} で出品（{new Date(priceHistoryHint.savedAt).toLocaleDateString("ja-JP")}）
                      <button type="button" onClick={() => setF((p) => ({ ...p, sellPriceUsd: priceHistoryHint.price }))} style={{
                        marginLeft: 6, padding: "1px 8px", borderRadius: 999, border: "1px solid #d9deea", cursor: "pointer",
                        fontSize: 10.5, fontWeight: 700, color: "#5b48d6", background: "#f4f2ff",
                      }}>使う</button>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}><Field label="発送実費（USD・任意）"><input style={inputStyle} inputMode="decimal" value={f.shippingCostUsd} onChange={set("shippingCostUsd")} placeholder="例: 5" /></Field></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="為替レート（円/USD）"><input style={inputStyle} inputMode="decimal" value={f.exchangeRate} onChange={set("exchangeRate")} /></Field></div>
                <div style={{ flex: 1 }}><Field label="eBay手数料率（%）" hint="国際取引手数料・通貨換算手数料込みの実効レートで（目安 17〜19%）"><input style={inputStyle} inputMode="decimal" value={f.ebayFeePercent} onChange={set("ebayFeePercent")} /></Field></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><Field label="eBay固定手数料（USD）" hint="出品1件あたりの定額手数料"><input style={inputStyle} inputMode="decimal" value={f.ebayFixedFeeUsd} onChange={set("ebayFixedFeeUsd")} /></Field></div>
                <div style={{ flex: 1 }}><Field label="目標利益率（%）" hint="推奨売値の逆算に使用"><input style={inputStyle} inputMode="decimal" value={f.targetMarginPercent} onChange={set("targetMarginPercent")} /></Field></div>
              </div>
              {recommendedPrice != null && (
                <div style={{ borderRadius: 10, padding: "10px 14px", marginBottom: 14, background: "#f4f2ff", border: "1.5px solid #e4e0fb" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#5b48d6" }}>
                    目標利益率 {f.targetMarginPercent}% を満たす推奨売値: ${recommendedPrice.toFixed(2)}
                    <button type="button" onClick={() => setF((p) => ({ ...p, sellPriceUsd: String(recommendedPrice.toFixed(2)) }))} style={{
                      marginLeft: 8, padding: "2px 10px", borderRadius: 999, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 700, color: "#fff", background: "#5b48d6",
                    }}>この価格を使う</button>
                  </div>
                </div>
              )}
              {profit && (
                <div style={{
                  borderRadius: 10, padding: "12px 14px", marginTop: 4, marginBottom: 14,
                  background: profit.profitUsd >= 0 ? "#eafaf1" : "#fdecea",
                  border: `1.5px solid ${profit.profitUsd >= 0 ? "#bfead2" : "#f3c6c0"}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: profit.profitUsd >= 0 ? "#0a6e3f" : "#a3352b" }}>
                    想定利益: ${profit.profitUsd.toFixed(2)}（約 ¥{Math.round(profit.profitJpy).toLocaleString()}） ／ 利益率: {profit.marginPercent.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: "#5b6478", marginTop: 4 }}>
                    仕入れ原価 ${profit.costUsd.toFixed(2)} ＋ eBay手数料 ${profit.feeUsd.toFixed(2)} を差し引いた金額です。
                  </div>
                </div>
              )}
            </details>
          </section>

          <section style={{ flex: "1 1 420px", minWidth: 320 }}>
            <div className="sticky-title" style={{ borderRadius: 18, padding: 3, background: holoGrad, boxShadow: "0 4px 18px rgba(120,110,220,.18)", marginBottom: 18 }}>
              <div style={{ background: "#fff", borderRadius: 15, padding: "20px 22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>タイトル</h2>
                  <span style={{ fontSize: 12, fontWeight: 800, color: over ? "#c0392b" : "#5b6478" }}>{title.length} / 80 文字</span>
                </div>
                {sku && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "#8b93a7" }}>SKU: <code style={{ fontFamily: "inherit", color: "#5b6478" }}>{sku}</code></span>
                  </div>
                )}
                <div style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 600, padding: "12px 14px", borderRadius: 10, background: "#f6f7fb", border: over ? "1.5px solid #e5b3ad" : "1.5px solid transparent", minHeight: 24, wordBreak: "break-word" }}>
                  {title || "入力するとここにタイトルが表示されます"}
                </div>
                {over && (
                  <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}>
                    eBayのタイトル上限は80文字です（<strong>{title.length - 80}文字オーバー</strong>）。
                    {f.setNameEn && ` セット英語名「${f.setNameEn}」を省くと ${title.length - f.setNameEn.length - 1} 文字になります。`}
                  </div>
                )}
                {droppedTitleParts.length > 0 && (
                  <div style={{ fontSize: 12, color: "#8b93a7", marginTop: 6 }}>
                    80文字に収めるため、{droppedTitleParts.join("・")}を省略しました。
                  </div>
                )}
                {missingEn && (
                  <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}>
                    ⚠ {missingPokemonEn && missingSetEn ? "英語名・セット英語名" : missingPokemonEn ? "英語名" : "セット英語名"}がデータに未登録です。前に選んだカードの英語名が残っていないか確認し、手入力してからコピーしてください。
                  </div>
                )}
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <CopyBtn text={title} label="タイトルをコピー" />
                  {ebaySoldUrl && (
                    <a href={ebaySoldUrl} target="_blank" rel="noopener noreferrer" style={{
                      padding: "8px 16px", borderRadius: 999, textDecoration: "none",
                      fontSize: 13, fontWeight: 700, color: "#1a2238", background: "#fff",
                      border: "1.5px solid #d9deea",
                    }}>eBayで相場を見る（売却済み）</a>
                  )}
                  {ebayActiveUrl && (
                    <a href={ebayActiveUrl} target="_blank" rel="noopener noreferrer" style={{
                      padding: "8px 16px", borderRadius: 999, textDecoration: "none",
                      fontSize: 13, fontWeight: 700, color: "#1a2238", background: "#fff",
                      border: "1.5px solid #d9deea",
                    }}>現在の出品を見る</a>
                  )}
                  <button onClick={handleSaveClick} style={{
                    padding: "8px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
                    fontSize: 13, fontWeight: 700, color: historySaved ? "#0a6e3f" : "#1a2238",
                    background: historySaved ? "#d3f5e3" : "#fff", transition: "all .2s",
                  }}>{historySaved ? "保存しました ✓" : "履歴に保存"}</button>
                  <button onClick={addToQueue} style={{
                    padding: "8px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
                    fontSize: 13, fontWeight: 700, color: queueSaved ? "#0a6e3f" : "#5b48d6",
                    background: queueSaved ? "#d3f5e3" : "#f4f2ff", transition: "all .2s",
                  }}>{queueSaved ? "追加しました ✓" : `出品キューに追加 (${queue.length})`}</button>
                </div>
              </div>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>説明文</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {descOverride !== null && <span style={{ fontSize: 11, color: "#8b93a7" }}>編集済み（フォームを変更すると再生成されます）</span>}
                  <CopyBtn text={desc} label="説明文をコピー" />
                </div>
              </div>
              <textarea
                value={desc}
                onChange={(e) => setDescOverride(e.target.value)}
                style={{ margin: 0, width: "100%", boxSizing: "border-box", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, lineHeight: 1.75, color: "#2a3145", background: "#f6f7fb", borderRadius: 10, border: "1.5px solid transparent", padding: "14px 16px", minHeight: 340, maxHeight: 460, overflowY: "auto", resize: "vertical", outline: "none" }}
              />
            </div>

            {mode === "single" && itemSpecifics.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)", marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>アイテムスペシフィック</h2>
                  <CopyBtn text={itemSpecificsText} label="まとめてコピー" />
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "#8b93a7", lineHeight: 1.6 }}>
                  eBayの出品フォーム「Item specifics」欄に入力する項目です。検索フィルタに使われるため、埋めるほど露出が上がります。
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "6px 12px", alignItems: "center" }}>
                  {itemSpecifics.map(([label, value]) => (
                    <FragmentRow key={label} label={label} value={value} />
                  ))}
                </div>
              </div>
            )}

            {conditionGuide && (
              <p style={{ fontSize: 11.5, color: "#5b6478", marginTop: 12, lineHeight: 1.7, background: "#f6f7fb", borderRadius: 10, padding: "10px 14px" }}>
                💡 {conditionGuide}
              </p>
            )}
            <p style={{ fontSize: 11.5, color: "#8b93a7", marginTop: 12, lineHeight: 1.7 }}>
              ヒント: タイトルは「Title」欄に、説明文は「Item description」欄に貼り付けてください。
              Condition欄の選択は説明文と矛盾しないように選びましょう。
            </p>
            {mode === "single" && (
              <div style={{ marginTop: 8 }}>
                <CopyBtn text={allInOneText} label="タイトル＋説明文＋アイテムスペシフィックを一括コピー" />
              </div>
            )}
          </section>
        </div>

        {queue.length > 0 && (
          <section style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)", marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>出品キュー（{queue.length}件）</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={downloadQueueCsv} style={{
                  padding: "8px 16px", borderRadius: 999, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 700, color: "#fff", background: "#1a2238",
                }}>CSVをダウンロード</button>
                <button onClick={clearQueue} style={{
                  padding: "8px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
                  fontSize: 13, fontWeight: 700, color: "#a3352b", background: "#fff",
                }}>キューを空にする</button>
              </div>
            </div>
            {gradedInQueue > 0 && (
              <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6, marginBottom: 6 }}>
                鑑定品 {gradedInQueue} 件を含みます。鑑定情報のID未設定のため、
                この行はアップロード時にエラーになります。CSV編集時に手動で埋めるか、
                鑑定品は個別出品してください。
              </div>
            )}
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8b93a7", lineHeight: 1.6 }}>
              「出品キューに追加」で貯めた内容です。ブラウザ内（localStorage）にのみ保存されます。
              CSVはeBay File Exchange相当の列構成です。<strong>本番アップロード前に必ず少数件でテストし、
              カテゴリ・ConditionID・画像URLなど実際の値を確認してください</strong>（詳細はコード内コメント参照）。
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 220 }}>
                <Field label="このロットの仕入れ値（円）" hint="1BOXから複数枚出す場合など">
                  <input style={inputStyle} inputMode="decimal" value={lotCostJpy} onChange={(e) => setLotCostJpy(e.target.value)} placeholder="例: 100" />
                </Field>
              </div>
              <button onClick={applyLotCostToQueue} style={{
                padding: "10px 16px", borderRadius: 999, border: "1.5px solid #d9deea", cursor: "pointer",
                fontSize: 13, fontWeight: 700, color: "#1a2238", background: "#fff", marginBottom: 14,
              }}>キュー全件に適用</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
              {queue.map((entry) => (
                <div key={entry.id} style={{ borderRadius: 12, padding: 10, border: "2px solid #e4e8f2", background: "#fafbfe" }}>
                  <CardImage src={entryImage(entry)} name={entry.f.pokemonJa || entry.f.pokemonEn || entry.f.setNameJa} />
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: "#1a2238", lineHeight: 1.4 }}>
                    {entry.f.pokemonJa || entry.f.pokemonEn || (entry.mode === "pack" ? entry.f.setNameJa : "(未入力)")}
                  </div>
                  <div style={{ fontSize: 11, color: "#5b6478", marginTop: 2, lineHeight: 1.5 }}>
                    SKU: {entry.sku}<br />
                    ${entry.f.sellPriceUsd || "?"} ・ 数量{entry.f.quantity || "1"}
                  </div>
                  <button onClick={() => removeFromQueue(entry.id)} style={{
                    marginTop: 8, width: "100%", padding: "6px 8px", borderRadius: 999, border: "none", cursor: "pointer",
                    fontSize: 11, fontWeight: 800, color: "#a3352b", background: "#fdecea",
                  }}>キューから削除</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 4px rgba(26,34,56,.06)", marginTop: 20 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800 }}>保存した出品（履歴）</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8b93a7" }}>
              「履歴に保存」で保存した内容です。ブラウザ内（localStorage）にのみ保存され、他の端末とは共有されません。
            </p>
            {history.length > 6 && (
              <input style={{ ...inputStyle, marginBottom: 14, maxWidth: 320 }} value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                placeholder="カード名・セット名で絞り込み" />
            )}
            {filteredHistory.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#8b93a7" }}>該当する履歴がありません。</div>
            ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
              {filteredHistory.map((entry) => (
                <div key={entry.id} style={{ borderRadius: 12, padding: 10, border: "2px solid #e4e8f2", background: "#fafbfe" }}>
                  <CardImage src={entryImage(entry)} name={entry.f.pokemonJa || entry.f.pokemonEn || entry.f.setNameJa} />
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: "#1a2238", lineHeight: 1.4 }}>
                    {entry.f.pokemonJa || entry.f.pokemonEn || (entry.mode === "pack" ? entry.f.setNameJa : "(未入力)")}
                  </div>
                  <div style={{ fontSize: 11, color: "#5b6478", marginTop: 2, lineHeight: 1.5 }}>
                    {[entry.f.rarity, entry.f.cardNo].filter(Boolean).join(" · ")}<br />
                    {entry.f.setNameJa || entry.f.setNameEn} ({entry.f.setCode})<br />
                    {new Date(entry.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <button onClick={() => loadFromHistory(entry)} style={{
                      flex: 1, padding: "6px 8px", borderRadius: 999, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 800, color: "#5b48d6", background: "#f4f2ff",
                    }}>読み込む</button>
                    <button onClick={() => deleteHistoryEntry(entry.id)} style={{
                      padding: "6px 10px", borderRadius: 999, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 800, color: "#a3352b", background: "#fdecea",
                    }}>削除</button>
                  </div>
                </div>
              ))}
            </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
