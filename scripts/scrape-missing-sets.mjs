#!/usr/bin/env node
/**
 * 未収録セットのカードデータ取得（全世代共通・フェーズ制）
 *
 * 背景: official-card-cache.json（322セット）に対し cardData.json は一部のみで、
 * 未収録セット・カード枚数が大量に残っている。本スクリプトは scripts/scrape-bw-xy.mjs
 * （BW・XY世代向けに確立した取得ロジック）をそのまま汎用化したもの。
 * ロジック自体はBW/XYで実績のあるものを一切変更していない。
 *
 * 番号・レアリティは pokemon-card.com の details.php から取得する（経路A）。
 * resultAPI.php（official-card-cache.json の元データ）はカード番号を含まないため、
 * この2つを組み合わせて使う: official-card-cache.json でカードID一覧を得て、
 * details.php で1枚ずつ番号・総数・レアリティ・(HTMLデコード済みの)日本語名を検証する。
 *
 * 対象セットは TARGET_SETS のホワイトリストに明記したものだけを処理する
 * （official-card-cache.jsonのキーを機械的に列挙しない。正体不明のセットが
 * 混入するのを防ぐため。BW/XY調査で正体不明の裸"BW"/"XY"キーが見つかった実例がある）。
 *
 * フェーズごとに TARGET_SETS へ追記していく運用とする（1セットずつ検証、
 * 失敗したら停止して報告。詳細は docs/task-missing-sets.md 相当の依頼文を参照）。
 *
 * 使い方:
 *   node scripts/scrape-missing-sets.mjs
 *
 * 前提: scripts/official-card-cache.json が存在すること
 *   （無ければ node scripts/scrape-official-images.mjs --rescan を先に実行）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileName, computeSetTotal, isUsableImage, writeFileAtomic } from "./filename-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cards");
const CARD_DATA_PATH = path.join(ROOT, "src", "cardData.json");
const CACHE_PATH = path.join(__dirname, "official-card-cache.json");
const REPORT_PATH = path.join(__dirname, "scrape-missing-sets-report.json");

const API_BASE = "https://www.pokemon-card.com";
const CONCURRENCY = 3;
const DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 15000;
// 失敗カード数がこの件数を超えたら、不完全なデータをcardData.jsonに書き込まず異常終了する
const MAX_FAILED_CARDS = 5;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

// === フェーズ1: S世代 初期（S1W/S1H/S1a/S2/S2a/S3/S3a） ===
// ja/y: TCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）のname/releaseDateを直接取得（確度: 高）
// codeAlias: 7セット全件、details.phpのimg-regulation altテキストで機械的に確認し、
// S3の001/100（パラス）を画像でも目視照合済み（バッジ文字列"s3"・番号・レアリティが一致）。
// 印刷テンプレートは既存のS4以降と同じ「モダン」形式（Dマーク付き）であることを画像で確認済みのため、
// buildModernTitle等の既存分岐に変更は不要（旧裏/BW-XY特有の分岐パターンの複製は不要）。
// en: 取得しない（既存方針通り空欄のまま。TCGdexに英語版シリーズ情報があっても、過去に
// インドネシア語混入が見つかった経緯があるため、cardData.json内のデータを信頼した復元はしない）
const TARGET_SETS = [
  { code: "S1W", sourceCacheKeys: ["S1W"], ja: "ソード", sr: "S", y: 2019, codeAlias: "S1W" },
  { code: "S1H", sourceCacheKeys: ["S1H"], ja: "シールド", sr: "S", y: 2019, codeAlias: "S1H" },
  { code: "S1a", sourceCacheKeys: ["S1a"], ja: "VMAXライジング", sr: "S", y: 2020, codeAlias: "S1a" },
  { code: "S2", sourceCacheKeys: ["S2"], ja: "反逆クラッシュ", sr: "S", y: 2020, codeAlias: "S2" },
  { code: "S2a", sourceCacheKeys: ["S2a"], ja: "爆炎ウォーカー", sr: "S", y: 2020, codeAlias: "S2a" },
  { code: "S3", sourceCacheKeys: ["S3"], ja: "ムゲンゾーン", sr: "S", y: 2020, codeAlias: "S3" },
  { code: "S3a", sourceCacheKeys: ["S3a"], ja: "伝説の鼓動", sr: "S", y: 2020, codeAlias: "S3a" },

  // SD: 本弾7セット完了後に検証。official-card-cache.json上127枚、details.phpで
  // 全件1〜127の欠番・重複なしを事前確認済み（cardId 38273=フシギバナV=001/127から連番）。
  // codeAliasは画像を目視確認済み（バッジ"sD"、レアリティ表記なし＝V系スターター商品の仕様）。
  // ja/y: Web検索（確度: 中。「スタートデッキ100」、2021-12-17発売・790円という一致する
  // 複数の言及を確認）。SAは同じ探索キーの中に「スターターセットV 草/炎/水/雷/闘」という
  // 5つの異なる商品が同じ番号帯(001〜023/024)で重複しており（例: 001がセレビィV/ロコン/
  // シェルダー/ピカチュウ/ディグダの5通り）、単一セットとして表現できないため対象外とした
  // （どのカードがどのデッキに属するか、公式サイト上に判別手段が見つからなかった。
  // 推測で割り振らない。DP世代の種族単位番号問題と同種の「番号だけでは一意に特定できない」
  // ケースとして別タスク行きとする）
  { code: "SD", sourceCacheKeys: ["SD"], ja: "スタートデッキ100", sr: "S", y: 2021, codeAlias: "SD" },

  // === フェーズ2: SM世代 本弾（SM1S〜SM12a、35セット） ===
  // ja/y: TCGdex（https://api.tcgdex.net/v2/ja/sets/{id}）のname/releaseDateを直接取得
  // （確度: 高。SM1p/SM2p/SM3p/SM4p/SM5pはTCGdex側のid表記が"SM1+"/"sm2+"/"SM3+"/"SM4+"/"SM5+"
  // という別表記だが、cardCount.officialが001/0NNのNNNと一致することで対応関係を確認した）。
  // codeAlias: 35セット全件、details.phpのimg-regulation altテキストで確認（全件setCode＝
  // codeAliasと一致）。SM1S・SM9(TAG TEAM GX、&のHTMLエンティティ含む)・SM12a(全210枚中
  // 最大セット)の3セットを画像でも目視照合済み（バッジ・番号・レアリティ・"&"を含む
  // カード名の復号が正しく行われることを確認）。印刷テンプレートは既存のS/SV系と同じ
  // モダン形式であることを確認済みで、buildModernTitle等の既存分岐に変更は不要。
  // レアリティ: SM1p/SM2p/SM3p/SM4p/SM5p/SM8bはレアリティアイコンなし（rarity=""になる。
  // CP4/CP5等と同じ挙動）。それ以外はC/U/R/RR等の通常表記
  { code: "SM1S", sourceCacheKeys: ["SM1S"], ja: "コレクションサン", sr: "SM", y: 2016, codeAlias: "SM1S" },
  { code: "SM1M", sourceCacheKeys: ["SM1M"], ja: "コレクションムーン", sr: "SM", y: 2016, codeAlias: "SM1M" },
  { code: "SM1p", sourceCacheKeys: ["SM1p"], ja: "サン＆ムーン", sr: "SM", y: 2017, codeAlias: "SM1p" },
  { code: "SM2K", sourceCacheKeys: ["SM2K"], ja: "キミを待つ島々", sr: "SM", y: 2017, codeAlias: "SM2K" },
  { code: "SM2L", sourceCacheKeys: ["SM2L"], ja: "アローラの月光", sr: "SM", y: 2017, codeAlias: "SM2L" },
  { code: "SM2p", sourceCacheKeys: ["SM2p"], ja: "新たなる試練の向こう", sr: "SM", y: 2017, codeAlias: "SM2p" },
  { code: "SM3H", sourceCacheKeys: ["SM3H"], ja: "闘う虹を見たか", sr: "SM", y: 2017, codeAlias: "SM3H" },
  { code: "SM3N", sourceCacheKeys: ["SM3N"], ja: "光を喰らう闇", sr: "SM", y: 2017, codeAlias: "SM3N" },
  { code: "SM3p", sourceCacheKeys: ["SM3p"], ja: "ひかる伝説", sr: "SM", y: 2017, codeAlias: "SM3p" },
  { code: "SM4S", sourceCacheKeys: ["SM4S"], ja: "覚醒の勇者", sr: "SM", y: 2017, codeAlias: "SM4S" },
  { code: "SM4A", sourceCacheKeys: ["SM4A"], ja: "超次元の暴獣", sr: "SM", y: 2017, codeAlias: "SM4A" },
  { code: "SM4p", sourceCacheKeys: ["SM4p"], ja: "GXバトルブースト", sr: "SM", y: 2017, codeAlias: "SM4p" },
  { code: "SM5S", sourceCacheKeys: ["SM5S"], ja: "ウルトラサン", sr: "SM", y: 2017, codeAlias: "SM5S" },
  { code: "SM5M", sourceCacheKeys: ["SM5M"], ja: "ウルトラムーン", sr: "SM", y: 2017, codeAlias: "SM5M" },
  { code: "SM5p", sourceCacheKeys: ["SM5p"], ja: "ウルトラフォース", sr: "SM", y: 2018, codeAlias: "SM5p" },
  { code: "SM6", sourceCacheKeys: ["SM6"], ja: "禁断の光", sr: "SM", y: 2018, codeAlias: "SM6" },
  { code: "SM6a", sourceCacheKeys: ["SM6a"], ja: "ドラゴンストーム", sr: "SM", y: 2018, codeAlias: "SM6a" },
  { code: "SM6b", sourceCacheKeys: ["SM6b"], ja: "チャンピオンロード", sr: "SM", y: 2018, codeAlias: "SM6b" },
  { code: "SM7", sourceCacheKeys: ["SM7"], ja: "裂空のカリスマ", sr: "SM", y: 2018, codeAlias: "SM7" },
  { code: "SM7a", sourceCacheKeys: ["SM7a"], ja: "迅雷スパーク", sr: "SM", y: 2018, codeAlias: "SM7a" },
  { code: "SM7b", sourceCacheKeys: ["SM7b"], ja: "フェアリーライズ", sr: "SM", y: 2018, codeAlias: "SM7b" },
  { code: "SM8", sourceCacheKeys: ["SM8"], ja: "超爆インパクト", sr: "SM", y: 2018, codeAlias: "SM8" },
  { code: "SM8a", sourceCacheKeys: ["SM8a"], ja: "ダークオーダー", sr: "SM", y: 2018, codeAlias: "SM8a" },
  { code: "SM8b", sourceCacheKeys: ["SM8b"], ja: "GXウルトラシャイニー", sr: "SM", y: 2018, codeAlias: "SM8b" },
  { code: "SM9", sourceCacheKeys: ["SM9"], ja: "タッグボルト", sr: "SM", y: 2018, codeAlias: "SM9" },
  { code: "SM9a", sourceCacheKeys: ["SM9a"], ja: "ナイトユニゾン", sr: "SM", y: 2019, codeAlias: "SM9a" },
  { code: "SM9b", sourceCacheKeys: ["SM9b"], ja: "フルメタルウォール", sr: "SM", y: 2019, codeAlias: "SM9b" },
  { code: "SM10", sourceCacheKeys: ["SM10"], ja: "ダブルブレイズ", sr: "SM", y: 2019, codeAlias: "SM10" },
  { code: "SM10a", sourceCacheKeys: ["SM10a"], ja: "ジージーエンド", sr: "SM", y: 2019, codeAlias: "SM10a" },
  { code: "SM10b", sourceCacheKeys: ["SM10b"], ja: "スカイレジェンド", sr: "SM", y: 2019, codeAlias: "SM10b" },
  { code: "SM11", sourceCacheKeys: ["SM11"], ja: "ミラクルツイン", sr: "SM", y: 2019, codeAlias: "SM11" },
  { code: "SM11a", sourceCacheKeys: ["SM11a"], ja: "リミックスバウト", sr: "SM", y: 2019, codeAlias: "SM11a" },
  { code: "SM11b", sourceCacheKeys: ["SM11b"], ja: "ドリームリーグ", sr: "SM", y: 2019, codeAlias: "SM11b" },
  { code: "SM12", sourceCacheKeys: ["SM12"], ja: "オルタージェネシス", sr: "SM", y: 2019, codeAlias: "SM12" },
  { code: "SM12a", sourceCacheKeys: ["SM12a"], ja: "TAG TEAM GX タッグオールスターズ", sr: "SM", y: 2019, codeAlias: "SM12a" },

  // === フェーズ2続き: SM世代 文字コード系（SMA〜SMN、14セット） ===
  // 着手前にSA（フェーズ1で対象外にした「5商品が番号帯を共有」パターン）と同種の
  // リスクがないか、全14セットについて事前に(番号, 総数, 日本語名)の組み合わせを
  // 検証した。SMA/SMHは複数の商品名（スターターセット草/炎/水、GXスタートデッキ各種）に
  // 対応するとWeb検索で分かったが、実際には商品間で番号を共有しておらず1つの連続した
  // 番号帯（SMA=1-59, SMH=1-131）として一貫していることを確認済み（同一番号に異なる
  // カード名が対応する例は0件）。SAのような一意特定不可能なケースには該当しない。
  // codeAlias: 14セット全件、details.phpのimg-regulation altテキストで確認（全件setCode＝
  // codeAliasと一致）。レアリティアイコンは14セット全件で確認できず（rarity=""になる。
  // XYA〜XYH・CP4/CP5と同じ、構築済みデッキ専用商品の仕様）。
  // ja/y: TCGdexに項目が無いため、Web検索（トレ研ポケカのエキスパンションマーク一覧）に基づく
  // （確度: 中。XYA〜XYHの時と同じ情報源）。SMA/SMHは複数商品名が対応するため、代表的な
  // 商品名を1つ選ぶのではなく複数名を併記した
  // 基本エネルギー9種（cardId 33218-33226）はdetails.phpで確認したところ番号表記が
  // 無い汎用インサートだったため除外した（CP4等と同じ既知パターン）
  {
    code: "SMA", sourceCacheKeys: ["SMA"],
    excludeCardIds: [33218, 33219, 33220, 33221, 33222, 33223, 33224, 33225, 33226],
    ja: "スターターセット草/炎/水（ジュナイパーGX/ガオガエンGX/アシレーヌGX）", sr: "SM", y: 2016, codeAlias: "SMA",
  },
  // SMBのキャッシュは001-006/018のみで、007-018/018は別キー"SM-XY"に格納されていた
  // （XY6-B/XY6等と同じ「1商品が複数キーに分裂」パターン。ただしこちらは商品内でカードの
  // 印刷バッジ自体が"SMB"と"SM-XY"の2種に分かれている実例＝XY時代のキャラクター
  // （N・フラダリ・プラターヌ博士等）の再録カードに"SM-XY"という別マークが付与されている）。
  // sourceCacheKeysを両方指定してマージした。裸の"SM-XY"を独立商品として誤って
  // 取り込まないよう、TARGET_SETSには"SM-XY"単体のエントリを別途追加していない。
  // 【既知の精度限界】codeAlias（画面表示用の型番）はセット単位の1値しか持てないため
  // "SMB"を設定しているが、007-018番のカードは実物の印字が"SMB"ではなく"XY"（画像で
  // 目視確認済み）。この12枚に限りcodeAliasの表示が実物と一致しない。CLAUDE.md参照
  {
    code: "SMB", sourceCacheKeys: ["SMB", "SM-XY"],
    excludeCardIds: [33190, 33191, 33192, 33193, 33194, 33195, 33196, 33197, 33198],
    ja: "プレミアムトレーナーボックス（サン&ムーン）", sr: "SM", y: 2016, codeAlias: "SMB",
  },
  { code: "SMC", sourceCacheKeys: ["SMC"], ja: "スターターセット改造「カプ・ブルルGX」", sr: "SM", y: 2017, codeAlias: "SMC" },
  { code: "SMD", sourceCacheKeys: ["SMD"], ja: "30枚デッキ対戦セット「サトシVSロケット団」", sr: "SM", y: 2017, codeAlias: "SMD" },
  { code: "SME", sourceCacheKeys: ["SME"], ja: "スターターセット伝説 ソルガレオGX ルナアーラGX", sr: "SM", y: 2017, codeAlias: "SME" },
  // SMFのキャッシュは001-012/020のみで、013-020/020は正体不明の裸"XY"キー
  // （396枚、多数の無関係な商品の再録カードが混在する共有プール。BW/XY調査時に
  // 「正体不明のため対象外」としていたもの）に格納されていた。裸"XY"キーを丸ごと
  // sourceCacheKeysでマージすると無関係なカードまで大量に混入するため、SMFに属する
  // 8枚のcardIdのみをextraCardIdsで個別指定した（1つずつdetails.phpで番号013-020/020と
  // 確認済み）。【既知の精度限界】SMBと同様、013-020番の8枚は実物の印字が"SMF"ではなく
  // "XY"（画像で目視確認済み）。codeAliasの表示はこの8枚には一致しない
  {
    code: "SMF", sourceCacheKeys: ["SMF"],
    extraCardIds: [34527, 34528, 34529, 34530, 34531, 34532, 34533, 34534],
    ja: "プレミアムトレーナーボックス ウルトラサン・ウルトラムーン", sr: "SM", y: 2017, codeAlias: "SMF",
  },
  // 同じパターン: SMGのキャッシュは001-012/041のみで、013-041/041(29枚)が裸"XY"キーに
  // 格納されていた。全29枚をextraCardIdsで個別指定した。【既知の精度限界】013-041番の
  // 29枚は実物の印字が"SMG"ではなく"XY"（画像で目視確認済み）
  {
    code: "SMG", sourceCacheKeys: ["SMG"],
    extraCardIds: [34637, 34638, 34639, 34640, 34641, 34642, 34643, 34644, 34645, 34646, 34647, 34648, 34649, 34650, 34651, 34652, 34653, 34654, 34655, 34656, 34657, 34658, 34659, 34660, 34661, 34662, 34663, 34664, 34665],
    ja: "デッキビルドBOX「ウルトラサン」「ウルトラムーン」", sr: "SM", y: 2018, codeAlias: "SMG",
  },
  { code: "SMH", sourceCacheKeys: ["SMH"], ja: "GXスタートデッキ（各種）", sr: "SM", y: 2018, codeAlias: "SMH" },
  { code: "SMI", sourceCacheKeys: ["SMI"], ja: "スターターセット「炎のブースターGX」ほか", sr: "SM", y: 2018, codeAlias: "SMI" },
  { code: "SMJ", sourceCacheKeys: ["SMJ"], ja: "プレミアムトレーナーボックス TAG TEAM GX", sr: "SM", y: 2018, codeAlias: "SMJ" },
  { code: "SMK", sourceCacheKeys: ["SMK"], ja: "トレーナーバトルデッキシリーズ", sr: "SM", y: 2019, codeAlias: "SMK" },
  {
    code: "SML", sourceCacheKeys: ["SML"],
    excludeCardIds: [36493, 36494, 36516, 36517, 36539, 36540],
    ja: "ファミリーポケモンカードゲーム", sr: "SM", y: 2019, codeAlias: "SML",
  },
  { code: "SMM", sourceCacheKeys: ["SMM"], ja: "スターターセット TAG TEAM GX", sr: "SM", y: 2019, codeAlias: "SMM" },
  { code: "SMN", sourceCacheKeys: ["SMN"], ja: "デッキビルドBOX「TAG TEAM GX」", sr: "SM", y: 2019, codeAlias: "SMN" },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// resultAPI.phpのcardNameViewText同様、details.phpの<title>もHTMLエスケープされて
// 返る場合がある（過去の実例: S-PのTAG TEAMカード"グズマ&amp;ハラ"）。無条件で適用する
function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// cardThumbFile のファイル名先頭6桁 ("030046_P_FUSHIGIBANAEX.jpg") がそのまま cardID
function extractCardId(cardThumbFile) {
  const m = cardThumbFile.match(/\/(\d+)_/);
  return m ? String(parseInt(m[1], 10)) : null;
}

// details.php のレアリティアイコン画像ファイル名（例: ic_rare_rr.gif, ic_rare_sr_c.gif）から
// 抽出したコードを、既存cardData.jsonのレアリティ表記（RARITIES配列と同じ大文字表記）に変換する。
// BW/XY調査（180枚サンプリング）で確認できたのは元々6種のみだったが、フェーズ2で新規に
// 3種を追加確認した: s_2→"S"（SM8b「GXウルトラシャイニー」161-205番台の色違いレア）、
// ssr→"SSR"（同206番台以降のGXシャイニー）、tr→"TR"（SM9「タッグボルト」092-095番台の
// トレーナーズレア。カード面に直接"TR"と印字されているのを画像で確認済み。Web検索で
// 「トレーナーズレア」の略と確認）。SとSSRはsrc/App.jsxのRARITIES配列に元々定義済みだったが、
// TRは今回新規追加した（RARITIES/RARITY_EN_LABELS/HOLO_RARITIES、src/App.jsx）。
// 未知のコードが出た場合は呼び出し側で例外を投げる（不明なレアリティを無検証で採用しない）。
// "s_2"の"_2"の意味は未確認のため、将来的に別の数字サフィックス（s_1等）が出た場合は
// 無条件でSに丸めず個別に確認すること
// chr→"CHR"（SM11b「ドリームリーグ」050/049コータス等で確認。RARITIES配列に元々
// 定義済みの"CHR"=Character Rareと一致、追加のUI側変更は不要）
const RARITY_CODE_MAP = { c_c: "C", u_c: "U", r_c: "R", rr: "RR", sr_c: "SR", ur_c: "UR", s_2: "S", ssr: "SSR", tr: "TR", chr: "CHR" };

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// details.php から番号・総数・レアリティ・日本語名を取得する。
// 番号（img-regulation直後の "NNN / NNN" 表記）が取得できないカードはnullを返し、
// 呼び出し側で失敗扱いにする（絶対にやってはいけないこと: 番号未検証のまま取り込むこと）
async function fetchCardDetail(cardId) {
  const url = `${API_BASE}/card-search/details.php/card/${cardId}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const numM = html.match(/&nbsp;(\d+)&nbsp;\/&nbsp;(\d+)&nbsp;/);
      if (!numM) return null;
      const rarM = html.match(/ic_rare_([a-z0-9_]+)\.gif/);
      const titleM = html.match(/<title>([^<]*)<\/title>/);
      const rawName = titleM ? titleM[1].replace(/\s*\|\s*ポケモンカードゲーム公式ホームページ$/, "") : null;
      if (!rawName) return null;
      // 画像パスはdetails.php自身にも埋め込まれている（<img class="fit" src="...">）。
      // official-card-cache.jsonに載っていないcardId（extraCardIds、スキャン漏れの救済用）でも
      // ここから画像パスを取得できるため、cardThumbFileの別ソースとして使う
      const imgM = html.match(/<img class="fit" src="([^"]+)"/);
      return {
        local: numM[1],
        total: numM[2],
        rarity: rarM ? (RARITY_CODE_MAP[rarM[1]] ?? null) : "",
        jaName: decodeHtmlEntities(rawName),
        cardThumbFile: imgM ? imgM[1] : null,
      };
    } catch {
      if (i < 2) await sleep(1000 * (i + 1));
    }
  }
  return null;
}

async function downloadImage(cardThumbFile, destPath) {
  const url = `${API_BASE}${cardThumbFile}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": HEADERS["User-Agent"], "Referer": API_BASE + "/" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (r.status === 404) return null;
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
    } catch {}
    await sleep(500 * (i + 1));
  }
  return null;
}

async function main() {
  if (!(await exists(CACHE_PATH))) {
    throw new Error(
      `${CACHE_PATH} が見つかりません。先に node scripts/scrape-official-images.mjs --rescan を実行してください。`
    );
  }
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
  const setMap = cache.setMap;

  const cardData = JSON.parse(await fs.readFile(CARD_DATA_PATH, "utf-8"));
  const existingCodes = new Set(cardData.map((s) => s.c));

  const report = { generatedAt: new Date().toISOString(), sets: {} };
  let anyAdded = false;

  for (const target of TARGET_SETS) {
    if (existingCodes.has(target.code)) {
      console.log(`[${target.code}] 既にcardData.jsonに存在するためスキップ`);
      continue;
    }
    const sourceKeys = target.sourceCacheKeys || [target.code];
    const officialCards = sourceKeys.flatMap((key) => setMap[key] || []);
    if (officialCards.length === 0) {
      throw new Error(
        `[${target.code}] official-card-cache.jsonに見つかりません（探索キー: ${sourceKeys.join(", ")}）。` +
        `--rescanを試すか、setCodeを確認してください。`
      );
    }

    // extraCardIds: official-card-cache.jsonのスキャン漏れで欠番になったcardIdを
    // 個別に補う（BW/XYでBREAK進化カードの欠落が繰り返し見つかった）。
    // cardThumbFileはキャッシュに無いため、details.php自身から取得する
    // excludeCardIds: 逆に、キャッシュには載っているがセット固有の番号を持たないカード
    // （例: 基本エネルギーの汎用インサート。details.phpで確認済み＝"NNN/NNN"表記自体が無い）
    // を明示的に除外する。無検証で除外しないこと
    // （details.phpで番号なしと確認した上でのみリストに追加する）
    const excludeSet = new Set((target.excludeCardIds || []).map(String));
    const cacheJobs = officialCards
      .map((c) => ({ cardId: extractCardId(c.cardThumbFile), cardThumbFile: c.cardThumbFile }))
      .filter((j) => j.cardId && !excludeSet.has(j.cardId));
    const extraJobs = (target.extraCardIds || []).map((cardId) => ({ cardId: String(cardId), cardThumbFile: null }));
    const jobs = [...cacheJobs, ...extraJobs];

    console.log(`[${target.code}] ${jobs.length}枚（探索キー: ${sourceKeys.join(", ")}${extraJobs.length ? `, +extraCardIds×${extraJobs.length}` : ""}）を details.php で検証中...`);

    const details = [];
    const failed = [];
    let idx = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        const detail = await fetchCardDetail(job.cardId);
        // cardThumbFileはキャッシュ側の値を優先（同一のはずだが、既存の挙動を変えないため）。
        // 無ければdetails.php自身から取得した値にフォールバックする（extraCardIds用）。
        // 両方とも無ければ画像パスが取れていないため失敗扱いにする
        const cardThumbFile = job.cardThumbFile || detail?.cardThumbFile;
        if (detail && cardThumbFile) details.push({ ...detail, cardThumbFile });
        else failed.push(job.cardId);
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers);

    if (failed.length > MAX_FAILED_CARDS) {
      throw new Error(
        `[${target.code}] 番号取得に失敗したカード数(${failed.length})が上限(${MAX_FAILED_CARDS})を超えました。` +
        `不完全なデータをcardData.jsonに書き込まず中断します。失敗ID: [${failed.join(", ")}]`
      );
    }

    // 番号の重複・欠番・レアリティ未取得をチェックしてから採用する
    // （絶対にやってはいけないこと: 未検証データの投入、掲載順=番号順の無検証採用）
    //
    // 例外: 2デッキ同梱の対戦スタートセット等は、両デッキ共通のトレーナー/エネルギーカードが
    // 公式サイト上で別cardIDとして2重に掲載されていることがある（BW/XY調査のXYEで実例あり）。
    // jaNameが完全一致する場合に限りスキップ（後勝ちを採用）する。
    // jaNameが食い違う場合は本来の異常（絶対にやってはいけないこと）としてthrowする
    const byLocal = new Map();
    for (const d of details) {
      const n = parseInt(d.local, 10);
      if (byLocal.has(n)) {
        const prev = byLocal.get(n);
        if (prev.jaName === d.jaName) continue;
        throw new Error(`[${target.code}] 番号 ${d.local} が重複しています（cardID差異を確認してください）。既存: ${prev.jaName} / 新規: ${d.jaName}`);
      }
      if (d.rarity === null) {
        throw new Error(`[${target.code}] cardID未知のレアリティコードを検出しました: ${JSON.stringify(d)}`);
      }
      byLocal.set(n, d);
    }
    const totals = new Set(details.map((d) => d.total));
    if (totals.size > 1) {
      throw new Error(`[${target.code}] 総数(total)が一致しません: ${[...totals].join(", ")}`);
    }
    const total = parseInt([...totals][0], 10);
    const missing = [];
    for (let n = 1; n <= total; n++) {
      if (!byLocal.has(n)) missing.push(n);
    }
    if (missing.length > 0) {
      throw new Error(`[${target.code}] 欠番があります（1〜${total}のうち）: ${missing.join(", ")}`);
    }

    const sortedLocals = [...byLocal.keys()].sort((a, b) => a - b);
    const k = sortedLocals.map((n) => {
      const d = byLocal.get(n);
      return [String(n).padStart(3, "0"), d.jaName, "", d.rarity];
    });

    const newSet = { c: target.code, ja: target.ja, en: "", sr: target.sr, of: total, y: target.y, k };
    if (target.codeAlias) newSet.codeAlias = target.codeAlias;
    cardData.push(newSet);
    anyAdded = true;

    console.log(`[${target.code}] 番号検証OK: ${k.length}枚（001〜${String(total).padStart(3, "0")}、失敗 ${failed.length}件）`);

    // 画像を取得
    const setTotal = computeSetTotal(newSet.k);
    let imgDownloaded = 0, imgSkipped = 0, imgFailed = 0;
    let idx2 = 0;
    const workers2 = Array.from({ length: CONCURRENCY }, async () => {
      while (idx2 < sortedLocals.length) {
        const n = sortedLocals[idx2++];
        const d = byLocal.get(n);
        const localId = String(n).padStart(3, "0");
        const dest = path.join(
          OUT_DIR, target.sr, target.code,
          buildFileName(d.jaName, target.code, localId, d.rarity, setTotal) + ".jpg"
        );
        if (await isUsableImage(dest)) { imgSkipped++; continue; }
        const buf = await downloadImage(d.cardThumbFile, dest);
        if (buf) { await writeFileAtomic(dest, buf); imgDownloaded++; }
        else imgFailed++;
        await sleep(DELAY_MS);
      }
    });
    await Promise.all(workers2);

    console.log(`[${target.code}] 画像: 取得${imgDownloaded} スキップ${imgSkipped} 失敗${imgFailed}`);
    report.sets[target.code] = {
      cards: k.length, cardFailed: failed.length, cardFailedIds: failed,
      imgDownloaded, imgSkipped, imgFailed,
    };

    // 1セットごとにcardData.jsonへ書き込む（TARGET_SETS内の後続セットで例外が
    // 発生しても、ここまでに成功したセットの取り込みが失われないようにするため。
    // 「1セットずつ取り込み、都度受け入れ条件を確認する」運用と対応させている
    await fs.writeFile(CARD_DATA_PATH, JSON.stringify(cardData, null, 2) + "\n", "utf-8");
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[${target.code}] cardData.json を更新しました。\n`);
  }

  if (!anyAdded) {
    console.log("\n追加対象はありませんでした（既に取り込み済み）。");
  }
  console.log("詳細: scripts/scrape-missing-sets-report.json");
}

main().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
